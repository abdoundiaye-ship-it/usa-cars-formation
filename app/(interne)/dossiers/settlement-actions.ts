"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { generateFinancialDocumentFile } from "@/lib/server/contracts";
import { storeDossierFile } from "@/lib/server/documents";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  creditedAtOf,
  discountSchema,
  extraCostSchema,
  lateFeeDecisionSchema,
  paymentSchema,
  refundDecisionSchema,
  refundExecutionSchema,
} from "@/lib/validation/finance";
import { dossierIdSchema, proofFileError } from "@/lib/validation/operations";

/**
 * Phase 3, lot 3c — paiements (US-3.6), facture de solde (US-3.7), frais de retard (US-3.8), frais supplémentaires
 * (US-3.9), remboursements (US-3.12). Les règles sont dans la base ; ces actions valident la saisie (Zod),
 * déposent les justificatifs et génèrent les fichiers des documents émis (RC, FS, RB).
 */

const FINANCE_WRITERS = "Action réservée à l’administrateur et à la comptabilité.";
const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/** Message d'une règle métier de la base (22023) ou d'un refus explicite (42501), sinon message générique. */
const ruleMessage = (error: { code?: string; message: string } | null, fallback: string) =>
  error && (error.code === "22023" || error.code === "42501") ? error.message : fallback;

/** Justificatif téléversé (preuve de paiement) : null si absent, message si invalide. */
async function storeProof(
  dossierId: string,
  formData: FormData,
  required: boolean,
): Promise<{ id: string | null; error?: string }> {
  const proof = formData.get("proof");
  const file = proof instanceof File && proof.size > 0 ? proof : null;
  if (!file) return required ? { id: null, error: "Joignez le justificatif." } : { id: null };
  const proofError = proofFileError(file);
  if (proofError) return { id: null, error: proofError };
  const id = await storeDossierFile(dossierId, "payment_proof", file);
  return id ? { id } : { id: null, error: "Le justificatif n’a pas pu être enregistré. Réessayez." };
}

/** US-3.6 : paiement 1 puis solde (imputation par la base, R6) ; reçu RC généré pour les espèces (C7). */
export async function recordPayment(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.paymentsWrite))) return failure(FINANCE_WRITERS);
  const parsed = paymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, currency, amountCents, amountXof, mode, accountId, reference, creditedOn, notes } = parsed.data;

  const proof = await storeProof(dossierId, formData, mode !== "cash");
  if (proof.error) {
    return withValues(
      { status: "error", message: "Justificatif à joindre.", fieldErrors: { proof: proof.error } },
      formData,
    );
  }
  const supabase = await createSupabaseServerClient();
  const { data: paymentId, error } = await supabase.rpc("record_payment", {
    p_dossier_id: dossierId,
    p_paid_currency: currency,
    p_amount_cents: amountCents,
    p_amount_xof: amountXof,
    p_mode: mode,
    p_official_account_id: accountId,
    p_reference: reference,
    p_credited_at: creditedAtOf(creditedOn).toISOString(),
    p_proof_document_id: proof.id,
    p_notes: notes,
  });
  if (error || !paymentId) {
    return withValues(failure(ruleMessage(error, "Le paiement n’a pas pu être enregistré.")), formData);
  }
  if (mode === "cash") {
    const { data: payment } = await supabase.from("payments").select("receipt_id").eq("id", paymentId).maybeSingle();
    const generated = payment?.receipt_id ? await generateFinancialDocumentFile(payment.receipt_id) : null;
    revalidatePath(dossierPath(dossierId));
    if (!generated?.ok) {
      return success(
        "Paiement enregistré. Le fichier du reçu n’a pas pu être généré : utilisez « Générer le fichier ».",
      );
    }
    return success("Paiement enregistré, reçu espèces généré.");
  }
  revalidatePath(dossierPath(dossierId));
  return success("Paiement enregistré.");
}

/** US-3.7 : facture de solde (après embarquement, B/L et ETA) ; la fiche annonce le résultat. */
export async function issueBalanceInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = dossierIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Dossier inconnu.");
  const { dossierId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("issue_balance_invoice", { p_dossier_id: dossierId });
  if (error || !id) return failure(ruleMessage(error, "La facture de solde n’a pas pu être émise."));
  const generated = await generateFinancialDocumentFile(id);
  revalidatePath(dossierPath(dossierId));
  redirect(`${dossierPath(dossierId)}?facturation=${generated.ok ? "solde" : "fichier-erreur"}` as Route);
}

