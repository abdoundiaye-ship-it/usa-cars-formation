import { z } from "zod";

/** Référence du projet Supabase de PRODUCTION (CLAUDE.md §2). Ce n’est pas un secret. */
export const PRODUCTION_PROJECT_REF = "hzgkhtaefpbqztwagwph";

const appEnvSchema = z.enum(["local", "production"]).default("local");

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_ENV: appEnvSchema,
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),
  ADMIN_EMAIL: z.email().optional(),
  NOTIFICATIONS_MODE: z.enum(["simulated", "live"]).default("simulated"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Refuse toute connexion au projet de production hors de l’environnement `production`.
 * Développement et tests uniquement sur Supabase local (CLAUDE.md §2).
 */
export function assertNotProductionOutsideProd(supabaseUrl: string, appEnv: string | undefined): void {
  if (appEnv !== "production" && supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      "Configuration refusée : l’URL Supabase pointe vers le projet de production alors que NEXT_PUBLIC_APP_ENV n’est pas « production ». " +
        "Utilisez Supabase local (pnpm db:start puis pnpm db:env).",
    );
  }
}

export function getPublicEnv(): PublicEnv {
  // Accès littéraux : Next.js n’injecte les variables NEXT_PUBLIC_* dans le navigateur que sous cette forme.
  const env = publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  });
  assertNotProductionOutsideProd(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_APP_ENV);
  return env;
}

/** Noms des variables serveur absentes ou invalides (jamais leurs valeurs) : diagnostic de /api/sante. */
export function serverEnvIssues(): string[] {
  const result = serverSchema.safeParse(process.env);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))].sort();
}

export function getServerEnv(): ServerEnv {
  const env = serverSchema.parse(process.env);
  assertNotProductionOutsideProd(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_APP_ENV);
  return env;
}
