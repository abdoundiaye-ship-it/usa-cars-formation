import { formatDate } from "@/lib/format";
import type {
  ConfirmationCode,
  ContainerStatus,
  DossierStage,
  FinanceOverviewRow,
  UnclaimedOverviewRow,
} from "@/lib/supabase/database.types";
import { trackingCheckOverdue } from "@/lib/tracking";

/**
 * Tableau de bord opérationnel (US-2.9, docs/14_ecrans_ux.md) : liste « À traiter » triée par gravité et
 * indicateurs. La liste ne cite aucun montant ; seul l'indicateur des soldes dus en donne un total (décision Q2).
 * Fonctions pures : les données viennent de la base (RLS, finance_overview), les seuils des paramètres.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface DashboardDossier {
  id: string;
  reference: string;
  stage: DossierStage;
  status: string;
  updated_at: string;
  payment1_due_at: string | null;
  client_name: string | null;
}

export interface DashboardContainer {
  id: string;
  number: string;
  status: ContainerStatus;
  etd: string | null;
  departed_on: string | null;
  eta: string | null;
  ata: string | null;
  last_checked_at: string | null;
  /** Dernière modification de l'ETA (hors première saisie), d'après l'historique. */
  eta_changed_at: string | null;
  /** Saisie de l'ATA (événement « Arrivée ») : point de départ du délai d'information du client. */
  arrival_recorded_at?: string | null;
}

export interface DashboardThresholds {
  staleDossierDays: number;
  recentEtaChangeDays: number;
  maxDaysWithoutCheck: number;
  unclaimedReminderDays: number;
  /** Contrat art. 17 : le client est informé de l'arrivée dans ce délai (heures après la saisie de l'ATA). */
  arrivalNotifyHours: number;
  /** R10 : enlèvement attendu ce nombre de jours après la remise des documents. */
  pickupDaysAfterDocuments: number;
}

/** Situation financière d'un dossier (fonction finance_overview, lot 3d). */
export type DashboardFinance = Pick<
  FinanceOverviewRow,
  | "dossier_id"
  | "reference"
  | "has_accepted_quote"
  | "payment1_remaining_cents"
  | "balance_remaining_cents"
  | "payment1_due_at"
  | "balance_due_at"
  | "quote_expired"
  | "proposed_late_fees"
  | "pending_client_extra_costs"
  | "overdue_refunds"
  | "ownership_transferred_at"
  | "documents_released"
  | "release_due_at"
>;

export interface DashboardData {
  dossiers: DashboardDossier[];
  /** Situation financière (lot 3d) ; absente : seules les confirmations manuelles de la phase 2 comptent. */
  finance?: DashboardFinance[];
  confirmations: { dossier_id: string; code: ConfirmationCode }[];
  releasedDossierIds: Set<string>;
  containers: DashboardContainer[];
  assignments: { dossier_id: string; container_id: string }[];
  /** Dossiers dont le client a été informé de l'arrivée (message envoyé, ou information enregistrée par l'agent). */
  arrivalNotifiedDossierIds?: Set<string>;
  /** Remises des documents (R9) : date de remise, point de départ du délai d'enlèvement. */
  releases?: { dossier_id: string; released_at: string }[];
  /** Procédure « véhicule non réclamé » (lot 5b, fonction unclaimed_overview) ; absente : règle simple du lot 2d. */
  unclaimed?: Pick<
    UnclaimedOverviewRow,
    | "dossier_id"
    | "reference"
    | "applies"
    | "next_step"
    | "reminder_due_on"
    | "formal_notice_due_on"
    | "procedure_possible_on"
    | "reminder_status"
    | "formal_notice_status"
    | "cure_deadline"
  >[];
}

export type Severity = "danger" | "warning" | "info";

