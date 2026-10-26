/**
 * Devis DV (US-3.3), facture d'acompte FA (US-3.4) et facture de solde FS (US-3.7) : données du modèle
 * templates/devis_facture.docx.
 * Module autonome (Deno et Vitest) — voir docx.ts.
 *
 * CLAUDE.md règle 2 : l'entrée ne contient QUE les lignes visibles du client (forfaits A et B, option C,
 * ajustements D, TVA) ; aucun coût interne ni marge ne peut atteindre le document (test sur le fichier généré).
 */
import {
  formatDate,
  formatInteger,
  formatUsdCents,
  platformBoxes,
  renderTemplate,
  text,
  type AuctionPlatform,
} from "./docx.ts";
import { ID_DOCUMENT_LABELS, type CompanyIdentity } from "./contract.ts";
import { FINANCIAL_TEMPLATE_BASE64, FINANCIAL_TEMPLATE_VERSION } from "./document-templates.generated.ts";

export { FINANCIAL_TEMPLATE_VERSION };

/** Information pas encore connue à ce stade du dossier (expédition, ETA…). */
const DASH = "—";
const CHECKED = "☒";
const UNCHECKED = "☐";

export type FinancialDocType = "quote" | "deposit_invoice" | "balance_invoice";
export type PaymentMode = "bank_transfer" | "wave" | "orange_money" | "cash";
export type InsuranceChoice = "pending" | "accepted" | "refused";

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Virement",
  wave: "Wave",
  orange_money: "Orange Money",
  cash: "Espèces",
};

export interface FinancialDocumentInput {
  docType: FinancialDocType;
  number: string;
  issuedAt: Date;
  /** Devis : fin de validité (X2). */
  validUntil: Date | null;
  /** Échéance du paiement 1 (R4) : celle du dossier pour le devis, celle de la facture d'acompte sinon. */
  payment1DueAt: Date | null;
  /** Facture de solde : paiement 1 soldé ? */
  payment1Paid?: boolean;
  /** Facture de solde : échéance (R4) et ETA de référence figée à l'émission. */
  balanceDueAt?: Date | null;
  referenceEta?: Date | null;
  /** Expédition (conteneur en cours) : « — » tant qu'elle n'est pas connue. */
  shipping?: {
    carrier: string;
    container: string;
    vessel: string | null;
    voyage: string | null;
    bl: string | null;
    eta: Date | null;
    trackingUrl: string | null;
  } | null;
  /** Facture de solde : lignes D approuvées (frais supplémentaires, frais de retard, remises). */
  adjustments?: Array<{ label: string; amountCents: number }>;
  legalValidated: boolean;
  contractReference: string | null;
  company: CompanyIdentity;
  client: {
    kind: "person" | "company";
    name: string;
    notify_phone: string;
    notify_email: string | null;
    id_document_type: string | null;
    id_document_number: string | null;
    ninea: string | null;
    rccm: string | null;
  };
  dossier: {
    reference: string;
    platform: AuctionPlatform | null;
    lot_number: string | null;
    vin: string | null;
    make: string | null;
    model: string | null;
    model_year: number | null;
    purchase_location: string | null;
    departure_port: string | null;
  };
  /** Lignes visibles du client, figées à l'émission (table financial_documents). */
  amounts: {
    forfaitACents: number;
    forfaitBCents: number | null;
    insurancePremiumCents: number;
    insuranceChoice: InsuranceChoice;
    vatRatePercent: string;
    vatCents: number;
    insuranceVatCents: number;
    totalCents: number;
    depositAppliedCents: number;
    depositExcessCents: number;
    amountDueCents: number;
  };
  /** Taux de référence du devis (R1), repris sur les factures. */
  referenceRate: { rate: string; source: string; capturedAt: Date };
  /** Taux du jour d'édition : montant FCFA indicatif du reste à payer. */
  editionRate: { rate: string; capturedAt: Date };
  payments: Array<{
    creditedAt: Date;
    mode: PaymentMode;
    reference: string;
    amountCents: number;
    paidCurrency: "USD" | "XOF";
    amountXof: number | null;
    fxRate: string | null;
  }>;
  /** Comptes officiels actifs (annexe D). */
  accounts: Array<{
    kind: "bank" | "wave" | "orange_money" | "cash_office";
    holder_name: string;
    bank_name: string | null;
    account_number: string | null;
    iban: string | null;
    phone: string | null;
  }>;
  /** Valeurs contractuelles : paramètres en vigueur à l'ouverture du dossier (CLAUDE.md règle 4, X7). */
  terms: {
    validityHours: number;
    payment1DueHoursAfterWin: number;
    balanceDueHoursBeforeEta: number;
    balanceRecommendedDaysBeforeEta: number;
    lateFeeCents: number;
    lateFeePeriodDays: number;
    releaseBusinessHours: number;
  };
}

