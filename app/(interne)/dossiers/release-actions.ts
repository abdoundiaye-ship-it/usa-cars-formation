"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { storeDossierFile } from "@/lib/server/documents";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { creditedAtOf, documentReleaseSchema } from "@/lib/validation/finance";
import { proofFileError } from "@/lib/validation/operations";

const dossierPath = (id: string) => `/dossiers/${id}` as Route;

const fileOf = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
};

/**
 * US-3.11 / R9 : remise des documents au client ou à son mandataire, après le paiement intégral (vérifié par la base).
 * La décharge signée est versée au dossier (visible du client) ; la procuration aussi pour un mandataire.
 */
export async function recordDocumentRelease(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) {
    return failure("Action réservée à l’administrateur et aux agents opérations.");
  }
  const parsed = documentReleaseSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const v = parsed.data;

  const discharge = fileOf(formData, "discharge");
  const powerOfAttorney = fileOf(formData, "powerOfAttorney");
  const fieldErrors: Record<string, string> = {};
  const dischargeError = proofFileError(discharge);
  if (dischargeError) fieldErrors.discharge = dischargeError;
  if (v.beneficiaryKind === "representative") {
    const poaError = proofFileError(powerOfAttorney);
    if (poaError) fieldErrors.powerOfAttorney = poaError;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return withValues({ status: "error", message: "Pièces à joindre.", fieldErrors }, formData);
  }

  const dischargeId = await storeDossierFile(v.dossierId, "release_receipt", discharge!, true);
  const powerOfAttorneyId =
    v.beneficiaryKind === "representative"
      ? await storeDossierFile(v.dossierId, "power_of_attorney", powerOfAttorney!, true)
      : null;
  if (!dischargeId || (v.beneficiaryKind === "representative" && !powerOfAttorneyId)) {
    return withValues(failure("Les pièces n’ont pas pu être enregistrées. Réessayez."), formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_document_release", {
    p_dossier_id: v.dossierId,
    p_beneficiary_kind: v.beneficiaryKind,
    p_beneficiary_name: v.beneficiaryName,
    p_id_document_type: v.idDocumentType,
    p_id_document_number: v.idDocumentNumber,
    p_discharge_document_id: dischargeId,
    p_power_of_attorney_document_id: powerOfAttorneyId,
    p_released_at: creditedAtOf(v.releasedOn).toISOString(),
    p_notes: v.notes,
  });
  if (error) {
    const message =
      error.code === "22023" || error.code === "42501" ? error.message : "La remise n’a pas pu être enregistrée.";
    return withValues(failure(message), formData);
  }
  revalidatePath(dossierPath(v.dossierId));
  return success("Remise des documents enregistrée.");
}
