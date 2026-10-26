import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Notifications au client (R16, US-4.5). Les messages sont mis en file dans la table notifications (par la base,
 * ou ici pour le lien de connexion) puis envoyés par la fonction Supabase send-notifications : chaque minute
 * (pg_cron) en production, et immédiatement quand l'application le demande (lien de connexion, « Envoyer
 * maintenant »). Sans identifiants de fournisseur, l'envoi est simulé (CLAUDE.md règle 10).
 * Le lien de connexion n'est jamais écrit dans les journaux de l'application ; la base l'efface du journal
 * des notifications une fois le message traité.
 */

/** Déclenche l'envoi des messages en file (clé service_role, côté serveur uniquement). */
export async function dispatchNotifications(): Promise<{ ok: boolean }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.functions.invoke("send-notifications", { body: {} });
  if (error) console.error("notifications: envoi non déclenché", error.message);
  return { ok: !error };
}

/** US-4.1 : lien de connexion envoyé par e-mail et par WhatsApp, puis envoi immédiat. */
export async function deliverClientLoginLink(clientId: string, url: string): Promise<{ queued: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("enqueue_notification", {
    p_client_id: clientId,
    p_dossier_id: null,
    p_template: "login_link",
    p_variables: { lien: url },
  });
  if (error) {
    console.error("notifications: lien de connexion non mis en file", error.message);
    return { queued: 0 };
  }
  await dispatchNotifications();
  return { queued: data ?? 0 };
}
