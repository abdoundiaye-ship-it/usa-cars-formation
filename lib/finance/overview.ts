import type { FinanceOverviewRow } from "@/lib/supabase/database.types";

/**
 * Écran Finances et tableau de bord (lot 3d) : prochaine échéance d'un dossier (R4). Le paiement 1 passe avant le
 * solde (imputation R6) ; le solde n'a d'échéance qu'une fois la facture de solde émise.
 */
export interface NextDue {
  kind: "payment1" | "balance";
  dueAt: string | null;
  remainingCents: number;
  overdue: boolean;
}

export function nextDue(
  row: Pick<
    FinanceOverviewRow,
    "has_accepted_quote" | "payment1_remaining_cents" | "balance_remaining_cents" | "payment1_due_at" | "balance_due_at"
  >,
  now = new Date(),
): NextDue | null {
  if (!row.has_accepted_quote) return null;
  if (row.payment1_remaining_cents > 0) {
    return {
      kind: "payment1",
      dueAt: row.payment1_due_at,
      remainingCents: row.payment1_remaining_cents,
      overdue: row.payment1_due_at !== null && new Date(row.payment1_due_at) < now,
    };
  }
  if (row.balance_remaining_cents > 0) {
    return {
      kind: "balance",
      dueAt: row.balance_due_at,
      remainingCents: row.balance_remaining_cents,
      overdue: row.balance_due_at !== null && new Date(row.balance_due_at) < now,
    };
  }
  return null;
}