// ---------------------------------------------------------------------------
// Conversion FCFA (règle R1) — même calcul que lib/money/fx.ts (BigInt, demi vers l'extérieur), vérifié par un test.
// ---------------------------------------------------------------------------
const RATE_SCALE = 10_000n;

function scaledRate(rate: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(rate.trim().replace(",", "."));
  if (!match) throw new RangeError(`Taux de change invalide : « ${rate} »`);
  return BigInt(match[1]!) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(4, "0"));
}

/** Centimes USD → FCFA entier le plus proche. */
export function usdCentsToXof(cents: number, rate: string): number {
  const n = BigInt(cents) * scaledRate(rate);
  const d = 100n * RATE_SCALE;
  const q = ((n < 0n ? -n : n) * 2n + d) / (d * 2n);
  return Number(n < 0n ? -q : q);
}

const formatXof = (xof: number) => `${formatInteger(xof)} FCFA`;

/** « 587,1 » → « 587,10 » ; 4 décimales au plus, 2 au moins. */
export function formatRate(rate: string): string {
  const [whole, fraction = ""] = rate.trim().replace(",", ".").split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${formatInteger(Number(whole))},${trimmed}`;
}

/** « 19/10/2026 à 09h30 » (Africa/Dakar = UTC). */
function formatDateTime(date: Date): string {
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Dakar", hour: "2-digit", minute: "2-digit" })
    .format(date)
    .replace(":", "h");
  return `${formatDate(date)} à ${time}`;
}

const usd = formatUsdCents;
const box = (checked: boolean) => (checked ? CHECKED : UNCHECKED);

function clientPiece(client: FinancialDocumentInput["client"]): string {
  if (client.kind === "company") {
    return text(
      [client.ninea && `NINEA ${client.ninea}`, client.rccm && `RCCM ${client.rccm}`].filter(Boolean).join(" · "),
    );
  }
  const label = client.id_document_type
    ? (ID_DOCUMENT_LABELS[client.id_document_type] ?? client.id_document_type)
    : null;
  return text([label, client.id_document_number].filter(Boolean).join(" n° "));
}

function accountLines(accounts: FinancialDocumentInput["accounts"], kind: "bank" | "wave" | "orange_money"): string {
  const lines = accounts
    .filter((a) => a.kind === kind)
    .map((a) =>
      kind === "bank"
        ? `Titulaire : ${a.holder_name}  Banque : ${a.bank_name ?? DASH}  RIB / IBAN : ${a.iban ?? a.account_number ?? DASH}`
        : `Numéro : ${a.phone ?? DASH}  Nom du compte : ${a.holder_name}`,
    );
  return lines.length > 0 ? lines.join("\n") : DASH;
}

/** Données du modèle (balises `{…}` de templates/devis_facture.docx). */
export function buildFinancialDocumentData(input: FinancialDocumentInput): Record<string, unknown> {
  const { amounts: a, dossier, client, company, terms } = input;
  const isQuote = input.docType === "quote";
  const isBalance = input.docType === "balance_invoice";
  const listedCents = input.payments.reduce((sum, p) => sum + p.amountCents, 0);
  // Déjà payé : versements listés (devis, FA) ; facture de solde : paiements imputés sur le solde à l'émission.
  const paidCents = isBalance ? a.depositAppliedCents : listedCents;
  const withInsuranceCents = a.totalCents + a.insurancePremiumCents + a.insuranceVatCents;
  const optionC = isQuote && a.insurancePremiumCents > 0;
  // Reste à payer : devis = total (hors option C) − versements ; facture = montant dû figé à l'émission.
  const balanceCents = isQuote ? Math.max(a.totalCents - paidCents, 0) : a.amountDueCents;
  const adjustments = input.adjustments ?? [];
  const adjustmentsTotal = adjustments.reduce((sum, d) => sum + d.amountCents, 0);
  const ship = input.shipping ?? null;

  const vatRate = Number(a.vatRatePercent);
  const titre = isQuote ? "DEVIS" : isBalance ? "FACTURE DE SOLDE" : "FACTURE D’ACOMPTE";

  return {
    projet: !input.legalValidated,
    titre_entete: titre,
    titre_document: `${titre} N° ${input.number}`,
    case_devis: box(isQuote),
    case_fa: box(input.docType === "deposit_invoice"),
    case_fs: box(isBalance),
    numero: input.number,
    date_document: formatDate(input.issuedAt),
    contrat_reference: text(input.contractReference),
    dossier_reference: dossier.reference,
    usa_forme_juridique: company.legalForm,
    usa_rccm: company.rccm,
    usa_ninea: company.ninea,
    usa_bureau: company.officeAddress,
    usa_telephone: company.phone,
    usa_email: company.email,
    usa_representant: company.representativeName,
    client_nom: client.name,
    client_telephone: client.notify_phone,
    client_piece: clientPiece(client),
    client_email: text(client.notify_email),
    // Section 1 — véhicule et expédition (« — » tant que le conteneur n'est pas connu ; ETA toujours indicative).
    marque: text(dossier.make),
    modele: text(dossier.model),
    annee: text(dossier.model_year),
    vin: text(dossier.vin),
    plateforme_cases: platformBoxes(dossier.platform),
    lot: text(dossier.lot_number),
    lieu_achat: text(dossier.purchase_location),
    port_depart: dossier.departure_port?.trim() || DASH,
    transporteur: ship?.carrier ?? DASH,
    conteneur: ship?.container ?? DASH,
    navire: ship ? [ship.vessel, ship.voyage].filter(Boolean).join(" / ") || DASH : DASH,
    bl: ship?.bl ?? DASH,
    eta: ship?.eta ? `${formatDate(ship.eta)} (indicative)` : DASH,
    lien_suivi: ship?.trackingUrl ?? DASH,
    // Section 2 — lignes A, B, C, D, TVA (R2)
    montant_a: isBalance ? "Facturé à l’acompte" : usd(a.forfaitACents),
    montant_b: (isQuote || isBalance) && a.forfaitBCents !== null ? usd(a.forfaitBCents) : "Facturé au solde",
    montant_c:
      a.insuranceChoice === "refused"
        ? usd(0)
        : isQuote
          ? `${usd(a.insurancePremiumCents)} (option)`
          : isBalance
            ? usd(a.insurancePremiumCents)
            : `${usd(a.insurancePremiumCents)} (facturée au solde)`,
    case_c_acceptee: box(a.insuranceChoice === "accepted"),
    case_c_refusee: box(a.insuranceChoice === "refused"),
    montant_d: !isBalance
      ? DASH
      : adjustments.length === 0
        ? usd(0)
        : [...adjustments.map((d) => `${d.label} : ${usd(d.amountCents)}`), `Total : ${usd(adjustmentsTotal)}`].join(
            "\n",
          ),
    tva_libelle: vatRate > 0 ? `TVA (${a.vatRatePercent.replace(".", ",")} %)` : "TVA (non applicable)",
    montant_tva: usd(a.vatCents + (isBalance ? a.insuranceVatCents : 0)),
    total_general: optionC
      ? `${usd(a.totalCents)} hors option C\n${usd(withInsuranceCents)} avec l’assurance`
      : usd(a.totalCents),
    // Sections 3 et 4 — paiements reçus, récapitulatif et conversion (R1)
    paiements:
      input.payments.length > 0
        ? input.payments.map((p) => ({
            date: formatDate(p.creditedAt),
            mode: PAYMENT_MODE_LABELS[p.mode],
            reference: p.reference,
            montant:
              p.paidCurrency === "XOF" && p.amountXof !== null && p.fxRate !== null
                ? `${usd(p.amountCents)}\n(${formatXof(p.amountXof)} au taux de ${formatRate(p.fxRate)})`
                : usd(p.amountCents),
          }))
        : [{ date: DASH, mode: DASH, reference: "Aucun paiement reçu", montant: DASH }],
    total_paye: usd(paidCents),
    solde_usd:
      (optionC ? `${usd(balanceCents)} hors option C` : usd(balanceCents)) +
      (a.depositExcessCents > 0 ? `\nExcédent de dépôt à restituer : ${usd(a.depositExcessCents)}` : ""),
    taux_source: input.referenceRate.source,
    taux: formatRate(input.referenceRate.rate),
    taux_releve: formatDateTime(input.referenceRate.capturedAt),
    solde_fcfa: `${formatXof(usdCentsToXof(balanceCents, input.editionRate.rate))} au taux du ${formatDate(
      input.editionRate.capturedAt,
    )} (indicatif, réactualisé au paiement)`,
    // Section 5 — échéancier (R4)
    p1_montant: isQuote
      ? usd(a.forfaitACents) + (paidCents > 0 ? `\ndépôt déjà versé : ${usd(paidCents)}` : "")
      : isBalance
        ? "Selon la facture d’acompte"
        : usd(a.amountDueCents),
    p1_echeance: input.payment1DueAt ? formatDateTime(input.payment1DueAt) : DASH,
    p1_heures: String(terms.payment1DueHoursAfterWin),
    p1_statut: `${box(isBalance ? input.payment1Paid === true : !isQuote && a.amountDueCents === 0)} Payé`,
    solde_montant: isBalance
      ? usd(a.amountDueCents)
      : isQuote && a.forfaitBCents !== null
        ? `${usd(a.forfaitBCents)}${optionC ? ` + ${usd(a.insurancePremiumCents)} si l’assurance est acceptée` : ""} + D`
        : "Selon la facture de solde",
    solde_echeance: isBalance && input.balanceDueAt ? formatDateTime(input.balanceDueAt) : DASH,
    solde_heures: String(terms.balanceDueHoursBeforeEta),
    solde_eta: isBalance && input.referenceEta ? `${formatDate(input.referenceEta)} (indicative)` : DASH,
    solde_jours: String(terms.balanceRecommendedDaysBeforeEta),
    solde_statut: `${box(isBalance && a.amountDueCents === 0)} Payé`,
    // Section 6 — comptes officiels actifs
    compte_banque: accountLines(input.accounts, "bank"),
    compte_wave: accountLines(input.accounts, "wave"),
    compte_orange_money: accountLines(input.accounts, "orange_money"),
    // Section 7 — conditions
    conditions_validite: isQuote
      ? `Devis valable ${terms.validityHours} heures au plus, soit jusqu’au ${
          input.validUntil ? formatDateTime(input.validUntil) : DASH
        } (au plus tard à l’échéance du paiement 1), en raison des délais de paiement imposés par les plateformes d’enchères.`
      : isBalance
        ? `Facture de solde payable au plus tard le ${
            input.balanceDueAt ? formatDateTime(input.balanceDueAt) : DASH
          }, soit ${terms.balanceDueHoursBeforeEta} heures avant l’ETA de référence (indicative) ; si l’ETA est avancée, l’échéance l’est aussi, avec un préavis minimal.`
        : `Facture d’acompte payable au plus tard le ${
            input.payment1DueAt ? formatDateTime(input.payment1DueAt) : DASH
          } : totalité du forfait A, dépôt déduit.`,
    frais_retard: usd(terms.lateFeeCents),
    frais_retard_jours: String(terms.lateFeePeriodDays),
    remise_heures: String(terms.releaseBusinessHours),
  };
}

export function renderFinancialDocument(input: FinancialDocumentInput): Uint8Array {
  return renderTemplate(FINANCIAL_TEMPLATE_BASE64, buildFinancialDocumentData(input));
}
