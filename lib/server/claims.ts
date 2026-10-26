import "server-only";
import { storagePath, uploadToStorage } from "@/lib/server/documents";
import { MAX_UPLOAD_BYTES, PROOF_MIME_TYPES } from "@/lib/validation/operations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Pièce jointe d'une réclamation (photo ou document) : PDF ou image, 20 Mo au maximum. */
export function claimPhotoError(file: File | null): string | null {
  if (!file || file.size === 0) return null; // la photo est facultative
  if (file.size > MAX_UPLOAD_BYTES) return "Le fichier dépasse 20 Mo.";
  if (!(PROOF_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Format accepté : photo (JPEG, PNG, WebP, HEIC) ou PDF.";
  }
  return null;
}

/**
 * Dépose une photo dans le bucket privé (au nom de l'utilisateur : la politique de stockage limite le client à ses
 * dossiers) et l'enregistre sur la réclamation via register_claim_photo (interne ou client propriétaire).
 * Renvoie l'identifiant de la pièce, ou null en cas d'échec.
 */
export async function storeClaimPhoto(claimId: string, dossierId: string, file: File): Promise<string | null> {
  const stored = await uploadToStorage(
    storagePath(dossierId, "photos", file.name),
    new Uint8Array(await file.arrayBuffer()),
    file.type,
  );
  if (!stored) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_claim_photo", {
    p_claim_id: claimId,
    p_storage_path: stored.path,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: stored.size,
    p_sha256: stored.sha256,
  });
  if (error) return null;
  return data ?? null;
}