export interface TodoItem {
  severity: Severity;
  kind:
    | "payment1_overdue"
    | "balance_overdue"
    | "refund_overdue"
    | "unclaimed"
    | "arrival_not_notified"
    | "pickup_overdue"
    | "tracking_check"
    | "documents_to_release"
    | "quote_expired"
    | "finance_to_validate"
    | "eta_changed"
    | "stale";
  label: string;
  /** Référence du dossier ou numéro du conteneur concerné. */
  subject: string;
  href: `/dossiers/${string}` | `/conteneurs/${string}`;
  /** Date de référence (la plus ancienne en premier, à gravité égale). */
  since: string;
}

const RANK: Record<TodoItem["kind"], number> = {
  payment1_overdue: 1,
  balance_overdue: 2,
  refund_overdue: 3,
  unclaimed: 4,
  arrival_not_notified: 5,
  pickup_overdue: 6,
  tracking_check: 7,
  documents_to_release: 8,
  quote_expired: 9,
  finance_to_validate: 10,
  eta_changed: 11,
  stale: 12,
};

const HOUR = 60 * 60 * 1000;

const daysBetween = (from: string | Date, to: Date) => Math.floor((to.getTime() - new Date(from).getTime()) / DAY);

/** Liste « À traiter », de la plus grave à la moins grave. */
export function buildTodoList(data: DashboardData, thresholds: DashboardThresholds, now = new Date()): TodoItem[] {
  const items: TodoItem[] = [];
  const confirmed = (dossierId: string, code: ConfirmationCode) =>
    data.confirmations.some((c) => c.dossier_id === dossierId && c.code === code);
  const financeOf = (dossierId: string) => data.finance?.find((f) => f.dossier_id === dossierId);
  const containerOf = (dossierId: string) => {
    const assignment = data.assignments.find((a) => a.dossier_id === dossierId);
    return assignment ? data.containers.find((c) => c.id === assignment.container_id) : undefined;
  };

  for (const d of data.dossiers) {
    if (d.stage === "closing") continue;
    const href = `/dossiers/${d.id}` as const;
    const f = financeOf(d.id);
    // Paiement 1 : situation financière réelle dès le devis accepté ; avant, échéance du dossier (phase 2).
    const payment1Due = f?.has_accepted_quote ? f.payment1_due_at : d.payment1_due_at;
    const payment1Open = f?.has_accepted_quote ? f.payment1_remaining_cents > 0 : !confirmed(d.id, "payment1_received");
    if (d.stage === "purchase" && payment1Due && new Date(payment1Due) < now && payment1Open) {
      items.push({
        severity: "danger",
        kind: "payment1_overdue",
        label: `Paiement 1 en retard depuis le ${formatDate(payment1Due)}`,
        subject: d.reference,
        href,
        since: payment1Due,
      });
    }
    // Contrat art. 17 : client informé de l'arrivée sous `arrival.notify_within_hours` heures après la saisie de l'ATA.
    const container = containerOf(d.id);
    if (container?.ata && !data.arrivalNotifiedDossierIds?.has(d.id)) {
      const recordedAt = container.arrival_recorded_at ?? `${container.ata}T12:00:00Z`;
      const deadline = new Date(new Date(recordedAt).getTime() + thresholds.arrivalNotifyHours * HOUR);
      if (deadline < now) {
        items.push({
          severity: "warning",
          kind: "arrival_not_notified",
          label: `Client non informé de l’arrivée du ${formatDate(container.ata)}`,
          subject: d.reference,
          href,
          since: deadline.toISOString(),
        });
      }
    }
    // R10 : enlèvement attendu `pickup.days_after_documents` jours après la remise des documents.
    const release = data.releases?.find((r) => r.dossier_id === d.id);
    if (release && d.status !== "collected") {
      const expected = new Date(new Date(release.released_at).getTime() + thresholds.pickupDaysAfterDocuments * DAY);
      if (expected < now) {
        items.push({
          severity: "warning",
          kind: "pickup_overdue",
          label: `Enlèvement attendu depuis le ${formatDate(expected.toISOString())}`,
          subject: d.reference,
          href,
          since: expected.toISOString(),
        });
      }
    }
    if (d.stage === "dakar") {
      const ata = container?.ata;
      if (
        !data.unclaimed &&
        ata &&
        d.status !== "collected" &&
        daysBetween(ata, now) > thresholds.unclaimedReminderDays
      ) {
        items.push({
          severity: "danger",
          kind: "unclaimed",
          label: `Véhicule non enlevé ${daysBetween(ata, now)} jours après l’arrivée`,
          subject: d.reference,
          href,
          since: ata,
        });
      }
      if (!f?.ownership_transferred_at && confirmed(d.id, "balance_paid") && !data.releasedDossierIds.has(d.id)) {
        items.push({
          severity: "warning",
          kind: "documents_to_release",
          label: "Solde réglé : documents à remettre au client",
          subject: d.reference,
          href,
          since: d.updated_at,
        });
      }
    }
    if (daysBetween(d.updated_at, now) > thresholds.staleDossierDays) {
      items.push({
        severity: "info",
        kind: "stale",
        label: `Sans mise à jour depuis ${daysBetween(d.updated_at, now)} jours`,
        subject: d.reference,
        href,
        since: d.updated_at,
      });
    }
  }

  // Lot 3d : soldes, remboursements, devis expirés, décisions financières, remise des documents (R9).
  for (const f of data.finance ?? []) {
    const href = `/dossiers/${f.dossier_id}` as const;
    if (
      f.payment1_remaining_cents === 0 &&
      f.balance_remaining_cents > 0 &&
      f.balance_due_at &&
      new Date(f.balance_due_at) < now
    ) {
      items.push({
        severity: "danger",
        kind: "balance_overdue",
        label: `Solde en retard depuis le ${formatDate(f.balance_due_at)}`,
        subject: f.reference,
        href,
        since: f.balance_due_at,
      });
    }
    if (f.overdue_refunds > 0) {
      items.push({
        severity: "danger",
        kind: "refund_overdue",
        label: "Remboursement non effectué dans le délai",
        subject: f.reference,
        href,
        since: now.toISOString(),
      });
    }
    if (f.ownership_transferred_at && !f.documents_released) {
      const late = f.release_due_at !== null && new Date(f.release_due_at) < now;
      items.push({
        severity: late ? "danger" : "warning",
        kind: "documents_to_release",
        label: late ? "Documents à remettre : délai dépassé" : "Paiement intégral : documents à remettre au client",
        subject: f.reference,
        href,
        since: f.ownership_transferred_at,
      });
    }
    if (f.quote_expired) {
      items.push({
        severity: "warning",
        kind: "quote_expired",
        label: "Devis expiré : un nouveau devis est à émettre",
        subject: f.reference,
        href,
        since: now.toISOString(),
      });
    }
    if (f.proposed_late_fees > 0 || f.pending_client_extra_costs > 0) {
      items.push({
        severity: "warning",
        kind: "finance_to_validate",
        label: [
          f.proposed_late_fees > 0 && "Frais de retard à valider",
          f.pending_client_extra_costs > 0 && "Frais supplémentaires : accord du client attendu",
        ]
          .filter(Boolean)
          .join(" · "),
        subject: f.reference,
        href,
        since: now.toISOString(),
      });
    }
  }

  // US-5.3 (R11) : étape suivante de la procédure « véhicule non réclamé », à son échéance.
  const today = now.toISOString().slice(0, 10); // Africa/Dakar = UTC
  for (const u of data.unclaimed ?? []) {
    if (!u.applies) continue;
    const href = `/dossiers/${u.dossier_id}` as const;
    const push = (label: string, since: string) =>
      items.push({ severity: "danger", kind: "unclaimed", label, subject: u.reference, href, since });
    if (u.next_step === "reminder" && today >= u.reminder_due_on) {
      push(
        u.reminder_status === "issued"
          ? "Lettre de relance émise : envoi à enregistrer"
          : `Véhicule non réclamé : lettre de relance à envoyer (échéance du ${formatDate(u.reminder_due_on)})`,
        u.reminder_due_on,
      );
    } else if (u.next_step === "formal_notice" && today >= u.formal_notice_due_on) {
      push(
        u.formal_notice_status === "issued"
          ? "Mise en demeure émise : envoi à enregistrer"
          : `Véhicule non réclamé : mise en demeure à envoyer (échéance du ${formatDate(u.formal_notice_due_on)})`,
        u.formal_notice_due_on,
      );
    } else if (
      u.next_step === "procedure" &&
      u.cure_deadline !== null &&
      u.cure_deadline < today &&
      today >= u.procedure_possible_on
    ) {
      push(
        `Procédure « véhicule non réclamé » possible depuis le ${formatDate(u.procedure_possible_on)}`,
        u.procedure_possible_on,
      );
    }
  }

  for (const c of data.containers) {
    const href = `/conteneurs/${c.id}` as const;
    if (trackingCheckOverdue(c, thresholds.maxDaysWithoutCheck, now)) {
      items.push({
        severity: "warning",
        kind: "tracking_check",
        label: "Conteneur en mer : suivi à vérifier",
        subject: c.number,
        href,
        since: c.last_checked_at ?? c.departed_on ?? now.toISOString(),
      });
    }
    if (!c.ata && c.eta && c.eta_changed_at && daysBetween(c.eta_changed_at, now) <= thresholds.recentEtaChangeDays) {
      items.push({
        severity: "info",
        kind: "eta_changed",
        label: `ETA indicative modifiée : ${formatDate(c.eta)}`,
        subject: c.number,
        href,
        since: c.eta_changed_at,
      });
    }
  }

  return items.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.since.localeCompare(b.since));
}

