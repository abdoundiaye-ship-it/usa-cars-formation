/**
 * Fonction Supabase generate-document — contrat (US-2.2, R14), ordre d'achat (US-2.3, annexe B), devis et
 * factures (US-3.3, US-3.4, US-3.7), reçus espèces et notes de remboursement (US-3.6, US-3.12), courriers de la
 * procédure « véhicule non réclamé » (US-5.3 : lettre de relance, mise en demeure).
 *
 * Remplit le modèle Word, dépose le fichier dans le bucket privé « documents » et l'enregistre
 * (register_contract_document / register_purchase_order_document / register_financial_document_file).
 * Un devis ou une facture est d'abord émis en base (numéro, montants figés) ; le fichier est ensuite rattaché
 * une seule fois. Exécutée ici plutôt que dans l'application :
 * le remplissage d'un modèle (~85 ms de calcul) dépasse la limite de l'offre gratuite de Cloudflare Workers (10 ms).
 *
 * Toutes les lectures et écritures se font AU NOM DE L'UTILISATEUR (jeton transmis par l'application) :
 * la RLS s'applique ; la clé service_role n'est jamais utilisée.
 */
import {
  COMPANY_SETTING_KEYS,
  CONTRACT_TEMPLATE_VERSION,
  renderContract,
  RETENTION_SETTING_KEYS,
  type CompanyIdentity,
} from "../_shared/contract.ts";
import { sha256Hex } from "../_shared/docx.ts";
import {
  FINANCIAL_TEMPLATE_VERSION,
  renderFinancialDocument,
  type FinancialDocumentInput,
  type PaymentMode,
} from "../_shared/financial-document.ts";
import { RECEIPT_TEMPLATE_VERSION, renderReceipt, type RefundReason } from "../_shared/receipt.ts";
import {
  LETTER_TEMPLATE_VERSION,
  renderLetter,
  type LetterKind,
  type LetterReason,
} from "../_shared/unclaimed-letter.ts";
import { PURCHASE_ORDER_TEMPLATE_VERSION, renderPurchaseOrder } from "../_shared/purchase-order.ts";
import { SupabaseRest } from "../_shared/rest.ts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["contract", "purchase_order", "financial_document", "unclaimed_letter"] as const;
type Kind = (typeof KINDS)[number];

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/** Colonnes du dossier utilisées ici ; les autres sont transmises telles quelles aux modèles. */
type Row = { id: string; reference: string; client_id: string; params_as_of: string } & Record<string, unknown>;

/** Dernière valeur de chaque paramètre en vigueur à l'ouverture du dossier (décision X7). */
async function settingsAsOf(api: SupabaseRest, keys: string[], asOf: string) {
  const { data, error } = await api.select<{ key: string; value: unknown }>("settings", {
    select: "key,value,effective_from",
    key: `in.(${keys.join(",")})`,
    effective_from: `lte.${asOf}`,
    order: "effective_from.desc",
  });
  if (error || !data) throw new Refusal(500, "Les paramètres du document n’ont pas pu être lus.");
  return (key: string) => data.find((s) => s.key === key)?.value;
}

async function buildContract(api: SupabaseRest, dossier: Row) {
  const client = await api.first<Record<string, unknown>>("clients", { select: "*", id: `eq.${dossier.client_id}` });
  if (!client) throw new Refusal(404, "Client du dossier introuvable.");
  const valueOf = await settingsAsOf(
    api,
    [...Object.values(COMPANY_SETTING_KEYS), ...Object.values(RETENTION_SETTING_KEYS), "templates.legal_validated"],
    dossier.params_as_of,
  );
  const years = (key: string) => {
    const value = valueOf(key);
    return typeof value === "number" ? value : null;
  };
  const company = Object.fromEntries(
    Object.entries(COMPANY_SETTING_KEYS).map(([field, key]) => {
      const value = valueOf(key);
      return [field, typeof value === "string" ? value : ""];
    }),
  ) as unknown as CompanyIdentity;
  const bytes = renderContract({
    reference: dossier.reference,
    date: new Date(),
    legalValidated: valueOf("templates.legal_validated") === true,
    company,
    retention: {
      accounting: years(RETENTION_SETTING_KEYS.accounting),
      other: years(RETENTION_SETTING_KEYS.other),
    },
    client: client as never,
    dossier: dossier as never,
  });
  return { bytes, fileName: `Contrat-${dossier.reference}.docx`, templateVersion: CONTRACT_TEMPLATE_VERSION };
}

