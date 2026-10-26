import { describe, expect, it } from "vitest";
import {
  creditedAtOf,
  depositSchema,
  extraCostSchema,
  forfaitsSchema,
  fxRateSchema,
  internalCostSchema,
  lateFeeDecisionSchema,
  officialAccountSchema,
  refundDecisionSchema,
  sectionOf,
} from "@/lib/validation/finance";
import { dossierMargin } from "./margin";

describe("marge implicite (US-3.1, information interne)", () => {
  it("par section et au total", () => {
    const margin = dossierMargin({ forfait_a_cents: 1_150_000, forfait_b_cents: 320_000 }, [
      { section: "A", amount_cents: 950_000 },
      { section: "A", amount_cents: 95_000 },
      { section: "B", amount_cents: 225_000 },
    ]);
    expect(margin.A).toMatchObject({ costsCents: 1_045_000, marginCents: 105_000, marginPercent: 9.1 });
    expect(margin.B).toMatchObject({ marginCents: 95_000, marginPercent: 29.7 });
    expect(margin.total).toMatchObject({ forfaitCents: 1_470_000, marginCents: 200_000, marginPercent: 13.6 });
  });

  it("forfait non saisi : pas de marge calculée ; marge négative signalée telle quelle", () => {
    expect(dossierMargin(null, [{ section: "A", amount_cents: 10 }]).A.marginCents).toBeNull();
    expect(
      dossierMargin({ forfait_a_cents: 100, forfait_b_cents: null }, [{ section: "A", amount_cents: 150 }]).A
        .marginCents,
    ).toBe(-50);
  });
});

describe("formulaires financiers", () => {
  it("taux de change : 4 décimales, virgule acceptée", () => {
    expect(fxRateSchema.parse({ rate: "587,1050", capturedAt: "2026-10-19T09:30", source: "XE.com" })).toEqual({
      rate: "587.1050",
      capturedAt: "2026-10-19T09:30:00.000Z",
      source: "XE.com",
    });
    expect(
      fxRateSchema.safeParse({ rate: "587,12345", capturedAt: "2026-10-19T09:30", source: "XE.com" }).success,
    ).toBe(false);
    expect(fxRateSchema.safeParse({ rate: "0", capturedAt: "2026-10-19T09:30", source: "XE.com" }).success).toBe(false);
  });

  it("forfaits en dollars convertis en centimes, champs facultatifs", () => {
    expect(
      forfaitsSchema.parse({ dossierId: "11111111-1111-4111-8111-111111111111", forfaitA: "11 500", insurance: "0" }),
    ).toMatchObject({ forfaitA: 1_150_000, forfaitB: null, insurance: 0 });
    expect(forfaitsSchema.safeParse({ dossierId: "11111111-1111-4111-8111-111111111111", forfaitA: "0" }).success).toBe(
      false,
    );
  });

  it("coût interne : section déduite du poste", () => {
    const cost = internalCostSchema.parse({
      dossierId: "11111111-1111-4111-8111-111111111111",
      category: "ocean_freight",
      amount: "1800",
      status: "estimated",
    });
    expect(cost.amount).toBe(180_000);
    expect(sectionOf(cost.category)).toBe("B");
    expect(sectionOf("us_taxes")).toBe("A");
  });

  it("dépôt (US-3.4) : USD en centimes, FCFA entiers, compte officiel exigé sauf espèces", () => {
    const base = {
      dossierId: "11111111-1111-4111-8111-111111111111",
      mode: "bank_transfer",
      accountId: "22222222-2222-4222-8222-222222222222",
      reference: "VIR-001",
      creditedOn: "2026-10-18",
    };
    expect(depositSchema.parse({ ...base, currency: "USD", amount: "2 500,50" })).toMatchObject({
      amountCents: 250_050,
      amountXof: null,
    });
    expect(depositSchema.parse({ ...base, currency: "XOF", amount: "1 500 000" })).toMatchObject({
      amountCents: null,
      amountXof: 1_500_000,
    });
    expect(depositSchema.safeParse({ ...base, currency: "XOF", amount: "1500,5" }).success).toBe(false);
    expect(depositSchema.safeParse({ ...base, accountId: "", currency: "USD", amount: "100" }).success).toBe(false);
    expect(
      depositSchema.safeParse({ ...base, mode: "cash", accountId: "", currency: "USD", amount: "100" }).success,
    ).toBe(true);
  });

  it("date de crédit : fin de journée pour un jour passé (dernier taux du jour), maintenant pour aujourd'hui", () => {
    const now = new Date("2026-10-19T10:15:00Z");
    expect(creditedAtOf("2026-10-18", now).toISOString()).toBe("2026-10-18T23:59:59.000Z");
    expect(creditedAtOf("2026-10-19", now)).toEqual(now);
  });

  it("compte officiel : numéro Wave au format international, banque complète", () => {
    expect(
      officialAccountSchema.parse({ kind: "wave", label: "Wave", holderName: "USA CARS", phone: "77 000 09 00" }).phone,
    ).toBe("+221770000900");
    expect(
      officialAccountSchema.safeParse({ kind: "wave", label: "Wave", holderName: "USA CARS", phone: "" }).success,
    ).toBe(false);
    expect(
      officialAccountSchema.safeParse({ kind: "bank", label: "Banque", holderName: "USA CARS", bankName: "B" }).success,
    ).toBe(false);
  });
});

describe("lignes D et remboursements (lot 3c)", () => {
  const dossierId = "11111111-1111-4111-8111-111111111111";
  const targetId = "22222222-2222-4222-8222-222222222222";

  it("frais supplémentaires (R7) : montant en centimes, urgence motivée", () => {
    expect(extraCostSchema.parse({ dossierId, section: "B", label: "Stockage", amount: "350" })).toMatchObject({
      amount: 35_000,
      urgent: false,
    });
    expect(
      extraCostSchema.safeParse({ dossierId, section: "B", label: "Stockage", amount: "350", urgent: "on" }).success,
    ).toBe(false);
    expect(
      extraCostSchema.parse({
        dossierId,
        section: "B",
        label: "Stockage",
        amount: "350",
        urgent: "on",
        reason: "Stockage imposé par le port",
      }).urgent,
    ).toBe(true);
  });

  it("frais de retard (C5) et remboursement (C9) : motif exigé pour écarter ou refuser", () => {
    expect(lateFeeDecisionSchema.safeParse({ dossierId, adjustmentId: targetId, decision: "approve" }).success).toBe(
      true,
    );
    expect(lateFeeDecisionSchema.safeParse({ dossierId, adjustmentId: targetId, decision: "reject" }).success).toBe(
      false,
    );
    expect(
      refundDecisionSchema.safeParse({ dossierId, refundId: targetId, decision: "reject", reason: "Doublon" }).success,
    ).toBe(true);
    expect(refundDecisionSchema.safeParse({ dossierId, refundId: targetId, decision: "reject" }).success).toBe(false);
  });
});
