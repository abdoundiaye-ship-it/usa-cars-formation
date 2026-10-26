import { describe, expect, it } from "vitest";
import {
  buildIndicators,
  buildTodoList,
  calendarProgress,
  type DashboardContainer,
  type DashboardData,
  type DashboardDossier,
  type DashboardFinance,
} from "./dashboard";
import type { UnclaimedNextStep } from "@/lib/supabase/database.types";

const now = new Date("2026-10-19T12:00:00Z");
const thresholds = {
  staleDossierDays: 7,
  recentEtaChangeDays: 3,
  maxDaysWithoutCheck: 3,
  unclaimedReminderDays: 30,
  arrivalNotifyHours: 24,
  pickupDaysAfterDocuments: 15,
};

const dossier = (over: Partial<DashboardDossier>): DashboardDossier => ({
  id: over.reference ?? "d",
  reference: "UC-2026-0001",
  stage: "opening",
  status: "new",
  updated_at: "2026-10-18T10:00:00Z",
  payment1_due_at: null,
  client_name: "Client",
  ...over,
});

const container = (over: Partial<DashboardContainer>): DashboardContainer => ({
  id: over.number ?? "c",
  number: "DEMU1234560",
  status: "booking_confirmed",
  etd: null,
  departed_on: null,
  eta: null,
  ata: null,
  last_checked_at: null,
  eta_changed_at: null,
  ...over,
});

const empty: DashboardData = {
  dossiers: [],
  confirmations: [],
  releasedDossierIds: new Set(),
  containers: [],
  assignments: [],
};

