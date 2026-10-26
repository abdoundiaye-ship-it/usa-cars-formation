import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import {
  CONTAINER_STATUS_LABELS,
  ETA_SOURCE_LABELS,
  STAGE_LABELS,
  TRACKING_SOURCE_LABELS,
} from "@/lib/dossiers/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { maxDaysWithoutCheck } from "@/lib/server/tracking-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arrivalLabel, trackingCheckOverdue, trackingLink } from "@/lib/tracking";
import { CheckedTodayForm, ContainerDateForm, ContainerForm, EtaForm, TrackingEventForm } from "../container-forms";

export const metadata: Metadata = { title: "Fiche conteneur" };

export default async function ConteneurPage({ params, searchParams }: PageProps<"/conteneurs/[id]">) {
  const access = await requireInternal(SCREEN_ROLES.containers);
  const canWrite = canAccess(access.role, SCREEN_ROLES.operationsWrite);
  const { id } = await params;
  const created = (await searchParams).cree === "1";

  const supabase = await createSupabaseServerClient();
  const { data: container } = await supabase.from("containers").select("*").eq("id", id).maybeSingle();
  if (!container) notFound();

  const [
    { data: carrier },
    { data: carriers },
    { data: etaHistory },
    { data: events },
    { data: assignments },
    { data: staff },
    maxDays,
  ] = await Promise.all([
    supabase.from("carriers").select("*").eq("id", container.carrier_id).maybeSingle(),
    supabase.from("carriers").select("id, name, link_type").order("name"),
    supabase.from("eta_history").select("*").eq("container_id", id).order("changed_at", { ascending: false }),
    supabase.from("tracking_events").select("*").eq("container_id", id).order("occurred_at", { ascending: false }),
    supabase
      .from("dossier_containers")
      .select("dossier_id, assigned_at, dossiers(reference, stage, make, model, model_year, clients(name))")
      .eq("container_id", id)
      .is("removed_at", null),
    supabase.from("staff_directory").select("id, full_name"),
    maxDaysWithoutCheck(),
  ]);
  const staffName = (userId: string | null) => staff?.find((s) => s.id === userId)?.full_name ?? "—";
  const link = carrier ? trackingLink(carrier, container) : null;
  const overdue = trackingCheckOverdue(container, maxDays);
  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC+0
  const arrived = Boolean(container.ata);

  return (
    <>
      <PageHeader
        title={`Conteneur ${container.number}`}
        description={[carrier?.name, container.vessel, container.voyage].filter(Boolean).join(" · ")}
      />

      <div className="flex flex-col gap-6">
        {created && <Alert tone="success">Conteneur créé.</Alert>}

        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              <Badge tone={arrived ? "success" : "info"}>{CONTAINER_STATUS_LABELS[container.status]}</Badge>{" "}
              <strong>{arrivalLabel(container)}</strong>
            </p>
            {link && (
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary")}>
                <ExternalLink aria-hidden />
                Ouvrir le suivi du transporteur
              </a>
            )}
          </div>
          {link?.referenceToEnter && (
            <p className="text-sm">
              Référence à saisir sur la page de suivi : <span className="font-mono">{link.referenceToEnter}</span>
            </p>
          )}
          {link?.thirdParty && (
            <Alert tone="warning">
              Suivi assuré par un service tiers, non par le transporteur lui-même : informations indicatives.
            </Alert>
          )}
          <p className="text-muted text-xs">
            L’ETA est une estimation du transporteur, pas une position en temps réel. Dernière vérification :{" "}
            {container.last_checked_at
              ? `${formatDateTime(container.last_checked_at)} par ${staffName(container.last_checked_by)}`
              : "jamais"}
            .
          </p>
          {overdue && (
            <Alert tone="warning">
              Conteneur en mer non vérifié depuis plus de {maxDays} jours : consultez le suivi puis cliquez sur «
              Vérifié aujourd’hui ».
            </Alert>
          )}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ["B/L", container.bl_number],
              ["Port de chargement", container.port_of_loading],
              ["Port d’arrivée", container.port_of_discharge],
              ["Départ prévu (ETD)", container.etd ? formatDate(container.etd) : null],
              ["Départ réel", container.departed_on ? formatDate(container.departed_on) : null],
              ["Arrivée réelle (ATA)", container.ata ? formatDate(container.ata) : null],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {canWrite && !arrived && (
            <div className="border-border flex flex-col gap-4 border-t pt-4">
              <CheckedTodayForm containerId={container.id} />
              {!container.departed_on && (
                <ContainerDateForm containerId={container.id} kind="departure" today={today} />
              )}
              <ContainerDateForm containerId={container.id} kind="arrival" today={today} />
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Véhicules chargés</h2>
          {!assignments?.length ? (
            <EmptyState title="Aucun véhicule">Associez un véhicule depuis la fiche de son dossier.</EmptyState>
          ) : (
            <Table caption="Véhicules du conteneur">
              <thead>
                <tr>
                  <Th>Dossier</Th>
                  <Th>Véhicule · client</Th>
                  <Th className="hidden sm:table-cell">Étape</Th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.dossier_id}>
                    <Td>
                      <Link href={`/dossiers/${a.dossier_id}` as Route} className="text-primary font-medium underline">
                        {a.dossiers?.reference}
                      </Link>
                    </Td>
                    <Td>
                      {[a.dossiers?.make, a.dossiers?.model, a.dossiers?.model_year].filter(Boolean).join(" ") || "—"}
                      <p className="text-muted text-xs">{a.dossiers?.clients?.name}</p>
                    </Td>
                    <Td className="hidden sm:table-cell">{a.dossiers ? STAGE_LABELS[a.dossiers.stage] : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Historique de l’ETA indicative</h2>
          {!etaHistory?.length ? (
            <EmptyState title="Aucune ETA saisie" />
          ) : (
            <Table caption="Historique de l’ETA">
              <thead>
                <tr>
                  <Th>ETA</Th>
                  <Th>Source</Th>
                  <Th className="hidden sm:table-cell">Saisie</Th>
                </tr>
              </thead>
              <tbody>
                {etaHistory.map((h) => (
                  <tr key={h.id}>
                    <Td>
                      {formatDate(h.eta)}
                      {h.previous_eta && <p className="text-muted text-xs">avant : {formatDate(h.previous_eta)}</p>}
                    </Td>
                    <Td>
                      {ETA_SOURCE_LABELS[h.source]}
                      {h.note && <p className="text-muted text-xs">{h.note}</p>}
                    </Td>
                    <Td className="hidden sm:table-cell">
                      {formatDateTime(h.changed_at)} · {staffName(h.changed_by)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {canWrite && !arrived && <EtaForm containerId={container.id} current={container.eta} />}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Événements</h2>
          {!events?.length ? (
            <EmptyState title="Aucun événement" />
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={`border-l-2 pl-3 text-sm ${e.source === "manual" ? "border-warning border-dashed" : "border-border"}`}
                >
                  <p className="font-medium">{e.label}</p>
                  <p className="text-muted text-xs">
                    {formatDate(e.occurred_at)}
                    {e.location && ` · ${e.location}`} · {TRACKING_SOURCE_LABELS[e.source]} ·{" "}
                    {e.visible_client ? "visible du client" : "interne"}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {canWrite && !arrived && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Ajouter un événement…</summary>
              <div className="mt-3">
                <TrackingEventForm containerId={container.id} today={today} />
              </div>
            </details>
          )}
        </Card>

        {canWrite && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Références d’expédition</h2>
            <ContainerForm carriers={carriers ?? []} container={container} />
          </Card>
        )}
      </div>
    </>
  );
}