export interface DashboardIndicators {
  activeDossiers: number;
  byStage: Record<DossierStage, number>;
  containersAtSea: number;
  arrivalsSoon: number;
  payment1Overdue: number;
  /** Total des soldes restant dus (centimes USD), trop-perçus exclus. */
  balanceDueCents: number;
}

/** Indicateurs (aucun montant) ; « arrivées prochaines » : ETA dans les `arrivalWindowDays` jours. */
export function buildIndicators(
  data: DashboardData,
  arrivalWindowDays: number,
  todo: TodoItem[],
  now = new Date(),
): DashboardIndicators {
  const byStage = { opening: 0, purchase: 0, us_transport: 0, container: 0, ocean: 0, dakar: 0, closing: 0 };
  for (const d of data.dossiers) byStage[d.stage] += 1;
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + arrivalWindowDays * DAY).toISOString().slice(0, 10);
  return {
    activeDossiers: data.dossiers.length - byStage.closing,
    byStage,
    containersAtSea: data.containers.filter((c) => !c.ata && (c.status === "at_sea" || c.status === "transshipment"))
      .length,
    arrivalsSoon: data.containers.filter((c) => !c.ata && c.eta && c.eta >= today && c.eta <= horizon).length,
    payment1Overdue: todo.filter((t) => t.kind === "payment1_overdue").length,
    balanceDueCents: (data.finance ?? []).reduce((sum, f) => sum + Math.max(f.balance_remaining_cents, 0), 0),
  };
}

/**
 * Progression calendaire d'un conteneur entre son départ et son ETA indicative (0 à 1) — une simple
 * proportion de jours écoulés, jamais une position (CLAUDE.md règle 6). null si elle ne peut pas être calculée.
 */
export function calendarProgress(
  c: Pick<DashboardContainer, "departed_on" | "eta" | "ata">,
  now = new Date(),
): number | null {
  if (c.ata) return 1;
  if (!c.departed_on || !c.eta) return null;
  const start = new Date(c.departed_on).getTime();
  const end = new Date(c.eta).getTime();
  if (end <= start) return null;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}
