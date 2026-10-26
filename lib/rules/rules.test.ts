import { describe, expect, it } from "vitest";
import { balanceDueAfterEtaChange, balanceDueAt, payment1DueAt, quoteValidUntil } from "./due-dates";
import { lateFee } from "./late-fees";

const d = (iso: string) => new Date(iso);

describe("R5 — frais de retard (100 $US par période de 14 jours commencée)", () => {
  const settings = { amountCents: 10_000, periodDays: 14, capCents: null };
  const due = d("2026-10-01T12:00:00Z");

  it.each([
    ["2026-10-01T12:00:00Z", 0, 0],
    ["2026-10-02T12:00:00Z", 1, 10_000], // 1 jour → 1 période
    ["2026-10-01T13:00:00Z", 1, 10_000], // jour commencé
    ["2026-10-15T12:00:00Z", 14, 10_000], // 14 jours → 1 période
    ["2026-10-16T12:00:00Z", 15, 20_000], // 15 jours → 2 périodes
    ["2026-11-12T12:00:00Z", 42, 30_000],
  ])("au %s : %i jour(s) de retard → %i centimes", (asOf, days, cents) => {
    const fee = lateFee(due, d(asOf), settings);
    expect(fee.daysLate).toBe(days);
    expect(fee.amountCents).toBe(cents);
  });

  it("plafond atteint", () => {
    const fee = lateFee(due, d("2027-01-01T12:00:00Z"), { ...settings, capCents: 25_000 });
    expect(fee).toMatchObject({ amountCents: 25_000, capped: true });
  });

  it("les frais cessent de courir au paiement intégral", () => {
    expect(lateFee(due, d("2026-12-01T00:00:00Z"), settings, d("2026-10-10T00:00:00Z")).amountCents).toBe(10_000);
    expect(lateFee(due, d("2026-12-01T00:00:00Z"), settings, d("2026-09-30T00:00:00Z")).amountCents).toBe(0);
  });

  it("refuse un montant non entier ou une période nulle", () => {
    expect(() => lateFee(due, due, { ...settings, amountCents: 100.5 })).toThrow(RangeError);
    expect(() => lateFee(due, due, { ...settings, periodDays: 0 })).toThrow(RangeError);
  });
});

describe("R4 — échéances", () => {
  it("paiement 1 : notification + 24 h", () => {
    expect(payment1DueAt(d("2026-10-19T10:00:00Z"), 24).toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });

  it("X2 — le devis expire au plus tard à l’échéance du paiement 1", () => {
    const issued = d("2026-10-19T12:00:00Z");
    expect(quoteValidUntil(issued, 48, null).toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(quoteValidUntil(issued, 48, d("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(quoteValidUntil(issued, 48, d("2026-10-25T10:00:00Z")).toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });

  it("solde : ETA de référence − 48 h", () => {
    expect(balanceDueAt(d("2026-11-20T00:00:00Z"), 48).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  const opts = { dueHoursBeforeEta: 48, minHoursAfterNotice: 48 };
  const due = d("2026-11-18T00:00:00Z");
  const eta = d("2026-11-20T00:00:00Z");

  it("ETA avancée : nouvelle ETA − 48 h, mais jamais moins de 48 h après la notification", () => {
    expect(balanceDueAfterEtaChange(due, eta, d("2026-11-15T00:00:00Z"), d("2026-11-01T00:00:00Z"), opts)).toEqual({
      dueAt: d("2026-11-13T00:00:00Z"),
      changed: true,
    });
    expect(balanceDueAfterEtaChange(due, eta, d("2026-11-12T00:00:00Z"), d("2026-11-09T12:00:00Z"), opts)).toEqual({
      dueAt: d("2026-11-11T12:00:00Z"),
      changed: true,
    });
  });

  it("ETA avancée plusieurs fois : chaque étape part de l’échéance en vigueur", () => {
    const first = balanceDueAfterEtaChange(due, eta, d("2026-11-17T00:00:00Z"), d("2026-11-01T00:00:00Z"), opts);
    const second = balanceDueAfterEtaChange(
      first.dueAt,
      d("2026-11-17T00:00:00Z"),
      d("2026-11-14T00:00:00Z"),
      d("2026-11-05T00:00:00Z"),
      opts,
    );
    expect(first.dueAt.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(second.dueAt.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("ETA retardée ou dans le passé : échéance inchangée ou bornée par le préavis", () => {
    expect(balanceDueAfterEtaChange(due, eta, d("2026-11-25T00:00:00Z"), d("2026-11-01T00:00:00Z"), opts)).toEqual({
      dueAt: due,
      changed: false,
    });
    // ETA (avancée) déjà passée : le client garde le préavis minimal.
    expect(
      balanceDueAfterEtaChange(
        due,
        eta,
        d("2026-11-01T00:00:00Z"),
        d("2026-11-10T00:00:00Z"),
        opts,
      ).dueAt.toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
  });
});
