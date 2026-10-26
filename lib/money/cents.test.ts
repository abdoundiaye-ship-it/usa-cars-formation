import { describe, expect, it } from "vitest";
import { assertCents, parseUsdToCents } from "./cents";

describe("parseUsdToCents", () => {
  it("convertit les saisies usuelles sans float", () => {
    expect(parseUsdToCents("12450")).toBe(1_245_000);
    expect(parseUsdToCents("12 450,5")).toBe(1_245_050);
    expect(parseUsdToCents("12 450.05")).toBe(1_245_005);
    expect(parseUsdToCents("0.1")).toBe(10);
    expect(parseUsdToCents("-25")).toBe(-2_500);
  });

  it("refuse les saisies invalides ou à plus de 2 décimales", () => {
    expect(parseUsdToCents("")).toBeNull();
    expect(parseUsdToCents("12.345")).toBeNull();
    expect(parseUsdToCents("abc")).toBeNull();
    expect(parseUsdToCents("1e5")).toBeNull();
  });
});

describe("assertCents", () => {
  it("accepte les entiers sûrs et refuse le reste", () => {
    expect(() => assertCents(100)).not.toThrow();
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(() => assertCents(Number.NaN)).toThrow(RangeError);
    expect(() => assertCents(2 ** 60)).toThrow(RangeError);
  });
});
