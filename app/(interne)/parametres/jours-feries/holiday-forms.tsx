"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useFormAction } from "@/lib/use-form-action";
import { addHoliday, deleteHoliday } from "./actions";

export function HolidayForm() {
  const { state, pending, formProps } = useFormAction(addHoliday, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="holiday-day" label="Date" error={e.day}>
          {(aria) => <Input {...aria} name="day" type="date" defaultValue={state.data?.day ?? ""} />}
        </Field>
        <Field id="holiday-label" label="Fête" hint="Ex. Korité, Tabaski, Grand Magal de Touba" error={e.label}>
          {(aria) => <Input {...aria} name="label" defaultValue={state.data?.label ?? ""} />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Ajouter le jour férié
        </Button>
      </div>
    </form>
  );
}

export function DeleteHolidayButton({ day, label }: { day: string; label: string }) {
  const { state, pending, formProps } = useFormAction(deleteHoliday);
  return (
    <form {...formProps}>
      <input type="hidden" name="day" value={day} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le jour férié : ${label}`}
        className="text-danger text-xs underline underline-offset-2 disabled:opacity-60"
      >
        Supprimer
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-danger text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
