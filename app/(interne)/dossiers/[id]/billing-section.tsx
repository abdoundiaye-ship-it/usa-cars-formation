import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import {
  FINANCIAL_DOC_TYPE_LABELS,
  FINANCIAL_STATUS_LABELS,
  INSURANCE_CHOICE_LABELS,
  PAYMENT_MODE_LABELS,
} from "@/lib/finance/labels";
import { formatDate, formatDateTime, formatUsd, formatXof } from "@/lib/format";
import { usdCentsToXof } from "@/lib/money/fx";
import type {
  AcceptanceRow,
  DossierForfaitsRow,
  DossierRow,
  FinancialDocStatus,
  FinancialDocumentRow,
  OfficialAccountRow,
  PaymentRow,
  PurchaseOrderRow,
} from "@/lib/supabase/database.types";
import { AcceptanceForm } from "../dossier-forms";
import {
  CancelForm,
  DepositForm,
  GenerateFileButton,
  IssueDepositInvoiceButton,
  IssueQuoteButton,
} from "../billing-forms";
import { AcceptanceSummary, downloadHref } from "./sections";

type StaffName = (userId: string | null) => string | null;

const STATUS_TONES: Record<FinancialDocStatus, "success" | "danger" | "warning" | "info"> = {
  issued: "warning",
  accepted: "success",
  refused: "danger",
  expired: "danger",
  paid: "success",
  cancelled: "danger",
};

/** Statut affiché : un devis émis dont la validité est passée est « Expiré », même avant le passage automatique. */
function displayStatus(doc: FinancialDocumentRow, now: Date): FinancialDocStatus {
  return doc.doc_type === "quote" && doc.status === "issued" && doc.valid_until && new Date(doc.valid_until) <= now
    ? "expired"
    : doc.status;
}

