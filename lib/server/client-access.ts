import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { technicalEmail } from "@/lib/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Connexion des clients au portail (US-4.1, R16, décisions I3-a et P4-1).
 *
 * - Chaque client a un compte de connexion Supabase identifié par son e-mail ; sans e-mail, par une adresse
 *   technique interne jamais utilisée pour un envoi (P4-1).
 * - Le client se connecte par un **lien à usage unique** valable {client_auth.link_ttl_minutes} minutes, envoyé
 *   par e-mail et par WhatsApp. Seule l'empreinte SHA-256 du jeton est conservée (table client_login_tokens).
 * - L'ouverture du lien affiche un bouton : un aperçu automatique (WhatsApp, messagerie) ne consomme pas le jeton.
 * - À la validation, le serveur ouvre la session par un lien magique Supabase généré et vérifié côté serveur.
 *
 * La clé service_role n'est utilisée qu'ici, côté serveur (CLAUDE.md règle 9).
 */

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Paramètre numérique en vigueur, lu côté serveur (le client n'est pas encore connecté). */
async function settingNumber(key: string): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("settings_current").select("value").eq("key", key).maybeSingle();
  return typeof data?.value === "number" ? data.value : null;
}

export type ClientLink = { ok: true; url: string; expiresAt: Date } | { ok: false; message: string };

/**
 * Crée un lien de connexion à usage unique pour un compte client. Au-delà de {client_auth.max_links_per_hour}
 * demandes dans l'heure, refuse (anti-abus) — sauf pour une invitation de l'agent.
 */
export async function createClientLoginLink(
  userId: string,
  clientId: string,
  channel: "email" | "whatsapp" | "invitation",
  createdBy: string | null = null,
): Promise<ClientLink> {
  const admin = createSupabaseAdminClient();
  const ttl = (await settingNumber("client_auth.link_ttl_minutes")) ?? 15;
  if (channel !== "invitation") {
    const max = await settingNumber("client_auth.max_links_per_hour");
    if (max !== null) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("client_login_tokens")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", since);
      if ((count ?? 0) >= max) {
        return { ok: false, message: "Trop de demandes de lien en une heure. Réessayez plus tard." };
      }
    }
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  const { error } = await admin.from("client_login_tokens").insert({
    user_id: userId,
    client_id: clientId,
    token_hash: hashToken(token),
    channel,
    expires_at: expiresAt.toISOString(),
    created_by: createdBy,
  });
  if (error) return { ok: false, message: "Le lien de connexion n’a pas pu être créé. Réessayez." };
  return { ok: true, url: `${getServerEnv().APP_URL}/connexion/lien/${token}`, expiresAt };
}

/**
 * Ouvre la session du client à partir d'un jeton : usage unique (marqué utilisé de façon atomique), non expiré,
 * compte client actif. Renvoie false sans détail (pas de divulgation).
 */
export async function redeemClientLoginLink(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return false;
  const admin = createSupabaseAdminClient();
  const { data: used } = await admin
    .from("client_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (!used) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("email, role, active")
    .eq("id", used.user_id)
    .maybeSingle();
  if (!profile || profile.role !== "client" || !profile.active) return false;

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: profile.email });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) return false;
  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  return !verifyError;
}

/**
 * Compte de connexion d'un client (création au besoin) : e-mail du client, sinon adresse technique (P4-1).
 * Le rattachement (profil « client ») est fait par la base au nom de l'agent connecté, et journalisé.
 */
export async function ensureClientAccount(client: {
  id: string;
  notify_email: string | null;
}): Promise<{ ok: true; userId: string; email: string; created: boolean } | { ok: false; message: string }> {
  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  const { data: accounts } = await supabase.rpc("client_portal_accounts", { p_client_id: client.id });
  const existing = accounts?.find((a) => a.active);
  if (existing) return { ok: true, userId: existing.user_id, email: existing.email, created: false };

  const email = client.notify_email?.trim().toLowerCase() || technicalEmail(client.id);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return { ok: false, message: "Cette adresse e-mail est déjà utilisée par un autre compte de l’application." };
    }
    return { ok: false, message: "Le compte du client n’a pas pu être créé. Réessayez." };
  }
  const { error: registerError } = await supabase.rpc("register_client_portal_access", {
    p_user_id: data.user.id,
    p_client_id: client.id,
    p_email: email,
  });
  if (registerError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, message: "L’accès n’a pas pu être ouvert : la création du compte a été annulée." };
  }
  return { ok: true, userId: data.user.id, email, created: true };
}

/**
 * Compte client actif correspondant à un identifiant saisi (e-mail ou numéro WhatsApp au format international).
 * Lecture serveur : le visiteur n'est pas connecté.
 */
export async function findClientAccount(
  identifier: { email: string } | { phone: string },
): Promise<{ userId: string; clientId: string } | null> {
  const admin = createSupabaseAdminClient();
  const query = admin.from("clients").select("id");
  const { data: clients } =
    "email" in identifier
      ? await query.eq("notify_email", identifier.email.toLowerCase())
      : await query.eq("notify_phone", identifier.phone);
  for (const client of clients ?? []) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("client_id", client.id)
      .eq("role", "client")
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (profile) return { userId: profile.id, clientId: client.id };
  }
  return null;
}
