import { describe, expect, it } from "vitest";
import { nextClientAction, type ClientDossierState } from "./portal";

const now = new Date("2026-10-20T12:00:00Z");
const idle: ClientDossierState = {
  quoteToDecide: false,
  extraCostsToApprove: 0,
  payment1RemainingCents: 0,
  payment1DueAt: null,
  balanceRemainingCents: 0,
  balanceDueAt: null,
  documentsReady: false,
};

describe("prochaine action attendue du client (portail)", () => {
  it("le devis à accepter passe avant tout", () => {
    expect(nextClientAction({ ...idle, quoteToDecide: true, payment1RemainingCents: 100 }, now).kind).toBe("quote");
  });

  it("puis les frais supplémentaires à approuver", () => {
    expect(nextClientAction({ ...idle, extraCostsToApprove: 2 }, now).label).toBe(
      "2 frais supplémentaires attendent votre accord",
    );
  });

  it("paiement 1 avant le solde, en retard si l'échéance est passée", () => {
    expect(
      nextClientAction(
        { ...idle, payment1RemainingCents: 500, payment1DueAt: "2026-10-19T12:00:00Z", balanceRemainingCents: 900 },
        now,
      ),
    ).toEqual({
      kind: "payment",
      label: "Paiement 1 à régler",
      dueAt: "2026-10-19T12:00:00Z",
      overdue: true,
      amountCents: 500,
    });
  });

  it("le solde n'est demandé qu'avec la facture de solde (échéance connue)", () => {
    expect(nextClientAction({ ...idle, balanceRemainingCents: 900 }, now).kind).toBe("none");
    expect(
      nextClientAction({ ...idle, balanceRemainingCents: 900, balanceDueAt: "2026-11-01T00:00:00Z" }, now),
    ).toMatchObject({
      kind: "payment",
      overdue: false,
    });
  });

  it("paiement intégral : documents prêts ; sinon rien à faire", () => {
    expect(nextClientAction({ ...idle, documentsReady: true }, now).kind).toBe("documents");
    expect(nextClientAction(idle, now).label).toBe("Aucune action attendue de votre part");
  });
});
