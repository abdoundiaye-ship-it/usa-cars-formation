import { assertCents, type Cents } from "./cents";

/**
 * Conversion USD ↔ FCFA (règle R1, décision C4).
 * Le taux est manipulé sous forme décimale exacte (chaîne, comme `numeric(12,4)` en base) et converti
 * en entier mis à l’échelle 10^4 : tous les calculs se font en BigInt, sans erreur d’arrondi flottant.
 * Arrondi au FCFA entier le plus proche, demi vers l’extérieur (0,5 → 1).
 */
const RATE_SCALE = 10_000n;

/** Taux « 586.52 » ou « 586,5200 » → 5865200n (XOF par USD × 10^4). */
export function parseRate(rate: string | number): bigint {
  const text = typeof rate === "number" ? rate.toString() : rate.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new RangeError(`Taux de change invalide : « ${rate} » (4 décimales au plus).`);
  const [, whole = "0", fraction = ""] = match;
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(4, "0"));
  if (scaled <= 0n) throw new RangeError("Le taux de change doit être strictement positif.");
  return scaled;
}

/** Division entière arrondie au plus proche, demi vers l’extérieur. */
function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Centimes USD → FCFA entier : round(usd × taux). */
export function usdCentsToXof(cents: Cents, rate: string | number): number {
  assertCents(cents);
  const xof = divRoundHalfAwayFromZero(BigInt(cents) * parseRate(rate), 100n * RATE_SCALE);
  return Number(xof);
}

/** FCFA → centimes USD pour l’imputation d’un paiement reçu en FCFA : round(xof / taux × 100). */
export function xofToUsdCents(xof: number, rate: string | number): Cents {
  if (!Number.isSafeInteger(xof)) throw new RangeError(`Montant FCFA invalide : ${xof}.`);
  const cents = divRoundHalfAwayFromZero(BigInt(xof) * 100n * RATE_SCALE, parseRate(rate));
  return Number(cents);
}
