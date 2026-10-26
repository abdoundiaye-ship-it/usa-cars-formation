import { Plus, Search } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { STAGE_LABELS, STAGES } from "@/lib/dossiers/labels";
import { formatDate } from "@/lib/format";
import { likePattern, normalizeQuery } from "@/lib/search";
import type { DossierStage } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dossiers" };

const isStage = (value: unknown): value is DossierStage =>
  typeof value === "string" && (STAGES as readonly string[]).includes(value);

/** Recherche : référence, client, VIN ou lot (docs/14_ecrans_ux.md). */
export default async function DossiersPage({ searchParams }: PageProps<"/dossiers">) {
  const access = await requireInternal(SCREEN_ROLES.dossiers);
  const canWrite = canAccess(access.role, SCREEN_ROLES.operationsWrite);
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const q = normalizeQuery(rawQ);
  const stage = isStage(params.etape) ? params.etape : null;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("dossiers")
    .select(
      "id, reference, stage, status, make, model, model_year, vin, lot_number, owner_id, updated_at, clients(name)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (stage) query = query.eq("stage", stage);
  if (q) {
    const p = likePattern(q);
    const { data: matchingClients } = await supabase.from("clients").select("id").ilike("name", p).limit(50);
    const clientFilter = matchingClients?.length ? `,client_id.in.(${matchingClients.map((c) => c.id).join(",")})` : "";
    query = query.or(`reference.ilike.${p},vin.ilike.${p},lot_number.ilike.${p}${clientFilter}`);
  }
  const [{ data: dossiers, error }, { data: statuses }, { data: staff }] = await Promise.all([
    query,
    supabase.from("workflow_statuses").select("stage, code, label"),
    supabase.from("staff_directory").select("id, full_name"),
  ]);
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.full_name ?? "—";
  const statusLabel = (s: string, code: string) =>
    statuses?.find((x) => x.stage === s && x.code === code)?.label ?? code;

  return (
    <>
      <PageHeader title="Dossiers" description="Un dossier par véhicule : du contrat jusqu’à l’enlèvement à Dakar.">
        {canWrite && (
          <Link href="/dossiers/nouveau" className={buttonClasses("primary")}>
            <Plus aria-hidden />
            Ouvrir un dossier
          </Link>
        )}
      </PageHeader>

      <form role="search" className="mb-4 flex flex-col gap-2 sm:flex-row" action="/dossiers">
        <label htmlFor="q" className="sr-only">
          Rechercher un dossier
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={rawQ}
          placeholder="Référence, client, VIN ou lot"
          className="sm:max-w-sm"
        />
        <label htmlFor="etape" className="sr-only">
          Étape
        </label>
        <Select id="etape" name="etape" defaultValue={stage ?? ""} className="sm:max-w-48">
          <option value="">Toutes les étapes</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Rechercher
        </Button>
      </form>

      {error ? (
        <Alert tone="danger">La liste des dossiers n’a pas pu être chargée. Rechargez la page.</Alert>
      ) : !dossiers?.length ? (
        <EmptyState title={q || stage ? "Aucun dossier trouvé" : "Aucun dossier"}>
          {q || stage
            ? "Modifiez la recherche ou le filtre d’étape."
            : canWrite && "Ouvrez un premier dossier depuis une fiche client."}
        </EmptyState>
      ) : (
        <Table caption="Dossiers">
          <thead>
            <tr>
              <Th>Référence</Th>
              <Th>Client</Th>
              <Th className="hidden sm:table-cell">Véhicule</Th>
              <Th>Étape · statut</Th>
              <Th className="hidden lg:table-cell">Responsable</Th>
              <Th className="hidden md:table-cell">Mis à jour</Th>
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link
                    href={`/dossiers/${d.id}` as Route}
                    className="text-primary font-medium whitespace-nowrap underline-offset-2 hover:underline"
                  >
                    {d.reference}
                  </Link>
                </Td>
                <Td>{d.clients?.name ?? "—"}</Td>
                <Td className="hidden sm:table-cell">
                  {[d.make, d.model, d.model_year].filter(Boolean).join(" ") || "—"}
                  {d.vin && <p className="text-muted font-mono text-xs">{d.vin}</p>}
                </Td>
                <Td>
                  <Badge tone="info">{STAGE_LABELS[d.stage]}</Badge>
                  <p className="text-muted mt-1 text-xs">{statusLabel(d.stage, d.status)}</p>
                </Td>
                <Td className="hidden lg:table-cell">{staffName(d.owner_id)}</Td>
                <Td className="hidden md:table-cell">{formatDate(d.updated_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
