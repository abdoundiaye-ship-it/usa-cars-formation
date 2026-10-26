import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StageBanner } from "@/components/stage-banner";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { DOCUMENT_KIND_LABELS, STAGE_LABELS, UNCLAIMED_LETTER_LABELS } from "@/lib/dossiers/labels";
import {
  ACCOUNT_KIND_LABELS,
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_STATUS_LABELS,
  FINANCIAL_DOC_TYPE_LABELS,
  FINANCIAL_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
} from "@/lib/finance/labels";
import { formatDate, formatDateTime, formatUsd, formatXof } from "@/lib/format";
import { usdCentsToXof } from "@/lib/money/fx";
import { nextClientAction } from "@/lib/portal";
import { clientDossierState } from "@/lib/server/portal-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arrivalLabel, trackingLink } from "@/lib/tracking";
import { CLAIM_STATUS_LABELS, claimStatusTone, deadlineLabel } from "@/lib/claims";
import { ExtraCostDecisionForm, FileClaimPortalForm, QuoteDecisionForm } from "../../portal-forms";

export const metadata: Metadata = { title: "Mon dossier" };

const documentHref = (id: string) => `/espace/documents/${id}` as Route;

/**
 * Portail — dossier (US-4.2 à US-4.4, docs/14) : étapes, devis à accepter, factures, paiements, solde en USD et
 * FCFA, documents visibles, frais à approuver, suivi maritime, instructions de paiement. Uniquement les données
 * que la RLS laisse au client : jamais de coût interne ni de marge (CLAUDE.md règle 2).
 */
