import { Anchor, Banknote, ChartColumn, Clock, Folder, Ship, TriangleAlert } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { SEVERITY_DISPLAY } from "@/components/dashboard/severity";
import { TodoList } from "@/components/dashboard/todo-list";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader, StatTile } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import {
  buildIndicators,
  buildTodoList,
  calendarProgress,
  type DashboardContainer,
  type Severity,
} from "@/lib/dashboard";
import { CONTAINER_STATUS_LABELS, STAGE_LABELS, STAGES } from "@/lib/dossiers/labels";
import { formatUsd } from "@/lib/format";
import { currentNumbers } from "@/lib/server/settings-values";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arrivalLabel } from "@/lib/tracking";

export const metadata: Metadata = { title: "Tableau de bord" };

const SETTING_KEYS = [
  "dashboard.stale_dossier_days",
  "dashboard.recent_eta_change_days",
  "tracking.max_days_without_check_in_transit",
  "unclaimed.reminder_days_after_arrival",
  "balance.recommended_days_before_eta",
  "arrival.notify_within_hours",
  "pickup.days_after_documents",
] as const;

/** Couleurs d'état des graphiques (vérifiées pour le daltonisme), toujours accompagnées d'une icône et d'un libellé. */
const SEVERITY_FILL: Record<Severity, string> = {
  danger: "bg-chart-urgent",
  warning: "bg-chart-todo",
  info: "bg-chart-follow",
};

/**
 * US-2.9 : liste « À traiter » et indicateurs pour toute l'équipe interne ; depuis le lot 3d, soldes, remboursements,
 * devis expirés et remise des documents. Seul l'indicateur des soldes dus affiche un montant (décision Q2).
 */