async function buildPurchaseOrder(api: SupabaseRest, dossier: Row) {
  const po = await api.first<{ auction_at: string | null; max_bid_cents: number; deposit_cents: number }>(
    "purchase_orders",
    { select: "auction_at,max_bid_cents,deposit_cents", dossier_id: `eq.${dossier.id}` },
  );
  if (!po) throw new Refusal(409, "Saisissez d’abord l’ordre d’achat (enchère maximale).");
  const contract = await api.first<{ reference: string }>("contracts", {
    select: "reference",
    dossier_id: `eq.${dossier.id}`,
  });
  const valueOf = await settingsAsOf(api, ["templates.legal_validated"], dossier.params_as_of);
  const bytes = renderPurchaseOrder({
    contractReference: contract?.reference ?? dossier.reference,
    legalValidated: valueOf("templates.legal_validated") === true,
    dossier: dossier as never,
    auctionAt: po.auction_at ? new Date(po.auction_at) : null,
    maxBidCents: Number(po.max_bid_cents),
    depositCents: Number(po.deposit_cents),
  });
  return { bytes, fileName: `Ordre-achat-${dossier.reference}.docx`, templateVersion: PURCHASE_ORDER_TEMPLATE_VERSION };
}

/** Valeurs contractuelles imprimées sur le devis et les factures (paramètres à l'ouverture du dossier, X7). */
const TERM_KEYS = {
  validityHours: "quote.validity_hours",
  payment1DueHoursAfterWin: "payment1.due_hours_after_win",
  balanceDueHoursBeforeEta: "balance.due_hours_before_eta",
  balanceRecommendedDaysBeforeEta: "balance.recommended_days_before_eta",
  lateFeeCents: "late_fee.amount_usd",
  lateFeePeriodDays: "late_fee.period_days",
  releaseBusinessHours: "documents.release_business_hours",
} as const;

type FinancialRow = {
  id: string;
  dossier_id: string;
  doc_type: "quote" | "deposit_invoice" | "balance_invoice" | "cash_receipt" | "refund_note";
  number: string;
  status: string;
  document_id: string | null;
  forfait_a_cents: number | null;
  forfait_b_cents: number | null;
  insurance_premium_cents: number;
  insurance_choice: "pending" | "accepted" | "refused";
  vat_rate_percent: number | string;
  vat_cents: number;
  insurance_vat_cents: number;
  adjustments_cents: number;
  total_cents: number;
  deposit_applied_cents: number;
  deposit_excess_cents: number;
  amount_due_cents: number;
  fx_rate: number | string;
  fx_source: string;
  fx_captured_at: string;
  edition_fx_rate: number | string;
  edition_fx_captured_at: string;
  issued_at: string;
  valid_until: string | null;
  due_at: string | null;
  reference_eta: string | null;
  payment_id: string | null;
  refund_id: string | null;
};

type PaymentRow = {
  purpose: "deposit" | "payment1" | "balance";
  credited_at: string;
  mode: PaymentMode;
  reference: string;
  amount_cents: number;
  paid_currency: "USD" | "XOF";
  amount_xof: number | null;
  fx_rate: number | string | null;
  fx_captured_at: string | null;
};

/** Paramètres communs : identité légale (company.*), valeurs contractuelles, mention PROJET (D1). */
async function documentSettings(api: SupabaseRest, dossier: Row) {
  const valueOf = await settingsAsOf(
    api,
    [...Object.values(COMPANY_SETTING_KEYS), ...Object.values(TERM_KEYS), "templates.legal_validated"],
    dossier.params_as_of,
  );
  const company = Object.fromEntries(
    Object.entries(COMPANY_SETTING_KEYS).map(([field, key]) => {
      const value = valueOf(key);
      return [field, typeof value === "string" ? value : ""];
    }),
  ) as unknown as CompanyIdentity;
  const terms = Object.fromEntries(
    Object.entries(TERM_KEYS).map(([field, key]) => {
      const value = Number(valueOf(key));
      if (!Number.isFinite(value)) throw new Refusal(500, `Paramètre ${key} manquant.`);
      return [field, value];
    }),
  ) as FinancialDocumentInput["terms"];
  return { company, terms, legalValidated: valueOf("templates.legal_validated") === true };
}

