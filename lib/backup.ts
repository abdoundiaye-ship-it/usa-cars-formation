/**
 * Sauvegardes (décision G3-a) : fonctions pures communes aux scripts de sauvegarde et de restauration
 * (scripts/sauvegarde-fichiers.ts, scripts/restauration-fichiers.ts, scripts/verifier-restauration.ts).
 */

/** Fichier de Storage sauvegardé : chemin dans le compartiment, taille et empreinte SHA-256. */
export interface BackupObject {
  name: string;
  contentType: string;
  size: number;
  sha256: string;
}

export interface BackupBucket {
  id: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
  objects: BackupObject[];
}

/** Manifeste des fichiers (manifeste-fichiers.json, dans l'archive chiffrée). */
export interface FilesManifest {
  createdAt: string;
  buckets: BackupBucket[];
}

/** Nombre de lignes par table (« schéma.table » → nombre). */
export type TableCounts = Record<string, number>;

/**
 * Chemin d'objet utilisable comme chemin de fichier local : relatif, sans « .. », sans caractère interdit sous
 * Windows. Un nom refusé arrête la sauvegarde (jamais d'écriture hors du dossier de sauvegarde).
 */
export function isSafeObjectPath(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[<>:"|?*]/.test(part));
}

/**
 * Restauration vérifiée : chaque table comptée en production avant et après la copie des données doit exister dans
 * la base restaurée, avec un nombre de lignes compris entre les deux comptages (écritures pendant la sauvegarde).
 * Renvoie la liste des écarts, vide si la restauration est complète.
 */
export function compareCounts(before: TableCounts, after: TableCounts, restored: TableCounts): string[] {
  const problems: string[] = [];
  for (const table of Object.keys(before).sort()) {
    const low = Math.min(before[table]!, after[table] ?? before[table]!);
    const high = Math.max(before[table]!, after[table] ?? before[table]!);
    const count = restored[table];
    if (count === undefined) problems.push(`${table} : table absente de la base restaurée`);
    else if (count < low || count > high) {
      problems.push(
        `${table} : ${count} ligne(s) restaurée(s), ${low === high ? low : `${low} à ${high}`} attendue(s)`,
      );
    }
  }
  return problems;
}

/**
 * Appel Storage relancé en cas d'erreur (coupure réseau passagère) : jusqu'à `attempts` essais, attente croissante.
 * Renvoie le dernier résultat ({ data, error } de supabase-js).
 */
export async function retrying<T extends { error: unknown }>(call: () => Promise<T>, attempts = 3, waitMs = 1000) {
  let result = await call();
  for (let attempt = 1; attempt < attempts && result.error; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
    result = await call();
  }
  return result;
}

/** Fichiers attendus par compartiment, pour le résumé de la sauvegarde. */
export function manifestSummary(manifest: FilesManifest): string {
  const files = manifest.buckets.reduce((sum, b) => sum + b.objects.length, 0);
  const bytes = manifest.buckets.reduce((sum, b) => sum + b.objects.reduce((s, o) => s + o.size, 0), 0);
  return `${manifest.buckets.length} compartiment(s), ${files} fichier(s), ${(bytes / 1_048_576).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo`;
}
