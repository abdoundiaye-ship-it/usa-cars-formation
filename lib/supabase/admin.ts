import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Client Supabase avec la clé service_role : contourne la RLS.
 * Réservé au code serveur (actions, routes, scripts) — jamais exposé au navigateur (CLAUDE.md règle 9).
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
