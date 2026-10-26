import { describe, expect, it } from "vitest";
import { nextDue } from "./overview";

const now = new Date("2026-10-20T12:00:00Z");
const base = {
  has_accepted_quote: true,
  payment1_remaining_cents: 0,
  balance_remaining_cents: 0,
  payment1_due_at: "2026-10-19T12:00:00Z",
  balance_due_at: null as string | null,
};

describe("prochaine échéance d'un dossier (R4, R6)", () => {
  it("sans devis accepté : rien n'est dû", () => {
    expect(nextDue({ ...base, has_accepted_quote: false, payment1_remaining_cents: 100 }, now)).toBeNull();
  });

  it("paiement 1 d'abord, en retard si l'échéance est passée", () => {
    expect(nextDue({ ...base, payment1_remaining_cents: 500, balance_remaining_cents: 900 }, now)).toEqual({
      kind: "payment1",
      dueAt: "2026-10-19T12:00:00Z",
      remainingCents: 500,
      overdue: true,
    });
  });

  it("puis le solde : sans facture de solde, pas d'échéance ni de retard", () => {
    expect(nextDue({ ...base, balance_remaining_cents: 900 }, now)).toEqual({
      kind: "balance",
      dueAt: null,
      remainingCents: 900,
      overdue: false,
    });
    expect(
      nextDue({ ...base, balance_remaining_cents: 900, balance_due_at: "2026-11-01T00:00:00Z" }, now)?.overdue,
    ).toBe(false);
  });

  it("tout réglé (ou trop-perçu) : aucune échéance", () => {
    expect(nextDue({ ...base, balance_remaining_cents: -2000 }, now)).toBeNull();
  });
});
