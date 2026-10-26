"use server";

import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountIdSchema, deactivateAccountSchema, officialAccountSchema } from "@/lib/validation/finance";

const PATH = "/parametres/comptes-officiels";
const ruleMessage = (error: { code?: string; message: string } | null, fallback: string) =>
  error && (error.code === "22023" || error.code === "42501") ? error.message : fallback;

/** US-3.10 : nouveau compte (ou remplacement d'un compte actif), en attente d'une seconde validation (Q1). */
export async function createAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.accountsWrite))) {
    return failure("Seul un administrateur crée ou modifie un compte officiel.");
  }
  const parsed = officialAccountSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const a = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_official_account", {
    p_kind: a.kind,
    p_label: a.label,
    p_holder_name: a.holderName,
    ...(a.bankName ? { p_bank_name: a.bankName } : {}),
    ...(a.accountNumber ? { p_account_number: a.accountNumber } : {}),
    ...(a.iban ? { p_iban: a.iban } : {}),
    ...(a.swift ? { p_swift: a.swift } : {}),
    ...(a.phone ? { p_phone: a.phone } : {}),
    ...(a.instructions ? { p_instructions: a.instructions } : {}),
    ...(a.replacesId ? { p_replaces_id: a.replacesId } : {}),
  });
  if (error) return withValues(failure(ruleMessage(error, "Le compte n’a pas pu être créé.")), formData);
  revalidatePath(PATH);
  return success(
    "Compte enregistré : il sera actif après l’approbation d’une autre personne (administrateur ou direction).",
  );
}

/** Q1 : approbation par un administrateur ou la direction, autre que le créateur. */
export async function approveAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.accountsApprove))) {
    return failure("Approbation réservée à un administrateur ou à la direction.");
  }
  const parsed = accountIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Compte inconnu.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_official_account", { p_account_id: parsed.data.accountId });
  if (error) return failure(ruleMessage(error, "L’approbation a échoué."));
  revalidatePath(PATH);
  return success("Compte approuvé : il est désormais actif.");
}

export async function deactivateAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.accountsWrite))) {
    return failure("Seul un administrateur désactive un compte officiel.");
  }
  const parsed = deactivateAccountSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("deactivate_official_account", {
    p_account_id: parsed.data.accountId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "La désactivation a échoué.")), formData);
  revalidatePath(PATH);
  return success("Compte désactivé.");
}
