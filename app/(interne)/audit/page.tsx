import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { ACTION_LABELS, actionLabel, describeChanges, OBJECT_LABELS, objectLabel } from "@/lib/audit/format";
import { requireInternal } from "@/lib/auth/access";
import { ROLE_LABELS, SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import { settingLabel } from "@/lib/settings/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Journal d’audit" };

const PAGE_SIZE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireInternal(SCREEN_ROLES.audit);
  const sp = await searchParams;
  const filters = {
    objet: param(sp.objet),
    action: param(sp.action),
    auteur: param(sp.auteur),
    du: DATE_RE.test(param(sp.du)) ? param(sp.du) : "",
    au: DATE_RE.test(param(sp.au)) ? param(sp.au) : "",
    recherche: param(sp.recherche)
      .replace(/[^\p{L}\p{N}@._\- ]/gu, "")
      .slice(0, 80),
  };
  const page = Math.max(1, Number.parseInt(param(sp.page), 10) || 1);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.objet) query = query.eq("object_type", filters.objet);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.auteur) query = query.eq("actor_id", filters.auteur);
  if (filters.du) query = query.gte("at", `${filters.du}T00:00:00Z`);
  if (filters.au) query = query.lte("at", `${filters.au}T23:59:59.999Z`);
  if (filters.recherche) query = query.ilike("object_id", `%${filters.recherche}%`);

  const [{ data: entries, count, error }, { data: people }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const pageHref = (target: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    params.set("page", String(target));
    return `/audit?${params.toString()}` as Route;
  };

  return (
    <>
      <PageHeader title="Journal d’audit" description="Qui a fait quoi, quand, avec les valeurs avant et après." />

      <form
        method="get"
        className="border-border bg-card mb-6 grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <label className="flex flex-col gap-1 text-sm">
          Objet
          <Select name="objet" defaultValue={filters.objet}>
            <option value="">Tous</option>
            {Object.entries(OBJECT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Action
          <Select name="action" defaultValue={filters.action}>
            <option value="">Toutes</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Auteur
          <Select name="auteur" defaultValue={filters.auteur}>
            <option value="">Tous</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Du
          <Input type="date" name="du" defaultValue={filters.du} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Au
          <Input type="date" name="au" defaultValue={filters.au} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Référence de l’objet
          <Input name="recherche" defaultValue={filters.recherche} placeholder="ex. quote.validity_hours" />
        </label>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <Button type="submit">Filtrer</Button>
          <Link
            href="/audit"
            className="text-primary inline-flex min-h-10 items-center px-3 text-sm underline underline-offset-2"
          >
            Réinitialiser
          </Link>
        </div>
      </form>

      {error ? (
        <Alert tone="danger">Le journal n’a pas pu être chargé. Rechargez la page.</Alert>
      ) : !entries?.length ? (
        <EmptyState title="Aucune entrée">Aucune action ne correspond à ces filtres.</EmptyState>
      ) : (
        <>
          <p className="text-muted mb-2 text-sm">
            {count} entrée{(count ?? 0) > 1 ? "s" : ""} · page {page} sur {pages}
          </p>
          <Table caption="Entrées du journal d’audit">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Auteur</Th>
                <Th>Action</Th>
                <Th>Objet</Th>
                <Th>Détail</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const changes = describeChanges(e.before, e.after);
                const objectName =
                  e.object_type === "profiles"
                    ? (names.get(e.object_id) ?? e.object_id)
                    : e.object_type === "settings"
                      ? settingLabel(e.object_id)
                      : e.object_id;
                return (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(e.at)}</Td>
                    <Td>
                      <p>
                        {e.actor_id ? (names.get(e.actor_id) ?? "Utilisateur supprimé") : (e.actor_label ?? "Système")}
                      </p>
                      {e.actor_role && <p className="text-muted text-xs">{ROLE_LABELS[e.actor_role]}</p>}
                    </Td>
                    <Td>{actionLabel(e.action)}</Td>
                    <Td>
                      <p>{objectLabel(e.object_type)}</p>
                      <p className="text-muted text-xs break-all">{objectName}</p>
                    </Td>
                    <Td>
                      {changes.length === 0 && !e.reason ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs">
                          {changes.map((c) => (
                            <li key={c.field}>
                              <span className="font-medium">{c.label} :</span>{" "}
                              {c.before !== undefined && c.after !== undefined ? (
                                <>
                                  {c.before} → {c.after}
                                </>
                              ) : (
                                (c.after ?? c.before)
                              )}
                            </li>
                          ))}
                          {e.reason && (
                            <li>
                              <span className="font-medium">Motif :</span> {e.reason}
                            </li>
                          )}
                        </ul>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-4 flex justify-between text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="text-primary underline underline-offset-2">
                  ← Plus récentes
                </Link>
              ) : (
                <span />
              )}
              {page < pages && (
                <Link href={pageHref(page + 1)} className="text-primary underline underline-offset-2">
                  Plus anciennes →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
