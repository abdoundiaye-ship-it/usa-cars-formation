import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { ACCOUNT_KIND_LABELS } from "@/lib/finance/labels";
import { formatDateTime } from "@/lib/format";
import type { OfficialAccountRow } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountForm, ApproveAccountForm, DeactivateAccountForm } from "./account-forms";

export const metadata: Metadata = { title: "Comptes officiels" };

function Coordinates({ account }: { account: OfficialAccountRow }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted inline">Titulaire : </dt>
        <dd className="inline">{account.holder_name}</dd>
      </div>
      {account.bank_name && (
        <div>
          <dt className="text-muted inline">Banque : </dt>
          <dd className="inline">{account.bank_name}</dd>
        </div>
      )}
      {account.account_number && (
        <div>
          <dt className="text-muted inline">Compte : </dt>
          <dd className="inline font-mono break-all">{account.account_number}</dd>
        </div>
      )}
      {account.iban && (
        <div>
          <dt className="text-muted inline">IBAN : </dt>
          <dd className="inline font-mono break-all">{account.iban}</dd>
        </div>
      )}
      {account.phone && (
        <div>
          <dt className="text-muted inline">Numéro : </dt>
          <dd className="inline font-mono">{account.phone}</dd>
        </div>
      )}
      {account.instructions && <p className="text-muted sm:col-span-2">{account.instructions}</p>}
    </dl>
  );
}

/** US-3.10 : comptes de paiement officiels (annexe D) ; double validation (décision Q1). */
export default async function ComptesOfficielsPage() {
  const access = await requireInternal(SCREEN_ROLES.settings);
  const canCreate = canAccess(access.role, SCREEN_ROLES.accountsWrite);
  const canApprove = canAccess(access.role, SCREEN_ROLES.accountsApprove);
  const supabase = await createSupabaseServerClient();
  const [{ data: accounts, error }, { data: staff }] = await Promise.all([
    supabase.from("official_accounts").select("*").order("created_at", { ascending: false }),
    supabase.from("staff_directory").select("id, full_name"),
  ]);
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.full_name ?? "—";
  const byStatus = (status: OfficialAccountRow["status"]) => (accounts ?? []).filter((a) => a.status === status);

  return (
    <>
      <PageHeader
        title="Comptes officiels"
        description="Comptes sur lesquels le client paie. Toute création ou modification est activée par une autre personne (administrateur ou direction)."
      >
        <Link href="/parametres" className="text-primary text-sm underline">
          ← Paramètres contractuels
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <Alert tone="info">
          Les coordonnées d’un compte ne se modifient jamais : on crée un compte de remplacement, qui désactive l’ancien
          à son approbation. Aucune notification ne contient de coordonnées nouvelles ou modifiées.
        </Alert>
        {error && <Alert tone="danger">Les comptes n’ont pas pu être chargés. Rechargez la page.</Alert>}

        <section aria-labelledby="pending" className="flex flex-col gap-3">
          <h2 id="pending" className="font-semibold">
            En attente d’approbation
          </h2>
          {byStatus("pending_approval").length === 0 ? (
            <EmptyState title="Aucun compte en attente" />
          ) : (
            byStatus("pending_approval").map((a) => (
              <Card key={a.id} className="flex flex-col gap-3">
                <p className="font-medium">
                  {a.label} <Badge tone="warning">En attente</Badge>{" "}
                  <span className="text-muted text-sm">{ACCOUNT_KIND_LABELS[a.kind]}</span>
                </p>
                <Coordinates account={a} />
                <p className="text-muted text-xs">
                  Créé par {staffName(a.created_by)} le {formatDateTime(a.created_at)}
                  {a.replaces_id && " · remplace un compte actif"}
                </p>
                {canApprove && a.created_by !== access.userId ? (
                  <ApproveAccountForm accountId={a.id} label={a.label} />
                ) : (
                  <p className="text-muted text-sm">
                    {a.created_by === access.userId
                      ? "Vous avez créé ce compte : une autre personne (administrateur ou direction) doit l’approuver."
                      : "Approbation par un administrateur ou la direction."}
                  </p>
                )}
                {canCreate && (
                  <details>
                    <summary className="text-danger cursor-pointer text-sm">Annuler ce compte…</summary>
                    <div className="mt-3">
                      <DeactivateAccountForm accountId={a.id} />
                    </div>
                  </details>
                )}
              </Card>
            ))
          )}
        </section>

        <section aria-labelledby="active" className="flex flex-col gap-3">
          <h2 id="active" className="font-semibold">
            Comptes actifs
          </h2>
          {byStatus("active").length === 0 ? (
            <EmptyState title="Aucun compte actif">
              Les factures ne pourront indiquer aucun compte de paiement.
            </EmptyState>
          ) : (
            byStatus("active").map((a) => (
              <Card key={a.id} className="flex flex-col gap-3">
                <p className="font-medium">
                  {a.label} <Badge tone="success">Actif</Badge>{" "}
                  <span className="text-muted text-sm">{ACCOUNT_KIND_LABELS[a.kind]}</span>
                </p>
                <Coordinates account={a} />
                <p className="text-muted text-xs">
                  Créé par {staffName(a.created_by)}, approuvé par {staffName(a.approved_by)} le{" "}
                  {a.approved_at ? formatDateTime(a.approved_at) : "—"}
                </p>
                {canCreate && (
                  <div className="flex flex-col gap-2">
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">Remplacer ce compte…</summary>
                      <div className="mt-3">
                        <AccountForm replaces={a} />
                      </div>
                    </details>
                    <details>
                      <summary className="text-danger cursor-pointer text-sm">Désactiver ce compte…</summary>
                      <div className="mt-3">
                        <DeactivateAccountForm accountId={a.id} />
                      </div>
                    </details>
                  </div>
                )}
              </Card>
            ))
          )}
        </section>

        {canCreate && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Nouveau compte</h2>
            <AccountForm />
          </Card>
        )}

        {byStatus("inactive").length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Comptes désactivés ({byStatus("inactive").length})
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {byStatus("inactive").map((a) => (
                <li key={a.id}>
                  {a.label} ({ACCOUNT_KIND_LABELS[a.kind]}) — désactivé le{" "}
                  {a.deactivated_at ? formatDateTime(a.deactivated_at) : "—"} : {a.deactivation_reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
