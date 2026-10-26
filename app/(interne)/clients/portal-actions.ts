"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, success, type FormState } from "@/lib/forms";
import { createClientLoginLink, ensureClientAccount } from "@/lib/server/client-access";
import { deliverClientLoginLink } from "@/lib/server/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const clientIdSchema = z.object({ clientId: z.uuid("Client inconnu.") });

/**
 * US-4.1 : l'agent ouvre l'accès au portail (compte créé au besoin, P4-1) et obtient un lien de connexion à usage
 * unique, envoyé au client par e-mail et par WhatsApp (envoi simulé tant que les fournisseurs ne sont pas
 * configurés) et affiché ici pour être transmis à la main si besoin.
 */
export async function sendPortalAccess(_previous: FormState, formData: FormData): Promise<FormState> {
  const access = await getInternalAccess(SCREEN_ROLES.operationsWrite);
  if (!access) return failure("Action réservée à l’administrateur et aux agents opérations.");
  const parsed = clientIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Client inconnu.");

  const supabase = await createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, notify_email")
    .eq("id", parsed.data.clientId)
    .maybeSingle();
  if (!client) return failure("Client introuvable.");

  const account = await ensureClientAccount(client);
  if (!account.ok) return failure(account.message);
  const link = await createClientLoginLink(account.userId, client.id, "invitation", access.userId);
  if (!link.ok) return failure(link.message);
  await deliverClientLoginLink(client.id, link.url);
  await supabase.rpc("log_audit", {
    p_action: "client_login_link",
    p_object_type: "clients",
    p_object_id: client.id,
  });
  revalidatePath(`/clients/${client.id}` as Route);
  return success(
    `${account.created ? "Accès au portail ouvert. " : ""}Lien de connexion valable jusqu’à ${link.expiresAt.toLocaleTimeString("fr-FR", { timeZone: "Africa/Dakar", hour: "2-digit", minute: "2-digit" })} (heure de Dakar), à usage unique.`,
    { lien: link.url },
  );
}
