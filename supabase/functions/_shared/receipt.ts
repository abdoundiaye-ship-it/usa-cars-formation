/**
 * Reçu espèces RC (US-3.6, décision C7) et note de remboursement RB (US-3.12, décisions C6, C9) : données du
 * modèle templates/recu.docx. Module autonome (Deno et Vitest) — voir docx.ts.
 */
import { formatDate, formatInteger, formatUsdCents, renderTemplate, text } from "./docx.ts";
import type { CompanyIdentity } from "./contract.ts";
import { RECEIPT_TEMPLATE_BASE64, RECEIPT_TEMPLATE_VERSION } from "./document-templates.generated.ts";
import { formatRate, PAYMENT_MODE_LABELS, usdCentsToXof, type PaymentMode } from "./financial-document.ts";

export { RECEIPT_TEMPLATE_VERSION };

export type RefundReason = "overpayment" | "deposit_excess" | "lot_not_won" | "cancellation";

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  overpayment: "trop-perçu",
  deposit_excess: "excédent de dépôt",
  lot_not_won: "lot non remporté — dépôt restitué",
  cancellation: "annulation",
};

export interface ReceiptInput {
  kind: "cash_receipt" | "refund_note";
  number: string;
  issuedAt: Date;
  legalValidated: boolean;
  contractReference: string | null;
  company: CompanyIdentity;
  client: { name: string; notify_phone: string };
  dossierReference: string;
  amountCents: number;
  /** Montant reçu en FCFA (paiement en FCFA) ; sinon équivalent au taux indiqué. */
  amountXof: number | null;
  rate: { rate: string; capturedAt: Date };
  mode: PaymentMode;
  reference: string;
  /** Date du paiement reçu (RC) ou du remboursement effectué (RB). */
  paidAt: Date;
  refundReason?: RefundReason;
}

export function buildReceiptData(input: ReceiptInput): Record<string, unknown> {
  const isRefund = input.kind === "refund_note";
  const usd = formatUsdCents(input.amountCents);
  const xof = input.amountXof ?? usdCentsToXof(input.amountCents, input.rate.rate);
  const titre = isRefund ? "NOTE DE REMBOURSEMENT" : "REÇU DE PAIEMENT EN ESPÈCES";
  return {
    projet: !input.legalValidated,
    titre_entete: titre,
    titre_document: `${titre} N° ${input.number}`,
    usa_forme_juridique: input.company.legalForm,
    usa_rccm: input.company.rccm,
    usa_ninea: input.company.ninea,
    usa_bureau: input.company.officeAddress,
    usa_telephone: input.company.phone,
    usa_representant: input.company.representativeName,
    date_document: formatDate(input.issuedAt),
    dossier_reference: input.dossierReference,
    contrat_reference: text(input.contractReference),
    client_nom: input.client.name,
    client_telephone: input.client.notify_phone,
    objet: isRefund
      ? `Remboursement (${REFUND_REASON_LABELS[input.refundReason ?? "overpayment"]}) : USA CARS restitue au client la somme de ${usd}.`
      : `USA CARS reconnaît avoir reçu en espèces, au bureau de Dakar, la somme de ${usd} pour le dossier ${input.dossierReference}.`,
    montant_usd: usd,
    montant_fcfa:
      input.amountXof !== null
        ? `${formatInteger(xof)} FCFA reçus (taux du jour : 1 $US = ${formatRate(input.rate.rate)} FCFA)`
        : `${formatInteger(xof)} FCFA au taux du ${formatDate(input.rate.capturedAt)} (1 $US = ${formatRate(input.rate.rate)} FCFA)`,
    mode: PAYMENT_MODE_LABELS[input.mode],
    reference: input.reference,
    mention: isRefund
      ? `Remboursement effectué le ${formatDate(input.paidAt)} par le même moyen que le paiement d’origine. Le trop-perçu est toujours restitué au client, jamais conservé comme avoir.`
      : `Paiement reçu le ${formatDate(input.paidAt)}. Reçu à conserver : il fait foi du paiement en espèces.`,
    libelle_client: isRefund ? "Le client (bénéficiaire)" : "Le client (déposant)",
  };
}

export function renderReceipt(input: ReceiptInput): Uint8Array {
  return renderTemplate(RECEIPT_TEMPLATE_BASE64, buildReceiptData(input));
}
