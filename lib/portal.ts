/**
 * Portail client (US-4.3, docs/14) : « prochaine action attendue » du client sur un dossier. Fonction pure ;
 * les données viennent de la base, filtrées par la RLS (le client ne voit que ses dossiers).
 */

export interface ClientDossierState {
  /** Devis émis, valable, en attente de la décision du client. */
  quoteToDecide: boolean;
  /** Frais supplémentaires en attente de son accord (R7). */
  extraCostsToApprove: number;
  /** Paiement 1 restant dû (centimes USD) et son échéance. */
  payment1RemainingCents: number;
  payment1DueAt: string | null;
  /** Solde restant dû (centimes USD) et son échéance (facture de solde émise). */
  balanceRemainingCents: number;
  balanceDueAt: string | null;
  /** Paiement intégral : documents prêts, pas encore remis. */
  documentsReady: boolean;
}

export type ClientAction =
  | { kind: "quote"; label: string }
  | { kind: "extra_costs"; label: string }
  | { kind: "payment"; label: string; dueAt: string | null; overdue: boolean; amountCents: number }
  | { kind: "documents"; label: string }
  | { kind: "none"; label: string };

export function nextClientAction(state: ClientDossierState, now = new Date()): ClientAction {
  if (state.quoteToDecide) return { kind: "quote", label: "Votre devis attend votre réponse" };
  if (state.extraCostsToApprove > 0) {
    return {
      kind: "extra_costs",
      label:
        state.extraCostsToApprove > 1
          ? `${state.extraCostsToApprove} frais supplémentaires attendent votre accord`
          : "Des frais supplémentaires attendent votre accord",
    };
  }
  const payment =
    state.payment1RemainingCents > 0
      ? { label: "Paiement 1 à régler", dueAt: state.payment1DueAt, amountCents: state.payment1RemainingCents }
      : state.balanceRemainingCents > 0 && state.balanceDueAt
        ? { label: "Solde à régler", dueAt: state.balanceDueAt, amountCents: state.balanceRemainingCents }
        : null;
  if (payment) {
    return {
      kind: "payment",
      ...payment,
      overdue: payment.dueAt !== null && new Date(payment.dueAt) < now,
    };
  }
  if (state.documentsReady) return { kind: "documents", label: "Vos documents sont prêts à être remis" };
  return { kind: "none", label: "Aucune action attendue de votre part" };
}

/** Domaine des adresses techniques (P4-1) : « .invalid » ne peut jamais recevoir de courrier (RFC 2606). */
export const TECHNICAL_EMAIL_DOMAIN = "clients.usacars.invalid";

/** Compte d'un client sans e-mail : adresse technique, jamais utilisée pour un envoi (connexion par WhatsApp). */
export const technicalEmail = (clientId: string) => `client-${clientId}@${TECHNICAL_EMAIL_DOMAIN}`;
export const isTechnicalEmail = (email: string) => email.endsWith(`@${TECHNICAL_EMAIL_DOMAIN}`);
