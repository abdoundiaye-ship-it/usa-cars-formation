import { Plus, Search, Ship } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { CONTAINER_STATUS_LABELS } from "@/lib/dossiers/labels";
import { formatDate } from "@/lib/format";
import { likePattern, normalizeQuery } from "@/lib/search";
import { maxDaysWithoutCheck } from "@/lib/server/tracking-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arrivalLabel, trackingCheckOverdue } from "@/lib/tracking";

export const metadata: Metadata = { title: "Conteneurs" };

export default async function ConteneursPage({ searchParams }: PageProps<"/conteneurs">) {
  const access = await requireInternal(SCREEN_ROLES.containers);
  const canWrite = canAccess(access.role, SCREEN_ROLES.operationsWrite);
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const q = normalizeQuery(rawQ);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("containers")
    .select("*, carriers(name, link_type)")
    .order("ata", { ascending: true, nullsFirst: true })
    .order("eta", { ascending: true, nullsFirst: false })
    .limit(200);
  if (q) {
    const p = likePattern(q);
    query = query.or(`number.ilike.${p},bl_number.ilike.${p},vessel.ilike.${p}`);
  }
  const [{ data: containers, error }, { data: assignments }, maxDays] = await Promise.all([
    query,
    supabase.from("dossier_containers").select("container_id").is("removed_at", null),
    maxDaysWithoutCheck(),
  ]);
  const vehicleCount = (id: string) => assignments?.filter((a) => a.container_id === id).length ?? 0;

  return (
    <>
      <PageHeader
        title="Conteneurs"
        description="Références d’expédition, ETA indicative et suivi. L’ETA n’est pas une position en temps réel."
      >
        {canWrite && (
          <Link href="/conteneurs/nouveau" className={buttonClasses("primary")}>
            <Plus aria-hidden />
            Nouveau conteneur
          </Link>
        )}
      </PageHeader>

      <form role="search" className="mb-4 flex flex-col gap-2 sm:flex-row" action="/conteneurs">
        <label htmlFor="q" className="sr-only">
          Rechercher un conteneur
        </label>
        <Input id="q" name="q" defaultValue={rawQ} placeholder="Numéro, B/L ou navire" className="sm:max-w-sm" />
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Rechercher
        </Button>
      </form>

      {error ? (
        <Alert tone="danger">La liste des conteneurs n’a pas pu être chargée. Rechargez la page.</Alert>
      ) : !containers?.length ? (
        <EmptyState title={q ? "Aucun conteneur trouvé" : "Aucun conteneur"} icon={Ship}>
          {q ? "Vérifiez le numéro saisi." : canWrite && "Créez le premier conteneur."}
        </EmptyState>
      ) : (
        <Table caption="Conteneurs">
          <thead>
            <tr>
              <Th>Conteneur</Th>
              <Th className="hidden sm:table-cell">Transporteur · navire</Th>
              <Th>Statut</Th>
              <Th>Arrivée</Th>
              <Th className="hidden md:table-cell">Véhicules</Th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => {
              const overdue = trackingCheckOverdue(c, maxDays);
              return (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/conteneurs/${c.id}` as Route}
                      className="text-primary font-mono font-medium underline-offset-2 hover:underline"
                    >
                      {c.number}
                    </Link>
                    {c.bl_number && <p className="text-muted text-xs">B/L {c.bl_number}</p>}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    {c.carriers?.name ?? "—"}
                    {(c.vessel || c.voyage) && (
                      <p className="text-muted text-xs">{[c.vessel, c.voyage].filter(Boolean).join(" · ")}</p>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={c.ata ? "success" : "info"}>{CONTAINER_STATUS_LABELS[c.status]}</Badge>
                    {overdue && (
                      <p className="text-warning mt-1 text-xs font-medium">À vérifier (suivi non consulté)</p>
                    )}
                  </Td>
                  <Td>{arrivalLabel(c)}</Td>
                  <Td className="hidden md:table-cell">{vehicleCount(c.id)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="text-muted mt-3 text-xs">
        Dernière vérification au-delà de {Number.isFinite(maxDays) ? `${maxDays} jours` : "la limite"} pour un conteneur
        en mer : signalé « À vérifier ». Liste mise à jour le {formatDate(new Date())}.
      </p>
    </>
  );
}
