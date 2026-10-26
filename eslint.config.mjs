import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // La clé service_role ne doit jamais atteindre le navigateur (CLAUDE.md règle 9).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message: "Client service_role : à n’importer que dans du code serveur (actions, routes, scripts).",
            },
          ],
        },
      ],
    },
  },
  {
    // Fichiers serveur autorisés à importer le client admin.
    files: ["app/**/actions.ts", "app/**/route.ts", "lib/server/**/*.ts", "scripts/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "lib/supabase/database.types.ts",
    "reference/**",
  ]),
]);
