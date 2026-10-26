import { describe, expect, it } from "vitest";
import {
  renderNotification,
  TEMPLATES,
  type NotificationTemplate,
} from "@/supabase/functions/_shared/notification-templates.ts";
import {
  effectiveRecipient,
  readChannelConfig,
  sendEmail,
  sendWhatsApp,
} from "@/supabase/functions/_shared/notification-channels.ts";

const portal = "https://usa-cars.exemple.test/connexion/client";

describe("textes des notifications (E5-a, docs/19)", () => {
  it("devis émis : objet, texte et variables WhatsApp dans l'ordre du modèle", () => {
    const rendered = renderNotification(
      "quote_issued",
      {
        nom: "Mamadou Diallo",
        reference: "UC-2026-0042",
        numero: "DV-2026-0007",
        total: "14 700 $US",
        validite: "21/10/2026 à 10h00",
      },
      portal,
    );
    expect(rendered.subject).toBe("Votre devis DV-2026-0007 — dossier UC-2026-0042");
    expect(rendered.text).toContain("14 700 $US (hors assurance)");
    expect(rendered.text).toContain(portal);
    expect(rendered.whatsappVariables).toEqual({
      "1": "Mamadou Diallo",
      "2": "UC-2026-0042",
      "3": "DV-2026-0007",
      "4": "14 700 $US",
      "5": "21/10/2026 à 10h00",
      "6": portal,
    });
  });

  it("lien de connexion : le lien personnel remplace celui de l'espace", () => {
    const rendered = renderNotification(
      "login_link",
      { nom: "Client", lien: "https://x.test/connexion/lien/abc" },
      portal,
    );
    expect(rendered.text).toContain("https://x.test/connexion/lien/abc");
    expect(rendered.text).not.toContain(portal);
  });

  it("variable manquante : erreur explicite (jamais de « undefined » envoyé)", () => {
    expect(() => renderNotification("lot_won", { nom: "Client" }, portal)).toThrow(/reference/);
  });

  it("courriers « véhicule non réclamé » (U4) : numéro, date limite, renvoi vers l’espace client", () => {
    const portal = "https://usa-cars.exemple.test/connexion/client";
    const notice = renderNotification(
      "formal_notice",
      { nom: "Awa", reference: "DEMO-2026-0007", numero: "MD-2026-0001", date_limite: "05/11/2026" },
      portal,
    );
    expect(notice.subject).toBe("Mise en demeure MD-2026-0001 — dossier DEMO-2026-0007");
    expect(notice.text).toContain("au plus tard le 05/11/2026");
    expect(notice.whatsappVariables).toEqual({
      "1": "Awa",
      "2": "DEMO-2026-0007",
      "3": "MD-2026-0001",
      "4": "05/11/2026",
      "5": portal,
    });
    const reminder = renderNotification(
      "unclaimed_reminder",
      { nom: "Awa", reference: "DEMO-2026-0007", numero: "LR-2026-0001" },
      portal,
    );
    expect(reminder.text).toContain("lettre de relance LR-2026-0001, disponible dans votre espace");
  });

  it("règle 7 : aucun texte ne contient de coordonnées de paiement", () => {
    const sample: Record<string, string> = {
      nom: "N",
      reference: "R",
      vehicule: "V",
      echeance: "E",
      numero: "No",
      total: "T",
      validite: "Va",
      montant: "M",
      date: "D",
      conteneur: "C",
      eta: "Et",
      ancienne_eta: "A",
      nouvelle_eta: "Nv",
      date_limite: "Dl",
    };
    for (const template of Object.keys(TEMPLATES) as NotificationTemplate[]) {
      const { text, subject } = renderNotification(template, { ...sample, lien: portal }, portal);
      expect(`${subject} ${text}`).not.toMatch(/IBAN|RIB|\+221 ?\d{2} ?\d{3}|Wave :|Orange Money :/i);
    }
  });
});

describe("adaptateurs d'envoi (règle 10 : réels ou simulés)", () => {
  const empty = readChannelConfig(() => undefined);
  const configured = readChannelConfig(
    (name) =>
      ({
        BREVO_API_KEY: "cle-brevo",
        EMAIL_FROM: "no-reply@exemple.test",
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "jeton",
        TWILIO_WHATSAPP_FROM: "+14155238886",
        TWILIO_CONTENT_SIDS: '{"lot_won": "HX111"}',
      })[name],
  );
  const recorder = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messageId: "m-1", sid: "SM1" }), { status: 201 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sans identifiants : envoi simulé, aucun appel réseau", async () => {
    const { calls, fetchImpl } = recorder();
    expect(await sendEmail(empty, "a@exemple.test", "Objet", "Texte", fetchImpl)).toEqual({ status: "simulated" });
    expect(await sendWhatsApp(empty, "+221770000001", "lot_won", {}, "Texte", fetchImpl)).toEqual({
      status: "simulated",
    });
    expect(calls).toHaveLength(0);
  });

  it("e-mail Brevo : expéditeur, destinataire, objet, texte", async () => {
    const { calls, fetchImpl } = recorder();
    expect(await sendEmail(configured, "a@exemple.test", "Objet", "Texte", fetchImpl)).toEqual({
      status: "sent",
      providerMessageId: "m-1",
    });
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      sender: { email: "no-reply@exemple.test" },
      to: [{ email: "a@exemple.test" }],
      subject: "Objet",
      textContent: "Texte",
    });
  });

  it("WhatsApp Twilio : modèle approuvé s'il est configuré, texte libre sinon", async () => {
    const { calls, fetchImpl } = recorder();
    await sendWhatsApp(configured, "+221770000001", "lot_won", { "1": "Mamadou" }, "Texte", fetchImpl);
    await sendWhatsApp(configured, "+221770000001", "arrived", { "1": "Mamadou" }, "Texte libre", fetchImpl);
    const first = new URLSearchParams(String(calls[0]!.init.body));
    expect(first.get("To")).toBe("whatsapp:+221770000001");
    expect(first.get("ContentSid")).toBe("HX111");
    expect(first.get("ContentVariables")).toBe('{"1":"Mamadou"}');
    expect(new URLSearchParams(String(calls[1]!.init.body)).get("Body")).toBe("Texte libre");
  });

  it("mode test : tous les messages vont aux destinataires de test", () => {
    const test = readChannelConfig((name) =>
      name === "NOTIFICATIONS_TEST_EMAIL"
        ? "test@exemple.test"
        : name === "NOTIFICATIONS_TEST_WHATSAPP"
          ? "+10000000000"
          : undefined,
    );
    expect(effectiveRecipient("email", "client@exemple.test", test)).toEqual({
      to: "test@exemple.test",
      redirected: true,
    });
    expect(effectiveRecipient("whatsapp", "+221770000001", test)).toEqual({ to: "+10000000000", redirected: true });
    expect(effectiveRecipient("email", "client@exemple.test", empty)).toEqual({
      to: "client@exemple.test",
      redirected: false,
    });
    expect(effectiveRecipient("email", "test", empty).to).toBeNull(); // message de test sans destinataire configuré
  });
});
