import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/** Client Supabase côté serveur, au nom de l’utilisateur connecté (clé anon + session, soumis à la RLS). */
export async function createSupabaseServerClient() {
  // cookies() d’abord : rend la page dynamique avant toute lecture de configuration (pas de prérendu au build).
  const cookieStore = await cookies();
  // Configuration publique seulement : ce client n’a besoin ni de la clé service_role ni des variables serveur.
  const env = getPublicEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Appelé depuis un Server Component : les cookies seront rafraîchis par le proxy (phase 1).
        }
      },
    },
  });
}
