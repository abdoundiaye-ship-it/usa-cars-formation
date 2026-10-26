"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms";
import { requestPasswordReset } from "../actions";

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialFormState);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Adresse e-mail" error={state.fieldErrors?.email}>
        {(aria) => <Input {...aria} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Button type="submit" pending={pending}>
        {pending ? "Envoi…" : "Envoyer le lien de réinitialisation"}
      </Button>
    </form>
  );
}
