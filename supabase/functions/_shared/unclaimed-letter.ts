/**
 * Courriers de la procédure « véhicule non réclamé » (US-5.3, contrat art. 21–22, décisions U1 à U4) : lettre de
 * relance (LR) et mise en demeure (MD), modèle templates/courrier.docx. Textes rédigés d'après le contrat, marqués
 * « PROJET » tant que templates.legal_validated est faux (U2, D1). Aucune coordonnée de paiement : rappel des
 * seuls canaux officiels (annexe D). Module autonome (Deno et Vitest) — voir docx.ts.
 */
import { formatDate, formatInteger, formatUsdCents, renderTemplate, text } from "./docx.ts";
import type { CompanyIdentity } from "./contract.ts";
import { LETTER_TEMPLATE_BASE64, LETTER_TEMPLATE_VERSION } from "./document-templates.generated.ts";
import { formatRate, usdCentsToXof } from "./financial-document.ts";

export { LETTER_TEMPLATE_VERSION };

export type LetterKind = "reminder" | "formal_notice";
export type LetterReason = "unpaid" | "not_collected" | "unpaid_not_collected";

export interface LetterInput {
  kind: LetterKind;
  number: string;
  issuedAt: Date;
  legalValidated: boolean;
  company: CompanyIdentity;
  client: { name: string; address: string | null; notify_phone: string };
  dossier: {
    reference: string;
    make: string | null;
    model: string | null;
    model_year: number | null;
    vin: string | null;
  };
  contractReference: string | null;
  arrivalDate: Date;
  reason: LetterReason;
  amountDueCents: number;
  lateFeesCents: number;
  rate: { rate: string; capturedAt: Date };
  /** Contrat art. 22 : mise en demeure au plus tard N jours après l'arrivée ; procédure à M mois. */
  formalNoticeDays: number;
  procedureMonths: number;
  /** Mise en demeure : délai de régularisation (≥ minimum du contrat) et relance qui l'a précédée. */
  cureDays: number | null;
  reminder: { number: string; sentAt: Date } | null;
}

const NUMBER_WORDS: Record<number, string> = {
  2: "deux",
  3: "trois",
  4: "quatre",
  5: "cinq",
  6: "six",
  15: "quinze",
  20: "vingt",
  30: "trente",
  45: "quarante-cinq",
  60: "soixante",
  90: "quatre-vingt-dix",
};

