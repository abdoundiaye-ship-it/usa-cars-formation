"use client";

import { useActionState, useState } from "react";
import { AccessLink } from "@/components/access-link";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { INTERNAL_ROLES, ROLE_LABELS, type InternalRole } from "@/lib/auth/roles";
import { initialFormState } from "@/lib/forms";
import { changeRole, generateAccessLink, inviteUser, resendInvite, setUserActive } from "./actions";

export function InviteUserForm() {
  const [state, action, pending] = useActionState(inviteUser, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="fullName" label="Nom complet" error={state.fieldErrors?.fullName}>
          {(aria) => <Input {...aria} name="fullName" autoComplete="off" required />}
        </Field>
        <Field id="invite-email" label="Adresse e-mail" error={state.fieldErrors?.email}>
          {(aria) => <Input {...aria} name="email" type="email" autoComplete="off" required />}
        </Field>
        <Field id="invite-role" label="Rôle" error={state.fieldErrors?.role}>
          {(aria) => (
            <Select {...aria} name="role" defaultValue="ops" required>
              {INTERNAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Mode d’envoi</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="delivery" value="lien" defaultChecked className="mt-1" />
          <span>
            Lien à copier et à envoyer moi-même (WhatsApp…) — recommandé tant que l’envoi d’e-mails n’est pas configuré
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="delivery" value="email" className="mt-1" />
          <span>Invitation par e-mail</span>
        </label>
      </fieldset>
      <div>
        <Button type="submit" pending={pending}>
          {pending ? "Création…" : "Créer le compte"}
        </Button>
      </div>
      {state.status === "success" && state.data?.lien && <AccessLink key={state.data.lien} link={state.data.lien} />}
    </form>
  );
}

export function RoleForm({ userId, role, name }: { userId: string; role: InternalRole; name: string }) {
  const [state, action, pending] = useActionState(changeRole, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`role-${userId}`} className="sr-only">
          Rôle de {name}
        </label>
        <Select id={`role-${userId}`} name="role" defaultValue={role} className="w-auto min-w-40">
          {INTERNAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer le rôle
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Désactivation / réactivation avec confirmation dans la page (pas de confirm() navigateur).
 * Le parent change la `key` quand l’état du compte change, ce qui referme la confirmation.
 */
export function ActiveToggle({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  const [state, action, pending] = useActionState(setUserActive, initialFormState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" variant={active ? "secondary" : "primary"} onClick={() => setConfirming(true)}>
          {active ? "Désactiver le compte" : "Réactiver le compte"}
        </Button>
        <FormMessage state={state} />
      </div>
    );
  }

  return (
    <form action={action} className="border-border flex flex-col gap-2 rounded-md border p-3">
      <FormMessage state={state} />
      <p className="text-sm">
        {active
          ? `Désactiver le compte de ${name} ? Il perdra immédiatement tout accès.`
          : `Réactiver le compte de ${name} ?`}
      </p>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={active ? "danger" : "primary"} pending={pending}>
          {active ? "Confirmer la désactivation" : "Confirmer la réactivation"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function ResendInviteForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resendInvite, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        variant="ghost"
        pending={pending}
        className="text-primary px-0 underline underline-offset-2"
      >
        Renvoyer l’invitation par e-mail
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function AccessLinkForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(generateAccessLink, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        variant="ghost"
        pending={pending}
        className="text-primary px-0 underline underline-offset-2"
      >
        Obtenir un lien d’accès
      </Button>
      <FormMessage state={state} />
      {state.status === "success" && state.data?.lien && <AccessLink key={state.data.lien} link={state.data.lien} />}
    </form>
  );
}
