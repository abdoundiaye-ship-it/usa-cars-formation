/**
 * Rapports de la phase 6 (US-6.1) : définition commune à l'écran Rapports (application) et à l'export Excel
 * (fonction export-report) — fonction SQL, période, colonnes et formats. Les droits sont vérifiés par la base.
 * Module autonome (Deno et Vitest).
 */
import type { XlsxCellType, XlsxValue } from "./xlsx.ts";

export type ReportKey =
  "active_dossiers" | "delays" | "receivables" | "transit_times" | "margins" | "retention" | "access_review";
export type ReportRole = "admin" | "ops" | "accounting" | "management";
/** Filtre de date : aucun, une période (du … au …), ou une date de situation. */
export type ReportPeriod = "none" | "range" | "as_of";
type Row = Record<string, unknown>;

export interface ReportColumn {
  key: string;
  label: string;
  type: XlsxCellType | "stage" | "delay_kind" | "retention_scope" | "role" | "bool";
  width?: number;
}

export interface ReportDefinition {
  title: string;
  description: string;
  rpc: string;
  period: ReportPeriod;
  /** Rôles autorisés (docs/12) : affichage seulement, la base refuse les autres. */
  roles: readonly ReportRole[];
  columns: ReportColumn[];
}

/** Libellés des étapes (mêmes valeurs que lib/dossiers/labels.ts, vérifié par un test). */
export const REPORT_STAGE_LABELS: Record<string, string> = {
  opening: "Ouverture",
  purchase: "Achat",
  us_transport: "Transport USA",
  container: "Conteneur",
  ocean: "Maritime",
  dakar: "Dakar",
  closing: "Clôture",
};

export const DELAY_KIND_LABELS: Record<string, string> = {
  payment1_overdue: "Paiement 1",
  balance_overdue: "Solde",
  stale: "Sans mise à jour",
  eta_postponed: "ETA repoussée",
  unclaimed: "Non réclamé",
};

/** Données dont la durée de conservation est atteinte (G2-a). */
export const RETENTION_SCOPE_LABELS: Record<string, string> = {
  all: "Toutes les données",
  other_data: "Hors pièces comptables",
  accounting: "Pièces comptables seulement",
};