/** « quinze (15) jours » comme dans le contrat ; « 17 jours » pour une valeur sans équivalent écrit. */
export function inWords(value: number, unit: string): string {
  const words = NUMBER_WORDS[value];
  return words ? `${words} (${value}) ${unit}` : `${value} ${unit}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

const PAYMENT_CHANNELS =
  "Tout paiement s’effectue exclusivement au bureau de USA CARS à Dakar ou sur un compte officiel listé à " +
  "l’annexe D du contrat, en indiquant la référence du dossier. USA CARS ne communique jamais un changement " +
  "de compte par WhatsApp ou par simple message.";

export function buildLetterData(input: LetterInput): Record<string, unknown> {
  const isNotice = input.kind === "formal_notice";
  if (isNotice && (input.cureDays === null || input.reminder === null)) {
    throw new Error("Mise en demeure : délai de régularisation et lettre de relance requis.");
  }
  const vehicle = [input.dossier.make, input.dossier.model, input.dossier.model_year].filter(Boolean).join(" ");
  const usd = formatUsdCents(input.amountDueCents);
  const xof = `${formatInteger(usdCentsToXof(input.amountDueCents, input.rate.rate))} FCFA`;
  const rateNote = `au taux du ${formatDate(input.rate.capturedAt)} (1 $US = ${formatRate(input.rate.rate)} FCFA ; le montant en USD fait foi)`;
  const unpaid = input.reason !== "not_collected";
  const notCollected = input.reason !== "unpaid";
  const procedureDate = formatDate(addMonths(input.arrivalDate, input.procedureMonths));
  const arrival =
    `Le véhicule ${vehicle || "objet du dossier"}${input.dossier.vin ? ` (VIN ${input.dossier.vin})` : ""}, ` +
    `objet du dossier ${input.dossier.reference}, est arrivé au port de Dakar le ${formatDate(input.arrivalDate)}. ` +
    "Son arrivée vous a été notifiée conformément à l’article 17 du contrat de prestation.";
  const sums = unpaid
    ? `À la date du présent courrier, la somme de ${usd} reste due au titre de ce dossier, soit ${xof} ${rateNote}` +
      (input.lateFeesCents > 0 ? `, dont ${formatUsdCents(input.lateFeesCents)} de frais de retard (article 20).` : ".")
    : "Aucune somme ne reste due au titre de ce dossier.";
  const collection = notCollected
    ? "À ce jour, le véhicule n’a pas été enlevé du port de Dakar."
    : "Le véhicule a été enlevé, mais le solde n’est pas réglé.";

  const paragraphs = isNotice
    ? [
        `Par lettre de relance n° ${input.reminder!.number} du ${formatDate(input.reminder!.sentAt)}, nous vous avons ` +
          `invité à régulariser la situation du dossier ${input.dossier.reference}. Ce courrier est resté sans suite.`,
        arrival,
        `${sums} ${collection}`,
        `En conséquence, conformément à l’article 21 du contrat, nous vous mettons en demeure de ` +
          [
            unpaid && "régler les sommes dues",
            notCollected && "prendre les mesures nécessaires à l’enlèvement du véhicule",
          ]
            .filter(Boolean)
            .join(" et de ") +
          ` dans un délai de ${inWords(input.cureDays!, "jours")} à compter de la réception du présent courrier.`,
        "À défaut de régularisation dans ce délai, et à l’expiration d’un délai de " +
          `${inWords(input.procedureMonths, "mois")} à compter de l’arrivée du véhicule au Sénégal (soit le ${procedureDate}), ` +
          "USA CARS pourra exercer les droits et recours prévus par la législation applicable : réclamer les sommes " +
          "dues et les frais de conservation, exercer tout droit de rétention légalement applicable, engager une " +
          "procédure de recouvrement ou solliciter l’autorisation de vendre le véhicule afin de recouvrer les sommes " +
          "dues (article 22). Aucune appropriation automatique du véhicule n’est réputée acquise du seul fait de " +
          "l’expiration de ce délai.",
        PAYMENT_CHANNELS,
      ]
    : [
        arrival,
        `${sums} ${collection}`,
        "Nous vous invitons à " +
          [
            unpaid && "régler les sommes dues",
            notCollected && "prendre les dispositions nécessaires à l’enlèvement du véhicule",
          ]
            .filter(Boolean)
            .join(" et à ") +
          " dans les meilleurs délais. Les documents du véhicule vous sont remis après le paiement intégral.",
        "À défaut, conformément à l’article 22 du contrat, une mise en demeure pourra vous être adressée au plus tard " +
          `${inWords(input.formalNoticeDays, "jours")} après l’arrivée du véhicule ; des frais de retard peuvent ` +
          "s’appliquer (article 20).",
        PAYMENT_CHANNELS,
      ];

  const title = isNotice ? "MISE EN DEMEURE" : "LETTRE DE RELANCE";
  return {
    projet: !input.legalValidated,
    titre_entete: title,
    titre_document: `${title} N° ${input.number}`,
    usa_forme_juridique: input.company.legalForm,
    usa_rccm: input.company.rccm,
    usa_ninea: input.company.ninea,
    usa_bureau: input.company.officeAddress,
    usa_telephone: input.company.phone,
    usa_representant: input.company.representativeName,
    usa_qualite: text(input.company.representativeTitle),
    date_document: formatDate(input.issuedAt),
    client_nom: input.client.name,
    client_adresse: text(input.client.address),
    client_telephone: input.client.notify_phone,
    objet: isNotice
      ? `Mise en demeure — dossier ${input.dossier.reference}, véhicule non réclamé (articles 21 et 22 du contrat)`
      : `Relance — dossier ${input.dossier.reference}, véhicule arrivé à Dakar`,
    references: `Dossier : ${input.dossier.reference}    N° contrat : ${text(input.contractReference)}`,
    paragraphes: paragraphs.map((p) => ({ texte: p })),
  };
}

export function renderLetter(input: LetterInput): Uint8Array {
  return renderTemplate(LETTER_TEMPLATE_BASE64, buildLetterData(input));
}