function Amounts({ doc }: { doc: FinancialDocumentRow }) {
  const rows: [string, string][] =
    doc.doc_type === "quote"
      ? [
          ["A — Acquisition (forfait)", formatUsd(doc.forfait_a_cents ?? 0)],
          ["B — Logistique et maritime (forfait)", formatUsd(doc.forfait_b_cents ?? 0)],
          [
            `C — Assurance (option) : ${INSURANCE_CHOICE_LABELS[doc.insurance_choice].toLowerCase()}`,
            formatUsd(doc.insurance_premium_cents),
          ],
          [`TVA (${String(doc.vat_rate_percent).replace(".", ",")} %)`, formatUsd(doc.vat_cents)],
          ["Total hors assurance", formatUsd(doc.total_cents)],
        ]
      : doc.doc_type === "balance_invoice"
        ? [
            ["B — Logistique et maritime (forfait)", formatUsd(doc.forfait_b_cents ?? 0)],
            [
              `C — Assurance : ${INSURANCE_CHOICE_LABELS[doc.insurance_choice].toLowerCase()}`,
              formatUsd(doc.insurance_premium_cents),
            ],
            ["D — Ajustements", formatUsd(doc.adjustments_cents)],
            [
              `TVA (${String(doc.vat_rate_percent).replace(".", ",")} %)`,
              formatUsd(doc.vat_cents + doc.insurance_vat_cents),
            ],
            ["Déjà payé (au-delà du paiement 1)", `− ${formatUsd(doc.deposit_applied_cents)}`],
            ["Solde à payer", formatUsd(doc.amount_due_cents)],
          ]
        : [
            ["A — Acquisition (totalité du forfait)", formatUsd(doc.forfait_a_cents ?? 0)],
            [`TVA (${String(doc.vat_rate_percent).replace(".", ",")} %)`, formatUsd(doc.vat_cents)],
            ["Dépôt imputé", `− ${formatUsd(doc.deposit_applied_cents)}`],
            ["Reste à payer (paiement 1)", formatUsd(doc.amount_due_cents)],
          ];
  return (
    <Table caption={`Montants ${doc.number}`}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <Td>{label}</Td>
            <Td className="amount text-right">{value}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function FinancialDocumentCard({
  doc,
  now,
  acceptance,
  canWriteQuote,
  canWriteInvoice,
  today,
  staffName,
}: {
  doc: FinancialDocumentRow;
  now: Date;
  acceptance: AcceptanceRow | null;
  canWriteQuote: boolean;
  canWriteInvoice: boolean;
  today: string;
  staffName: StaffName;
}) {
  const status = displayStatus(doc, now);
  const isQuote = doc.doc_type === "quote";
  const canCancel = isQuote && doc.status === "issued" ? canWriteQuote : canWriteInvoice;
  const dueXof = usdCentsToXof(doc.amount_due_cents, String(doc.edition_fx_rate));
  return (
    <article
      className="border-border flex flex-col gap-3 rounded-md border p-4"
      aria-label={`${FINANCIAL_DOC_TYPE_LABELS[doc.doc_type]} ${doc.number}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {FINANCIAL_DOC_TYPE_LABELS[doc.doc_type]} {doc.number}{" "}
          <Badge tone={STATUS_TONES[status]}>{FINANCIAL_STATUS_LABELS[status]}</Badge>
        </h3>
        {doc.document_id ? (
          <a href={downloadHref(doc.document_id)} className={buttonClasses("secondary")}>
            <Download aria-hidden />
            Télécharger (Word)
          </a>
        ) : (
          doc.status !== "cancelled" &&
          canWriteQuote && <GenerateFileButton dossierId={doc.dossier_id} financialDocumentId={doc.id} />
        )}
      </div>
      <p className="text-muted text-xs">
        Émis le {formatDateTime(doc.issued_at)} · taux de référence 1 $US = {String(doc.fx_rate).replace(".", ",")} FCFA
        ({doc.fx_source}, relevé le {formatDateTime(doc.fx_captured_at)})
        {isQuote && doc.valid_until && ` · valable jusqu’au ${formatDateTime(doc.valid_until)}`}
        {!isQuote && doc.due_at && ` · échéance ${formatDateTime(doc.due_at)}`}
        {doc.reference_eta && ` · ETA de référence ${formatDate(doc.reference_eta)} (indicative)`}
      </p>
      <Amounts doc={doc} />
      {!isQuote && (
        <p className="text-sm">
          Soit <span className="amount">{formatXof(dueXof)}</span> au taux du{" "}
          {formatDateTime(doc.edition_fx_captured_at)} (indicatif, réactualisé au paiement).
        </p>
      )}
      {doc.deposit_excess_cents > 0 && (
        <Alert tone="warning">
          Excédent de dépôt de {formatUsd(doc.deposit_excess_cents)} à restituer au client (demande de remboursement).
        </Alert>
      )}
      {doc.status === "cancelled" && (
        <p className="text-danger text-sm">
          Annulé le {doc.cancelled_at ? formatDateTime(doc.cancelled_at) : "—"} : {doc.cancelled_reason}
        </p>
      )}
      {isQuote && acceptance && (
        <>
          <AcceptanceSummary acceptance={acceptance} staffName={staffName} />
          {acceptance.decision === "accepted" && (
            <p className="text-sm">
              Assurance transport :{" "}
              <strong>{acceptance.insurance_choice === "accepted" ? "acceptée" : "refusée"}</strong>
            </p>
          )}
        </>
      )}
      {isQuote && !acceptance && ["issued", "expired"].includes(doc.status) && doc.document_id && canWriteQuote && (
        <details className="border-border border-t pt-3" open={status === "issued"}>
          <summary className="cursor-pointer font-medium">Enregistrer la décision du client</summary>
          <div className="mt-3">
            <AcceptanceForm
              dossierId={doc.dossier_id}
              subject="quote"
              subjectId={doc.id}
              today={today}
              insurancePremium={formatUsd(doc.insurance_premium_cents)}
            />
          </div>
        </details>
      )}
      {["issued", "accepted"].includes(doc.status) && canCancel && (
        <CancelForm kind="document" dossierId={doc.dossier_id} targetId={doc.id} label={`Annuler ${doc.number}`} />
      )}
    </article>
  );
}

/**
 * US-3.3 / US-3.4 : devis DV, dépôt et facture d'acompte FA. Les montants affichés sont ceux des documents émis
 * (figés) — jamais les coûts internes (CLAUDE.md règle 2).
 */
export function BillingSection({
  dossier,
  order,
  forfaits,
  documents,
  payments,
  acceptances,
  accounts,
  todayRateExists,
  canWriteQuote,
  canWriteInvoice,
  canWritePayment,
  today,
  staffName,
}: {
  dossier: DossierRow;
  order: PurchaseOrderRow | null;
  forfaits: DossierForfaitsRow | null;
  documents: FinancialDocumentRow[];
  payments: PaymentRow[];
  acceptances: AcceptanceRow[];
  accounts: Pick<OfficialAccountRow, "id" | "kind" | "label">[];
  todayRateExists: boolean;
  canWriteQuote: boolean;
  canWriteInvoice: boolean;
  canWritePayment: boolean;
  today: string;
  staffName: StaffName;
}) {
  const now = new Date();
  const quotes = documents.filter((d) => d.doc_type === "quote");
  const invoices = documents.filter((d) => d.doc_type === "deposit_invoice");
  const openQuote = quotes.find((q) => q.status === "accepted" || displayStatus(q, now) === "issued");
  const acceptedQuote = quotes.find((q) => q.status === "accepted");
  const activeInvoice = invoices.find((i) => i.status !== "cancelled");
  const deposits = payments.filter((p) => p.purpose === "deposit");
  const depositTotal = deposits.filter((p) => !p.cancelled_at).reduce((sum, p) => sum + p.amount_cents, 0);
  const missing = [
    dossier.auction_result !== "won" && "le lot remporté",
    (forfaits?.forfait_a_cents == null || forfaits?.forfait_b_cents == null) && "les forfaits A et B",
    forfaits?.insurance_cents == null && "la prime d’assurance (option C)",
    !todayRateExists && "le taux de change du jour (Finances)",
  ].filter(Boolean) as string[];

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Devis, dépôt et facture d’acompte</h2>

      <section className="flex flex-col gap-3" aria-labelledby="depot-titre">
        <h3 id="depot-titre" className="font-medium">
          Dépôt
        </h3>
        <p className="text-sm">
          Dépôt attendu (ordre d’achat) : {order ? formatUsd(order.deposit_cents) : "—"} · reçu :{" "}
          <span className="amount">{formatUsd(depositTotal)}</span>
        </p>
        {deposits.length > 0 && (
          <Table caption="Dépôts reçus">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th className="hidden sm:table-cell">Référence</Th>
                <Th className="text-right">Montant</Th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((p) => (
                <tr key={p.id} className={p.cancelled_at ? "text-muted line-through" : undefined}>
                  <Td>{formatDateTime(p.credited_at)}</Td>
                  <Td>
                    {PAYMENT_MODE_LABELS[p.mode]}
                    {!p.fx_rate_same_day && !p.cancelled_at && (
                      <p className="text-warning text-xs no-underline">Aucun taux relevé ce jour-là</p>
                    )}
                  </Td>
                  <Td className="hidden sm:table-cell">{p.reference}</Td>
                  <Td className="amount text-right">
                    {formatUsd(p.amount_cents)}
                    {p.paid_currency === "XOF" && p.amount_xof !== null && (
                      <p className="text-muted text-xs">{formatXof(p.amount_xof)} reçus</p>
                    )}
                    {canWritePayment && !p.cancelled_at && !activeInvoice && (
                      <CancelForm kind="payment" dossierId={dossier.id} targetId={p.id} label="Annuler ce dépôt" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canWritePayment && order && !activeInvoice && dossier.status !== "cancelled" && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Enregistrer un dépôt reçu…</summary>
            <div className="mt-3">
              <DepositForm dossierId={dossier.id} accounts={accounts} today={today} />
            </div>
          </details>
        )}
      </section>

      <section className="border-border flex flex-col gap-3 border-t pt-4" aria-labelledby="devis-titre">
        <h3 id="devis-titre" className="font-medium">
          Devis et factures
        </h3>
        {documents.length === 0 && (
          <EmptyState title="Aucun devis émis">Le devis s’émet après l’adjudication (lot remporté).</EmptyState>
        )}
        {[...invoices, ...quotes].map((doc) => (
          <FinancialDocumentCard
            key={doc.id}
            doc={doc}
            now={now}
            acceptance={acceptances.find((a) => a.subject === "quote" && a.subject_id === doc.id) ?? null}
            canWriteQuote={canWriteQuote}
            canWriteInvoice={canWriteInvoice}
            today={today}
            staffName={staffName}
          />
        ))}
        {canWriteQuote &&
          !openQuote &&
          dossier.status !== "cancelled" &&
          (missing.length > 0 ? (
            <p className="text-muted text-sm">Pour émettre le devis, il manque : {missing.join(", ")}.</p>
          ) : (
            <IssueQuoteButton dossierId={dossier.id} />
          ))}
        {canWriteInvoice && acceptedQuote && !activeInvoice && <IssueDepositInvoiceButton dossierId={dossier.id} />}
      </section>
    </Card>
  );
}
