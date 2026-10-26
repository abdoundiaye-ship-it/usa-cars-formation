import { describe, expect, it } from "vitest";
import {
  formatSettingValue,
  isNullable,
  isValidSettingValue,
  parseSettingInput,
  parseSettingType,
  settingValueToInput,
} from "./types";

const NBSP = " ";

describe("parseSettingType", () => {
  it("reconnaît les types simples et les énumérations", () => {
    expect(parseSettingType("integer").kind).toBe("integer");
    expect(parseSettingType("enum:manual|proposed_with_approval")).toEqual({
      kind: "enum",
      options: ["manual", "proposed_with_approval"],
    });
  });

  it("refuse un type inconnu", () => {
    expect(() => parseSettingType("date")).toThrow();
    expect(() => parseSettingType("enum:")).toThrow();
  });
});

describe("parseSettingInput (US-1.3)", () => {
  it("money : dollars saisis → centimes stockés", () => {
    expect(parseSettingInput("money", "250")).toEqual({ ok: true, value: 25_000 });
    expect(parseSettingInput("money", "250,50")).toEqual({ ok: true, value: 25_050 });
    expect(parseSettingInput("money", "-1").ok).toBe(false);
    expect(parseSettingInput("money", "12,345").ok).toBe(false);
  });

  it("valeur vide : « non défini » pour les nombres, refusée sinon", () => {
    expect(parseSettingInput("money", "")).toEqual({ ok: true, value: null });
    expect(parseSettingInput("integer", "  ")).toEqual({ ok: true, value: null });
    expect(parseSettingInput("string", "").ok).toBe(false);
    expect(parseSettingInput("boolean", "").ok).toBe(false);
  });

  it("integer et number", () => {
    expect(parseSettingInput("integer", "48")).toEqual({ ok: true, value: 48 });
    expect(parseSettingInput("integer", "4,5").ok).toBe(false);
    expect(parseSettingInput("number", "10,5")).toEqual({ ok: true, value: 10.5 });
    expect(parseSettingInput("number", "abc").ok).toBe(false);
  });

  it("booléens en français", () => {
    expect(parseSettingInput("boolean", "Oui")).toEqual({ ok: true, value: true });
    expect(parseSettingInput("boolean", "non")).toEqual({ ok: true, value: false });
    expect(parseSettingInput("boolean", "peut-être").ok).toBe(false);
  });

  it("listes", () => {
    expect(parseSettingInput("integer[]", "7, 3, 2")).toEqual({ ok: true, value: [7, 3, 2] });
    expect(parseSettingInput("integer[]", "7, x").ok).toBe(false);
    expect(parseSettingInput("string[]", "admin, accounting")).toEqual({ ok: true, value: ["admin", "accounting"] });
  });

  it("énumérations : valeur autorisée uniquement", () => {
    expect(parseSettingInput("enum:manual|proposed_with_approval", "manual")).toEqual({ ok: true, value: "manual" });
    const refused = parseSettingInput("enum:manual|proposed_with_approval", "auto");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("manual");
  });
});

describe("isValidSettingValue", () => {
  it("contrôle la cohérence valeur / type", () => {
    expect(isValidSettingValue("money", 10_000)).toBe(true);
    expect(isValidSettingValue("money", 100.5)).toBe(false);
    expect(isValidSettingValue("money", null)).toBe(true);
    expect(isValidSettingValue("boolean", null)).toBe(false);
    expect(isValidSettingValue("integer[]", [])).toBe(false);
    expect(isValidSettingValue("enum:a|b", "c")).toBe(false);
  });

  it("isNullable", () => {
    expect(isNullable("money")).toBe(true);
    expect(isNullable("string")).toBe(false);
  });
});

describe("affichage et préremplissage", () => {
  it("formatSettingValue", () => {
    expect(formatSettingValue("money", 10_000)).toBe(`100${NBSP}$US`);
    expect(formatSettingValue("money", null)).toBe("Non défini");
    expect(formatSettingValue("boolean", false)).toBe("Non");
    expect(formatSettingValue("integer[]", [7, 3, 2])).toBe("7, 3, 2");
    expect(formatSettingValue("number", 586.52)).toBe("586,52");
  });

  it("settingValueToInput est l’inverse de parseSettingInput", () => {
    for (const [type, value] of [
      ["money", 25_050],
      ["money", 10_000],
      ["number", 10.5],
      ["boolean", true],
      ["integer[]", [7, 3, 2]],
      ["string", "XE.com"],
    ] as const) {
      expect(parseSettingInput(type, settingValueToInput(type, value))).toEqual({ ok: true, value });
    }
  });
});
