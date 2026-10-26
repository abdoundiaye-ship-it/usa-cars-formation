import type { Metadata, Route } from "next";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { REFUND_REASON_LABELS, REFUND_STATUS_LABELS } from "@/lib/finance/labels";
import { nextDue } from "@/lib/finance/overview";
import { formatDateTime, formatUsd, formatXof } from "@/lib/format";
import { usdCentsToXof } from "@/lib/money/fx";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FxRateForm } from "./fx-form";

export const metadata: Metadata = { title: "Finances" };

const dossierHref = (id: string) => `/dossiers/${id}` as Route;

/**
 * Écran Finances : taux de change (US-3.5, R1), soldes et échéances des dossiers (R4), éléments à traiter
 * (remboursements C9, frais de retard C5, accords de frais R7, devis expirés). Aucun coût interne (règle 2).
 */
export default async function FinancesPage() {
  const access = await requireInternal(SCREEN_ROLES.finances);
  const canWrite = canAccess(access.role, SCREEN_ROLES.fxWrite);
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC
  const [
    { data: rates, error },
    { data: hasToday },
    { data: sourceSetting },
    { data: staff },
    { data: overview, error: overviewError },
    { data: openRefunds },
  ] = await Promise.all([
    supabase.from("fx_rates").select("*").order("captured_at", { ascending: false }).limit(60),
    supabase.rpc("fx_rate_exists_on", { p_day: today }),
    supabase.from("settings_current").select("value").eq("key", "fx.source").maybeSingle(),
    supabase.from("staff_directory").select("id, full_name"),
    supabase.rpc("finance_overview"),
    supabase.from("refunds").select("*").in("status", ["requested", "approved"]).order("due_by"),
  ]);
  const current = rates?.[0];
  const now = new Date();
  const rows = (overview ?? []).filter((r) => r.has_accepted_quote);
  const referenceOf = (dossierId: string) => overview?.find((r) => r.dossier_id === dossierId)?.reference ?? "Dossier";
  const toProcess = (overview ?? []).filter(
    (r) => r.proposed_late_fees > 0 || r.pending_client_extra_costs > 0 || r.quote_expired,
  );
  const xof = (cents: number) => (current ? formatXof(usdCentsToXof(cents, String(current.rate))) : "—");
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.full_name ?? "—";
  const defaultSource = typeof sourceSetting?.value === "string" ? sourceSetting.value : "XE.com";

  return (
    <>
      <PageHeader
        title="Finances"
        description="Taux de change USD → FCFA : le devis fige le taux du jour de son émission ; chaque paiement prend le taux du jour du paiement (R1)."
      />
      <div className="flex flex-col gap-6">
        {!hasToday && (
          <Alert tone="warning">
            Aucun taux relevé aujourd’hui : enregistrez-le avant de saisir un paiement ou d’émettre un devis.
          </Alert>
        )}

        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Taux en vigueur</h2>
          {current ? (
            <>
              <p className="amount text-2xl font-semibold">
                1 $US = {current.rate.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}{" "}
                FCFA
              </p>
              <p className="text-muted text-sm">
                {current.source} · relevé le {formatDateTime(current.captured_at)} · exemple : 10 000 $US ={" "}
                {formatXof(usdCentsToXof(1_000_000, String(current.rate)))}
              </p>
            </>
          ) : (
            <EmptyState title="Aucun taux enregistré" />
          )}
        </Card>

        {canWrite && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Relever le taux du jour</h2>
            <FxRateForm defaultSource={defaultSource} now={new Date().toISOString().slice(0, 16)} />
          </Card>
        )}

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">À traiter</h2>
          {(openRefunds?.length ?? 0) === 0 && toProcess.length === 0 ? (
            <EmptyState title="Rien à traiter">
              Remboursements, frais de retard et accords de frais sont à jour.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {(openRefunds ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={new Date(r.due_by) < now ? "danger" : "warning"}>{REFUND_STATUS_LABELS[r.status]}</Badge>
                  <Link href={dossierHref(r.dossier_id)} className="text-primary underline">
                    {referenceOf(r.dossier_id)}
                  </Link>
                  <span>
                    {REFUND_REASON_LABELS[r.reason]} : <span className="amount">{formatUsd(r.amount_cents)}</span>, à
                    rembourser avant le {formatDateTime(r.due_by)}
                  </span>
                </li>
              ))}
              {toProcess.map((r) => (
                <li key={r.dossier_id} className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">À faire</Badge>
                  <Link href={dossierHref(r.dossier_id)} className="text-primary underline">
                    {r.reference}
                  </Link>
                  <span>
                    {[
                      r.proposed_late_fees > 0 && `${r.proposed_late_fees} frais de retard à valider`,
                      r.pending_client_extra_costs > 0 && "frais supplémentaires en attente de l’accord du client",
                      r.quote_expired && "devis expiré : un nouveau devis est à émettre",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Soldes des dossiers</h2>
          {overviewError ? (
            <Alert tone="danger">Les soldes n’ont pas pu être chargés. Rechargez la page.</Alert>
          ) : rows.length === 0 ? (
            <EmptyState title="Aucun dossier facturé">Les soldes apparaissent après l’acceptation du devis.</EmptyState>
          ) : (
            <Table caption="Soldes des dossiers (FCFA indicatif au taux en vigueur)">
              <thead>
                <tr>
                  <Th>Dossier</Th>
                  <Th className="text-right">Reste dû</Th>
                  <Th className="hidden sm:table-cell">Prochaine échéance</Th>
                  <Th className="hidden md:table-cell">Documents</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const due = nextDue(r, now);
                  return (
                    <tr key={r.dossier_id}>
                      <Td>
                        <Link href={dossierHref(r.dossier_id)} className="text-primary underline">
                          {r.reference}
                        </Link>
                        <p className="text-muted text-xs">{r.client_name}</p>
                      </Td>
                      <Td className="amount text-right">
                        {r.balance_remaining_cents < 0 ? (
                          <>
                            Trop-perçu {formatUsd(-r.balance_remaining_cents)}
                            <p className="text-muted text-xs">à restituer</p>
                          </>
                        ) : (
                          <>
                            {formatUsd(r.balance_remaining_cents)}
                            <p className="text-muted text-xs">{xof(r.balance_remaining_cents)}</p>
                          </>
                        )}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        {due ? (
                          <>
                            {due.kind === "payment1" ? "Paiement 1" : "Solde"} :{" "}
                            <span className="amount">{formatUsd(due.remainingCents)}</span>
                            <p className="text-xs">
                              {due.dueAt ? formatDateTime(due.dueAt) : "facture de solde à émettre"}{" "}
                              {due.overdue && <Badge tone="danger">En retard</Badge>}
                            </p>
                          </>
                        ) : (
                          "Réglé"
                        )}
                      </Td>
                      <Td className="hidden md:table-cell">
                        {r.documents_released ? (
                          "Remis"
                        ) : r.ownership_transferred_at ? (
                          <Badge tone={r.release_due_at && new Date(r.release_due_at) < now ? "danger" : "warning"}>
                            À remettre
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Historique des taux</h2>
          {error ? (
            <Alert tone="danger">L’historique n’a pas pu être chargé. Rechargez la page.</Alert>
          ) : !rates?.length ? (
            <EmptyState title="Aucun relevé" />
          ) : (
            <Table caption="Historique des taux de change">
              <thead>
                <tr>
                  <Th>Relevé le</Th>
                  <Th>Taux</Th>
                  <Th className="hidden sm:table-cell">Source</Th>
                  <Th className="hidden md:table-cell">Saisi par</Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(r.captured_at)}</Td>
                    <Td className="amount">
                      {r.rate.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </Td>
                    <Td className="hidden sm:table-cell">{r.source}</Td>
                    <Td className="hidden md:table-cell">{staffName(r.created_by)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
