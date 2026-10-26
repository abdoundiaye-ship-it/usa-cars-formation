import { NextResponse } from "next/server";
import { serverEnvIssues } from "@/lib/env";
import { checkDatabaseHealth } from "@/lib/server/health";

export const dynamic = "force-dynamic";

/** État de l’application (sans donnée) : utilisé pour la surveillance et les tests. */
export async function GET() {
  const base = await checkDatabaseHealth();
  // Noms des variables serveur manquantes ou invalides, jamais leurs valeurs.
  const missing = serverEnvIssues();
  const configuration = missing.length ? { serveur: "incomplete", variables: missing } : { serveur: "ok" };
  return NextResponse.json({ application: "ok", base, configuration }, { status: base === "ok" ? 200 : 503 });
}