/** US-3.9 / R7 : frais supplémentaires avec justificatif ; au-delà du seuil, accord du client (sauf urgence). */
export async function addExtraCost(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = extraCostSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, section, label, amount, urgent, reason } = parsed.data;
  const proof = formData.get("proof");
  const file = proof instanceof File && proof.size > 0 ? proof : null;
  const proofError = proofFileError(file);
  if (proofError) {
    return withValues(
      { status: "error", message: "Justificatif à joindre.", fieldErrors: { proof: proofError } },
      formData,
    );
  }
  // Justificatif visible du client : il fonde sa décision (R7, R15).
  const proofId = await storeDossierFile(dossierId, "other", file!, true);
  if (!proofId) return withValues(failure("Le justificatif n’a pas pu être enregistré. Réessayez."), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_extra_cost", {
    p_dossier_id: dossierId,
    p_section: section,
    p_label: label,
    p_amount_cents: amount,
    p_proof_document_id: proofId,
    p_urgent: urgent,
    p_reason: reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "Les frais n’ont pas pu être ajoutés.")), formData);
  revalidatePath(dossierPath(dossierId));
  return success("Frais supplémentaires enregistrés.");
}

export async function addDiscount(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = discountSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_discount", {
    p_dossier_id: parsed.data.dossierId,
    p_label: parsed.data.label,
    p_amount_cents: parsed.data.amount,
  });
  if (error) return withValues(failure(ruleMessage(error, "La remise n’a pas pu être enregistrée.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Remise enregistrée.");
}

/** C5 : la comptabilité valide (ligne D) ou écarte (motif) un frais de retard proposé. */
export async function decideLateFee(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = lateFeeDecisionSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_late_fee", {
    p_adjustment_id: parsed.data.adjustmentId,
    p_approve: parsed.data.decision === "approve",
    p_note: parsed.data.note,
  });
  if (error) return withValues(failure(ruleMessage(error, "La décision n’a pas pu être enregistrée.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success(parsed.data.decision === "approve" ? "Frais de retard ajoutés au solde." : "Frais de retard écartés.");
}

/** Annulation motivée d'une ligne D non encore facturée. */
export async function cancelAdjustment(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const dossierId = String(formData.get("dossierId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_adjustment", {
    p_adjustment_id: String(formData.get("targetId") ?? ""),
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return withValues(failure(ruleMessage(error, "La ligne n’a pas pu être annulée.")), formData);
  revalidatePath(dossierPath(dossierId));
  return success("Ligne annulée (l’annulation est journalisée).");
}

/** Déclenchement manuel du calcul quotidien des frais de retard (R5). */
export async function proposeLateFees(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = dossierIdSchema.safeParse(formObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("propose_late_fees");
  if (error) return failure(ruleMessage(error, "Le calcul des frais de retard a échoué."));
  if (parsed.success) revalidatePath(dossierPath(parsed.data.dossierId));
  return success(data ? `${data} frais de retard proposé(s), à valider.` : "Aucun nouveau frais de retard.");
}

/** C9 : validation ou refus d'une demande de remboursement (administrateur). */
export async function decideRefund(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(["admin"]))) return failure("Validation réservée à l’administrateur (décision C9).");
  const parsed = refundDecisionSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_refund", {
    p_refund_id: parsed.data.refundId,
    p_approve: parsed.data.decision === "approve",
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "La décision n’a pas pu être enregistrée.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success(parsed.data.decision === "approve" ? "Remboursement validé." : "Demande refusée.");
}

/** US-3.12 : exécution (date, référence, justificatif) et note de remboursement RB. */
export async function executeRefund(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.paymentsWrite))) return failure(FINANCE_WRITERS);
  const parsed = refundExecutionSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, refundId, paidOn, reference } = parsed.data;
  const proof = await storeProof(dossierId, formData, true);
  if (proof.error) {
    return withValues(
      { status: "error", message: "Justificatif à joindre.", fieldErrors: { proof: proof.error } },
      formData,
    );
  }
  const supabase = await createSupabaseServerClient();
  const { data: noteId, error } = await supabase.rpc("execute_refund", {
    p_refund_id: refundId,
    p_paid_at: creditedAtOf(paidOn).toISOString(),
    p_reference: reference,
    p_proof_document_id: proof.id!,
  });
  if (error || !noteId) {
    return withValues(failure(ruleMessage(error, "Le remboursement n’a pas pu être enregistré.")), formData);
  }
  const generated = await generateFinancialDocumentFile(noteId);
  revalidatePath(dossierPath(dossierId));
  return success(
    generated.ok
      ? "Remboursement enregistré, note de remboursement générée."
      : "Remboursement enregistré. La note n’a pas pu être générée : utilisez « Générer le fichier ».",
  );
}