export default async function EspaceDossierPage({ params }: PageProps<"/espace/dossiers/[id]">) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: dossier } = await supabase
    .from("dossiers")
    .select("id, reference, stage, status, make, model, model_year, vin, lot_number, collected_at")
    .eq("id", id)
    .maybeSingle();
  if (!dossier) notFound();

  const [
    { data: statuses },
    { data: events },
    { data: financial },
    { data: payments },
    { data: adjustments },
    { data: documents },
    { data: assignment },
    { data: accounts },
    { data: balanceRows },
    { data: rateRows },
    state,
    { data: letters },
    { data: claims },
    { data: claimPhotos },
  ] = await Promise.all([
    supabase.from("workflow_statuses").select("stage, code, label"),
    supabase
      .from("dossier_events")
      .select("id, occurred_at, label")
      .eq("dossier_id", id)
      .eq("visible_client", true)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("financial_documents")
      .select("*")
      .eq("dossier_id", id)
      .neq("status", "cancelled")
      .order("issued_at", { ascending: false }),
    supabase.from("payments").select("*").eq("dossier_id", id).is("cancelled_at", null).order("credited_at"),
    supabase.from("adjustments").select("*").eq("dossier_id", id).order("created_at"),
    supabase
      .from("documents")
      .select("id, kind, file_name, uploaded_at, sha256")
      .eq("dossier_id", id)
      .eq("visible_client", true)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("dossier_containers")
      .select(
        "containers(id, number, bl_number, vessel, voyage, eta, ata, carriers(name, tracking_url, url_template, link_type))",
      )
      .eq("dossier_id", id)
      .is("removed_at", null)
      .maybeSingle(),
    supabase.from("official_accounts").select("*").eq("status", "active").order("kind"),
    supabase.rpc("dossier_balance", { p_dossier_id: id }),
    supabase.rpc("portal_fx_rate"),
    clientDossierState(id),
    // US-5.3 : courriers envoyés (relance, mise en demeure), visibles une fois l'envoi enregistré (U4, RLS).
    supabase
      .from("unclaimed_letters")
      .select("id, kind, number, sent_at, cure_deadline, document_id")
      .eq("dossier_id", id)
      .eq("status", "sent")
      .order("sent_at"),
    // Lot 6d : réclamations du client (les siennes, RLS) et leurs photos.
    supabase.from("claims_overview").select("*").eq("dossier_id", id).order("filed_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id, claim_id, file_name")
      .eq("dossier_id", id)
      .not("claim_id", "is", null)
      .eq("visible_client", true),
  ]);

  const now = new Date();
  const action = nextClientAction(state, now);
  const status = statuses?.find((s) => s.stage === dossier.stage && s.code === dossier.status)?.label ?? dossier.status;
  const vehicle = [dossier.make, dossier.model, dossier.model_year].filter(Boolean).join(" ") || "Véhicule à préciser";
  const balance = balanceRows?.[0];
  const rate = rateRows?.[0];
  const xof = (cents: number) => (rate ? formatXof(usdCentsToXof(Math.max(cents, 0), String(rate.rate))) : null);
  const quote = (financial ?? []).find(
    (f) =>
      f.doc_type === "quote" &&
      f.status === "issued" &&
      f.document_id &&
      f.document_sha256 &&
      f.valid_until &&
      new Date(f.valid_until) > now,
  );
  const pendingExtras = (adjustments ?? []).filter((a) => a.status === "pending_client_approval");
  const shaOf = (documentId: string | null) => documents?.find((d) => d.id === documentId)?.sha256 ?? null;
  const container = assignment?.containers ?? null;
  const link = container?.carriers ? trackingLink(container.carriers, container) : null;

  return (
    <>
      <PageHeader title={vehicle} description={`Dossier ${dossier.reference}`}>
        <Link href="/espace" className="text-primary text-sm font-medium underline">
          ← Mes dossiers
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-3">
          <StageBanner stage={dossier.stage} />
          <p className="text-sm">
            Étape <strong>{STAGE_LABELS[dossier.stage]}</strong> · <Badge tone="info">{status}</Badge>
          </p>
          <Alert
            tone={action.kind === "none" ? "info" : action.kind === "payment" && action.overdue ? "danger" : "warning"}
          >
            {action.label}
            {action.kind === "payment" && (
              <>
                {" "}
                : {formatUsd(action.amountCents)}
                {action.dueAt && ` avant le ${formatDateTime(action.dueAt)}`}
              </>
            )}
          </Alert>
        </Card>

        {(letters?.length ?? 0) > 0 && (
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">Courriers de USA CARS</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {letters!.map((l) => (
                <li key={l.id} className="flex flex-col gap-1">
                  <span>
                    <strong>{UNCLAIMED_LETTER_LABELS[l.kind]}</strong> n° {l.number}
                    {l.sent_at && ` adressée le ${formatDate(l.sent_at)}`}
                    {l.cure_deadline && ` : régularisation attendue au plus tard le ${formatDate(l.cure_deadline)}`}
                  </span>
                  {l.document_id && (
                    <a href={documentHref(l.document_id)} className="text-primary w-fit underline">
                      Lire le courrier (Word)
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-muted text-xs">
              Pour régulariser ou pour toute question, contactez USA CARS au numéro officiel indiqué dans les
              instructions de paiement.
            </p>
          </Card>
        )}

        {quote && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Votre devis {quote.number}</h2>
            <Table caption={`Devis ${quote.number}`}>
              <tbody>
                <tr>
                  <Td>A — Coût total d’acquisition du véhicule (forfait)</Td>
                  <Td className="amount text-right">{formatUsd(quote.forfait_a_cents ?? 0)}</Td>
                </tr>
                <tr>
                  <Td>B — Logistique et transport maritime vers Dakar (forfait)</Td>
                  <Td className="amount text-right">{formatUsd(quote.forfait_b_cents ?? 0)}</Td>
                </tr>
                <tr>
                  <Td>C — Assurance transport maritime (option)</Td>
                  <Td className="amount text-right">{formatUsd(quote.insurance_premium_cents)}</Td>
                </tr>
                <tr>
                  <Td>Total hors assurance (TVA comprise le cas échéant)</Td>
                  <Td className="amount text-right font-medium">{formatUsd(quote.total_cents)}</Td>
                </tr>
              </tbody>
            </Table>
            <p className="text-muted text-sm">
              Valable jusqu’au {formatDateTime(quote.valid_until!)} · taux de référence 1 $US ={" "}
              {String(quote.fx_rate).replace(".", ",")} FCFA ({quote.fx_source}).{" "}
              <a href={documentHref(quote.document_id!)} className="text-primary underline">
                Télécharger le devis (Word)
              </a>
            </p>
            <QuoteDecisionForm
              dossierId={dossier.id}
              quoteId={quote.id}
              sha256={quote.document_sha256!}
              insurancePremium={formatUsd(quote.insurance_premium_cents)}
            />
          </Card>
        )}

        {pendingExtras.map((a) => {
          const sha = shaOf(a.proof_document_id);
          return (
            <Card key={a.id} className="flex flex-col gap-3">
              <h2 className="font-semibold">Frais supplémentaires à approuver</h2>
              <p className="text-sm">
                {a.label} : <span className="amount font-medium">{formatUsd(a.amount_cents)}</span>
              </p>
              {a.proof_document_id && (
                <a href={documentHref(a.proof_document_id)} className="text-primary text-sm underline">
                  Consulter le justificatif
                </a>
              )}
              {sha && <ExtraCostDecisionForm dossierId={dossier.id} adjustmentId={a.id} sha256={sha} />}
            </Card>
          );
        })}

        {balance?.has_accepted_quote && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Montants</h2>
            <Table caption="Situation du dossier">
              <tbody>
                <tr>
                  <Td>Total dû</Td>
                  <Td className="amount text-right">{formatUsd(balance.total_due_cents)}</Td>
                </tr>
                <tr>
                  <Td>Déjà payé</Td>
                  <Td className="amount text-right">{formatUsd(balance.net_paid_cents)}</Td>
                </tr>
                <tr>
                  <Td>
                    {balance.balance_remaining_cents < 0 ? "Trop-perçu, qui vous sera restitué" : "Reste à payer"}
                    {rate && (
                      <p className="text-muted text-xs">
                        FCFA indicatif au taux du {formatDate(rate.captured_at)} ({rate.source}), réactualisé au
                        paiement
                      </p>
                    )}
                  </Td>
                  <Td className="amount text-right font-medium">
                    {formatUsd(Math.abs(balance.balance_remaining_cents))}
                    {balance.balance_remaining_cents > 0 && xof(balance.balance_remaining_cents) && (
                      <p className="text-muted text-xs">{xof(balance.balance_remaining_cents)}</p>
                    )}
                  </Td>
                </tr>
              </tbody>
            </Table>
            <h3 className="font-medium">Devis et factures</h3>
            <ul className="flex flex-col gap-2 text-sm">
              {(financial ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {FINANCIAL_DOC_TYPE_LABELS[f.doc_type]} {f.number}
                  </span>
                  <Badge tone={f.status === "paid" || f.status === "accepted" ? "success" : "neutral"}>
                    {FINANCIAL_STATUS_LABELS[f.status]}
                  </Badge>
                  {f.due_at && f.status === "issued" && <span>· échéance {formatDateTime(f.due_at)}</span>}
                  {f.document_id && (
                    <a href={documentHref(f.document_id)} className="text-primary underline">
                      Télécharger
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {(payments?.length ?? 0) > 0 && (
              <>
                <h3 className="font-medium">Paiements reçus</h3>
                <Table caption="Paiements reçus">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Mode</Th>
                      <Th className="text-right">Montant</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments!.map((p) => (
                      <tr key={p.id}>
                        <Td>{formatDate(p.credited_at)}</Td>
                        <Td>{PAYMENT_MODE_LABELS[p.mode]}</Td>
                        <Td className="amount text-right">{formatUsd(p.amount_cents)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
            {(adjustments ?? []).some((a) => a.status === "approved") && (
              <>
                <h3 className="font-medium">Ajustements (ligne D)</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {adjustments!
                    .filter((a) => a.status === "approved")
                    .map((a) => (
                      <li key={a.id}>
                        {ADJUSTMENT_KIND_LABELS[a.kind]} — {a.label} :{" "}
                        <span className="amount">{formatUsd(a.amount_cents)}</span>{" "}
                        <span className="text-muted">({ADJUSTMENT_STATUS_LABELS[a.status].toLowerCase()})</span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Suivi maritime</h2>
          {container ? (
            <>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Transporteur</dt>
                  <dd>{container.carriers?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Conteneur</dt>
                  <dd className="font-mono">{container.number}</dd>
                </div>
                <div>
                  <dt className="text-muted">B/L</dt>
                  <dd>{container.bl_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Navire / voyage</dt>
                  <dd>{[container.vessel, container.voyage].filter(Boolean).join(" / ") || "—"}</dd>
                </div>
              </dl>
              <p className="text-sm font-medium">{arrivalLabel(container)}</p>
              {link && (
                <p className="text-sm">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Suivre sur le site {link.thirdParty ? "du service de suivi" : "du transporteur"}
                  </a>
                  {link.referenceToEnter && ` (référence à saisir : ${link.referenceToEnter})`}
                </p>
              )}
              <p className="text-muted text-xs">
                L’ETA est communiquée par le transporteur et reste indicative ; ce suivi n’est pas une position GPS.
              </p>
            </>
          ) : (
            <EmptyState title="Pas encore de conteneur">
              Le suivi maritime s’affiche dès que votre véhicule est chargé en conteneur.
            </EmptyState>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Documents</h2>
          {!documents?.length ? (
            <EmptyState title="Aucun document pour le moment" />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <a href={documentHref(d.id)} className="text-primary underline">
                    {DOCUMENT_KIND_LABELS[d.kind]}
                  </a>
                  <span className="text-muted text-xs">
                    {d.file_name} · {formatDate(d.uploaded_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(dossier.collected_at !== null || (claims?.length ?? 0) > 0) && (
          <Card className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">Réclamations</h2>
              <p className="text-muted mt-1 text-sm">
                Un problème constaté à l’enlèvement du véhicule ? Signalez-le rapidement (contrat art. 19). Vous pouvez
                joindre une photo.
              </p>
            </div>
            {(claims?.length ?? 0) > 0 && (
              <ul className="flex flex-col gap-3">
                {claims!.map((c) => {
                  const cp = (claimPhotos ?? []).filter((p) => p.claim_id === c.id);
                  return (
                    <li key={c.id} className="border-border rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={claimStatusTone(c.status)}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                        <Badge tone={c.out_of_time ? "danger" : "success"}>{deadlineLabel(c.out_of_time)}</Badge>
                        <span className="text-muted text-xs">Déposée le {formatDate(c.filed_at)}</span>
                      </div>
                      <p className="mt-2 text-sm whitespace-pre-line">{c.reserves}</p>
                      {cp.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                          {cp.map((p) => (
                            <li key={p.id}>
                              <a href={documentHref(p.id)} className="text-primary underline underline-offset-2">
                                {p.file_name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      {c.response && (
                        <div className="bg-background mt-2 rounded-md p-3 text-sm">
                          <p className="text-muted text-xs">Réponse de USA CARS</p>
                          <p className="mt-1 whitespace-pre-line">{c.response}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {dossier.collected_at !== null && (
              <div className="border-border border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">Nouvelle réclamation</h3>
                <FileClaimPortalForm dossierId={dossier.id} />
              </div>
            )}
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Instructions de paiement</h2>
          {!accounts?.length ? (
            <p className="text-sm">Contactez USA CARS au numéro officiel pour connaître les modalités de paiement.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {accounts.map((a) => (
                <li key={a.id}>
                  <p className="font-medium">{ACCOUNT_KIND_LABELS[a.kind]}</p>
                  <p>
                    Titulaire : {a.holder_name}
                    {a.bank_name && ` · Banque : ${a.bank_name}`}
                    {(a.iban ?? a.account_number) && ` · RIB / IBAN : ${a.iban ?? a.account_number}`}
                    {a.phone && ` · Numéro : ${a.phone}`}
                  </p>
                  {a.instructions && <p className="text-muted text-xs">{a.instructions}</p>}
                </li>
              ))}
            </ul>
          )}
          <Alert tone="warning">
            Référence à indiquer : dossier {dossier.reference}. Paiements acceptés uniquement sur ces comptes. USA CARS
            ne communique jamais un changement de compte par WhatsApp ou par simple message : en cas de doute, appelez
            le numéro officiel.
          </Alert>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Chronologie</h2>
          {!events?.length ? (
            <EmptyState title="Aucun événement" />
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="border-border border-l-2 pl-3 text-sm">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-muted text-xs">{formatDateTime(e.occurred_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
