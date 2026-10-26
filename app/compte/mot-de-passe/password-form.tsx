"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";
import { setPassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(setPassword, initialFormState);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        id="password"
        label="Nouveau mot de passe"
        hint={`${PASSWORD_MIN_LENGTH} caractères minimum, avec au moins une minuscule, une majuscule et un chiffre.`}
        error={state.fieldErrors?.password}
      >
        {(aria) => <Input {...aria} name="password" type="password" autoComplete="new-password" required />}
      </Field>
      <Field id="confirmation" label="Confirmez le mot de passe" error={state.fieldErrors?.confirmation}>
        {(aria) => <Input {...aria} name="confirmation" type="password" autoComplete="new-password" required />}
      </Field>
      <Button type="submit" pending={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </Button>
    </form>
  );
}
