import { assertCents, type Cents } from "@/lib/money/cents";

/** Conventions d’affichage (CLAUDE.md §5) : français, fuseau Africa/Dakar, `12 450 $US`, `7 302 000 FCFA`, `JJ/MM/AAAA`. */
export const APP_TIME_ZONE = "Africa/Dakar";

const NBSP = " ";

const integerFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const centsFormat = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Séparateur de milliers : espace insécable (homogène entre navigateurs et Node). */
function groupWithNbsp(text: string): string {
  return text.replace(/[\s ]/g, NBSP);
}

/** 1245000 → « 12 450 $US » ; 1245050 → « 12 450,50 $US » (décimales seulement si nécessaires). */
export function formatUsd(cents: Cents): string {
  assertCents(cents);
  const text = cents % 100 === 0 ? integerFormat.format(cents / 100) : centsFormat.format(cents / 100);
  return `${groupWithNbsp(text)}${NBSP}$US`;
}

/** 48000 → « 48 000 » (séparateur : espace insécable). */
export function formatInteger(value: number): string {
  return groupWithNbsp(integerFormat.format(value));
}

/** 7302000 → « 7 302 000 FCFA ». */
export function formatXof(xof: number): string {
  if (!Number.isSafeInteger(xof)) throw new RangeError(`Montant FCFA invalide : ${xof}.`);
  return `${groupWithNbsp(integerFormat.format(xof))}${NBSP}FCFA`;
}

/** Date au format JJ/MM/AAAA, fuseau Africa/Dakar. */
export function formatDate(value: Date | string): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

/** Date et heure au format JJ/MM/AAAA HH:MM, fuseau Africa/Dakar. */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormat.format(typeof value === "string" ? new Date(value) : value).replace(",", "");
}
