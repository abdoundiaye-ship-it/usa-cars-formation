/**
 * Garde-fou exécuté avant toute commande de base de données ou de test (db:reset, test:db, test:e2e).
 * Interdit sur la production : db reset, seed de démonstration, tests automatisés (CLAUDE.md §2).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCTION_PROJECT_REF } from "../lib/env";

const problems: string[] = [];

const envVarsToCheck = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL"] as const;
for (const name of envVarsToCheck) {
  if (process.env[name]?.includes(PRODUCTION_PROJECT_REF)) {
    problems.push(`la variable ${name} pointe vers le projet de production`);
  }
}

for (const file of [".env", ".env.local", ".env.development.local", ".env.test.local"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path) && readFileSync(path, "utf8").includes(PRODUCTION_PROJECT_REF)) {
    problems.push(`le fichier ${file} contient la référence du projet de production`);
  }
}

if (problems.length > 0) {
  console.error("⛔ Commande refusée : elle doit s’exécuter uniquement sur Supabase local.");
  for (const problem of problems) console.error(`   - ${problem}`);
  console.error("   Les clés de production vont dans l’hébergeur (Vercel), pas dans les fichiers .env locaux.");
  process.exit(1);
}