/** Libellés des rôles (mêmes valeurs que lib/auth/roles.ts ROLE_LABELS, vérifié par un test). */
export const REPORT_ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  ops: "Agent opérations",
  accounting: "Comptabilité",
  management: "Direction",
  client: "Client",
};

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  active_dossiers: {
    title: "Dossiers actifs",
    description: "Dossiers en cours (hors clôture) : étape, statut, responsable, conteneur, ETA indicative ou ATA.",
    rpc: "report_active_dossiers",
    period: "none",
    roles: ["admin", "management", "ops"],
    columns: [
      { key: "reference", label: "Dossier", type: "text", width: 16 },
      { key: "client_name", label: "Client", type: "text", width: 28 },
      { key: "stage", label: "Étape", type: "stage", width: 14 },
      { key: "status_label", label: "Statut", type: "text", width: 26 },
      { key: "owner_name", label: "Responsable", type: "text", width: 22 },
      { key: "opened_at", label: "Ouvert le", type: "date", width: 12 },
      { key: "days_since_update", label: "Jours sans mise à jour", type: "int", width: 12 },
      { key: "container_number", label: "Conteneur", type: "text", width: 14 },
      { key: "eta", label: "ETA indicative", type: "date", width: 12 },
      { key: "ata", label: "ATA", type: "date", width: 12 },
    ],
  },
  delays: {
    title: "Retards",
    description: "Paiements en retard, dossiers sans mise à jour, ETA repoussées et véhicules non réclamés.",
    rpc: "report_delays",
    period: "none",
    roles: ["admin", "management", "ops", "accounting"],
    columns: [
      { key: "reference", label: "Dossier", type: "text", width: 16 },
      { key: "client_name", label: "Client", type: "text", width: 28 },
      { key: "kind", label: "Type", type: "delay_kind", width: 18 },
      { key: "label", label: "Détail", type: "text", width: 34 },
      { key: "since", label: "Depuis le", type: "date", width: 12 },
      { key: "days_late", label: "Jours", type: "int", width: 8 },
    ],
  },
  receivables: {
    title: "Créances par client",
    description: "Reste dû par client (devis acceptés), réparti selon l’ancienneté de l’échéance, à la date choisie.",
    rpc: "report_receivables",
    period: "as_of",
    roles: ["admin", "management", "accounting"],
    columns: [
      { key: "client_name", label: "Client", type: "text", width: 30 },
      { key: "dossiers", label: "Dossiers", type: "int", width: 10 },
      { key: "total_cents", label: "Reste dû", type: "usd", width: 16 },
      { key: "not_due_cents", label: "Non échu", type: "usd", width: 16 },
      { key: "overdue_1_30_cents", label: "Échu 1–30 j", type: "usd", width: 16 },
      { key: "overdue_31_60_cents", label: "Échu 31–60 j", type: "usd", width: 16 },
      { key: "overdue_over_60_cents", label: "Échu > 60 j", type: "usd", width: 16 },
    ],
  },
  transit_times: {
    title: "Délais achat → Dakar",
    description:
      "Véhicules arrivés à Dakar dans la période : délais du lot remporté au départ, en mer et jusqu’à l’enlèvement.",
    rpc: "report_transit_times",
    period: "range",
    roles: ["admin", "management", "ops"],
    columns: [
      { key: "reference", label: "Dossier", type: "text", width: 16 },
      { key: "client_name", label: "Client", type: "text", width: 26 },
      { key: "carrier_name", label: "Transporteur", type: "text", width: 18 },
      { key: "port_of_loading", label: "Port de départ", type: "text", width: 16 },
      { key: "won_on", label: "Lot remporté", type: "date", width: 12 },
      { key: "departed_on", label: "Départ", type: "date", width: 12 },
      { key: "arrived_on", label: "Arrivée (ATA)", type: "date", width: 12 },
      { key: "collected_on", label: "Enlèvement", type: "date", width: 12 },
      { key: "days_won_to_departure", label: "Jours avant départ", type: "int", width: 12 },
      { key: "days_at_sea", label: "Jours en mer", type: "int", width: 12 },
      { key: "days_won_to_arrival", label: "Jours lot → Dakar", type: "int", width: 12 },
      { key: "days_arrival_to_collection", label: "Jours Dakar → enlèvement", type: "int", width: 14 },
    ],
  },
  margins: {
    title: "Marge par véhicule",
    description:
      "Devis acceptés dans la période : forfaits A + B et ajustements D (hors TVA et hors assurance), moins les coûts internes saisis. Confidentiel.",
    rpc: "report_margins",
    period: "range",
    roles: ["admin", "management"],
    columns: [
      { key: "reference", label: "Dossier", type: "text", width: 16 },
      { key: "client_name", label: "Client", type: "text", width: 26 },
      { key: "vehicle", label: "Véhicule", type: "text", width: 24 },
      { key: "accepted_on", label: "Devis accepté le", type: "date", width: 12 },
      { key: "revenue_cents", label: "Facturé (A + B + D)", type: "usd", width: 16 },
      { key: "insurance_cents", label: "Assurance (C)", type: "usd", width: 14 },
      { key: "costs_cents", label: "Coûts internes", type: "usd", width: 16 },
      { key: "costs_final", label: "Coûts définitifs", type: "bool", width: 10 },
      { key: "margin_cents", label: "Marge", type: "usd", width: 16 },
      { key: "margin_percent", label: "Marge %", type: "percent", width: 10 },
    ],
  },
  retention: {
    title: "Conservation des données",
    description:
      "Dossiers clôturés dont la durée de conservation est atteinte à la date choisie (pièces comptables et autres données). Aucune suppression automatique : la purge reste manuelle.",
    rpc: "report_retention",
    period: "as_of",
    roles: ["admin", "management"],
    columns: [
      { key: "reference", label: "Dossier", type: "text", width: 16 },
      { key: "client_name", label: "Client", type: "text", width: 26 },
      { key: "status_label", label: "Statut", type: "text", width: 14 },
      { key: "closed_on", label: "Clôturé le", type: "date", width: 12 },
      { key: "other_data_until", label: "Autres données jusqu’au", type: "date", width: 14 },
      { key: "accounting_until", label: "Pièces comptables jusqu’au", type: "date", width: 14 },
      { key: "scope", label: "Durée atteinte pour", type: "retention_scope", width: 26 },
      { key: "documents", label: "Fichiers", type: "int", width: 10 },
      { key: "financial_documents", label: "Pièces comptables", type: "int", width: 12 },
      { key: "client_dossiers_kept", label: "Autres dossiers du client conservés", type: "int", width: 16 },
    ],
  },
  access_review: {
    title: "Revue des accès",
    description:
      "Comptes internes : rôle, état du compte, double authentification et dernière connexion. Réservée à l'administrateur et à la direction.",
    rpc: "report_access_review",
    period: "none",
    roles: ["admin", "management"],
    columns: [
      { key: "full_name", label: "Utilisateur", type: "text", width: 26 },
      { key: "email", label: "E-mail", type: "text", width: 28 },
      { key: "role", label: "Rôle", type: "role", width: 18 },
      { key: "active", label: "Compte actif", type: "bool", width: 12 },
      { key: "mfa_required", label: "2FA requise", type: "bool", width: 12 },
      { key: "mfa_configured", label: "2FA configurée", type: "bool", width: 12 },
      { key: "last_sign_in_at", label: "Dernière connexion", type: "date", width: 14 },
      { key: "created_at", label: "Compte créé le", type: "date", width: 12 },
    ],
  },
};

export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];

export const isReportKey = (value: unknown): value is ReportKey =>
  typeof value === "string" && (REPORT_KEYS as string[]).includes(value);

/** Paramètres de la fonction SQL selon le filtre de date du rapport. */
export function reportArgs(
  key: ReportKey,
  filters: { from?: string | null; to?: string | null; asOf?: string | null },
): Record<string, string | null> {
  const period = REPORTS[key].period;
  if (period === "range") return { p_from: filters.from ?? null, p_to: filters.to ?? null };
  if (period === "as_of") return { p_as_of: filters.asOf ?? null };
  return {};
}

/** Valeur d'une cellule pour l'export Excel (montants en centimes, dates AAAA-MM-JJ, libellés en français). */
export function exportValue(column: ReportColumn, row: Row): XlsxValue {
  const value = row[column.key];
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case "stage":
      return REPORT_STAGE_LABELS[String(value)] ?? String(value);
    case "delay_kind":
      return DELAY_KIND_LABELS[String(value)] ?? String(value);
    case "retention_scope":
      return RETENTION_SCOPE_LABELS[String(value)] ?? String(value);
    case "role":
      return REPORT_ROLE_LABELS[String(value)] ?? String(value);
    case "bool":
      return value ? "oui" : "non";
    case "date":
      return String(value).slice(0, 10);
    case "text":
      return String(value);
    default:
      return Number(value);
  }
}

/** Type de cellule Excel d'une colonne. */
export function exportType(column: ReportColumn): XlsxCellType {
  return column.type === "stage" ||
    column.type === "delay_kind" ||
    column.type === "retention_scope" ||
    column.type === "role" ||
    column.type === "bool"
    ? "text"
    : column.type;
}
