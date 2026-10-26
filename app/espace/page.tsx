import { ChevronRight } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { ClientStageProgress } from "@/components/client-stage-progress";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { formatDateTime, formatUsd } from "@/lib/format";
import { nextClientAction } from "@/lib/portal";
import { clientDossierState } from "@/lib/server/portal-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mes dossiers" };

/** Portail — accueil : ses dossiers sous forme de cartes (véhicule, étape, prochaine action attendue). */
export default async function EspacePage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: dossiers, error }, { data: statuses }] = await Promise.all([
    supabase
      .from("dossiers")
      .select("id, reference, stage, status, make, model, model_year")
      .order("created_at", { ascending: false }),
    supabase.from("workflow_statuses").select("stage, code, label"),
  ]);
  const states = new Map(
    await Promise.all((dossiers ?? []).map(async (d) => [d.id, await clientDossierState(d.id)] as const)),
  );
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Mes dossiers"
        description="Un dossier par véhicule : étapes, documents, paiements et arrivée."
      />
      {error ? (
        <Alert tone="danger">Vos dossiers n’ont pas pu être chargés. Rechargez la page.</Alert>
      ) : !dossiers?.length ? (
        <EmptyState title="Aucun dossier pour le moment">Vos dossiers apparaîtront ici dès leur ouverture.</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {dossiers.map((d) => {
            const action = nextClientAction(states.get(d.id)!, now);
            const vehicle = [d.make, d.model, d.model_year].filter(Boolean).join(" ") || "Véhicule à préciser";
            const status = statuses?.find((s) => s.stage === d.stage && s.code === d.status)?.label ?? d.status;
            return (
              <li key={d.id}>
                <Card className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-bold">{vehicle}</h2>
                      <p className="text-muted text-sm">Dossier {d.reference}</p>
                    </div>
                    <Badge tone="info">{status}</Badge>
                  </div>
                  <ClientStageProgress stage={d.stage} />
                  <p className="text-sm">
                    <Badge
                      tone={
                        action.kind === "none"
                          ? "success"
                          : action.kind === "payment" && action.overdue
                            ? "danger"
                            : "warning"
                      }
                    >
                      {action.kind === "none" ? "À jour" : "À faire"}
                    </Badge>{" "}
                    {action.label}
                    {action.kind === "payment" && (
                      <>
                        {" "}
                        : <span className="amount font-semibold">{formatUsd(action.amountCents)}</span>
                        {action.dueAt && ` avant le ${formatDateTime(action.dueAt)}`}
                      </>
                    )}
                  </p>
                  <Link
                    href={`/espace/dossiers/${d.id}` as Route}
                    aria-label={`Voir le dossier ${d.reference}`}
                    className="text-primary mt-auto inline-flex items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    Voir le dossier
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
