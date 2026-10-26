import { assertCents, type Cents } from "@/lib/money/cents";

/**
 * Frais de retard (règle R5, contrat art. 20 ; décision C5 : pas de plafond par défaut, ajout après validation
 * de la comptabilité). Fonction pure : montant, période et plafond viennent des paramètres late_fee.*.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface LateFeeSettings {
  /** {late_fee.amount_usd}, en centimes. */
  amountCents: Cents;
  /** {late_fee.period_days}. */
  periodDays: number;
  /** {late_fee.cap_usd}, en centimes ; null = pas de plafond (C5). */
  capCents: Cents | null;
}

export interface LateFee {
  daysLate: number;
  periods: number;
  amountCents: Cents;
  capped: boolean;
}

/**
 * Retard compté en jours entiers commencés après l'échéance : périodes = ⌈jours / période⌉,
 * frais = min(périodes × montant, plafond). Aucun frais si l'échéance n'est pas dépassée
 * ou si la somme due a été payée intégralement (`paidInFullAt` au plus tard à l'échéance).
 */
export function lateFee(dueAt: Date, asOf: Date, settings: LateFeeSettings, paidInFullAt: Date | null = null): LateFee {
  assertCents(settings.amountCents, "montant des frais de retard");
  if (settings.capCents !== null) assertCents(settings.capCents, "plafond des frais de retard");
  if (!(settings.periodDays > 0)) throw new RangeError("La période des frais de retard doit être positive.");

  // Les frais cessent de courir au paiement intégral.
  const end = paidInFullAt && paidInFullAt < asOf ? paidInFullAt : asOf;
  const elapsed = end.getTime() - dueAt.getTime();
  if (elapsed <= 0) return { daysLate: 0, periods: 0, amountCents: 0, capped: false };

  const daysLate = Math.ceil(elapsed / DAY);
  const periods = Math.ceil(daysLate / settings.periodDays);
  const uncapped = periods * settings.amountCents;
  const capped = settings.capCents !== null && uncapped > settings.capCents;
  return { daysLate, periods, amountCents: capped ? settings.capCents! : uncapped, capped };
}
