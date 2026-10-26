import { describe, expect, it } from "vitest";
import { likePattern, normalizeQuery, SEARCH_MAX_LENGTH } from "./search";

describe("recherche globale", () => {
  it("nettoie la saisie et ignore une recherche trop courte", () => {
    expect(normalizeQuery("  DEMO-2026   0003 ")).toBe("DEMO-2026 0003");
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery(["DEMO"])).toBeNull();
    expect(normalizeQuery("x".repeat(200))).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("neutralise les caractères du motif et du filtre", () => {
    expect(likePattern("DEMU2468135")).toBe("%DEMU2468135%");
    expect(likePattern("100%_ok")).toBe("%100 ok%");
    expect(likePattern("a,id.eq.(x)")).toBe("%a id.eq. x%");
    expect(likePattern("client@exemple.test")).toBe("%client@exemple.test%");
    expect(likePattern('Diallo"')).toBe("%Diallo%");
  });
});
