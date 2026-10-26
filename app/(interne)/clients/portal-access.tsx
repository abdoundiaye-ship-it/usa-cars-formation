"use client";

import { AccessLink } from "@/components/access-link";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/lib/use-form-action";
import { sendPortalAccess } from "./portal-actions";

/** Ouverture de l'accès au portail / envoi d'un nouveau lien de connexion (US-4.1). */
export function PortalAccessForm({ clientId, hasAccount }: { clientId: string; hasAccount: boolean }) {
  const { state, pending, formProps } = useFormAction(sendPortalAccess);
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="clientId" value={clientId} />
      <div>
        <Button type="submit" variant={hasAccount ? "secondary" : "primary"} pending={pending}>
          {hasAccount ? "Envoyer un nouveau lien de connexion" : "Ouvrir l’accès au portail"}
        </Button>
      </div>
      {state.status === "success" && state.data?.lien && (
        <AccessLink key={state.data.lien} link={state.data.lien} label="Lien de connexion du client" />
      )}
    </form>
  );
}
