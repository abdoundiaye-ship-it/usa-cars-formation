import { formatUsd } from "@/lib/format";
import { parseUsdToCents } from "@/lib/money/cents";

/**
 * Types des paramètres contractuels (table settings, colonne value_type).
 * `money` : centimes USD entiers (CLAUDE.md règle 1).
 * Les valeurs numériques peuvent être `null` (« non défini », ex. plafond des frais de retard).
 */
export type SettingValue = string | number | boolean | number[] | string[] | null;

export type SettingKind = "string" | "number" | "integer" | "money" | "boolean" | "integer[]" | "string[]" | "enum";

export interface ParsedSettingType {
  kind: SettingKind;
  options: string[];
}

const NULLABLE_KINDS: ReadonlySet<SettingKind> = new Set(["number", "integer", "money"]);

export function parseSettingType(valueType: string): ParsedSettingType {
  if (valueType.startsWith("enum:")) {
    const options = valueType.slice(5).split("|").filter(Boolean);
    if (options.length === 0) throw new Error(`Type de paramètre invalide : « ${valueType} ».`);
    return { kind: "enum", options };
  }
  const kinds: SettingKind[] = ["string", "number", "integer", "money", "boolean", "integer[]", "string[]"];
  const kind = kinds.find((k) => k === valueType);
  if (!kind) throw new Error(`Type de paramètre inconnu : « ${valueType} ».`);
  return { kind, options: [] };
}

export function isNullable(valueType: string): boolean {
  return NULLABLE_KINDS.has(parseSettingType(valueType).kind);
}

export type ParseResult = { ok: true; value: SettingValue } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

function splitList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Convertit une saisie de formulaire en valeur typée, avec un message d’erreur qui dit comment corriger. */
export function parseSettingInput(valueType: string, raw: string): ParseResult {
  const { kind, options } = parseSettingType(valueType);
  const text = raw.trim();

  if (text === "") {
    return NULLABLE_KINDS.has(kind) ? { ok: true, value: null } : fail("Une valeur est obligatoire pour ce paramètre.");
  }

  switch (kind) {
    case "string":
      return { ok: true, value: text };
    case "number": {
      const normalized = text.replace(/[\s  ]/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(normalized)) return fail("Saisissez un nombre (ex. 10 ou 10,5).");
      return { ok: true, value: Number(normalized) };
    }
    case "integer": {
      const normalized = text.replace(/[\s  ]/g, "");
      if (!/^-?\d+$/.test(normalized)) return fail("Saisissez un nombre entier (ex. 48).");
      const value = Number(normalized);
      return Number.isSafeInteger(value) ? { ok: true, value } : fail("Nombre trop grand.");
    }
    case "money": {
      const cents = parseUsdToCents(text);
      if (cents === null) return fail("Saisissez un montant en dollars, 2 décimales au plus (ex. 250 ou 250,50).");
      if (cents < 0) return fail("Le montant ne peut pas être négatif.");
      return { ok: true, value: cents };
    }
    case "boolean": {
      const lowered = text.toLowerCase();
      if (["oui", "true", "vrai"].includes(lowered)) return { ok: true, value: true };
      if (["non", "false", "faux"].includes(lowered)) return { ok: true, value: false };
      return fail("Choisissez « Oui » ou « Non ».");
    }
    case "integer[]": {
      const items = splitList(text);
      if (items.length === 0 || items.some((item) => !/^-?\d+$/.test(item))) {
        return fail("Saisissez des nombres entiers séparés par des virgules (ex. 7, 3, 2).");
      }
      return { ok: true, value: items.map(Number) };
    }
    case "string[]": {
      const items = splitList(text);
      if (items.length === 0) return fail("Saisissez au moins une valeur (valeurs séparées par des virgules).");
      return { ok: true, value: items };
    }
    case "enum":
      if (!options.includes(text)) return fail(`Valeur autorisée : ${options.join(", ")}.`);
      return { ok: true, value: text };
  }
}

/** Vérifie qu’une valeur déjà typée (JSON) respecte son type. */
export function isValidSettingValue(valueType: string, value: unknown): value is SettingValue {
  const { kind, options } = parseSettingType(valueType);
  if (value === null) return NULLABLE_KINDS.has(kind);
  switch (kind) {
    case "string":
      return typeof value === "string" && value.trim() !== "";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
    case "money":
      return typeof value === "number" && Number.isSafeInteger(value) && (kind === "integer" || value >= 0);
    case "boolean":
      return typeof value === "boolean";
    case "integer[]":
      return Array.isArray(value) && value.length > 0 && value.every((v) => Number.isSafeInteger(v));
    case "string[]":
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== "");
    case "enum":
      return typeof value === "string" && options.includes(value);
  }
}

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });

/** Affichage d’une valeur pour l’écran Paramètres. */
export function formatSettingValue(valueType: string, value: unknown): string {
  if (value === null || value === undefined) return "Non défini";
  const { kind } = parseSettingType(valueType);
  switch (kind) {
    case "money":
      return typeof value === "number" ? formatUsd(value) : String(value);
    case "boolean":
      return value === true ? "Oui" : "Non";
    case "number":
    case "integer":
      return typeof value === "number" ? numberFormat.format(value).replace(/ /g, " ") : String(value);
    case "integer[]":
    case "string[]":
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return String(value);
  }
}

/** Valeur préremplie dans le champ de saisie (inverse de parseSettingInput). */
export function settingValueToInput(valueType: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  const { kind } = parseSettingType(valueType);
  if (kind === "money" && typeof value === "number") {
    return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2).replace(".", ",");
  }
  if (kind === "boolean") return value === true ? "oui" : "non";
  if (kind === "number" && typeof value === "number") return String(value).replace(".", ",");
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
