import "server-only";
import { sha256Hex } from "@/lib/hash";
import type { DocumentKind } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Bucket privé des documents (migration 20261019100100) : jamais d'URL publique. */
export const DOCUMENTS_BUCKET = "documents";

/** Durée de validité d'un lien de téléchargement signé (US-2.8 : lien expirant). */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Nom de fichier sûr pour le chemin de stockage (sans accents ni caractères spéciaux). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (cleaned || "document").slice(-80);
}

/** Chemin de stockage : dossiers/{dossier}/{type}/{identifiant unique}-{nom}. */
export function storagePath(dossierId: string, kind: DocumentKind, fileName: string): string {
  return `dossiers/${dossierId}/${kind}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

export interface StoredFile {
  path: string;
  sha256: string;
  size: number;
}

/** Dépose un fichier dans le bucket privé, au nom de l'utilisateur connecté (politiques de stockage). */
export async function uploadToStorage(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StoredFile | null> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) return null;
  return { path, sha256: await sha256Hex(bytes), size: bytes.byteLength };
}

/** Téléverse un fichier du dossier (bucket privé) et l'enregistre ; renvoie l'identifiant du document. */
export async function storeDossierFile(
  dossierId: string,
  kind: DocumentKind,
  file: File,
  visibleClient = false,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: dossier } = await supabase.from("dossiers").select("client_id").eq("id", dossierId).maybeSingle();
  if (!dossier) return null;
  const stored = await uploadToStorage(
    storagePath(dossierId, kind, file.name),
    new Uint8Array(await file.arrayBuffer()),
    file.type,
  );
  if (!stored) return null;
  const { data: document } = await supabase
    .from("documents")
    .insert({
      dossier_id: dossierId,
      client_id: dossier.client_id,
      kind,
      storage_path: stored.path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: stored.size,
      sha256: stored.sha256,
      visible_client: visibleClient,
    })
    .select("id")
    .single();
  return document?.id ?? null;
}
