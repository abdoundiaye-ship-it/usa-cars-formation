import type { AppRole } from "@/lib/auth/roles";
import { REPORT_KEYS, REPORTS, type ReportKey } from "@/supabase/functions/_shared/reports.ts";

/** Écran Rapports (US-6.1) : fonctions pures — rapports visibles, filtres de date, moyennes et totaux. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rapports accessibles à un rôle (docs/12) ; la base le vérifie aussi. */
export function reportsFor(role: AppRole): ReportKey[] {
  return REPORT_KEYS.filter((key) => (REPORTS[key].roles as readonly string[]).includes(role));
}

export interface ReportFilters {
  from: string;
  to: string;
  asOf: string;
}

/** Filtres de l'URL, sinon : du 1er janvier de l'année au jour, situation au jour. Dates inversées : remises dans l'ordre. */
export function reportFilters(
  params: { du?: unknown; au?: unknown; situation?: unknown },
  today: string,
): ReportFilters {
  const valid = (value: unknown) => (typeof value === "string" && ISO_DATE.test(value) ? value : null);
  let from = valid(params.du) ?? `${today.slice(0, 4)}-01-01`;
  let to = valid(params.au) ?? today;
  if (from > to) [from, to] = [to, from];
  return { from, to, asOf: valid(params.situation) ?? today };
}

/** Moyenne (arrondie au dixième) d'une colonne numérique, valeurs absentes ignorées ; null sans valeur. */
export function average(rows: Record<string, unknown>[], key: string): number | null {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/** Somme d'une colonne de montants (centimes), valeurs absentes ignorées. */
export function total(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((sum, r) => sum + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}

/** Moyennes par valeur d'une colonne (ex. par transporteur), triées par nombre de dossiers décroissant. */
export function averagesBy(
  rows: Record<string, unknown>[],
  groupKey: string,
  valueKeys: string[],
): { group: string; count: number; averages: Record<string, number | null> }[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const group = String(row[groupKey] ?? "—");
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([group, items]) => ({
      group,
      count: items.length,
      averages: Object.fromEntries(valueKeys.map((key) => [key, average(items, key)])),
    }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}
