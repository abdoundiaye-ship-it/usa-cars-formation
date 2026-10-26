"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useFormAction } from "@/lib/use-form-action";
import { addFxRate } from "./actions";

/** US-3.5 : relevé du taux du jour (source XE.com par défaut, paramètre fx.source). */
export function FxRateForm({ defaultSource, now }: { defaultSource: string; now: string }) {
  const { state, pending, formProps } = useFormAction(addFxRate, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="rate" label="Taux (FCFA pour 1 USD)" hint="4 décimales au plus, ex. 587,1050" error={e.rate}>
          {(aria) => <Input {...aria} name="rate" inputMode="decimal" defaultValue={state.data?.rate ?? ""} />}
        </Field>
        <Field id="capturedAt" label="Relevé le (heure de Dakar)" error={e.capturedAt}>
          {(aria) => (
            <Input
              {...aria}
              name="capturedAt"
              type="datetime-local"
              max={now}
              defaultValue={state.data?.capturedAt ?? now}
            />
          )}
        </Field>
        <Field id="source" label="Source" error={e.source}>
          {(aria) => <Input {...aria} name="source" defaultValue={state.data?.source ?? defaultSource} />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer le taux
        </Button>
      </div>
    </form>
  );
}
