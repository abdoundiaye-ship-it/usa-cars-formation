/**
 * Montants en USD stockés en centimes entiers (CLAUDE.md règle 1). Jamais de float pour l’argent.
 * Côté TypeScript, un montant est un `number` entier « sûr » (|n| ≤ 2^53 − 1), ce qui couvre
 * largement les montants manipulés ; la base les stocke en `bigint`.
 */
export type Cents = number;

export function assertCents(value: number, label = "montant"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} invalide : un montant doit être un nombre entier de centimes (reçu ${value}).`);
  }
}

/**
 * Convertit une saisie en dollars (« 12450 », « 12 450,5 », « 12450.50 ») en centimes, sans passer par un float.
 * Retourne null si la saisie n’est pas un montant valide (au plus 2 décimales).
 */
export function parseUsdToCents(input: string): Cents | null {
  const normalized = input.replace(/[\s  ]/g, "").replace(",", ".");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const [, sign, whole = "0", fraction = ""] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  const result = Number(sign ? -cents : cents);
  return Number.isSafeInteger(result) ? result : null;
}
