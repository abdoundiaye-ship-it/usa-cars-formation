"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useFormAction } from "@/lib/use-form-action";
import { redeemClientLink, requestClientLink } from "./actions";

export function ClientLinkRequestForm() {
  const { state, pending, formProps } = useFormAction(requestClientLink);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        id="identifier"
        label="Adresse e-mail ou numéro WhatsApp"
        hint="Ceux que vous avez donnés à USA CARS (ex. +221 77 123 45 67)."
        error={e.identifier}
      >
        {(aria) => (
          <Input {...aria} name="identifier" autoComplete="username" defaultValue={state.data?.identifier ?? ""} />
        )}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          Recevoir un lien de connexion
        </Button>
      </div>
    </form>
  );
}

/** Le jeton n'est consommé qu'au clic : un aperçu automatique du lien (WhatsApp, messagerie) ne l'utilise pas. */
export function RedeemLinkForm({ token }: { token: string }) {
  const { state, pending, formProps } = useFormAction(redeemClientLink);
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <div>
        <Button type="submit" pending={pending}>
          Accéder à mon espace
        </Button>
      </div>
    </form>
  );
}
