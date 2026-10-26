import { FileText, Search } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { DOCUMENT_KIND_LABELS } from "@/lib/dossiers/labels";
import { formatDateTime } from "@/lib/format";
import { likePattern, normalizeQuery } from "@/lib/search";
import type { DocumentKind } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VisibilityToggle } from "./visibility-toggle";

export const metadata: Metadata = { title: "Documents" };

const KINDS = Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[];
const isKind = (value: unknown): value is DocumentKind =>
  typeof value === "string" && KINDS.includes(value as DocumentKind);

/** US-2.8 : tous les documents des dossiers (bucket privé), filtre par type, visibilité client. */
export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const access = await requireInternal(SCREEN_ROLES.documents);
  const canEdit = canAccess(access.role, SCREEN_ROLES.documentsWrite);
  const params = await searchParams;
  const kind = isKind(params.type) ? params.type : null;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const q = normalizeQuery(rawQ);
  const visibility = params.visibilite === "client" || params.visibilite === "interne" ? params.visibilite : null;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("documents")
    .select("*, dossiers(reference), clients(name)")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (kind) query = query.eq("kind", kind);
  if (visibility) query = query.eq("visible_client", visibility === "client");
  if (q) {
    const { data: matching } = await supabase
      .from("dossiers")
      .select("id")
      .ilike("reference", likePattern(q))
      .limit(50);
    query = query.in(
      "dossier_id",
      (matching ?? []).map((d) => d.id),
    );
  }
  const { data: documents, error } = await query;

  return (
    <>
      <PageHeader
        title="Documents"
        description="Fichiers des dossiers, en stockage privé : chaque téléchargement passe par un lien qui expire."
      />

      <form role="search" className="mb-4 flex flex-col gap-2 sm:flex-row" action="/documents">
        <label htmlFor="q" className="sr-only">
          Référence du dossier
        </label>
        <Input id="q" name="q" defaultValue={rawQ} placeholder="Référence du dossier" className="sm:max-w-56" />
        <label htmlFor="type" className="sr-only">
          Type de document
        </label>
        <Select id="type" name="type" defaultValue={kind ?? ""} className="sm:max-w-56">
          <option value="">Tous les types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <label htmlFor="visibilite" className="sr-only">
          Visibilité
        </label>
        <Select id="visibilite" name="visibilite" defaultValue={visibility ?? ""} className="sm:max-w-48">
          <option value="">Toute visibilité</option>
          <option value="client">Visibles du client</option>
          <option value="interne">Internes</option>
        </Select>
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Filtrer
        </Button>
      </form>

      {error ? (
        <Alert tone="danger">Les documents n’ont pas pu être chargés. Rechargez la page.</Alert>
      ) : !documents?.length ? (
        <EmptyState title="Aucun document" icon={FileText}>
          {kind || q || visibility
            ? "Modifiez les filtres."
            : "Les documents s’ajoutent depuis la fiche de chaque dossier."}
        </EmptyState>
      ) : (
        <Table caption="Documents">
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Dossier</Th>
              <Th className="hidden md:table-cell">Ajouté le</Th>
              <Th>Client</Th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <Td>
                  <a
                    href={`/documents/${d.id}`}
                    className="text-primary font-medium underline-offset-2 hover:underline"
                  >
                    {DOCUMENT_KIND_LABELS[d.kind]}
                    {d.version > 1 && ` (v${d.version})`}
                  </a>
                  <p className="text-muted text-xs break-all">{d.file_name}</p>
                </Td>
                <Td>
                  {d.dossier_id ? (
                    <Link
                      href={`/dossiers/${d.dossier_id}` as Route}
                      className="text-primary whitespace-nowrap underline"
                    >
                      {d.dossiers?.reference}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <p className="text-muted text-xs">{d.clients?.name}</p>
                </Td>
                <Td className="hidden md:table-cell">{formatDateTime(d.uploaded_at)}</Td>
                <Td>
                  {canEdit ? (
                    <VisibilityToggle
                      documentId={d.id}
                      visible={d.visible_client}
                      label={DOCUMENT_KIND_LABELS[d.kind]}
                    />
                  ) : d.visible_client ? (
                    <Badge tone="info">Visible</Badge>
                  ) : (
                    <Badge>Interne</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
