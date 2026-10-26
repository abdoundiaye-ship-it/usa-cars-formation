import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNotProductionOutsideProd, PRODUCTION_PROJECT_REF, serverEnvIssues } from "./env";

describe("garde-fou production (CLAUDE.md §2)", () => {
  const prodUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

  it("refuse l’URL de production hors environnement production", () => {
    expect(() => assertNotProductionOutsideProd(prodUrl, "local")).toThrow(/production/);
    expect(() => assertNotProductionOutsideProd(prodUrl, undefined)).toThrow(/production/);
  });

  it("accepte l’URL de production en production et l’URL locale partout", () => {
    expect(() => assertNotProductionOutsideProd(prodUrl, "production")).not.toThrow();
    expect(() => assertNotProductionOutsideProd("http://127.0.0.1:54321", "local")).not.toThrow();
  });
});

describe("diagnostic de configuration serveur (/api/sante)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ne renvoie que les noms des variables absentes ou invalides, jamais leurs valeurs", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "valeur-secrete");
    vi.stubEnv("APP_URL", "pas-une-url");
    const issues = serverEnvIssues();
    expect(issues).toEqual(["APP_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(JSON.stringify(issues)).not.toContain("valeur-secrete");
  });

  it("renvoie une liste vide quand la configuration est complète", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle-service");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "local");
    vi.stubEnv("ADMIN_EMAIL", "admin@exemple.test");
    vi.stubEnv("NOTIFICATIONS_MODE", "simulated");
    expect(serverEnvIssues()).toEqual([]);
  });
});
