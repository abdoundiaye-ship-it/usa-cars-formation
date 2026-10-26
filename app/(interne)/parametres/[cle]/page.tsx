import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import { groupLabel, settingLabel } from "@/lib/settings/labels";
import { formatSettingValue, settingValueToInput } from "@/lib/settings/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingForm } from "../setting-form";

type Version = { effective_from: string };

/** Version en vigueur (la plus récente déjà effective) et versions programmées. */
function classifyVersions<T extends Version>(versions: T[]): { current: T; future: Set<T> } {
  const now = Date.now();
  const future = new Set(versions.filter((v) => new Date(v.effective_from).getTime() > now));
  const current = versions.find((v) => !future.has(v)) ?? versions[versions.length - 1]!;
  return { current, future };
}

export async function generateMetadata({ params }: PageProps<"/parametres/[cle]">): Promise<Metadata> {
  const { cle } = await params;
  return { title: settingLabel(decodeURIComponent(cle)) };
}

export default async function ParametrePage({ params }: PageProps<"/parametres/[cle]">) {
  const access = await requireInternal(SCREEN_ROLES.settings);
  const key = decodeURIComponent((await params).cle);

  const supabase = await createSupabaseServerClient();
  const { data: versions, error } = await supabase
    .from("settings")
    .select("*")
    .eq("key", key)
    .order("effective_from", { ascending: false });
  if (error) {
    return <Alert tone="danger">Le paramètre n’a pas pu être chargé. Rechargez la page.</Alert>;
  }
  if (!versions?.length) notFound();

  const { current, future: futureVersions } = classifyVersions(versions);

  // Noms des auteurs : visibles pour les rôles qui lisent les profils (admin, direction).
  const authorIds = [...new Set(versions.map((v) => v.created_by).filter((id): id is string => !!id))];
  const authors = new Map<string, string>();
  if (authorIds.length && canAccess(access.role, SCREEN_ROLES.users)) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
    for (const p of data ?? []) authors.set(p.id, p.full_name);
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/parametres" className="text-primary underline underline-offset-2">
          ← Paramètres
        </Link>
      </p>
      <PageHeader title={settingLabel(key)} description={`${groupLabel(key)} · ${key}`} />

      <Card className="mb-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Valeur en vigueur</dt>
            <dd className="amount text-lg font-semibold">{formatSettingValue(current.value_type, current.value)}</dd>
          </div>
          <div>
            <dt className="text-muted">Statut</dt>
            <dd>
              {current.status === "a_confirmer" ? (
                <Badge tone="warning">À confirmer</Badge>
              ) : (
                <Badge tone="success">Confirmé</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Source</dt>
            <dd>{current.source ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      {access.role === "admin" && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">Nouvelle version</h2>
          <SettingForm
            settingKey={key}
            valueType={current.value_type}
            currentInput={settingValueToInput(current.value_type, current.value)}
            currentStatus={current.status}
          />
        </Card>
      )}

      <h2 className="mb-2 font-semibold">Historique des versions</h2>
      <Table caption={`Historique de ${settingLabel(key)}`}>
        <thead>
          <tr>
            <Th>Date d’effet</Th>
            <Th>Valeur</Th>
            <Th>Statut</Th>
            <Th>Motif / source</Th>
            <Th>Auteur</Th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const future = futureVersions.has(v);
            return (
              <tr key={v.effective_from}>
                <Td className="whitespace-nowrap">
                  {formatDateTime(v.effective_from)}
                  {future && (
                    <Badge tone="info" className="ml-2">
                      Programmée
                    </Badge>
                  )}
                  {v === current && (
                    <Badge tone="success" className="ml-2">
                      En vigueur
                    </Badge>
                  )}
                </Td>
                <Td className="amount">{formatSettingValue(v.value_type, v.value)}</Td>
                <Td>{v.status === "a_confirmer" ? "À confirmer" : "Confirmé"}</Td>
                <Td>{v.reason ?? v.source ?? "—"}</Td>
                <Td>{v.created_by ? (authors.get(v.created_by) ?? "Utilisateur interne") : "Chargement initial"}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
