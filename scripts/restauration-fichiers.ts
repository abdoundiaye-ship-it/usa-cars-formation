/**
 * Restauration des fichiers (décision G3-a) : renvoie dans Storage les fichiers d'une sauvegarde, après contrôle de
 * leur empreinte, puis les relit pour vérifier la copie. Appelé par scripts/restauration.sh.
 *
 * Usage : tsx scripts/restauration-fichiers.ts <dossier>
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY du projet CIBLE (jamais la production, voir docs/21).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isSafeObjectPath, manifestSummary, retrying, type FilesManifest } from "../lib/backup";
import { PRODUCTION_PROJECT_REF } from "../lib/env";

const [inputDir] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!inputDir || !url || !key) {
  console.error("Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/restauration-fichiers.ts <dossier>");
  process.exit(2);
}
if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error("⛔ Restauration refusée sur le projet de production : restaurer dans un nouveau projet (docs/21).");
  process.exit(1);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = JSON.parse(readFileSync(join(inputDir, "manifeste-fichiers.json"), "utf8")) as FilesManifest;

const { data: existing, error } = await retrying(() => supabase.storage.listBuckets());
if (error) throw new Error(`Compartiments illisibles : ${error.message}`);

for (const bucket of manifest.buckets) {
  // Compartiment absent (base restaurée sans ses lignes storage.buckets) : recréé avec les mêmes réglages.
  if (!existing.some((b) => b.id === bucket.id)) {
    const { error: createError } = await supabase.storage.createBucket(bucket.id, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit ?? undefined,
      allowedMimeTypes: bucket.allowedMimeTypes ?? undefined,
    });
    if (createError) throw new Error(`Compartiment ${bucket.id} non créé : ${createError.message}`);
  }
  for (const object of bucket.objects) {
    if (!isSafeObjectPath(object.name)) throw new Error(`Nom de fichier refusé : ${bucket.id}/${object.name}`);
    const bytes = readFileSync(join(inputDir, bucket.id, ...object.name.split("/")));
    if (sha256(bytes) !== object.sha256)
      throw new Error(`Fichier altéré dans la sauvegarde : ${bucket.id}/${object.name}`);
    const { error: uploadError } = await retrying(() =>
      supabase.storage.from(bucket.id).upload(object.name, bytes, { upsert: true, contentType: object.contentType }),
    );
    if (uploadError) throw new Error(`Envoi impossible (${bucket.id}/${object.name}) : ${uploadError.message}`);
    const { data: blob, error: readError } = await retrying(() =>
      supabase.storage.from(bucket.id).download(object.name),
    );
    if (readError || sha256(new Uint8Array(await blob.arrayBuffer())) !== object.sha256) {
      throw new Error(`Copie non conforme après restauration : ${bucket.id}/${object.name}`);
    }
  }
}
console.log(`Fichiers restaurés et vérifiés : ${manifestSummary(manifest)}`);
