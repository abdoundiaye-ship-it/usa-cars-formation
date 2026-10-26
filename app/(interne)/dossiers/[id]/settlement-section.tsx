import { Alert, Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  REFUND_REASON_LABELS,
  REFUND_STATUS_LABELS,
} from "@/lib/finance/labels";
import { formatDateTime, formatUsd, formatXof } from "@/lib/format";
import { usdCentsToXof } from "@/lib/money/fx";
import type {
  AcceptanceRow,
  AdjustmentRow,
  DossierBalance,
  DossierRow,
  FinancialDocumentRow,
  OfficialAccountRow,
  PaymentRow,
  RefundRow,
} from "@/lib/supabase/database.types";
import { CancelForm, DepositForm, GenerateFileButton } from "../billing-forms";
import { AcceptanceForm } from "../dossier-forms";
import {
  DiscountForm,
  ExtraCostForm,
  IssueBalanceInvoiceButton,
  LateFeeDecisionForm,
  ProposeLateFeesButton,
  RefundDecisionForm,
  RefundExecutionForm,
} from "../settlement-forms";
import { FinancialDocumentCard } from "./billing-section";
import { AcceptanceSummary, downloadHref } from "./sections";

type StaffName = (userId: string | null) => string | null;

/** Lien de téléchargement d'un document émis, ou génération du fichier s'il manque. */
function DocumentLink({ doc, canGenerate }: { doc: FinancialDocumentRow | undefined; canGenerate: boolean }) {
  if (!doc) return null;
  if (doc.document_id) {
    return (
      <a href={downloadHref(doc.document_id)} className="text-primary text-xs underline">
        {doc.number} (Word)
      </a>
    );
  }
  return canGenerate ? <GenerateFileButton dossierId={doc.dossier_id} financialDocumentId={doc.id} /> : null;
}

/**
 * Phase 3, lot 3c : situation du dossier, paiements (US-3.6), facture de solde (US-3.7), lignes D (US-3.8, US-3.9)
 * et remboursements (US-3.12). Montants des documents émis et des lignes visibles du client — jamais de coût interne.
 */