export default async function TableauDeBordPage() {
  const access = await requireInternal(SCREEN_ROLES.dashboard);
  const supabase = await createSupabaseServerClient();

  const [
    { data: dossiers, error },
    { data: confirmations },
    { data: released },
    { data: containers },
    { data: etaChanges },
    { data: assignments },
    settings,
    { data: finance },
    { data: releases },
    { data: arrivalEvents },
    { data: arrivalMessages },
    { data: arrivalNotices },
    { data: unclaimed },
  ] = await Promise.all([
    supabase.from("dossiers").select("id, reference, stage, status, updated_at, payment1_due_at, clients(name)"),
    supabase.from("dossier_confirmations").select("dossier_id, code"),
    supabase.from("documents").select("dossier_id").eq("kind", "release_receipt"),
    supabase.from("containers").select("id, number, status, etd, departed_on, eta, ata, last_checked_at"),
    supabase
      .from("eta_history")
      .select("container_id, changed_at")
      .not("previous_eta", "is", null)
      .order("changed_at", { ascending: false }),
    supabase.from("dossier_containers").select("dossier_id, container_id").is("removed_at", null),
    currentNumbers(SETTING_KEYS),
    supabase.rpc("finance_overview"),
    supabase.from("document_releases").select("dossier_id, released_at"),
    supabase.from("tracking_events").select("container_id, created_at").eq("kind", "arrival"),
    supabase.from("notifications").select("dossier_id").eq("template", "arrived").eq("status", "sent"),
    supabase.from("dossier_events").select("dossier_id").eq("kind", "arrival_notified"),
    supabase.rpc("unclaimed_overview", {}),
  ]);

  const containerRows: DashboardContainer[] = (containers ?? []).map((c) => ({
    ...c,
    eta_changed_at: etaChanges?.find((e) => e.container_id === c.id)?.changed_at ?? null,
    arrival_recorded_at: arrivalEvents?.find((e) => e.container_id === c.id)?.created_at ?? null,
  }));
  const data = {
    dossiers: (dossiers ?? []).map((d) => ({ ...d, client_name: d.clients?.name ?? null })),
    confirmations: confirmations ?? [],
    releasedDossierIds: new Set([
      ...(released ?? []).flatMap((r) => (r.dossier_id ? [r.dossier_id] : [])),
      ...(releases ?? []).map((r) => r.dossier_id),
    ]),
    finance: finance ?? [],
    containers: containerRows,
    assignments: assignments ?? [],
    // Message « arrivée » réellement envoyé (un envoi simulé n'informe pas le client) ou information par l'agent.
    arrivalNotifiedDossierIds: new Set([
      ...(arrivalMessages ?? []).flatMap((m) => (m.dossier_id ? [m.dossier_id] : [])),
      ...(arrivalNotices ?? []).map((e) => e.dossier_id),
    ]),
    releases: releases ?? [],
    unclaimed: unclaimed ?? [],
  };
  const unset = Number.POSITIVE_INFINITY; // paramètre absent : la règle ne se déclenche pas
  const todo = buildTodoList(data, {
    staleDossierDays: settings["dashboard.stale_dossier_days"] ?? unset,
    recentEtaChangeDays: settings["dashboard.recent_eta_change_days"] ?? -1,
    maxDaysWithoutCheck: settings["tracking.max_days_without_check_in_transit"] ?? unset,
    unclaimedReminderDays: settings["unclaimed.reminder_days_after_arrival"] ?? unset,
    arrivalNotifyHours: settings["arrival.notify_within_hours"] ?? unset,
    pickupDaysAfterDocuments: settings["pickup.days_after_documents"] ?? unset,
  });
  const arrivalWindow = settings["balance.recommended_days_before_eta"] ?? 7;
  const indicators = buildIndicators(data, arrivalWindow, todo);
  const moving = containerRows
    .filter((c) => !c.ata && c.departed_on)
    .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));

  const urgent = todo.filter((t) => t.severity === "danger").length;
  const bySeverity = (["danger", "warning", "info"] as const).map((severity) => ({
    severity,
    count: todo.filter((t) => t.severity === severity).length,
  }));
  const maxStage = Math.max(1, ...STAGES.map((stage) => indicators.byStage[stage]));
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Dakar",
  }).format(new Date());
  const urgentText =
    urgent === 0 ? "aucune action urgente" : `${urgent} action${urgent > 1 ? "s" : ""} urgente${urgent > 1 ? "s" : ""}`;

  return (
    <>
      <PageHeader
        title={`Bonjour ${access.fullName}`}
        description={`${today.charAt(0).toUpperCase()}${today.slice(1)} · ${urgentText}.`}
      >
        <Link href="/rapports" className={buttonClasses("secondary")}>
          <ChartColumn aria-hidden />
          Voir les rapports
        </Link>
      </PageHeader>

      {error ? (
        <Alert tone="danger">Le tableau de bord n’a pas pu être chargé. Rechargez la page.</Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Indicateurs" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Dossiers actifs" value={indicators.activeDossiers} icon={Folder} />
            <StatTile
              label="Actions urgentes"
              value={urgent}
              hint={`sur ${todo.length} à traiter`}
              icon={TriangleAlert}
              tone={urgent > 0 ? "danger" : "neutral"}
            />
            <StatTile label="Paiements 1 en retard" value={indicators.payment1Overdue} icon={Clock} />
            <StatTile label="Soldes restant dus" value={formatUsd(indicators.balanceDueCents)} icon={Banknote} />
            <StatTile label="Conteneurs en mer" value={indicators.containersAtSea} icon={Ship} />
            <StatTile
              label={`Arrivées sous ${arrivalWindow} jours`}
              value={indicators.arrivalsSoon}
              hint="ETA indicatives"
              icon={Anchor}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-0 sm:p-0 lg:col-span-2">
              <h2 className="px-4 pt-4 pb-3 text-base font-bold sm:px-6 sm:pt-5">À traiter</h2>
              <TodoList items={todo} />
            </Card>

            <Card className="flex flex-col gap-4">
              <h2 className="text-base font-bold">Répartition par urgence</h2>
              {todo.length > 0 && (
                <div
                  role="img"
                  aria-label={`À traiter : ${bySeverity
                    .map((s) => `${s.count} ${SEVERITY_DISPLAY[s.severity].label.toLowerCase()}`)
                    .join(", ")}`}
                  className="flex h-3.5 gap-0.5 overflow-hidden rounded"
                >
                  {bySeverity
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <div key={s.severity} className={SEVERITY_FILL[s.severity]} style={{ flexGrow: s.count }} />
                    ))}
                </div>
              )}
              <ul className="flex flex-col gap-3 text-sm">
                {bySeverity.map(({ severity, count }) => {
                  const { label, icon: Icon } = SEVERITY_DISPLAY[severity];
                  return (
                    <li key={severity} className="flex items-center gap-2.5">
                      <span aria-hidden className={`size-2.5 rounded-sm ${SEVERITY_FILL[severity]}`} />
                      <Icon aria-hidden className="text-muted size-4" />
                      <span className="flex-1">{label}</span>
                      <strong className="amount">{count}</strong>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-bold">Dossiers par étape</h2>
                <p className="text-muted mt-1 text-sm">Cliquez sur une étape pour voir ses dossiers.</p>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {STAGES.map((stage) => {
                  const n = indicators.byStage[stage];
                  const tip = `${STAGE_LABELS[stage]} : ${n} dossier${n > 1 ? "s" : ""}`;
                  return (
                    <li key={stage}>
                      <Link
                        href={`/dossiers?etape=${stage}` as Route}
                        aria-label={`${tip} — voir la liste`}
                        className="group hover:bg-background relative grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 rounded-lg px-2 py-1.5"
                      >
                        <span>{STAGE_LABELS[stage]}</span>
                        <span className="bg-chart-track h-5 rounded-r">
                          <span
                            className="bg-chart-bar group-hover:bg-primary-hover block h-5 rounded-r"
                            style={{ width: `${Math.round((n / maxStage) * 100)}%` }}
                          />
                        </span>
                        <span className="amount text-right font-semibold">{n}</span>
                        <span
                          aria-hidden
                          className="bg-foreground text-background pointer-events-none absolute -top-7 left-32 z-10 hidden rounded-md px-2 py-1 text-xs whitespace-nowrap group-hover:block"
                        >
                          {tip}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-bold">Conteneurs en route</h2>
                <p className="text-muted mt-1 text-sm">
                  Progression calendaire entre le départ et l’ETA indicative — pas une position GPS.
                </p>
              </div>
              {moving.length === 0 ? (
                <EmptyState title="Aucun conteneur en route" icon={Ship} />
              ) : (
                <ul className="flex flex-col">
                  {moving.map((c) => {
                    const progress = calendarProgress(c);
                    return (
                      <li key={c.id} className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <Link
                            href={`/conteneurs/${c.id}` as Route}
                            className="text-primary font-mono font-semibold underline-offset-2 hover:underline"
                          >
                            {c.number}
                          </Link>
                          <span className="text-muted text-xs">
                            {CONTAINER_STATUS_LABELS[c.status]} · {arrivalLabel(c)}
                          </span>
                        </div>
                        {progress !== null && (
                          <div
                            role="progressbar"
                            aria-label={`Progression calendaire du conteneur ${c.number}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progress * 100)}
                            className="bg-chart-track h-2 overflow-hidden rounded-full"
                          >
                            <div
                              className="bg-chart-bar h-full rounded-full"
                              style={{ width: `${Math.round(progress * 100)}%` }}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
