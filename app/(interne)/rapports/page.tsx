import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDate, formatInteger, formatUsd } from "@/lib/format";
import { average, averagesBy, reportFilters, reportsFor, total } from "@/lib/reports";
import type { ReportRow } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DELAY_KIND_LABELS,
  REPORT_STAGE_LABELS,
  REPORTS,
  REPORT_ROLE_LABELS,
  RETENTION_SCOPE_LABELS,
  reportArgs,
  type ReportColumn,
  type ReportKey,
} from "@/supabase/functions/_shared/reports.ts";

export const metadata: Metadata = { title: "Rapports" };

const TRANSIT_DAYS = ["days_won_to_departure", "days_at_sea", "days_won_to_arrival", "days_arrival_to_collection"];

function display(column: ReportColumn, value: ReportRow[string]): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (column.type) {
    case "usd":
      return formatUsd(Number(value));
    case "date":
      return formatDate(String(value));
    case "int":
      return formatInteger(Number(value));
    case "percent":
      return `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
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
    default:
      return String(value);
  }
}

const days = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("fr-FR")} j`);

/**
 * US-6.1 : rapports par rôle (docs/12) — dossiers actifs, retards, créances, délais, marge (admin et direction) ;
 * conservation des données (G2-a, admin et direction).
 * Les droits sont vérifiés par la base ; l'export Excel passe par /rapports/export (journalisé).
 */
