/**
 * Sauvegarde des fichiers (décision G3-a) : copie de tous les compartiments Storage dans un dossier local, avec un
 * manifeste (taille et SHA-256 de chaque fichier). Appelé par scripts/sauvegarde.sh, avant le chiffrement.
 *
 * Usage : tsx scripts/sauvegarde-fichiers.ts <dossier>
 * Variables : SUPABASE_URL (URL de l'API du projet), SUPABASE_SERVICE_ROLE_KEY (lecture de tous les fichiers ;
 * jamais hors d'un serveur ou d'un secret GitHub Actions, CLAUDE.md règle 9).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isSafeObjectPath, manifestSummary, retrying, type BackupBucket, type FilesManifest } from "../lib/backup";

const [outputDir] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!outputDir || !url || !key) {
  console.error("Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/sauvegarde-fichiers.ts <dossier>");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PAGE = 1000;

/** Tous les fichiers d'un compartiment, avec leur type (les dossiers de Storage sont parcourus récursivement). */
async function listObjects(bucket: string, prefix = ""): Promise<{ name: string; contentType: string }[]> {
  const names: { name: string; contentType: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await retrying(() =>
      supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    );
    if (error) throw new Error(`Liste impossible (${bucket}/${prefix}) : ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) names.push(...(await listObjects(bucket, path)));
      else if (item.name !== ".emptyFolderPlaceholder") {
        const mimetype = (item.metadata as { mimetype?: unknown } | null)?.mimetype;
        names.push({ name: path, contentType: typeof mimetype === "string" ? mimetype : "application/octet-stream" });
      }
    }
    if (data.length < PAGE) return names;
  }
}

const { data: buckets, error } = await retrying(() => supabase.storage.listBuckets());
if (error) throw new Error(`Compartiments illisibles : ${error.message}`);

const manifest: FilesManifest = { createdAt: new Date().toISOString(), buckets: [] };
for (const bucket of buckets) {
  const entry: BackupBucket = {
    id: bucket.id,
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
    objects: [],
  };
  for (const { name, contentType } of await listObjects(bucket.id)) {
    if (!isSafeObjectPath(name)) throw new Error(`Nom de fichier refusé : ${bucket.id}/${name}`);
    const { data: blob, error: downloadError } = await retrying(() => supabase.storage.from(bucket.id).download(name));
    if (downloadError) throw new Error(`Téléchargement impossible (${bucket.id}/${name}) : ${downloadError.message}`);
    const bytes = Buffer.from(await blob.arrayBuffer());
    const target = join(outputDir, bucket.id, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    entry.objects.push({
      name,
      contentType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  manifest.buckets.push(entry);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "manifeste-fichiers.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Fichiers sauvegardés : ${manifestSummary(manifest)}`);
