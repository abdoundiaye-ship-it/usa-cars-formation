import type {
  AdjustmentKind,
  AdjustmentStatus,
  CostCategory,
  CostSection,
  FinancialDocStatus,
  FinancialDocType,
  InsuranceChoice,
  OfficialAccountKind,
  PaymentMode,
  RefundReason,
  RefundStatus,
} from "@/lib/supabase/database.types";

/** Libellés financiers (vocabulaire du devis révisé et du contrat). */

export const SECTION_LABELS: Record<CostSection, string> = {
  A: "A — Acquisition du véhicule",
  B: "B — Logistique et transport maritime",
};

export const COST_CATEGORIES: Record<CostSection, readonly CostCategory[]> = {
  A: ["hammer_price", "auction_fees", "us_taxes", "acquisition_other"],
  B: ["inland_transport", "loading", "ocean_freight", "port_fees", "documentation", "logistics_other"],
};

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  hammer_price: "Prix d’adjudication",
  auction_fees: "Frais de plateforme (COPART, IAA…)",
  us_taxes: "Taxes aux États-Unis",
  acquisition_other: "Autres frais d’acquisition",
  inland_transport: "Transport terrestre aux États-Unis",
  loading: "Chargement et empotage",
  ocean_freight: "Fret maritime",
  port_fees: "Frais portuaires",
  documentation: "Documentation et formalités",
  logistics_other: "Autres frais logistiques",
};

export const ACCOUNT_KIND_LABELS: Record<OfficialAccountKind, string> = {
  bank: "Virement bancaire",
  wave: "Wave",
  orange_money: "Orange Money",
  cash_office: "Espèces au bureau de Dakar",
};

export const FINANCIAL_DOC_TYPE_LABELS: Record<FinancialDocType, string> = {
  quote: "Devis",
  deposit_invoice: "Facture d’acompte",
  balance_invoice: "Facture de solde",
  cash_receipt: "Reçu espèces",
  refund_note: "Note de remboursement",
};

export const FINANCIAL_STATUS_LABELS: Record<FinancialDocStatus, string> = {
  issued: "Émis",
  accepted: "Accepté",
  refused: "Refusé",
  expired: "Expiré",
  paid: "Payé",
  cancelled: "Annulé",
};

export const INSURANCE_CHOICE_LABELS: Record<InsuranceChoice, string> = {
  pending: "En attente du choix du client",
  accepted: "Acceptée",
  refused: "Refusée",
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Virement bancaire",
  wave: "Wave",
  orange_money: "Orange Money",
  cash: "Espèces",
};

/** Compte officiel correspondant à un mode de paiement (annexe D). */
export const ACCOUNT_KIND_OF_MODE: Record<PaymentMode, OfficialAccountKind> = {
  bank_transfer: "bank",
  wave: "wave",
  orange_money: "orange_money",
  cash: "cash_office",
};

export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = {
  extra_cost: "Frais supplémentaires",
  late_fee: "Frais de retard",
  discount: "Remise",
};

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  proposed: "Proposé (à valider)",
  pending_client_approval: "Accord du client attendu",
  approved: "Ajouté au solde",
  rejected: "Écarté",
  cancelled: "Annulé",
};

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  overpayment: "Trop-perçu",
  deposit_excess: "Excédent de dépôt",
  lot_not_won: "Lot non remporté",
  cancellation: "Annulation",
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "À valider (administrateur)",
  approved: "Validé, à exécuter",
  paid: "Remboursé",
  rejected: "Refusé",
};
