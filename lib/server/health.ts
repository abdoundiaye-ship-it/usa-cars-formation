import "server-only";
import { getPublicEnv } from "@/lib/env";

export type DatabaseHealth = "ok" | "unreachable" | "not_configured";

/** Vérifie que l’API Supabase répond (sans lire aucune donnée). */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  let env;
  try {
    env = getPublicEnv();
  } catch {
    return "not_configured";
  }
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}
