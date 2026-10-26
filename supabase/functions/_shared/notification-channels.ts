/**
 * Adaptateurs d'envoi des notifications (CLAUDE.md règle 10 : interchangeables, simulés sans identifiants).
 * Module autonome (Deno et Vitest) ; `fetch` injectable pour les tests.
 *
 * Paramètres renseignés au déploiement (secrets de la fonction send-notifications) :
 * - e-mail (Brevo) : BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME ;
 * - WhatsApp (Twilio) : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_CONTENT_SIDS (JSON :
 *   modèle → identifiant du modèle approuvé, ex. {"lot_won": "HX…"}) ;
 * - mode test : NOTIFICATIONS_TEST_EMAIL, NOTIFICATIONS_TEST_WHATSAPP — si renseignés, TOUS les messages leur
 *   sont redirigés (le journal garde le destinataire d'origine).
 */

export interface ChannelConfig {
  brevoApiKey?: string;
  emailFrom?: string;
  emailFromName?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappFrom?: string;
  twilioContentSids: Record<string, string>;
  testEmail?: string;
  testWhatsapp?: string;
}

export type SendResult =
  { status: "sent"; providerMessageId: string | null } | { status: "simulated" } | { status: "failed"; error: string };

type Fetch = typeof fetch;

/** Lecture des paramètres (variables d'environnement de la fonction). */
export function readChannelConfig(get: (name: string) => string | undefined): ChannelConfig {
  const value = (name: string) => get(name)?.trim() || undefined;
  let contentSids: Record<string, string> = {};
  try {
    contentSids = JSON.parse(value("TWILIO_CONTENT_SIDS") ?? "{}") as Record<string, string>;
  } catch {
    contentSids = {};
  }
  return {
    brevoApiKey: value("BREVO_API_KEY"),
    emailFrom: value("EMAIL_FROM"),
    emailFromName: value("EMAIL_FROM_NAME") ?? "USA CARS",
    twilioAccountSid: value("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: value("TWILIO_AUTH_TOKEN"),
    twilioWhatsappFrom: value("TWILIO_WHATSAPP_FROM"),
    twilioContentSids: contentSids,
    testEmail: value("NOTIFICATIONS_TEST_EMAIL"),
    testWhatsapp: value("NOTIFICATIONS_TEST_WHATSAPP"),
  };
}

/** Destinataire effectif : le destinataire de test s'il est configuré (mode test), sinon celui du message. */
export function effectiveRecipient(
  channel: "email" | "whatsapp",
  recipient: string,
  config: ChannelConfig,
): { to: string | null; redirected: boolean } {
  const test = channel === "email" ? config.testEmail : config.testWhatsapp;
  if (test) return { to: test, redirected: test !== recipient };
  // « test » : message de test sans destinataire de test configuré.
  return { to: recipient === "test" ? null : recipient, redirected: false };
}

/** E-mail transactionnel par l'API Brevo (texte simple). */
export async function sendEmail(
  config: ChannelConfig,
  to: string,
  subject: string,
  text: string,
  fetchImpl: Fetch = fetch,
): Promise<SendResult> {
  if (!config.brevoApiKey || !config.emailFrom) return { status: "simulated" };
  try {
    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: config.emailFrom, name: config.emailFromName ?? "USA CARS" },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string };
    if (!response.ok) return { status: "failed", error: `Brevo ${response.status} : ${body.message ?? "erreur"}` };
    return { status: "sent", providerMessageId: body.messageId ?? null };
  } catch (error) {
    return { status: "failed", error: `Brevo injoignable : ${(error as Error).message}` };
  }
}

/**
 * Message WhatsApp par l'API Twilio : modèle approuvé (ContentSid + variables) s'il est configuré pour ce modèle ;
 * sinon texte libre — accepté seulement dans une conversation ouverte (bac à sable Twilio, réponse du client).
 */
export async function sendWhatsApp(
  config: ChannelConfig,
  to: string,
  template: string,
  variables: Record<string, string>,
  text: string,
  fetchImpl: Fetch = fetch,
): Promise<SendResult> {
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioWhatsappFrom) return { status: "simulated" };
  const form = new URLSearchParams({ From: `whatsapp:${config.twilioWhatsappFrom}`, To: `whatsapp:${to}` });
  const contentSid = config.twilioContentSids[template];
  if (contentSid) {
    form.set("ContentSid", contentSid);
    form.set("ContentVariables", JSON.stringify(variables));
  } else {
    form.set("Body", text);
  }
  try {
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!response.ok) {
      return {
        status: "failed",
        error: `Twilio ${response.status}${body.code ? ` (${body.code})` : ""} : ${body.message ?? "erreur"}`,
      };
    }
    return { status: "sent", providerMessageId: body.sid ?? null };
  } catch (error) {
    return { status: "failed", error: `Twilio injoignable : ${(error as Error).message}` };
  }
}
