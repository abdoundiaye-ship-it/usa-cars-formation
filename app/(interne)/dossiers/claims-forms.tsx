"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CLAIM_STATUS_LABELS } from "@/lib/claims";
import type { ClaimStatus } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { fileClaimByAgent, respondToClaim } from "./claims-actions";

/** Contrat art. 19 : l'agent enregistre une réclamation (réserves, photo facultative) après l'enlèvement. */
export function FileClaimForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(fileClaimByAgent, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field id="claim-reserves" label="Réserves (constat, dommages)" error={e.reserves}>
        {(aria) => <Textarea {...aria} name="reserves" rows={3} defaultValue={state.data?.reserves ?? ""} />}
      </Field>
      <Field id="claim-photo" label="Photo ou document (facultatif)" hint="JPEG, PNG, WebP, HEIC ou PDF, 20 Mo max.">
        {(aria) => <Input {...aria} type="file" name="photo" accept="image/*,application/pdf" />}
      </Field>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer la réclamation
        </Button>
      </div>
    </form>
  );
}

/** Traitement d'une réclamation : statut et réponse communiquée au client. */
export function RespondClaimForm({
  claimId,
  dossierId,
  status,
}: {
  claimId: string;
  dossierId: string;
  status: ClaimStatus;
}) {
  const { state, pending, formProps } = useFormAction(respondToClaim);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="border-border mt-3 flex flex-col gap-3 border-t pt-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`claim-status-${claimId}`} label="Statut">
          {(aria) => (
            <Select {...aria} name="status" defaultValue={state.data?.status ?? status}>
              {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field id={`claim-response-${claimId}`} label="Réponse au client (facultatif)" error={e.response}>
        {(aria) => <Textarea {...aria} name="response" rows={2} defaultValue={state.data?.response ?? ""} />}
      </Field>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Mettre à jour
        </Button>
      </div>
    </form>
  );
}
