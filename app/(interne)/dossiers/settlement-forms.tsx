"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useFormAction } from "@/lib/use-form-action";
import {
  addDiscount,
  addExtraCost,
  decideLateFee,
  decideRefund,
  executeRefund,
  issueBalanceInvoice,
  proposeLateFees,
} from "./settlement-actions";

const PROOF_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";
const PROOF_HINT = "PDF, JPEG, PNG, WebP ou HEIC — 20 Mo au plus";

function SimpleActionButton({
  action,
  dossierId,
  label,
  variant,
}: {
  action: typeof issueBalanceInvoice;
  dossierId: string;
  label: string;
  variant?: "secondary";
}) {
  const { state, pending, formProps } = useFormAction(action);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div>
        <Button type="submit" variant={variant} pending={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}

export const IssueBalanceInvoiceButton = ({ dossierId }: { dossierId: string }) => (
  <SimpleActionButton action={issueBalanceInvoice} dossierId={dossierId} label="Émettre la facture de solde" />
);

export const ProposeLateFeesButton = ({ dossierId }: { dossierId: string }) => (
  <SimpleActionButton
    action={proposeLateFees}
    dossierId={dossierId}
    label="Calculer les frais de retard"
    variant="secondary"
  />
);

/** US-3.9 / R7 : frais supplémentaires, justificatif obligatoire (visible du client). */
export function ExtraCostForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(addExtraCost, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="extra-label" label="Nature des frais" error={e.label}>
          {(aria) => <Input {...aria} name="label" defaultValue={state.data?.label ?? ""} />}
        </Field>
        <Field id="extra-section" label="Forfait concerné" error={e.section}>
          {(aria) => (
            <Select {...aria} name="section" defaultValue={state.data?.section ?? "B"}>
              <option value="A">A — Acquisition</option>
              <option value="B">B — Logistique et maritime</option>
            </Select>
          )}
        </Field>
        <Field id="extra-amount" label="Montant (USD)" error={e.amount}>
          {(aria) => <Input {...aria} name="amount" inputMode="decimal" defaultValue={state.data?.amount ?? ""} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="extra-proof" label="Justificatif des frais" hint={PROOF_HINT} error={e.proof}>
          {(aria) => <Input {...aria} name="proof" type="file" accept={PROOF_ACCEPT} required />}
        </Field>
        <Field
          id="extra-reason"
          label="Motif de l’urgence (si urgent)"
          hint="Stockage, port, transporteur : ajout immédiat, client notifié."
          error={e.reason}
        >
          {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="urgent" defaultChecked={state.data?.urgent === "on"} />
        Urgence (sans attendre l’accord du client)
      </label>
      <div>
        <Button type="submit" pending={pending}>
          Ajouter les frais
        </Button>
      </div>
    </form>
  );
}

export function DiscountForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(addDiscount, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="discount-label" label="Motif de la remise" error={e.label}>
          {(aria) => <Input {...aria} name="label" defaultValue={state.data?.label ?? ""} />}
        </Field>
        <Field id="discount-amount" label="Montant de la remise (USD)" error={e.amount}>
          {(aria) => <Input {...aria} name="amount" inputMode="decimal" defaultValue={state.data?.amount ?? ""} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Accorder la remise
        </Button>
      </div>
    </form>
  );
}

/** C5 : validation (ligne D) ou mise à l'écart motivée d'un frais de retard proposé. */
export function LateFeeDecisionForm({ dossierId, adjustmentId }: { dossierId: string; adjustmentId: string }) {
  const { state, pending, formProps } = useFormAction(decideLateFee);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="adjustmentId" value={adjustmentId} />
      <Field id={`late-note-${adjustmentId}`} label="Motif (si écartés)" error={e.note}>
        {(aria) => <Input {...aria} name="note" defaultValue={state.data?.note ?? ""} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" pending={pending}>
          Ajouter au solde
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" pending={pending}>
          Écarter
        </Button>
      </div>
    </form>
  );
}

/** C9 : validation d'un remboursement par l'administrateur. */
export function RefundDecisionForm({ dossierId, refundId }: { dossierId: string; refundId: string }) {
  const { state, pending, formProps } = useFormAction(decideRefund);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="refundId" value={refundId} />
      <Field id={`refund-reason-${refundId}`} label="Motif (si refus)" error={e.reason}>
        {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" pending={pending}>
          Valider le remboursement
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" pending={pending}>
          Refuser
        </Button>
      </div>
    </form>
  );
}

/** US-3.12 : exécution d'un remboursement validé ; la note RB est générée. */
export function RefundExecutionForm({
  dossierId,
  refundId,
  today,
}: {
  dossierId: string;
  refundId: string;
  today: string;
}) {
  const { state, pending, formProps } = useFormAction(executeRefund);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="refundId" value={refundId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`refund-paidOn-${refundId}`} label="Date du remboursement" error={e.paidOn}>
          {(aria) => (
            <Input {...aria} name="paidOn" type="date" max={today} defaultValue={state.data?.paidOn ?? today} />
          )}
        </Field>
        <Field id={`refund-reference-${refundId}`} label="Référence du remboursement" error={e.reference}>
          {(aria) => <Input {...aria} name="reference" defaultValue={state.data?.reference ?? ""} />}
        </Field>
        <Field id={`refund-proof-${refundId}`} label="Justificatif du remboursement" hint={PROOF_HINT} error={e.proof}>
          {(aria) => <Input {...aria} name="proof" type="file" accept={PROOF_ACCEPT} required />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer le remboursement
        </Button>
      </div>
    </form>
  );
}