export default async function RapportsPage({ searchParams }: PageProps<"/rapports">) {
  const access = await requireInternal(SCREEN_ROLES.reports);
  const params = await searchParams;
  const allowed = reportsFor(access.role);
  const key: ReportKey | undefined = allowed.find((k) => k === params.rapport) ?? allowed[0];
  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC
  const filters = reportFilters(params, today);

  if (!key) {
    return (
      <>
        <PageHeader title="Rapports" />
        <EmptyState title="Aucun rapport pour votre rôle" />
      </>
    );
  }
  const report = REPORTS[key];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(report.rpc as "report_delays", reportArgs(key, filters) as never);
  const rows = (data ?? []) as ReportRow[];
  const query = new URLSearchParams({ rapport: key });
  if (report.period === "range") {
    query.set("du", filters.from);
    query.set("au", filters.to);
  }
  if (report.period === "as_of") query.set("situation", filters.asOf);
  const exportHref = `/rapports/export?${query}` as Route;

  return (
    <>
      <PageHeader title="Rapports" description="Indicateurs de l’activité, exportables au format Excel." />
      <div className="flex flex-col gap-6">
        <nav aria-label="Rapports" className="flex flex-wrap gap-2">
          {allowed.map((k) => (
            <Link
              key={k}
              href={`/rapports?rapport=${k}` as Route}
              aria-current={k === key ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                k === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-background"
              }`}
            >
              {REPORTS[k].title}
            </Link>
          ))}
        </nav>

        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">{report.title}</h2>
            <p className="text-muted text-sm">{report.description}</p>
          </div>
          {key === "retention" && (
            <Alert tone="info">
              Durées fixées dans les paramètres « Données personnelles » (point de départ : la clôture du dossier). Un
              dossier dont le client a d’autres dossiers conservés ne permet pas d’effacer l’identité du client. La
              purge n’est jamais automatique : elle se fait à la main, après accord de la direction.
            </Alert>
          )}
          {key === "margins" && (
            <Alert tone="warning">
              Confidentiel : coûts internes et marge, réservés à l’administrateur et à la direction ; jamais communiqués
              au client.
            </Alert>
          )}

          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="rapport" value={key} />
            {report.period === "range" && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Du
                  <Input type="date" name="du" defaultValue={filters.from} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Au
                  <Input type="date" name="au" defaultValue={filters.to} />
                </label>
              </>
            )}
            {report.period === "as_of" && (
              <label className="flex flex-col gap-1 text-sm">
                Situation au
                <Input type="date" name="situation" defaultValue={filters.asOf} />
              </label>
            )}
            {report.period !== "none" && (
              <Button type="submit" variant="secondary">
                Afficher
              </Button>
            )}
            <a href={exportHref} className={buttonClasses("primary", "sm:ml-auto")}>
              Télécharger (Excel)
            </a>
          </form>
          {params.export === "erreur" && (
            <Alert tone="danger">L’export n’a pas pu être préparé. Réessayez dans un instant.</Alert>
          )}

          {error ? (
            <Alert tone="danger">Le rapport n’a pas pu être chargé. Rechargez la page.</Alert>
          ) : rows.length === 0 ? (
            <EmptyState title="Aucune ligne">Rien à signaler pour ce rapport et ces dates.</EmptyState>
          ) : (
            <>
              {key === "transit_times" && (
                <div className="flex flex-col gap-2 text-sm">
                  <p>
                    Moyennes sur {rows.length} véhicule(s) : {days(average(rows, "days_won_to_departure"))} avant le
                    départ, {days(average(rows, "days_at_sea"))} en mer, {days(average(rows, "days_won_to_arrival"))} du
                    lot remporté à Dakar, {days(average(rows, "days_arrival_to_collection"))} de Dakar à l’enlèvement.
                  </p>
                  <ul className="text-muted flex flex-col gap-1 text-xs">
                    {averagesBy(rows, "carrier_name", TRANSIT_DAYS).map((g) => (
                      <li key={g.group}>
                        {g.group} ({g.count}) : {days(g.averages.days_at_sea ?? null)} en mer,{" "}
                        {days(g.averages.days_won_to_arrival ?? null)} du lot à Dakar
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {key === "receivables" &&
                (() => {
                  const buckets = [
                    { label: "Non échu", cents: total(rows, "not_due_cents"), fill: "bg-muted", dot: "bg-muted" },
                    {
                      label: "Échu 1–30 j",
                      cents: total(rows, "overdue_1_30_cents"),
                      fill: "bg-chart-follow",
                      dot: "bg-chart-follow",
                    },
                    {
                      label: "Échu 31–60 j",
                      cents: total(rows, "overdue_31_60_cents"),
                      fill: "bg-chart-todo",
                      dot: "bg-chart-todo",
                    },
                    {
                      label: "Échu > 60 j",
                      cents: total(rows, "overdue_over_60_cents"),
                      fill: "bg-chart-urgent",
                      dot: "bg-chart-urgent",
                    },
                  ];
                  const grandTotal = total(rows, "total_cents");
                  const overdue = grandTotal - buckets[0]!.cents;
                  return (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm">
                        Total restant dû : <strong>{formatUsd(grandTotal)}</strong>, dont échu :{" "}
                        <strong>{formatUsd(overdue)}</strong>.
                      </p>
                      {grandTotal > 0 && (
                        <>
                          <div
                            role="img"
                            aria-label={`Créances par ancienneté : ${buckets
                              .filter((b) => b.cents > 0)
                              .map((b) => `${b.label} ${formatUsd(b.cents)}`)
                              .join(", ")}`}
                            className="flex h-4 gap-0.5 overflow-hidden rounded"
                          >
                            {buckets
                              .filter((b) => b.cents > 0)
                              .map((b) => (
                                <div key={b.label} className={b.fill} style={{ flexGrow: b.cents }} />
                              ))}
                          </div>
                          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                            {buckets.map((b) => (
                              <li key={b.label} className="flex items-center gap-2">
                                <span aria-hidden className={`size-2.5 rounded-sm ${b.dot}`} />
                                <span className="text-muted">{b.label}</span>
                                <span className="amount font-semibold">{formatUsd(b.cents)}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  );
                })()}
              {key === "margins" && (
                <p className="text-sm">
                  Marge totale des dossiers avec coûts saisis :{" "}
                  <strong>{formatUsd(total(rows, "margin_cents"))}</strong> (
                  {rows.filter((r) => r.margin_cents === null).length} dossier(s) sans coût saisi : marge non
                  calculable).
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      {report.columns.map((c) => (
                        <Th key={c.key}>{c.label}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={`${String(row.dossier_id ?? row.client_id ?? "")}-${i}`}>
                        {report.columns.map((c) => (
                          <Td
                            key={c.key}
                            className={c.type === "text" || c.type === "stage" ? "" : "amount whitespace-nowrap"}
                          >
                            {c.key === "reference" && typeof row.dossier_id === "string" ? (
                              <Link href={`/dossiers/${row.dossier_id}` as Route} className="text-primary underline">
                                {display(c, row[c.key] ?? null)}
                              </Link>
                            ) : (
                              display(c, row[c.key] ?? null)
                            )}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
