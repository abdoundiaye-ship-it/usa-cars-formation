"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getClientAccess } from "@/lib/auth/access";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { claimPhotoError, storeClaimPhoto } from "@/lib/server/claims";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fileClaimSchema } from "@/lib/validation/claims";
import { portalDecisionSchema } from "@/lib/validation/portal";

/** Identifiant de la session de connexion (preuve R15), lu dans le jeton d'accès. */
async function sessionId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as {
      session_id?: string;
    };
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}

/** Adresse IP du client (proxy Cloudflare, puis en-têtes standard). */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const raw = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip");
  const ip = raw?.trim() ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

export async function decideInPortal(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getClientAccess())) return failure("Votre session a expiré : reconnectez-vous.");
  const parsed = portalDecisionSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const session = await sessionId();
  if (!session) return failure("Votre session a expiré : reconnectez-vous.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("accept_in_portal", {
    p_subject: v.subject,
    p_subject_id: v.subjectId,
    p_decision: v.decision,
    p_document_sha256: v.sha256,
    p_session: session,
    p_ip: await clientIp(),
    p_insurance_choice: v.subject === "quote" && v.decision === "accepted" ? (v.insuranceChoice ?? null) : null,
  });
  if (error) {
    return failure(
      error.code === "22023" || error.code === "42501" ? error.message : "Votre décision n’a pas pu être enregistrée.",
    );
  }
  revalidatePath(`/espace/dossiers/${v.dossierId}` as Route);
  revalidatePath("/espace");
  return success(v.decision === "accepted" ? "Merci : votre accord est enregistré." : "Votre refus est enregistré.");
}

/** Lot 6d (contrat art. 19) : le client dépose une réclamation après l'enlèvement, avec une photo facultative. */
export async function fileClaimByClient(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getClientAccess())) return failure("Votre session a expiré : reconnectez-vous.");
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
          : "Votre réclamation n’a pas pu être envoyée.",
      ),
      formData,
    );
  }
  const path = `/espace/dossiers/${parsed.data.dossierId}` as Route;
  if (file && !(await storeClaimPhoto(claimId, parsed.data.dossierId, file))) {
    revalidatePath(path);
    return failure("Réclamation envoyée, mais la photo n’a pas pu être jointe. Ajoutez-la de nouveau.");
  }
  revalidatePath(path);
  return success("Votre réclamation a été envoyée à USA CARS.");
}
