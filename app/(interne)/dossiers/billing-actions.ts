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
import { dossierIdSchema, proofFileError } from "@/lib/validation/operations";
import {
  cancelFinancialSchema,
  creditedAtOf,
  depositSchema,
  financialDocumentIdSchema,
} from "@/lib/validation/finance";

const QUOTE_WRITERS = "Action réservée à l’administrateur, aux agents opérations et à la comptabilité.";
const FINANCE_WRITERS = "Action réservée à l’administrateur et à la comptabilité.";
const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/** Message d'une règle métier de la base (22023) ou d'un refus explicite (42501), sinon message générique. */
const ruleMessage = (error: { code?: string; message: string } | null, fallback: string) =>
  error && (error.code === "22023" || error.code === "42501") ? error.message : fallback;

const REFUSED = {
  issue_quote: "Le devis n’a pas pu être émis.",
  issue_deposit_invoice: "La facture d’acompte n’a pas pu être émise.",
} as const;

/**
 * Émet le document en base (numéro, montants figés), puis génère son fichier Word. Le bouton d'émission disparaît
 * une fois le document émis : le résultat est annoncé par la fiche (paramètre « facturation »).
 */
async function issueThenGenerate(dossierId: string, fn: keyof typeof REFUSED): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc(fn, { p_dossier_id: dossierId });
  if (error || !id) return failure(ruleMessage(error, REFUSED[fn]));
  const generated = await generateFinancialDocumentFile(id);
  revalidatePath(dossierPath(dossierId));
  const notice = !generated.ok ? "fichier-erreur" : fn === "issue_quote" ? "devis" : "facture";
  redirect(`${dossierPath(dossierId)}?facturation=${notice}` as Route);
}

/** US-3.3 : devis DV — forfaits saisis, taux du jour figé, validité alignée sur le paiement 1 (X2). */
export async function issueQuote(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.quotesWrite))) return failure(QUOTE_WRITERS);
  const parsed = dossierIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Dossier inconnu.");
  return issueThenGenerate(parsed.data.dossierId, "issue_quote");
}

/** US-3.4 : facture d'acompte FA — totalité du forfait A, dépôts imputés, échéance du paiement 1 (R4). */
export async function issueDepositInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.invoicesWrite))) return failure(FINANCE_WRITERS);
  const parsed = dossierIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Dossier inconnu.");
  return issueThenGenerate(parsed.data.dossierId, "issue_deposit_invoice");
}

/** Nouvelle tentative de génération du fichier d'un document émis (rattaché une seule fois). */
export async function generateFinancialFile(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.quotesWrite))) return failure(QUOTE_WRITERS);
  const parsed = financialDocumentIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Document inconnu.");
  const generated = await generateFinancialDocumentFile(parsed.data.financialDocumentId);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return generated.ok ? success("Fichier généré.") : failure(generated.message);
}

/** R3 : annulation motivée d'un devis ou d'une facture (le numéro reste attribué). */
export async function cancelFinancialDocument(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.quotesWrite))) return failure(QUOTE_WRITERS);
  const parsed = cancelFinancialSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_financial_document", {
    p_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "Le document n’a pas pu être annulé.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Document annulé (l’annulation est journalisée).");
}

/** US-3.4 : dépôt reçu (I2) ; justificatif facultatif, conversion FCFA → USD au taux du jour par la base (R1). */
export async function recordDeposit(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.paymentsWrite))) return failure(FINANCE_WRITERS);
  const parsed = depositSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, currency, amountCents, amountXof, mode, accountId, reference, creditedOn, notes } = parsed.data;

  const proof = formData.get("proof");
  let proofId: string | null = null;
  if (proof instanceof File && proof.size > 0) {
    const proofError = proofFileError(proof);
    if (proofError) {
      return withValues(
        { status: "error", message: "Justificatif invalide.", fieldErrors: { proof: proofError } },
        formData,
      );
    }
    proofId = await storeDossierFile(dossierId, "payment_proof", proof);
    if (!proofId) return withValues(failure("Le justificatif n’a pas pu être enregistré. Réessayez."), formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_deposit", {
    p_dossier_id: dossierId,
    p_paid_currency: currency,
    p_amount_cents: amountCents,
    p_amount_xof: amountXof,
    p_mode: mode,
    p_official_account_id: accountId,
    p_reference: reference,
    p_credited_at: creditedAtOf(creditedOn).toISOString(),
    p_proof_document_id: proofId,
    p_notes: notes,
  });
  if (error) return withValues(failure(ruleMessage(error, "Le dépôt n’a pas pu être enregistré.")), formData);
  revalidatePath(dossierPath(dossierId));
  return success("Dépôt enregistré.");
}

export async function cancelPayment(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.paymentsWrite))) return failure(FINANCE_WRITERS);
  const parsed = cancelFinancialSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_payment", {
    p_payment_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "Le paiement n’a pas pu être annulé.")), formData);
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Paiement annulé (l’annulation est journalisée).");
}
