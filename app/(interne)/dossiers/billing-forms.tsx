"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ACCOUNT_KIND_OF_MODE, PAYMENT_MODE_LABELS } from "@/lib/finance/labels";
import type { FormState } from "@/lib/forms";
import type { OfficialAccountRow, PaymentMode } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import {
  cancelFinancialDocument,
  cancelPayment,
  generateFinancialFile,
  issueDepositInvoice,
  issueQuote,
  recordDeposit,
} from "./billing-actions";
import { cancelAdjustment, recordPayment } from "./settlement-actions";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Bouton d'action unique sur le dossier (émission, génération du fichier). */
function DossierActionButton({
  action,
  dossierId,
  label,
  financialDocumentId,
  variant,
}: {
  action: Action;
  dossierId: string;
  label: string;
  financialDocumentId?: string;
  variant?: "secondary";
}) {
  const { state, pending, formProps } = useFormAction(action);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      {financialDocumentId && <input type="hidden" name="financialDocumentId" value={financialDocumentId} />}
      <div>
        <Button type="submit" variant={variant} pending={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}

export const IssueQuoteButton = ({ dossierId }: { dossierId: string }) => (
  <DossierActionButton action={issueQuote} dossierId={dossierId} label="Émettre le devis" />
);

export const IssueDepositInvoiceButton = ({ dossierId }: { dossierId: string }) => (
  <DossierActionButton action={issueDepositInvoice} dossierId={dossierId} label="Émettre la facture d’acompte" />
);

export const GenerateFileButton = ({
  dossierId,
  financialDocumentId,
}: {
  dossierId: string;
  financialDocumentId: string;
}) => (
  <DossierActionButton
    action={generateFinancialFile}
    dossierId={dossierId}
    financialDocumentId={financialDocumentId}
    label="Générer le fichier"
    variant="secondary"
  />
);

/** Annulation motivée d'un document financier ou d'un paiement (R3 ; journalisée). */
export function CancelForm({
  kind,
  dossierId,
  targetId,
  label,
}: {
  kind: "document" | "payment" | "adjustment";
  dossierId: string;
  targetId: string;
  label: string;
}) {
  const { state, pending, formProps } = useFormAction(
    kind === "document" ? cancelFinancialDocument : kind === "payment" ? cancelPayment : cancelAdjustment,
  );
  const e = state.fieldErrors ?? {};
  return (
    <details>
      <summary className="text-danger cursor-pointer text-xs">{label}…</summary>
      <form {...formProps} className="mt-2 flex flex-col gap-2" noValidate>
        <FormMessage state={state} />
        <input type="hidden" name="dossierId" value={dossierId} />
        <input type="hidden" name="targetId" value={targetId} />
        <Field id={`cancel-${targetId}`} label="Motif de l’annulation" error={e.reason}>
          {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
        </Field>
        <div>
          <Button type="submit" variant="secondary" pending={pending}>
            {label}
          </Button>
        </div>
      </form>
    </details>
  );
}

/**
 * US-3.4 : dépôt reçu (I2) ; US-3.6 : paiement 1 et solde (`kind="payment"`, justificatif obligatoire sauf espèces —
 * un reçu RC est alors généré). Montant en USD ou en FCFA, compte officiel actif du même moyen de paiement.
 */
export function DepositForm({
  dossierId,
  accounts,
  today,
  kind = "deposit",
}: {
  dossierId: string;
  accounts: Pick<OfficialAccountRow, "id" | "kind" | "label">[];
  today: string;
  kind?: "deposit" | "payment";
}) {
  const isPayment = kind === "payment";
  const { state, pending, formProps } = useFormAction(isPayment ? recordPayment : recordDeposit, {
    resetOnSuccess: true,
  });
  const [mode, setMode] = useState<PaymentMode>((state.data?.mode as PaymentMode | undefined) ?? "bank_transfer");
  const [currency, setCurrency] = useState(state.data?.currency ?? "USD");
  const e = state.fieldErrors ?? {};
  const options = accounts.filter((a) => a.kind === ACCOUNT_KIND_OF_MODE[mode]);
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${kind}-mode`} label="Mode de paiement" error={e.mode}>
          {(aria) => (
            <Select {...aria} name="mode" value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>
              {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${kind}-account`}
          label="Compte officiel crédité"
          hint={mode === "cash" ? "Facultatif pour les espèces." : undefined}
          error={e.accountId}
        >
          {(aria) => (
            <Select {...aria} name="accountId" key={mode} defaultValue={state.data?.accountId ?? options[0]?.id ?? ""}>
              <option value="">{options.length === 0 ? "Aucun compte actif de ce type" : "— Choisir —"}</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${kind}-creditedOn`} label="Date de crédit" error={e.creditedOn}>
          {(aria) => (
            <Input
              {...aria}
              name="creditedOn"
              type="date"
              max={today}
              defaultValue={state.data?.creditedOn ?? today}
              required
            />
          )}
        </Field>
        <Field id={`${kind}-currency`} label="Devise reçue" error={e.currency}>
          {(aria) => (
            <Select {...aria} name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option value="USD">Dollars (USD)</option>
              <option value="XOF">Francs CFA (FCFA)</option>
            </Select>
          )}
        </Field>
        <Field
          id={`${kind}-amount`}
          label={currency === "XOF" ? "Montant reçu (FCFA)" : "Montant reçu (USD)"}
          hint={currency === "XOF" ? "Converti en USD au taux du jour du paiement." : undefined}
          error={e.amount}
        >
          {(aria) => (
            <Input
              {...aria}
              name="amount"
              inputMode={currency === "XOF" ? "numeric" : "decimal"}
              defaultValue={state.data?.amount ?? ""}
            />
          )}
        </Field>
        <Field id={`${kind}-reference`} label="Référence du paiement" error={e.reference}>
          {(aria) => <Input {...aria} name="reference" defaultValue={state.data?.reference ?? ""} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${kind}-proof`}
          label={
            isPayment
              ? mode === "cash"
                ? "Justificatif (facultatif : reçu généré)"
                : "Justificatif"
              : "Justificatif (facultatif)"
          }
          hint="PDF, JPEG, PNG, WebP ou HEIC — 20 Mo au plus"
          error={e.proof}
        >
          {(aria) => (
            <Input
              {...aria}
              name="proof"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            />
          )}
        </Field>
        <Field id={`${kind}-notes`} label="Remarque (facultatif)" error={e.notes}>
          {(aria) => <Textarea {...aria} name="notes" rows={2} defaultValue={state.data?.notes ?? ""} />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          {isPayment ? "Enregistrer le paiement" : "Enregistrer le dépôt"}
        </Button>
      </div>
    </form>
  );
}