describe("liste « À traiter » (US-2.9)", () => {
  it("paiement 1 en retard, sauf s’il est confirmé reçu", () => {
    const late = dossier({ id: "a", reference: "A", stage: "purchase", payment1_due_at: "2026-10-18T10:00:00Z" });
    expect(buildTodoList({ ...empty, dossiers: [late] }, thresholds, now)[0]).toMatchObject({
      kind: "payment1_overdue",
      severity: "danger",
      label: "Paiement 1 en retard depuis le 18/10/2026",
      href: "/dossiers/a",
    });
    const paid = {
      ...empty,
      dossiers: [late],
      confirmations: [{ dossier_id: "a", code: "payment1_received" as const }],
    };
    expect(buildTodoList(paid, thresholds, now)).toEqual([]);
  });

  it("dossier sans mise à jour depuis plus de N jours (paramètre), jamais pour un dossier clôturé", () => {
    const stale = dossier({ id: "s", reference: "S", updated_at: "2026-10-10T10:00:00Z" });
    const closed = dossier({ id: "c", reference: "C", stage: "closing", updated_at: "2026-09-01T10:00:00Z" });
    const items = buildTodoList({ ...empty, dossiers: [stale, closed] }, thresholds, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "stale", label: "Sans mise à jour depuis 9 jours" });
  });

  it("Dakar : véhicule non enlevé après le délai de relance, documents à remettre après le solde", () => {
    const d = dossier({ id: "k", reference: "K", stage: "dakar", status: "balance_pending" });
    const data: DashboardData = {
      ...empty,
      dossiers: [d],
      containers: [container({ id: "x", ata: "2026-09-10", status: "arrived" })],
      assignments: [{ dossier_id: "k", container_id: "x" }],
      confirmations: [{ dossier_id: "k", code: "balance_paid" }],
      arrivalNotifiedDossierIds: new Set(["k"]),
    };
    expect(buildTodoList(data, thresholds, now).map((i) => i.kind)).toEqual(["unclaimed", "documents_to_release"]);
    expect(buildTodoList({ ...data, releasedDossierIds: new Set(["k"]) }, thresholds, now).map((i) => i.kind)).toEqual([
      "unclaimed",
    ]);
  });

  it("arrivée : client non informé au-delà du délai (art. 17), sauf message envoyé ou information par l’agent", () => {
    const d = dossier({ id: "n", reference: "N", stage: "dakar", status: "documents_pending" });
    const arrived = (recordedAt: string): DashboardData => ({
      ...empty,
      dossiers: [d],
      containers: [container({ id: "x", ata: "2026-10-17", status: "arrived", arrival_recorded_at: recordedAt })],
      assignments: [{ dossier_id: "n", container_id: "x" }],
    });
    // Saisie de l'ATA il y a 25 h : délai de 24 h dépassé.
    expect(buildTodoList(arrived("2026-10-18T11:00:00Z"), thresholds, now)[0]).toMatchObject({
      kind: "arrival_not_notified",
      severity: "warning",
      label: "Client non informé de l’arrivée du 17/10/2026",
      href: "/dossiers/n",
    });
    // Saisie il y a 23 h : encore dans le délai.
    expect(buildTodoList(arrived("2026-10-18T13:00:00Z"), thresholds, now)).toEqual([]);
    const informed = { ...arrived("2026-10-18T11:00:00Z"), arrivalNotifiedDossierIds: new Set(["n"]) };
    expect(buildTodoList(informed, thresholds, now)).toEqual([]);
    // Paramètre absent : aucune alerte.
    const unset = { ...thresholds, arrivalNotifyHours: Number.POSITIVE_INFINITY };
    expect(buildTodoList(arrived("2026-10-01T11:00:00Z"), unset, now)).toEqual([]);
  });

  it("enlèvement attendu N jours après la remise des documents (R10), jusqu’au statut « Enlevé »", () => {
    const data = (status: string): DashboardData => ({
      ...empty,
      dossiers: [dossier({ id: "p", reference: "P", stage: "dakar", status })],
      releasedDossierIds: new Set(["p"]),
      releases: [{ dossier_id: "p", released_at: "2026-10-03T10:00:00Z" }],
    });
    expect(buildTodoList(data("documents_released"), thresholds, now)[0]).toMatchObject({
      kind: "pickup_overdue",
      label: "Enlèvement attendu depuis le 18/10/2026",
    });
    expect(buildTodoList(data("collected"), thresholds, now)).toEqual([]);
    const later = {
      ...data("documents_released"),
      releases: [{ dossier_id: "p", released_at: "2026-10-05T10:00:00Z" }],
    };
    expect(buildTodoList(later, thresholds, now)).toEqual([]);
  });

  it("véhicule non réclamé (R11) : étape suivante à son échéance, jamais avant ni sans objet", () => {
    type UnclaimedRow = NonNullable<DashboardData["unclaimed"]>[number];
    const base: Omit<UnclaimedRow, "next_step"> = {
      dossier_id: "u",
      reference: "U",
      applies: true,
      reminder_due_on: "2026-09-16",
      formal_notice_due_on: "2026-10-16",
      procedure_possible_on: "2026-12-17",
      reminder_status: null,
      formal_notice_status: null,
      cure_deadline: null,
    };
    const todo = (row: Partial<UnclaimedRow> & { next_step: UnclaimedNextStep }) =>
      buildTodoList({ ...empty, unclaimed: [{ ...base, ...row }] }, thresholds, now).map((i) => i.label);
    expect(todo({ next_step: "reminder" })).toEqual([
      "Véhicule non réclamé : lettre de relance à envoyer (échéance du 16/09/2026)",
    ]);
    expect(todo({ next_step: "reminder", reminder_status: "issued" })).toEqual([
      "Lettre de relance émise : envoi à enregistrer",
    ]);
    expect(todo({ next_step: "formal_notice", reminder_status: "sent" })).toEqual([
      "Véhicule non réclamé : mise en demeure à envoyer (échéance du 16/10/2026)",
    ]);
    // Mise en demeure pas encore due, procédure avant 4 mois : rien.
    expect(todo({ next_step: "formal_notice", formal_notice_due_on: "2026-10-30" })).toEqual([]);
    expect(todo({ next_step: "procedure", cure_deadline: "2026-10-10" })).toEqual([]);
    expect(todo({ next_step: "procedure", cure_deadline: "2026-10-10", procedure_possible_on: "2026-10-18" })).toEqual([
      "Procédure « véhicule non réclamé » possible depuis le 18/10/2026",
    ]);
    expect(todo({ next_step: "reminder", applies: false })).toEqual([]);
  });

  it("conteneur en mer non vérifié et ETA modifiée récemment ; tri par gravité", () => {
    const data: DashboardData = {
      ...empty,
      dossiers: [dossier({ id: "s", reference: "S", updated_at: "2026-10-01T10:00:00Z" })],
      containers: [
        container({
          id: "m",
          status: "at_sea",
          departed_on: "2026-10-10",
          eta: "2026-11-02",
          eta_changed_at: "2026-10-18T09:00:00Z",
        }),
      ],
    };
    expect(buildTodoList(data, thresholds, now).map((i) => `${i.severity}:${i.kind}`)).toEqual([
      "warning:tracking_check",
      "info:eta_changed",
      "info:stale",
    ]);
  });
});

