"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { claimPhotoError, storeClaimPhoto } from "@/lib/server/claims";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fileClaimSchema, respondClaimSchema } from "@/lib/validation/claims";

/**
 * Lot 6d (contrat art. 19) : réclamations après l'enlèvement. Dépôt par l'agent (admin, opérations) ; traitement
 * (statut + réponse) par l'agent, avec information du client. La base vérifie les droits, l'enlèvement et le délai.
 */

const WRITE_ONLY = "Action réservée à l’administrateur et aux agents opérations.";
const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/** L'agent dépose une réclamation pour le client, avec une photo facultative. */
export async function fileClaimByAgent(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITE_ONLY);
  const parsed = fileClaimSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const photo = formData.get("photo");
  const file = photo instanceof File && photo.size > 0 ? photo : null;
  const photoError = claimPhotoError(file);
  if (photoError) return withValues(failure(photoError), formData);

  const supabase = await createSupabaseServerClient();
  const { data: claimId, error } = await supabase.rpc("file_claim", {
    p_dossier_id: parsed.data.dossierId,
    p_reserves: parsed.data.reserves,
  });
  if (error || !claimId) {
    return withValues(
      failure(
        error?.code === "22023" || error?.code === "42501"
          ? error.message
          : "La réclamation n’a pas pu être enregistrée.",
      ),
      formData,
    );
  }
  if (file && !(await storeClaimPhoto(claimId, parsed.data.dossierId, file))) {
    revalidatePath(dossierPath(parsed.data.dossierId));
    return failure("Réclamation enregistrée, mais la photo n’a pas pu être jointe. Ajoutez-la de nouveau.");
  }
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Réclamation enregistrée.");
}

/** L'agent met à jour le statut et la réponse d'une réclamation ; le client en est informé. */
export async function respondToClaim(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) return failure(WRITE_ONLY);
  const parsed = respondClaimSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("respond_to_claim", {
    p_claim_id: parsed.data.claimId,
    p_status: parsed.data.status,
    p_response: parsed.data.response ?? "",
  });
  if (error) {
    return withValues(
      failure(
        error.code === "22023" || error.code === "42501"
          ? error.message
          : "La mise à jour n’a pas pu être enregistrée.",
      ),
      formData,
    );
  }
  const dossierId = typeof formData.get("dossierId") === "string" ? (formData.get("dossierId") as string) : "";
  if (dossierId) revalidatePath(dossierPath(dossierId));
  revalidatePath("/notifications");
  return success("Réclamation mise à jour ; le client est informé.");
}
