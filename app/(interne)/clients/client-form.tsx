"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CLIENT_KIND_LABELS, ID_DOCUMENT_LABELS } from "@/lib/dossiers/labels";
import type { ClientKind, ClientRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { createClient, updateClient } from "./actions";

/** Formulaire de fiche client (création ou modification). */
export function ClientForm({ client }: { client?: ClientRow }) {
  const { state, pending, formProps } = useFormAction(client ? updateClient : createClient);
  const [kind, setKind] = useState<ClientKind>(client?.kind ?? "person");
  const errors = state.fieldErrors ?? {};
  // Valeur affichée : saisie précédente (après une erreur), sinon valeur enregistrée.
  const v = (name: string, saved: string | null | undefined) => state.data?.[name] ?? saved ?? "";

  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {client && <input type="hidden" name="clientId" value={client.id} />}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Type de client</legend>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(CLIENT_KIND_LABELS) as ClientKind[]).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {CLIENT_KIND_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label={kind === "company" ? "Raison sociale" : "Nom complet"} error={errors.name}>
          {(aria) => <Input {...aria} name="name" defaultValue={v("name", client?.name)} autoComplete="off" required />}
        </Field>
        <Field
          id="notifyPhone"
          label="WhatsApp de notification"
          hint="Format international, ex. +221 77 123 45 67"
          error={errors.notifyPhone}
        >
          {(aria) => (
            <Input
              {...aria}
              name="notifyPhone"
              type="tel"
              inputMode="tel"
              defaultValue={v("notifyPhone", client?.notify_phone)}
              autoComplete="off"
              required
            />
          )}
        </Field>
        <Field id="notifyEmail" label="E-mail (facultatif)" error={errors.notifyEmail}>
          {(aria) => (
            <Input
              {...aria}
              name="notifyEmail"
              type="email"
              defaultValue={v("notifyEmail", client?.notify_email)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field id="address" label="Adresse" error={errors.address}>
          {(aria) => <Input {...aria} name="address" defaultValue={v("address", client?.address)} autoComplete="off" />}
        </Field>
        <Field id="idDocumentType" label="Pièce d’identité" error={errors.idDocumentType}>
          {(aria) => (
            <Select {...aria} name="idDocumentType" defaultValue={v("idDocumentType", client?.id_document_type)}>
              <option value="">— Non renseignée —</option>
              {Object.entries(ID_DOCUMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="idDocumentNumber" label="Numéro de la pièce" error={errors.idDocumentNumber}>
          {(aria) => (
            <Input
              {...aria}
              name="idDocumentNumber"
              defaultValue={v("idDocumentNumber", client?.id_document_number)}
              autoComplete="off"
            />
          )}
        </Field>
      </div>

      {kind === "company" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ninea" label="NINEA" error={errors.ninea}>
            {(aria) => <Input {...aria} name="ninea" defaultValue={v("ninea", client?.ninea)} autoComplete="off" />}
          </Field>
          <Field id="rccm" label="RCCM" error={errors.rccm}>
            {(aria) => <Input {...aria} name="rccm" defaultValue={v("rccm", client?.rccm)} autoComplete="off" />}
          </Field>
          <Field id="representativeName" label="Représentant légal" error={errors.representativeName}>
            {(aria) => (
              <Input
                {...aria}
                name="representativeName"
                defaultValue={v("representativeName", client?.representative_name)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="representativeTitle" label="Fonction du représentant" error={errors.representativeTitle}>
            {(aria) => (
              <Input
                {...aria}
                name="representativeTitle"
                defaultValue={v("representativeTitle", client?.representative_title)}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
      )}

      <Field id="notes" label="Notes internes (facultatif)" error={errors.notes}>
        {(aria) => <Textarea {...aria} name="notes" defaultValue={v("notes", client?.notes)} />}
      </Field>

      <div>
        <Button type="submit" pending={pending}>
          {client ? "Enregistrer la fiche client" : "Créer le client"}
        </Button>
      </div>
    </form>
  );
}
