"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms";
import { signIn } from "./actions";

export function ConnexionForm({ suite }: { suite?: string }) {
  const [state, action, pending] = useActionState(signIn, initialFormState);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="suite" value={suite ?? ""} />
      <Field id="email" label="Adresse e-mail" error={state.fieldErrors?.email}>
        {(aria) => <Input {...aria} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field id="password" label="Mot de passe" error={state.fieldErrors?.password}>
        {(aria) => <Input {...aria} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <Button type="submit" pending={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
