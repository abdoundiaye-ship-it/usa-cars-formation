import type { Metadata, Route } from "next";
import Link from "next/link";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";
import { groupLabel, settingLabel } from "@/lib/settings/labels";
import { formatSettingValue } from "@/lib/settings/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Paramètres contractuels" };

export default async function ParametresPage() {
  const access = await requireInternal(SCREEN_ROLES.settings);
  const isAdmin = access.role === "admin";

  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase.from("settings_current").select("*").order("key");

  const groups = new Map<string, NonNullable<typeof settings>>();
  for (const s of settings ?? []) {
    const label = groupLabel(s.key);
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  const toConfirm = (settings ?? []).filter((s) => s.status === "a_confirmer").length;

  return (
    <>
      <PageHeader
        title="Paramètres contractuels"
        description={
          isAdmin
            ? "Valeurs appliquées par l’application (délais, montants, seuils). Une modification crée une nouvelle version datée, appliquée aux dossiers ouverts à partir de sa date d’effet."
            : "Valeurs appliquées par l’application (consultation)."
        }
      >
        <div className="flex flex-col gap-1 sm:items-end">
          <Link href="/parametres/transporteurs" className="text-primary text-sm font-medium underline">
            Transporteurs et liens de suivi →
          </Link>
          <Link href="/parametres/comptes-officiels" className="text-primary text-sm font-medium underline">
            Comptes officiels de paiement →
          </Link>
          <Link href="/parametres/jours-feries" className="text-primary text-sm font-medium underline">
            Jours fériés (jours ouvrés) →
          </Link>
        </div>
      </PageHeader>

      {toConfirm > 0 && (
        <Alert tone="warning" className="mb-6">
          {toConfirm} paramètre{toConfirm > 1 ? "s sont" : " est"} encore à confirmer : valeurs provisoires à valider
          avant la mise en production.
        </Alert>
      )}

      {error ? (
        <Alert tone="danger">Les paramètres n’ont pas pu être chargés. Rechargez la page.</Alert>
      ) : groups.size === 0 ? (
        <EmptyState title="Aucun paramètre">Le chargement initial n’a pas été appliqué à cette base.</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {[...groups.entries()].map(([group, items]) => (
            <section key={group} aria-labelledby={`groupe-${group}`}>
              <h2 id={`groupe-${group}`} className="mb-2 font-semibold">
                {group}
              </h2>
              <Table caption={group}>
                <thead>
                  <tr>
                    <Th>Paramètre</Th>
                    <Th>Valeur</Th>
                    <Th>Statut</Th>
                    <Th className="hidden sm:table-cell">En vigueur depuis</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.key}>
                      <Td>
                        <Link
                          href={`/parametres/${encodeURIComponent(s.key)}` as Route}
                          className="text-primary font-medium underline-offset-2 hover:underline"
                        >
                          {settingLabel(s.key)}
                        </Link>
                        <p className="text-muted font-mono text-xs break-all">{s.key}</p>
                      </Td>
                      <Td className="amount">{formatSettingValue(s.value_type, s.value)}</Td>
                      <Td>
                        {s.status === "a_confirmer" ? (
                          <Badge tone="warning">À confirmer</Badge>
                        ) : (
                          <Badge tone="success">Confirmé</Badge>
                        )}
                      </Td>
                      <Td className="hidden sm:table-cell">{formatDate(s.effective_from)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
