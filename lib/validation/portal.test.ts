import { describe, expect, it } from "vitest";
import { portalDecisionSchema } from "./portal";

const base = {
  dossierId: "11111111-1111-4111-8111-111111111111",
  subject: "quote",
  subjectId: "22222222-2222-4222-8222-222222222222",
  sha256: "d".repeat(64),
  decision: "accepted",
};

describe("décision du client dans le portail (R15, X1)", () => {
  it("signale ensemble le consentement et le choix d'assurance manquants", () => {
    const result = portalDecisionSchema.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["consent", "insuranceChoice"]);
  });

  it("accepte un devis avec consentement et choix d'assurance ; refus sans choix d'assurance", () => {
    expect(portalDecisionSchema.safeParse({ ...base, consent: "on", insuranceChoice: "refused" }).success).toBe(true);
    expect(portalDecisionSchema.safeParse({ ...base, decision: "refused", consent: "on" }).success).toBe(true);
  });

  it("frais supplémentaires : pas de choix d'assurance, consentement exigé", () => {
    expect(portalDecisionSchema.safeParse({ ...base, subject: "extra_cost", consent: "on" }).success).toBe(true);
    expect(portalDecisionSchema.safeParse({ ...base, subject: "extra_cost" }).success).toBe(false);
  });
});
