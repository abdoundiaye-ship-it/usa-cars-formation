/**
 * Vérification d'une restauration (décision G3-a) : compare le nombre de lignes de chaque table de la base restaurée
 * aux comptages faits en production avant et après la copie des données. Appelé par scripts/restauration.sh.
 *
 * Usage : tsx scripts/verifier-restauration.ts <avant.json> <apres.json> <restaure.json>
 */
import { readFileSync } from "node:fs";
import { compareCounts, type TableCounts } from "../lib/backup";

const files = process.argv.slice(2);
if (files.length !== 3) {
  console.error("Usage : tsx scripts/verifier-restauration.ts <avant.json> <apres.json> <restaure.json>");
  process.exit(2);
}
const [before, after, restored] = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as TableCounts) as [
  TableCounts,
  TableCounts,
  TableCounts,
];
const problems = compareCounts(before, after, restored);
const tables = Object.keys(before).length;
const rows = Object.values(restored).reduce((sum, n) => sum + n, 0);
if (problems.length > 0) {
  console.error(`⛔ Restauration incomplète (${problems.length} écart(s) sur ${tables} tables) :`);
  for (const problem of problems) console.error(`   - ${problem}`);
  process.exit(1);
}
console.log(`✅ Restauration vérifiée : ${tables} tables, ${rows} lignes, conformes à la sauvegarde.`);