/** Conteneur en cours du dossier (section 1 du devis / facture) ; lien de suivi du transporteur (R12). */
async function shippingOf(api: SupabaseRest, dossierId: string): Promise<FinancialDocumentInput["shipping"]> {
  const assignment = await api.first<{
    containers: {
      number: string;
      bl_number: string | null;
      vessel: string | null;
      voyage: string | null;
      eta: string | null;
      ata: string | null;
      carriers: { name: string; tracking_url: string; url_template: string | null } | null;
    } | null;
  }>("dossier_containers", {
    select: "containers(number,bl_number,vessel,voyage,eta,ata,carriers(name,tracking_url,url_template))",
    dossier_id: `eq.${dossierId}`,
    removed_at: "is.null",
  });
  const c = assignment?.containers;
  if (!c) return null;
  const template = c.carriers?.url_template;
  const trackingUrl = template
    ? template.replace("{container}", c.number).replace("{bl}", c.bl_number ?? "")
    : (c.carriers?.tracking_url ?? null);
  return {
    carrier: c.carriers?.name ?? "—",
    container: c.number,
    vessel: c.vessel,
    voyage: c.voyage,
    bl: c.bl_number,
    eta: c.ata ? null : c.eta ? new Date(`${c.eta}T00:00:00Z`) : null,
    trackingUrl,
  };
}

/** Reçu espèces RC ou note de remboursement RB. */
async function buildReceiptDocument(api: SupabaseRest, financial: FinancialRow, dossier: Row) {
  const client = await api.first<{ name: string; notify_phone: string }>("clients", {
    select: "name,notify_phone",
    id: `eq.${dossier.client_id}`,
  });
  if (!client) throw new Refusal(404, "Client du dossier introuvable.");
  const contract = await api.first<{ reference: string }>("contracts", {
    select: "reference",
    dossier_id: `eq.${dossier.id}`,
  });
  const { company, legalValidated } = await documentSettings(api, dossier);
  const common = {
    number: financial.number,
    issuedAt: new Date(financial.issued_at),
    legalValidated,
    contractReference: contract?.reference ?? null,
    company,
    client,
    dossierReference: dossier.reference,
    amountCents: Number(financial.total_cents),
    rate: { rate: String(financial.fx_rate), capturedAt: new Date(financial.fx_captured_at) },
  };
  let bytes: Uint8Array;
  if (financial.doc_type === "cash_receipt") {
    const payment = await api.first<PaymentRow>("payments", { select: "*", id: `eq.${financial.payment_id}` });
    if (!payment) throw new Refusal(404, "Paiement du reçu introuvable.");
    bytes = renderReceipt({
      ...common,
      kind: "cash_receipt",
      amountXof: payment.paid_currency === "XOF" && payment.amount_xof !== null ? Number(payment.amount_xof) : null,
      mode: payment.mode,
      reference: payment.reference,
      paidAt: new Date(payment.credited_at),
    });
  } else {
    const refund = await api.first<{
      reason: RefundReason;
      mode: PaymentMode;
      payment_reference: string;
      paid_at: string;
    }>("refunds", { select: "reason,mode,payment_reference,paid_at", id: `eq.${financial.refund_id}` });
    if (!refund) throw new Refusal(404, "Remboursement introuvable.");
    bytes = renderReceipt({
      ...common,
      kind: "refund_note",
      amountXof: null,
      mode: refund.mode,
      reference: refund.payment_reference,
      paidAt: new Date(refund.paid_at),
      refundReason: refund.reason,
    });
  }
  const prefix = financial.doc_type === "cash_receipt" ? "Recu" : "Note-remboursement";
  return { bytes, fileName: `${prefix}-${financial.number}.docx`, templateVersion: RECEIPT_TEMPLATE_VERSION };
}

