/**
 * Fonction Supabase send-notifications (US-4.5, R16) : envoie les notifications en file (table notifications)
 * par e-mail (Brevo) et WhatsApp (Twilio), puis enregistre le résultat dans le journal.
 *
 * Appelée chaque minute par la base (pg_cron + pg_net, adresse et clé dans le coffre Vault) et par l'application
 * juste après une mise en file urgente (lien de connexion). Accès : clé service_role uniquement (en-tête
 * Authorization), car la fonction lit et met à jour la file pour tous les clients.
 * Sans identifiants de fournisseur, l'envoi est simulé (CLAUDE.md règle 10).
 */
import {
  effectiveRecipient,
  readChannelConfig,
  sendEmail,
  sendWhatsApp,
  type SendResult,
} from "../_shared/notification-channels.ts";
import { renderNotification, type NotificationTemplate } from "../_shared/notification-templates.ts";
import { SupabaseRest } from "../_shared/rest.ts";

type QueuedNotification = {
  id: string;
  template: NotificationTemplate;
  channel: "email" | "whatsapp";
  recipient: string;
  variables: Record<string, string>;
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { message: "Méthode non autorisée." });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Clé service_role de la fonction, ou jeton partagé NOTIFICATIONS_DISPATCH_TOKEN (même valeur que la clé
  // serveur de l'application si leurs formats diffèrent).
  const accepted = [serviceKey, Deno.env.get("NOTIFICATIONS_DISPATCH_TOKEN") ?? ""].filter((key) => key.length >= 20);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!accepted.some((key) => authorization === `Bearer ${key}`)) {
    return reply(401, { message: "Accès refusé." });
  }

  const api = new SupabaseRest(Deno.env.get("SUPABASE_URL")!, serviceKey, `Bearer ${serviceKey}`);
  const config = readChannelConfig((name) => Deno.env.get(name));
  const appUrl = (Deno.env.get("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  const portalUrl = `${appUrl}/connexion/client`;

  const { data: queued, error } = await api.rpc<QueuedNotification[]>("claim_notifications", { p_limit: 25 });
  if (error) {
    console.error("send-notifications: file inaccessible", error.message);
    return reply(500, { message: "File des notifications inaccessible." });
  }

  const summary = { sent: 0, simulated: 0, failed: 0 };
  for (const notification of queued ?? []) {
    let result: SendResult;
    let redirectedTo: string | null = null;
    try {
      const target = effectiveRecipient(notification.channel, notification.recipient, config);
      const providerReady =
        notification.channel === "email"
          ? Boolean(config.brevoApiKey && config.emailFrom)
          : Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioWhatsappFrom);
      if (!target.to) {
        // Message de test sans destinataire de test : simulé si le canal n'est pas configuré, échec sinon.
        result = providerReady
          ? { status: "failed", error: "Destinataire de test non configuré (NOTIFICATIONS_TEST_*)." }
          : { status: "simulated" };
      } else {
        if (target.redirected) redirectedTo = target.to;
        const rendered = renderNotification(notification.template, notification.variables ?? {}, portalUrl);
        result =
          notification.channel === "email"
            ? await sendEmail(config, target.to, rendered.subject, rendered.text)
            : await sendWhatsApp(config, target.to, notification.template, rendered.whatsappVariables, rendered.text);
      }
    } catch (failure) {
      result = { status: "failed", error: (failure as Error).message };
    }
    summary[result.status] += 1;
    await api.rpc("complete_notification", {
      p_id: notification.id,
      p_status: result.status,
      p_error: result.status === "failed" ? result.error : null,
      p_provider_message_id: result.status === "sent" ? result.providerMessageId : null,
      p_redirected_to: redirectedTo,
    });
  }
  return reply(200, summary);
});