describe("indicateurs (sans montant)", () => {
  it("compte les dossiers actifs par étape, les conteneurs en mer et les arrivées prochaines", () => {
    const data: DashboardData = {
      ...empty,
      dossiers: [dossier({ id: "1" }), dossier({ id: "2", stage: "ocean" }), dossier({ id: "3", stage: "closing" })],
      containers: [
        container({ id: "a", status: "at_sea", eta: "2026-10-24" }),
        container({ id: "b", status: "arrived", ata: "2026-10-15", eta: "2026-10-14" }),
        container({ id: "c", eta: "2026-12-01" }),
      ],
    };
    const indicators = buildIndicators(data, 7, [], now);
    expect(indicators).toMatchObject({ activeDossiers: 2, containersAtSea: 1, arrivalsSoon: 1, payment1Overdue: 0 });
    expect(indicators.byStage.ocean).toBe(1);
  });
});

describe("progression calendaire (jamais une position)", () => {
  it("proportion de jours écoulés entre le départ et l’ETA", () => {
    expect(calendarProgress({ departed_on: "2026-10-09", eta: "2026-10-29", ata: null }, now)).toBeCloseTo(0.525, 2);
    expect(calendarProgress({ departed_on: null, eta: "2026-10-29", ata: null }, now)).toBeNull();
    expect(calendarProgress({ departed_on: "2026-10-09", eta: "2026-10-12", ata: null }, now)).toBe(1);
    expect(calendarProgress({ departed_on: "2026-10-09", eta: "2026-10-29", ata: "2026-10-18" }, now)).toBe(1);
  });
});

describe("tableau de bord financier (lot 3d)", () => {
  const finance = (over: Partial<DashboardFinance>): DashboardFinance => ({
    dossier_id: "f",
    reference: "UC-2026-0009",
    has_accepted_quote: true,
    payment1_remaining_cents: 0,
    balance_remaining_cents: 0,
    payment1_due_at: "2026-10-10T12:00:00Z",
    balance_due_at: null,
    quote_expired: false,
    proposed_late_fees: 0,
    pending_client_extra_costs: 0,
    overdue_refunds: 0,
    ownership_transferred_at: null,
    documents_released: false,
    release_due_at: null,
    ...over,
  });

  it("paiement 1 : situation réelle dès le devis accepté (les confirmations manuelles ne comptent plus)", () => {
    const d = dossier({
      id: "f",
      reference: "UC-2026-0009",
      stage: "purchase",
      payment1_due_at: "2026-10-10T12:00:00Z",
    });
    const paid = { ...empty, dossiers: [d], finance: [finance({})] };
    expect(buildTodoList(paid, thresholds, now)).toEqual([]);
    const unpaid = { ...empty, dossiers: [d], finance: [finance({ payment1_remaining_cents: 5000 })] };
    expect(buildTodoList(unpaid, thresholds, now).map((i) => i.kind)).toEqual(["payment1_overdue"]);
  });

  it("solde et remboursement en retard, devis expiré, décisions à prendre ; tri par gravité", () => {
    const data = {
      ...empty,
      finance: [
        finance({ dossier_id: "q", reference: "Q", quote_expired: true }),
        finance({
          dossier_id: "s",
          reference: "S",
          balance_remaining_cents: 30000,
          balance_due_at: "2026-10-18T00:00:00Z",
        }),
        finance({ dossier_id: "r", reference: "R", overdue_refunds: 1 }),
        finance({ dossier_id: "v", reference: "V", proposed_late_fees: 2, pending_client_extra_costs: 1 }),
      ],
    };
    const todo = buildTodoList(data, thresholds, now);
    expect(todo.map((i) => i.kind)).toEqual([
      "balance_overdue",
      "refund_overdue",
      "quote_expired",
      "finance_to_validate",
    ]);
    expect(todo[3]!.label).toBe("Frais de retard à valider · Frais supplémentaires : accord du client attendu");
    expect(todo.every((i) => !/\$US|FCFA/.test(i.label))).toBe(true); // aucun montant dans la liste
  });

  it("remise des documents après le paiement intégral, urgente une fois le délai dépassé (R9)", () => {
    const pending = finance({
      ownership_transferred_at: "2026-10-15T10:00:00Z",
      release_due_at: "2026-10-17T10:00:00Z",
    });
    expect(buildTodoList({ ...empty, finance: [pending] }, thresholds, now)[0]).toMatchObject({
      kind: "documents_to_release",
      severity: "danger",
    });
    expect(buildTodoList({ ...empty, finance: [{ ...pending, documents_released: true }] }, thresholds, now)).toEqual(
      [],
    );
  });

  it("indicateur : total des soldes dus, trop-perçus exclus", () => {
    const data = {
      ...empty,
      finance: [finance({ balance_remaining_cents: 30000 }), finance({ balance_remaining_cents: -5000 })],
    };
    expect(buildIndicators(data, 7, [], now).balanceDueCents).toBe(30000);
  });
});