/** Devis, facture d'acompte ou de solde : uniquement les lignes visibles du client (jamais les coûts internes). */
async function buildFinancialDocument(api: SupabaseRest, financial: FinancialRow, dossier: Row) {
  if (financial.document_id) throw new Refusal(409, "Le fichier de ce document est déjà généré.");
  if (financial.status === "cancelled") throw new Refusal(409, "Ce document est annulé.");
  if (financial.doc_type === "cash_receipt" || financial.doc_type === "refund_note") {
    return buildReceiptDocument(api, financial, dossier);
  }
  const isBalance = financial.doc_type === "balance_invoice";
  const client = await api.first<FinancialDocumentInput["client"]>("clients", {
    select: "kind,name,notify_phone,notify_email,id_document_type,id_document_number,ninea,rccm",
    id: `eq.${dossier.client_id}`,
  });
  if (!client) throw new Refusal(404, "Client du dossier introuvable.");
  const contract = await api.first<{ reference: string }>("contracts", {
    select: "reference",
    dossier_id: `eq.${dossier.id}`,
  });
  const { data: payments } = await api.select<PaymentRow>("payments", {
    select: "purpose,credited_at,mode,reference,amount_cents,paid_currency,amount_xof,fx_rate,fx_captured_at",
    dossier_id: `eq.${dossier.id}`,
    cancelled_at: "is.null",
    order: "credited_at.asc",
  });
  const { data: accounts } = await api.select<FinancialDocumentInput["accounts"][number]>("official_accounts", {
    select: "kind,holder_name,bank_name,account_number,iban,phone",
    status: "eq.active",
    order: "created_at.asc",
  });
  const { company, terms, legalValidated } = await documentSettings(api, dossier);
  const shipping = await shippingOf(api, dossier.id);

  // Facture de solde : lignes D reprises, échéance du paiement 1 et son état (facture d'acompte).
  let adjustments: FinancialDocumentInput["adjustments"] = [];
  let depositInvoice: { due_at: string | null; status: string } | null = null;
  if (isBalance) {
    const { data } = await api.select<{ label: string; amount_cents: number }>("adjustments", {
      select: "label,amount_cents",
      financial_document_id: `eq.${financial.id}`,
      order: "created_at.asc",
    });
    adjustments = (data ?? []).map((d) => ({ label: d.label, amountCents: Number(d.amount_cents) }));
    depositInvoice = await api.first<{ due_at: string | null; status: string }>("financial_documents", {
      select: "due_at,status",
      dossier_id: `eq.${dossier.id}`,
      doc_type: "eq.deposit_invoice",
      status: "neq.cancelled",
    });
  }
  const listed = (payments ?? []).filter((p) => (isBalance ? p.purpose === "balance" : true));
  const payment1Due =
    financial.doc_type === "quote"
      ? typeof dossier.payment1_due_at === "string"
        ? dossier.payment1_due_at
        : null
      : isBalance
        ? (depositInvoice?.due_at ?? null)
        : financial.due_at;

  const bytes = renderFinancialDocument({
    docType: financial.doc_type,
    number: financial.number,
    issuedAt: new Date(financial.issued_at),
    validUntil: financial.valid_until ? new Date(financial.valid_until) : null,
    payment1DueAt: payment1Due ? new Date(payment1Due) : null,
    payment1Paid: depositInvoice?.status === "paid",
    balanceDueAt: isBalance && financial.due_at ? new Date(financial.due_at) : null,
    referenceEta: financial.reference_eta ? new Date(`${financial.reference_eta}T00:00:00Z`) : null,
    shipping,
    adjustments,
    legalValidated,
    contractReference: contract?.reference ?? null,
    company,
    client,
    dossier: dossier as never,
    amounts: {
      forfaitACents: Number(financial.forfait_a_cents ?? 0),
      forfaitBCents: financial.forfait_b_cents === null ? null : Number(financial.forfait_b_cents),
      insurancePremiumCents: Number(financial.insurance_premium_cents),
      insuranceChoice: financial.insurance_choice,
      vatRatePercent: String(financial.vat_rate_percent),
      vatCents: Number(financial.vat_cents),
      insuranceVatCents: Number(financial.insurance_vat_cents),
      totalCents: Number(financial.total_cents),
      depositAppliedCents: Number(financial.deposit_applied_cents),
      depositExcessCents: Number(financial.deposit_excess_cents),
      amountDueCents: Number(financial.amount_due_cents),
    },
    referenceRate: {
      rate: String(financial.fx_rate),
      source: financial.fx_source,
      capturedAt: new Date(financial.fx_captured_at),
    },
    editionRate: { rate: String(financial.edition_fx_rate), capturedAt: new Date(financial.edition_fx_captured_at) },
    payments: listed.map((p) => ({
      creditedAt: new Date(p.credited_at),
      mode: p.mode,
      reference: p.reference,
      amountCents: Number(p.amount_cents),
      paidCurrency: p.paid_currency,
      amountXof: p.amount_xof === null ? null : Number(p.amount_xof),
      fxRate: p.fx_rate === null ? null : String(p.fx_rate),
    })),
    accounts: accounts ?? [],
    terms,
  });
  const prefix = financial.doc_type === "quote" ? "Devis" : isBalance ? "Facture-solde" : "Facture-acompte";
  return { bytes, fileName: `${prefix}-${financial.number}.docx`, templateVersion: FINANCIAL_TEMPLATE_VERSION };
}