export function SettlementSection({
  dossier,
  balance,
  documents,
  payments,
  adjustments,
  refunds,
  acceptances,
  accounts,
  todayRate,
  shippingReady,
  canWriteInvoice,
  canWritePayment,
  isAdmin,
  today,
  staffName,
}: {
  dossier: DossierRow;
  balance: DossierBalance | null;
  documents: FinancialDocumentRow[];
  payments: PaymentRow[];
  adjustments: AdjustmentRow[];
  refunds: RefundRow[];
  acceptances: AcceptanceRow[];
  accounts: Pick<OfficialAccountRow, "id" | "kind" | "label">[];
  todayRate: { rate: number; captured_at: string } | null;
  shippingReady: boolean;
  canWriteInvoice: boolean;
  canWritePayment: boolean;
  isAdmin: boolean;
  today: string;
  staffName: StaffName;
}) {
  if (!balance?.has_accepted_quote && refunds.length === 0) return null;
  const now = new Date();
  const activeDepositInvoice = documents.find((d) => d.doc_type === "deposit_invoice" && d.status !== "cancelled");
  const balanceInvoices = documents.filter((d) => d.doc_type === "balance_invoice");
  const activeBalanceInvoice = balanceInvoices.find((d) => d.status !== "cancelled");
  const receipts = new Map(documents.filter((d) => d.doc_type === "cash_receipt").map((d) => [d.id, d]));
  const notes = new Map(documents.filter((d) => d.doc_type === "refund_note").map((d) => [d.id, d]));
  const received = payments.filter((p) => p.purpose !== "deposit");
  const remaining = balance?.balance_remaining_cents ?? 0;
  const xof = (cents: number) =>
    todayRate ? ` · ${formatXof(usdCentsToXof(Math.abs(cents), String(todayRate.rate)))}` : "";
  const open = dossier.status !== "cancelled";

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Paiements, solde et remboursements</h2>

      {balance?.has_accepted_quote && (
        <Table caption="Situation du dossier">
          <tbody>
            <tr>
              <Td>Total dû (A + B + assurance si acceptée + D, TVA comprise)</Td>
              <Td className="amount text-right">{formatUsd(balance.total_due_cents)}</Td>
            </tr>
            <tr>
              <Td>Payé (dépôts compris), net des remboursements</Td>
              <Td className="amount text-right">{formatUsd(balance.net_paid_cents)}</Td>
            </tr>
            <tr>
              <Td>Reste du paiement 1</Td>
              <Td className="amount text-right">{formatUsd(balance.payment1_remaining_cents)}</Td>
            </tr>
            <tr>
              <Td>
                {remaining < 0 ? "Trop-perçu à restituer" : "Solde restant dû"}
                {todayRate && (
                  <p className="text-muted text-xs">
                    FCFA au taux du {formatDateTime(todayRate.captured_at)} (indicatif, réactualisé au paiement)
                  </p>
                )}
              </Td>
              <Td className="amount text-right font-medium">
                {formatUsd(Math.abs(remaining))}
                {xof(remaining)}
              </Td>
            </tr>
          </tbody>
        </Table>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="paiements-titre">
        <h3 id="paiements-titre" className="font-medium">
          Paiements reçus
        </h3>
        {received.length === 0 ? (
          <EmptyState title="Aucun paiement">
            Le paiement 1 suit la facture d’acompte ; les dépôts figurent dans la section précédente.
          </EmptyState>
        ) : (
          <Table caption="Paiements reçus">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th className="hidden sm:table-cell">Imputation</Th>
                <Th className="text-right">Montant</Th>
              </tr>
            </thead>
            <tbody>
              {received.map((p) => (
                <tr key={p.id} className={p.cancelled_at ? "text-muted line-through" : undefined}>
                  <Td>
                    {formatDateTime(p.credited_at)}
                    <p className="text-muted text-xs">{p.reference}</p>
                  </Td>
                  <Td>
                    {PAYMENT_MODE_LABELS[p.mode]}
                    {!p.fx_rate_same_day && !p.cancelled_at && (
                      <p className="text-warning text-xs">Aucun taux relevé ce jour-là</p>
                    )}
                    {p.receipt_id && (
                      <div>
                        <DocumentLink doc={receipts.get(p.receipt_id)} canGenerate={canWritePayment} />
                      </div>
                    )}
                  </Td>
                  <Td className="hidden sm:table-cell">{p.purpose === "payment1" ? "Paiement 1" : "Solde"}</Td>
                  <Td className="amount text-right">
                    {formatUsd(p.amount_cents)}
                    {p.paid_currency === "XOF" && p.amount_xof !== null && (
                      <p className="text-muted text-xs">{formatXof(p.amount_xof)} reçus</p>
                    )}
                    {canWritePayment && !p.cancelled_at && (
                      <CancelForm kind="payment" dossierId={dossier.id} targetId={p.id} label="Annuler ce paiement" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canWritePayment && activeDepositInvoice && open && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Enregistrer un paiement…</summary>
            <div className="mt-3">
              <DepositForm dossierId={dossier.id} accounts={accounts} today={today} kind="payment" />
            </div>
          </details>
        )}
      </section>

      <section className="border-border flex flex-col gap-3 border-t pt-4" aria-labelledby="ajustements-titre">
        <h3 id="ajustements-titre" className="font-medium">
          Ajustements (ligne D)
        </h3>
        {adjustments.length === 0 ? (
          <EmptyState title="Aucun ajustement">Frais supplémentaires, frais de retard, remises.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {adjustments.map((a) => {
              const acceptance = acceptances.find((x) => x.subject === "extra_cost" && x.subject_id === a.id);
              return (
                <li key={a.id} className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <strong>{ADJUSTMENT_KIND_LABELS[a.kind]}</strong> — {a.label}{" "}
                      <Badge
                        tone={
                          a.status === "approved"
                            ? "success"
                            : a.status === "rejected" || a.status === "cancelled"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {ADJUSTMENT_STATUS_LABELS[a.status]}
                      </Badge>
                    </p>
                    <span className="amount">{formatUsd(a.amount_cents)}</span>
                  </div>
                  {a.urgent && <p className="text-muted text-xs">Urgence : {a.reason}</p>}
                  {a.decision_note && <p className="text-muted text-xs">Motif : {a.decision_note}</p>}
                  {a.proof_document_id && (
                    <a href={downloadHref(a.proof_document_id)} className="text-primary text-xs underline">
                      Justificatif
                    </a>
                  )}
                  {acceptance && <AcceptanceSummary acceptance={acceptance} staffName={staffName} />}
                  {canWriteInvoice && a.status === "proposed" && a.kind === "late_fee" && (
                    <LateFeeDecisionForm dossierId={dossier.id} adjustmentId={a.id} />
                  )}
                  {canWriteInvoice && a.status === "pending_client_approval" && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium">
                        Enregistrer la décision du client…
                      </summary>
                      <div className="mt-2">
                        <AcceptanceForm dossierId={dossier.id} subject="extra_cost" subjectId={a.id} today={today} />
                      </div>
                    </details>
                  )}
                  {canWriteInvoice &&
                    ["approved", "pending_client_approval"].includes(a.status) &&
                    !(a.financial_document_id && activeBalanceInvoice?.id === a.financial_document_id) && (
                      <CancelForm
                        kind="adjustment"
                        dossierId={dossier.id}
                        targetId={a.id}
                        label="Annuler cette ligne"
                      />
                    )}
                </li>
              );
            })}
          </ul>
        )}
        {canWriteInvoice && balance?.has_accepted_quote && open && (
          <div className="flex flex-col gap-3">
            <details>
              <summary className="cursor-pointer text-sm font-medium">Ajouter des frais supplémentaires…</summary>
              <div className="mt-3">
                <ExtraCostForm dossierId={dossier.id} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Accorder une remise…</summary>
              <div className="mt-3">
                <DiscountForm dossierId={dossier.id} />
              </div>
            </details>
            <ProposeLateFeesButton dossierId={dossier.id} />
          </div>
        )}
      </section>

      <section className="border-border flex flex-col gap-3 border-t pt-4" aria-labelledby="solde-titre">
        <h3 id="solde-titre" className="font-medium">
          Facture de solde
        </h3>
        {balanceInvoices.map((doc) => (
          <FinancialDocumentCard
            key={doc.id}
            doc={doc}
            now={now}
            acceptance={null}
            canWriteQuote={canWriteInvoice}
            canWriteInvoice={canWriteInvoice}
            today={today}
            staffName={staffName}
          />
        ))}
        {canWriteInvoice &&
          balance?.has_accepted_quote &&
          !activeBalanceInvoice &&
          open &&
          (shippingReady ? (
            <IssueBalanceInvoiceButton dossierId={dossier.id} />
          ) : (
            <p className="text-muted text-sm">
              La facture de solde s’émet après l’embarquement : conteneur affecté, avec son B/L et son ETA.
            </p>
          ))}
      </section>

      <section className="border-border flex flex-col gap-3 border-t pt-4" aria-labelledby="remboursements-titre">
        <h3 id="remboursements-titre" className="font-medium">
          Remboursements
        </h3>
        {refunds.length === 0 ? (
          <EmptyState title="Aucun remboursement">
            Tout trop-perçu est restitué au client (décision C6) : la demande est créée automatiquement.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {refunds.map((r) => {
              const late = r.status !== "paid" && r.status !== "rejected" && new Date(r.due_by) < now;
              return (
                <li key={r.id} className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <strong>{REFUND_REASON_LABELS[r.reason]}</strong> — {PAYMENT_MODE_LABELS[r.mode]} ·{" "}
                      {r.beneficiary}{" "}
                      <Badge tone={r.status === "paid" ? "success" : r.status === "rejected" ? "danger" : "warning"}>
                        {REFUND_STATUS_LABELS[r.status]}
                      </Badge>
                    </p>
                    <span className="amount">{formatUsd(r.amount_cents)}</span>
                  </div>
                  <p className="text-muted text-xs">
                    Demandé le {formatDateTime(r.requested_at)} · à rembourser avant le {formatDateTime(r.due_by)}
                    {r.paid_at && ` · remboursé le ${formatDateTime(r.paid_at)} (réf. ${r.payment_reference})`}
                    {r.rejection_reason && ` · refus : ${r.rejection_reason}`}
                  </p>
                  {late && <Alert tone="danger">Délai de remboursement dépassé.</Alert>}
                  {r.refund_note_id && <DocumentLink doc={notes.get(r.refund_note_id)} canGenerate={canWritePayment} />}
                  {isAdmin && r.status === "requested" && <RefundDecisionForm dossierId={dossier.id} refundId={r.id} />}
                  {canWritePayment && r.status === "approved" && (
                    <details open>
                      <summary className="cursor-pointer text-xs font-medium">
                        Enregistrer le remboursement effectué
                      </summary>
                      <div className="mt-2">
                        <RefundExecutionForm dossierId={dossier.id} refundId={r.id} today={today} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}
