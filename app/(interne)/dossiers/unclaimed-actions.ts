"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { generateUnclaimedLetterFile } from "@/lib/server/contracts";
import { storagePath, uploadToStorage } from "@/lib/server/documents";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proofFileError } from "@/lib/validation/operations";
import {
  cancelLetterSchema,
  closeProcedureSchema,
  issueLetterSchema,
  letterIdSchema,
  letterSentSchema,
  openProcedureSchema,
} from "@/lib/validation/recovery";

/**
 * US-5.3 : procédure « véhicule non réclamé » (contrat art. 21–22, R11). Courriers par l'administrateur, la
 * direction et la comptabilité ; ouverture et clôture de la procédure par l'administrateur et la direction (U3).
 * La base vérifie chaque règle (délais, ordre des courriers, montants figés) ; aucune action sur la propriété.
 */

const RECOVERY_ONLY = "Action réservée à l’administrateur, à la direction et à la comptabilité.";
const PROCEDURE_ONLY = "Action réservée à l’administrateur et à la direction.";

const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/** Message d'une règle métier de la base (22023) ; message générique sinon. */
const ruleMessage = (error: { code?: string; message: string }, fallback: string) =>
  error.code === "22023" ? error.message : fallback;

function refresh(dossierId: string) {
  revalidatePath(dossierPath(dossierId));
  revalidatePath("/tableau-de-bord");
}

/** Émission d'une lettre de relance ou d'une mise en demeure, puis génération de son fichier Word. */
export async function issueUnclaimedLetter(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.recoveryWrite))) return failure(RECOVERY_ONLY);
  const parsed = issueLetterSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, kind, cureDays } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: letterId, error } = await supabase.rpc("issue_unclaimed_letter", {
    p_dossier_id: dossierId,
    p_kind: kind,
    p_cure_days: cureDays,
  });
  if (error || !letterId) {
    return withValues(failure(ruleMessage(error ?? { message: "" }, "Le courrier n’a pas pu être émis.")), formData);
  }
  const file = await generateUnclaimedLetterFile(letterId);
  refresh(dossierId);
  return file.ok
    ? success("Courrier émis. Téléchargez-le, envoyez-le au client, puis enregistrez l’envoi.")
    : failure(
        `Courrier émis, mais son fichier n’a pas pu être généré (${file.message}). Utilisez « Générer le fichier ».`,
      );
}

/** Nouvelle tentative de génération du fichier d'un courrier émis. */
export async function generateLetterFile(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.recoveryWrite))) return failure(RECOVERY_ONLY);
  const parsed = letterIdSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Courrier inconnu.");
  const file = await generateUnclaimedLetterFile(parsed.data.letterId);
  refresh(parsed.data.dossierId);
  return file.ok ? success("Fichier du courrier généré.") : failure(file.message);
}

/** Envoi enregistré (U4) : date, canal, preuve ; le courrier devient visible du client, qui est notifié. */
export async function recordLetterSent(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.recoveryWrite))) return failure(RECOVERY_ONLY);
  const parsed = letterSentSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const v = parsed.data;

  const proof = formData.get("proof");
  const file = proof instanceof File && proof.size > 0 ? proof : null;
  const proofError = file
    ? proofFileError(file)
    : "Joignez la preuve d’envoi (accusé signé, capture, reçu du coursier).";
  if (proofError) {
    return withValues(
      { status: "error", message: "Preuve d’envoi à joindre.", fieldErrors: { proof: proofError } },
      formData,
    );
  }
  const stored = await uploadToStorage(
    storagePath(v.dossierId, "letter_sending_proof", file!.name),
    new Uint8Array(await file!.arrayBuffer()),
    file!.type,
  );
  if (!stored) return withValues(failure("La preuve d’envoi n’a pas pu être enregistrée. Réessayez."), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_letter_sent", {
    p_letter_id: v.letterId,
    p_sent_on: v.sentOn,
    p_channel: v.channel,
    p_note: v.note,
    p_proof_storage_path: stored.path,
    p_proof_file_name: file!.name.slice(0, 200),
    p_proof_mime_type: file!.type,
    p_proof_size_bytes: stored.size,
    p_proof_sha256: stored.sha256,
  });
  if (error) return withValues(failure(ruleMessage(error, "L’envoi n’a pas pu être enregistré.")), formData);
  refresh(v.dossierId);
  return success("Envoi enregistré : le courrier est visible dans l’espace client et le client est notifié.");
}

/** Annulation d'un courrier non envoyé (erreur), motif obligatoire. */
export async function cancelUnclaimedLetter(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.recoveryWrite))) return failure(RECOVERY_ONLY);
  const parsed = cancelLetterSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_unclaimed_letter", {
    p_letter_id: parsed.data.letterId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "Le courrier n’a pas pu être annulé.")), formData);
  refresh(parsed.data.dossierId);
  return success("Courrier annulé.");
}

/** Ouverture de la procédure à l'échéance (art. 22) : statut « Non réclamé (procédure en cours) ». */
export async function openUnclaimedProcedure(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.procedureWrite))) return failure(PROCEDURE_ONLY);
  const parsed = openProcedureSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("open_unclaimed_procedure", {
    p_dossier_id: parsed.data.dossierId,
    p_reason: parsed.data.reason,
  });
  if (error) return withValues(failure(ruleMessage(error, "La procédure n’a pas pu être ouverte.")), formData);
  refresh(parsed.data.dossierId);
  return success("Procédure ouverte.");
}

/** Clôture de la procédure avec son issue et le statut final du dossier. */
export async function closeUnclaimedProcedure(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.procedureWrite))) return failure(PROCEDURE_ONLY);
  const parsed = closeProcedureSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("close_unclaimed_procedure", {
    p_dossier_id: parsed.data.dossierId,
    p_outcome: parsed.data.outcome,
    p_closing_status: parsed.data.closingStatus,
  });
  if (error) return withValues(failure(ruleMessage(error, "La procédure n’a pas pu être clôturée.")), formData);
  refresh(parsed.data.dossierId);
  return success("Procédure clôturée.");
}
