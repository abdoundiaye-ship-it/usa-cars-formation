/**
 * Échéances de paiement (règle R4, contrat art. 9) et validité du devis (décision X2).
 * Fonctions pures : les délais viennent des paramètres (CLAUDE.md règle 4), jamais du code.
 */

const HOUR = 60 * 60 * 1000;

/** Paiement 1 : notification du lot remporté + {payment1.due_hours_after_win} heures. */
export function payment1DueAt(lotWonNotifiedAt: Date, dueHoursAfterWin: number): Date {
  return new Date(lotWonNotifiedAt.getTime() + dueHoursAfterWin * HOUR);
}

/**
 * Fin de validité d'un devis (décision X2) : {quote.validity_hours} après l'émission, mais jamais au-delà
 * de l'échéance du paiement 1 quand elle est connue (le devis expire en même temps que le délai de paiement).
 */
export function quoteValidUntil(issuedAt: Date, validityHours: number, payment1Due: Date | null): Date {
  const byValidity = new Date(issuedAt.getTime() + validityHours * HOUR);
  return payment1Due && payment1Due < byValidity ? payment1Due : byValidity;
}

/** Solde : ETA de référence (figée à l'émission de la facture de solde) − {balance.due_hours_before_eta} heures. */
export function balanceDueAt(referenceEta: Date, dueHoursBeforeEta: number): Date {
  return new Date(referenceEta.getTime() - dueHoursBeforeEta * HOUR);
}

export interface BalanceDueChange {
  dueAt: Date;
  changed: boolean;
}

/**
 * Nouvelle ETA après l'envoi de la facture de solde (R4) :
 * - ETA avancée : échéance = max(nouvelle ETA − délai avant ETA, notification + délai minimal de préavis) ;
 * - ETA retardée ou inchangée : échéance inchangée (seule une action manuelle autorisée la modifie).
 * L'échéance ne recule jamais du fait d'une ETA avancée en deçà du préavis minimal.
 */
export function balanceDueAfterEtaChange(
  currentDueAt: Date,
  currentReferenceEta: Date,
  newEta: Date,
  notifiedAt: Date,
  { dueHoursBeforeEta, minHoursAfterNotice }: { dueHoursBeforeEta: number; minHoursAfterNotice: number },
): BalanceDueChange {
  if (newEta >= currentReferenceEta) return { dueAt: currentDueAt, changed: false };
  const byEta = balanceDueAt(newEta, dueHoursBeforeEta);
  const byNotice = new Date(notifiedAt.getTime() + minHoursAfterNotice * HOUR);
  const dueAt = byEta > byNotice ? byEta : byNotice;
  // Une ETA avancée ne peut pas repousser l'échéance au-delà de l'échéance en vigueur.
  const result = dueAt < currentDueAt ? dueAt : currentDueAt;
  return { dueAt: result, changed: result.getTime() !== currentDueAt.getTime() };
}
