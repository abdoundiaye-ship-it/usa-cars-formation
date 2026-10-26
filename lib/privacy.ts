/** Page « Confidentialité » du portail (G1-a, contrat art. 33) : mise en forme des valeurs lues dans les paramètres. */

const PLACEHOLDER = "à compléter";

/** Coordonnée officielle affichable, ou null si le paramètre est vide ou encore « À compléter ». */
export function noticeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || text.toLowerCase() === PLACEHOLDER ? null : text;
}

/** Durée de conservation en toutes lettres (« 5 ans », « 1 an »), ou « durée à préciser » si le paramètre est vide. */
export function retentionText(years: unknown): string {
  if (typeof years !== "number" || !Number.isInteger(years) || years < 1) return "durée à préciser";
  return `${years} an${years > 1 ? "s" : ""}`;
}
