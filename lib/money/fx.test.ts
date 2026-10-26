import { describe, expect, it } from "vitest";
import { parseRate, usdCentsToXof, xofToUsdCents } from "./fx";

describe("parseRate", () => {
  it("accepte un taux décimal avec point ou virgule", () => {
    expect(parseRate("586.52")).toBe(5_865_200n);
    expect(parseRate("586,5200")).toBe(5_865_200n);
    expect(parseRate(586.52)).toBe(5_865_200n);
  });

  it("refuse un taux nul, négatif ou trop précis", () => {
    expect(() => parseRate("0")).toThrow(RangeError);
    expect(() => parseRate("-586.52")).toThrow(RangeError);
    expect(() => parseRate("586.12345")).toThrow(RangeError);
    expect(() => parseRate("abc")).toThrow(RangeError);
  });
});

describe("usdCentsToXof (R1 : arrondi au FCFA entier le plus proche)", () => {
  it("convertit un montant exact", () => {
    // 12 450 $US × 586,52 = 7 302 174 FCFA
    expect(usdCentsToXof(1_245_000, "586.52")).toBe(7_302_174);
  });

  it("arrondit 0,5 FCFA vers le haut", () => {
    // 0,01 $US × 50 = 0,5 FCFA → 1
    expect(usdCentsToXof(1, "50")).toBe(1);
    // 0,01 $US × 49,9999 = 0,499999 FCFA → 0
    expect(usdCentsToXof(1, "49.9999")).toBe(0);
  });

  it("arrondit symétriquement les montants négatifs (remise)", () => {
    expect(usdCentsToXof(-1, "50")).toBe(-1);
  });

  it("ne souffre d’aucune erreur flottante", () => {
    // 0,1 + 0,2 en float = 0,30000000000000004 ; ici tout est entier.
    expect(usdCentsToXof(30, "1")).toBe(0);
    expect(usdCentsToXof(50, "1")).toBe(1);
    expect(usdCentsToXof(1_000_000_00, "655.957")).toBe(655_957_000);
  });

  it("refuse un montant non entier", () => {
    expect(() => usdCentsToXof(10.5, "586.52")).toThrow(RangeError);
  });
});

describe("xofToUsdCents (imputation d’un paiement en FCFA)", () => {
  it("convertit au taux du jour du paiement", () => {
    expect(xofToUsdCents(7_302_174, "586.52")).toBe(1_245_000);
  });

  it("devis à un taux, paiement à un autre : l’USD fait foi", () => {
    const dueCents = 1_245_000;
    const quotedXof = usdCentsToXof(dueCents, "586.52");
    const paidAtNewRate = usdCentsToXof(dueCents, "590.10");
    expect(quotedXof).toBe(7_302_174);
    expect(paidAtNewRate).toBe(7_346_745);
    expect(xofToUsdCents(paidAtNewRate, "590.10")).toBe(dueCents);
  });

  it("arrondit au centime le plus proche (écart ≤ 1 centime)", () => {
    // 1 000 FCFA / 586,52 = 1,70497… $US → 170 centimes
    expect(xofToUsdCents(1_000, "586.52")).toBe(170);
  });
});
