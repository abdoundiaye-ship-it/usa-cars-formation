/**
 * US-1.0 — Compte administrateur initial (pnpm admin:create).
 *
 * Invite ADMIN_EMAIL (le mot de passe est choisi par la personne via le lien reçu) et lui attribue le rôle admin.
 * Idempotent : relancé, il ne crée ni doublon ni nouvelle invitation ; il se contente de vérifier l’état du compte.
 *
 * Par défaut sur Supabase LOCAL (.env.local). Sur la production, uniquement après validation de USA CARS,
 * avec NEXT_PUBLIC_APP_ENV=production et l’option --production (commande annoncée avant exécution).
 *
 * Option --lien : affiche en plus un lien d’accès à usage unique (choix du mot de passe), sans e-mail.
 * Utile tant que les modèles d’e-mail Supabase ne sont pas modifiables (offre gratuite sans SMTP personnalisé).
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertNotProductionOutsideProd, PRODUCTION_PROJECT_REF } from "../lib/env";
import type { Database } from "../lib/supabase/database.types";

if (existsSync(".env.local") && !process.env.NEXT_PUBLIC_SUPABASE_URL) process.loadEnvFile(".env.local");

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_ENV: z.enum(["local", "production"]).default("local"),
    APP_URL: z.url().default("http://localhost:3000"),
    ADMIN_EMAIL: z
      .email("ADMIN_EMAIL doit contenir l’adresse e-mail de l’administrateur initial.")
      .transform((v) => v.toLowerCase()),
    ADMIN_FULL_NAME: z.string().trim().min(2).default("Administrateur USA CARS"),
  })
  .parse(process.env);

assertNotProductionOutsideProd(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_APP_ENV);
const isProduction = env.NEXT_PUBLIC_SUPABASE_URL.includes(PRODUCTION_PROJECT_REF);
if (isProduction && !process.argv.includes("--production")) {
  console.error("⛔ Cible = PRODUCTION. Relancez avec --production après validation de USA CARS.");
  process.exit(1);
}

const admin = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`Cible : ${isProduction ? "PRODUCTION" : "locale"} — compte ${env.ADMIN_EMAIL}`);

  let userId = await findUserId(env.ADMIN_EMAIL);
  if (userId) {
    console.log("• Compte d’authentification déjà présent : aucune nouvelle invitation.");
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(env.ADMIN_EMAIL, {
      redirectTo: `${env.APP_URL}/auth/confirm?next=/compte/mot-de-passe`,
      data: { full_name: env.ADMIN_FULL_NAME },
    });
    if (error || !data.user) throw new Error(`Invitation impossible : ${error?.message ?? "réponse vide"}`);
    userId = data.user.id;
    console.log("• Invitation envoyée par e-mail.");
  }

  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();
  if (readError) throw new Error(`Lecture du profil impossible : ${readError.message}`);

  if (!profile) {
    const { error } = await admin
      .from("profiles")
      .insert({ id: userId, email: env.ADMIN_EMAIL, full_name: env.ADMIN_FULL_NAME, role: "admin" });
    if (error) throw new Error(`Création du profil impossible : ${error.message}`);
    await admin.rpc("log_audit", {
      p_action: "bootstrap_admin",
      p_object_type: "profiles",
      p_object_id: userId,
      p_after: { email: env.ADMIN_EMAIL, role: "admin" },
      p_actor_label: "script:create-admin",
    });
    console.log("• Profil administrateur créé et journalisé.");
  } else if (profile.role === "admin" && profile.active) {
    console.log("• Profil administrateur déjà en place : rien à faire.");
  } else {
    // Pas de promotion silencieuse d’un compte existant : décision humaine requise.
    console.warn(
      `⚠ Le compte existe avec le rôle « ${profile.role} »${profile.active ? "" : " (désactivé)"}. ` +
        "Aucune modification : changez son rôle depuis l’écran Utilisateurs avec un autre administrateur.",
    );
    process.exitCode = 2;
  }

  if (process.argv.includes("--lien") && process.exitCode !== 2) {
    // Même mécanisme que l’écran Utilisateurs : lien de récupération haché, vérifié par /auth/confirm.
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: env.ADMIN_EMAIL });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) throw new Error(`Lien d’accès impossible : ${error?.message ?? "réponse vide"}`);
    const params = new URLSearchParams({ token_hash: tokenHash, type: "recovery", next: "/compte/mot-de-passe" });
    console.log("• Lien d’accès à usage unique (valable peu de temps, ne le transmettez à personne) :");
    console.log(`  ${env.APP_URL}/auth/confirm?${params.toString()}`);
  }
}

main().catch((error: unknown) => {
  console.error(`⛔ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