type LetterRow = {
  id: string;
  dossier_id: string;
  kind: LetterKind;
  number: string;
  status: string;
  arrival_date: string;
  reason: LetterReason;
  amount_due_cents: number;
  late_fees_cents: number;
  fx_rate: number | string;
  fx_captured_at: string;
  cure_days: number | null;
  issued_at: string;
  document_id: string | null;
};

/** Lettre de relance ou mise en demeure : montants figés à l'émission, délais du contrat du dossier (X7). */
async function buildLetterDocument(api: SupabaseRest, letter: LetterRow, dossier: Row) {
  if (letter.document_id) throw new Refusal(409, "Le fichier de ce courrier est déjà généré.");
  if (letter.status === "cancelled") throw new Refusal(409, "Ce courrier est annulé.");
  const client = await api.first<{ name: string; address: string | null; notify_phone: string }>("clients", {
    select: "name,address,notify_phone",
    id: `eq.${dossier.client_id}`,
  });
  if (!client) throw new Refusal(404, "Client du dossier introuvable.");
  const contract = await api.first<{ reference: string }>("contracts", {
    select: "reference",
    dossier_id: `eq.${dossier.id}`,
  });
  const reminder =
    letter.kind === "formal_notice"
      ? await api.first<{ number: string; sent_at: string }>("unclaimed_letters", {
          select: "number,sent_at",
          dossier_id: `eq.${dossier.id}`,
          kind: "eq.reminder",
          status: "eq.sent",
        })
      : null;
  if (letter.kind === "formal_notice" && !reminder) throw new Refusal(409, "Lettre de relance envoyée introuvable.");
  const valueOf = await settingsAsOf(
    api,
    [
      ...Object.values(COMPANY_SETTING_KEYS),
      "templates.legal_validated",
      "unclaimed.formal_notice_days_after_arrival",
      "unclaimed.procedure_months_after_arrival",
    ],
    dossier.params_as_of,
  );
  const company = Object.fromEntries(
    Object.entries(COMPANY_SETTING_KEYS).map(([field, key]) => {
      const value = valueOf(key);
      return [field, typeof value === "string" ? value : ""];
    }),
  ) as unknown as CompanyIdentity;
  const formalNoticeDays = Number(valueOf("unclaimed.formal_notice_days_after_arrival"));
  const procedureMonths = Number(valueOf("unclaimed.procedure_months_after_arrival"));
  if (!Number.isFinite(formalNoticeDays) || !Number.isFinite(procedureMonths)) {
    throw new Refusal(500, "Paramètres de la procédure « véhicule non réclamé » manquants.");
  }
  const bytes = renderLetter({
    kind: letter.kind,
    number: letter.number,
    issuedAt: new Date(letter.issued_at),
    legalValidated: valueOf("templates.legal_validated") === true,
    company,
    client,
    dossier: dossier as never,
    contractReference: contract?.reference ?? null,
    arrivalDate: new Date(`${letter.arrival_date}T00:00:00Z`),
    reason: letter.reason,
    amountDueCents: Number(letter.amount_due_cents),
    lateFeesCents: Number(letter.late_fees_cents),
    rate: { rate: String(letter.fx_rate), capturedAt: new Date(letter.fx_captured_at) },
    formalNoticeDays,
    procedureMonths,
    cureDays: letter.cure_days === null ? null : Number(letter.cure_days),
    reminder: reminder ? { number: reminder.number, sentAt: new Date(reminder.sent_at) } : null,
  });
  const prefix = letter.kind === "reminder" ? "Relance" : "Mise-en-demeure";
  return { bytes, fileName: `${prefix}-${letter.number}.docx`, templateVersion: LETTER_TEMPLATE_VERSION };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { message: "Méthode non autorisée." });
  const authorization = request.headers.get("Authorization");
  if (!authorization) return reply(401, { message: "Connexion requise." });

  let dossierId: unknown;
  let kind: unknown;
  let financialDocumentId: unknown;
  let letterId: unknown;
  try {
    ({ dossierId, kind, financialDocumentId, letterId } = await request.json());
  } catch {
    return reply(400, { message: "Requête invalide." });
  }
  if (!KINDS.includes(kind as Kind)) return reply(400, { message: "Type de document inconnu." });
  if (kind === "financial_document") {
    if (typeof financialDocumentId !== "string" || !UUID.test(financialDocumentId)) {
      return reply(400, { message: "Document inconnu." });
    }
  } else if (kind === "unclaimed_letter") {
    if (typeof letterId !== "string" || !UUID.test(letterId)) return reply(400, { message: "Courrier inconnu." });
  } else if (typeof dossierId !== "string" || !UUID.test(dossierId)) {
    return reply(400, { message: "Dossier inconnu." });
  }

  const api = new SupabaseRest(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, authorization);

  try {
    // Mêmes règles que la base : contrat et ordre d'achat (administrateur, agent opérations) ; devis et factures
    // (administrateur, agent opérations, comptabilité) ; courriers (administrateur, direction, comptabilité, U3) —
    // la base vérifie à nouveau à l'enregistrement.
    const financialKind = kind === "financial_document";
    const letterKind = kind === "unclaimed_letter";
    const { data: canWrite } = await api.rpc<boolean>(
      letterKind ? "is_recovery_writer" : financialKind ? "is_quote_writer" : "is_operations_writer",
    );
    if (canWrite !== true) {
      throw new Refusal(
        403,
        letterKind
          ? "Action réservée à l’administrateur, à la direction et à la comptabilité."
          : financialKind
            ? "Action réservée à l’administrateur, aux agents opérations et à la comptabilité."
            : "Action réservée à l’administrateur et aux agents opérations.",
      );
    }

    let financial: FinancialRow | null = null;
    if (financialKind) {
      financial = await api.first<FinancialRow>("financial_documents", {
        select: "*",
        id: `eq.${financialDocumentId}`,
      });
      if (!financial) throw new Refusal(404, "Document introuvable.");
      dossierId = financial.dossier_id;
    }
    let letter: LetterRow | null = null;
    if (letterKind) {
      letter = await api.first<LetterRow>("unclaimed_letters", { select: "*", id: `eq.${letterId}` });
      if (!letter) throw new Refusal(404, "Courrier introuvable.");
      dossierId = letter.dossier_id;
    }
    const dossier = await api.first<Row>("dossiers", { select: "*", id: `eq.${dossierId}` });
    if (!dossier) throw new Refusal(404, "Dossier introuvable.");

    let built: { bytes: Uint8Array; fileName: string; templateVersion: string };
    try {
      built = letter
        ? await buildLetterDocument(api, letter, dossier)
        : financial
          ? await buildFinancialDocument(api, financial, dossier)
          : kind === "contract"
            ? await buildContract(api, dossier)
            : await buildPurchaseOrder(api, dossier);
    } catch (error) {
      if (error instanceof Refusal) throw error;
      console.error("generate-document: rendu impossible", error);
      throw new Refusal(500, "Le document n’a pas pu être généré à partir du modèle.");
    }

    const folder = letter ? "unclaimed_letter" : financial ? financial.doc_type : kind;
    const path = `dossiers/${dossier.id}/${folder}/${crypto.randomUUID()}-${built.fileName}`;
    const uploadError = await api.upload("documents", path, built.bytes, DOCX_MIME);
    if (uploadError) {
      console.error("generate-document: dépôt impossible", uploadError.message);
      throw new Refusal(500, "Le document n’a pas pu être enregistré dans l’espace de stockage.");
    }

    const file = {
      p_storage_path: path,
      p_file_name: built.fileName,
      p_size_bytes: built.bytes.byteLength,
      p_sha256: await sha256Hex(built.bytes),
      p_template_version: built.templateVersion,
    };
    const { data: id, error } = letter
      ? await api.rpc<string>("register_unclaimed_letter_file", { p_letter_id: letter.id, ...file })
      : financial
        ? await api.rpc<string>("register_financial_document_file", { p_financial_document_id: financial.id, ...file })
        : await api.rpc<string>(
            kind === "contract" ? "register_contract_document" : "register_purchase_order_document",
            {
              p_dossier_id: dossier.id,
              ...file,
            },
          );
    if (error || !id) {
      // 22023 : règle métier (véhicule incomplet, trop âgé, décision déjà enregistrée…) — message destiné à l'agent.
      const rule = error?.code === "22023";
      throw new Refusal(rule ? 409 : 500, rule ? error!.message : "Le document n’a pas pu être enregistré.");
    }
    return reply(200, { id });
  } catch (error) {
    if (error instanceof Refusal) return reply(error.status, { message: error.message });
    console.error("generate-document: erreur inattendue", error);
    return reply(500, { message: "Erreur inattendue lors de la génération du document." });
  }
});
