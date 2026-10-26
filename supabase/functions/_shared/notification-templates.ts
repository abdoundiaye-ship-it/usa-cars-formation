/**
 * Textes des notifications au client (décision E5-a, docs/19_notifications.md) — module autonome (Deno et Vitest).
 *
 * - E-mail : objet + texte.
 * - WhatsApp : modèle approuvé par Meta (via Twilio) ; ses variables `{{1}}`, `{{2}}`… suivent l'ordre de
 *   `WHATSAPP_VARIABLES` (le lien vers l'espace client est toujours la dernière variable quand le texte en a un).
 * Aucun texte ne contient de coordonnées de paiement (CLAUDE.md règle 7).
 */

export type NotificationTemplate =
  | "login_link"
  | "lot_won"
  | "quote_issued"
  | "payment_due_reminder"
  | "vessel_departed"
  | "eta_changed"
  | "arrived"
  | "documents_ready"
  | "payment_overdue"
  | "test_message"
  | "unclaimed_reminder"
  | "formal_notice"
  | "claim_update";

export type NotificationVariables = Record<string, string>;

const SIGNATURE = "USA CARS — Dakar.";

interface TemplateDefinition {
  subject: (v: NotificationVariables) => string;
  text: (v: NotificationVariables) => string;
  /** Ordre des variables du modèle WhatsApp ({{1}}, {{2}}…). */
  whatsappVariables: string[];
}

export const TEMPLATES: Record<NotificationTemplate, TemplateDefinition> = {
  login_link: {
    subject: () => "Votre accès à l’espace client USA CARS",
    text: (v) =>
      `Bonjour ${v.nom}, voici votre lien personnel pour accéder à votre espace USA CARS : ${v.lien}. Il est valable 15 minutes et ne peut servir qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
    whatsappVariables: ["nom", "lien"],
  },
  lot_won: {
    subject: (v) => `Lot remporté — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, bonne nouvelle : le véhicule ${v.vehicule} (dossier ${v.reference}) a été remporté. Votre devis vous sera transmis sous peu ; le paiement 1 est attendu au plus tard le ${v.echeance}. Retrouvez le détail dans votre espace : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "vehicule", "echeance", "lien"],
  },
  quote_issued: {
    subject: (v) => `Votre devis ${v.numero} — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, votre devis ${v.numero} pour le dossier ${v.reference} est disponible : ${v.total} (hors assurance). Il est valable jusqu’au ${v.validite}. Vous pouvez l’accepter dans votre espace, en indiquant votre choix pour l’assurance transport : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "numero", "total", "validite", "lien"],
  },
  payment_due_reminder: {
    subject: (v) => `Rappel : ${v.echeance} — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, pour le dossier ${v.reference}, le ${v.echeance} de ${v.montant} est attendu au plus tard le ${v.date}. Les comptes de paiement officiels figurent dans votre espace : ${v.lien}. USA CARS ne communique jamais de changement de compte par message ; en cas de doute, appelez le numéro officiel. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "echeance", "montant", "date", "lien"],
  },
  vessel_departed: {
    subject: (v) => `Votre véhicule est en route — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, le conteneur ${v.conteneur} de votre dossier ${v.reference} a quitté le port de départ. Arrivée à Dakar prévue le ${v.eta} (date indicative communiquée par le transporteur). Suivi : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "conteneur", "eta", "lien"],
  },
  eta_changed: {
    subject: (v) => `Date d’arrivée mise à jour — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, le transporteur a modifié la date d’arrivée prévue pour votre dossier ${v.reference} : ${v.nouvelle_eta} au lieu du ${v.ancienne_eta} (date indicative). Détail : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "ancienne_eta", "nouvelle_eta", "lien"],
  },
  arrived: {
    subject: (v) => `Votre véhicule est arrivé à Dakar — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, le navire transportant votre véhicule (dossier ${v.reference}) est arrivé à Dakar le ${v.date}. Nous vous contactons pour la suite : règlement du solde le cas échéant, remise des documents et enlèvement. Détail : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "date", "lien"],
  },
  documents_ready: {
    subject: (v) => `Vos documents sont prêts — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, votre paiement est complet pour le dossier ${v.reference} : les documents du véhicule (B/L, titre, factures) sont prêts à vous être remis, à vous ou à votre mandataire muni d’une procuration et d’une pièce d’identité. Contactez-nous pour fixer le rendez-vous. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference"],
  },
  payment_overdue: {
    subject: (v) => `Échéance dépassée — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, sauf erreur de notre part, le ${v.echeance} du dossier ${v.reference} n’est pas encore réglé (reste dû : ${v.montant}). Merci de régulariser au plus vite pour éviter des frais de retard, conformément au contrat. Détail et comptes officiels : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "echeance", "montant", "lien"],
  },
  unclaimed_reminder: {
    subject: (v) => `Courrier de relance ${v.numero} — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, votre véhicule (dossier ${v.reference}) est arrivé à Dakar et n’a pas encore été réglé ou enlevé. Nous vous avons adressé la lettre de relance ${v.numero}, disponible dans votre espace : ${v.lien}. Merci de prendre contact avec nous pour régulariser. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "numero", "lien"],
  },
  formal_notice: {
    subject: (v) => `Mise en demeure ${v.numero} — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, nous vous avons adressé la mise en demeure ${v.numero} concernant le dossier ${v.reference} : régularisation attendue au plus tard le ${v.date_limite}, conformément aux articles 21 et 22 du contrat. Le courrier est disponible dans votre espace : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "numero", "date_limite", "lien"],
  },
  claim_update: {
    subject: (v) => `Réponse à votre réclamation — dossier ${v.reference}`,
    text: (v) =>
      `Bonjour ${v.nom}, nous avons mis à jour le traitement de votre réclamation pour le dossier ${v.reference}. Vous pouvez en suivre l’avancement et notre réponse dans votre espace : ${v.lien}. ${SIGNATURE}`,
    whatsappVariables: ["nom", "reference", "lien"],
  },
  test_message: {
    subject: () => "Message de test — USA CARS",
    text: (v) =>
      `Bonjour ${v.nom}, ceci est un message de test envoyé par l’application USA CARS pour vérifier la configuration des notifications. ${SIGNATURE}`,
    whatsappVariables: ["nom"],
  },
};

export interface RenderedNotification {
  subject: string;
  text: string;
  /** Variables du modèle WhatsApp, au format attendu par Twilio (ContentVariables). */
  whatsappVariables: Record<string, string>;
}

/** Texte final ; le lien vers l'espace client est ajouté s'il n'est pas fourni (login_link a le sien). */
export function renderNotification(
  template: NotificationTemplate,
  variables: NotificationVariables,
  portalUrl: string,
): RenderedNotification {
  const definition = TEMPLATES[template];
  const v: NotificationVariables = { lien: portalUrl, ...variables };
  for (const key of definition.whatsappVariables) {
    if (!v[key]) throw new Error(`Variable « ${key} » manquante pour le modèle ${template}.`);
  }
  return {
    subject: definition.subject(v),
    text: definition.text(v),
    whatsappVariables: Object.fromEntries(definition.whatsappVariables.map((key, i) => [String(i + 1), v[key]!])),
  };
}
