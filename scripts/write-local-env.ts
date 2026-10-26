/**
 * Écrit .env.local avec les clés du Supabase LOCAL (sortie de `supabase status`).
 * Refuse d’écraser un fichier qui contiendrait des valeurs de production.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCTION_PROJECT_REF } from "../lib/env";

const target = resolve(process.cwd(), ".env.local");

if (existsSync(target) && readFileSync(target, "utf8").includes(PRODUCTION_PROJECT_REF)) {
  console.error("⛔ .env.local contient des valeurs de production : il n’a pas été modifié.");
  console.error("   Déplacez ces valeurs vers l’hébergeur, supprimez le fichier, puis relancez pnpm db:env.");
  process.exit(1);
}

let raw: string;
try {
  raw = execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  console.error("⛔ Supabase local ne répond pas. Lancez d’abord : pnpm db:start (Docker requis).");
  process.exit(1);
}

const status = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string | undefined>;
const apiUrl = status.API_URL;
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;

if (!apiUrl || !anonKey || !serviceRoleKey) {
  console.error("⛔ Sortie de `supabase status` inattendue : clés introuvables.");
  process.exit(1);
}

const content = [
  "# Généré par pnpm db:env — Supabase LOCAL uniquement. Ne pas y mettre de clés de production.",
  "NEXT_PUBLIC_APP_ENV=local",
  `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
  "APP_URL=http://localhost:3000",
  `ADMIN_EMAIL=${process.env.ADMIN_EMAIL ?? "admin@exemple.test"}`,
  "NOTIFICATIONS_MODE=simulated",
  "",
].join("\n");

writeFileSync(target, content, "utf8");
console.log("✅ .env.local écrit avec les clés du Supabase local.");
