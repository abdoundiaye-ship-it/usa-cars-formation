"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ARRIVAL_NOTICE_CHANNEL_LABELS } from "@/lib/dossiers/labels";
import { useFormAction } from "@/lib/use-form-action";
import { recordArrivalNotice } from "./arrival-actions";

/** Contrat art. 17 : information du client sur l'arrivée, donnée par l'agent (téléphone, en personne…). */
export function ArrivalNoticeForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(recordArrivalNotice);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="arrival-notice-channel" label="Client informé par" error={e.channel}>
          {(aria) => (
            <Select {...aria} name="channel" defaultValue={state.data?.channel ?? ""}>
              <option value="" disabled>
                Choisir…
              </option>
              {Object.entries(ARRIVAL_NOTICE_CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="arrival-notice-note" label="Précision (facultatif)" error={e.note}>
          {(aria) => <Input {...aria} name="note" defaultValue={state.data?.note ?? ""} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer l’information du client
        </Button>
      </div>
    </form>
  );
}
