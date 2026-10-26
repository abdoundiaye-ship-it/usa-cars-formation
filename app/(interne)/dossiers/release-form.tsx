"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ID_DOCUMENT_LABELS } from "@/lib/dossiers/labels";
import { useFormAction } from "@/lib/use-form-action";
import { recordDocumentRelease } from "./release-actions";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";
const HINT = "PDF, JPEG, PNG, WebP ou HEIC — 20 Mo au plus";

/** US-3.11 : remise des documents au client ou à son mandataire (pièce vérifiée, procuration, décharge signée). */
export function DocumentReleaseForm({
  dossierId,
  clientName,
  today,
}: {
  dossierId: string;
  clientName: string;
  today: string;
}) {
  const { state, pending, formProps } = useFormAction(recordDocumentRelease);
  const [kind, setKind] = useState(state.data?.beneficiaryKind ?? "client");
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Bénéficiaire</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["client", "Le client"],
              ["representative", "Un mandataire (procuration)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="beneficiaryKind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="release-name" label="Nom du bénéficiaire" error={e.beneficiaryName}>
          {(aria) => (
            <Input
              {...aria}
              name="beneficiaryName"
              key={kind}
              defaultValue={state.data?.beneficiaryName ?? (kind === "client" ? clientName : "")}
            />
          )}
        </Field>
        <Field id="release-date" label="Date de la remise" error={e.releasedOn}>
          {(aria) => (
            <Input {...aria} name="releasedOn" type="date" max={today} defaultValue={state.data?.releasedOn ?? today} />
          )}
        </Field>
        <Field id="release-id-type" label="Pièce d’identité vérifiée" error={e.idDocumentType}>
          {(aria) => (
            <Select {...aria} name="idDocumentType" defaultValue={state.data?.idDocumentType ?? "national_id"}>
              {Object.entries(ID_DOCUMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="release-id-number" label="Numéro de la pièce" error={e.idDocumentNumber}>
          {(aria) => <Input {...aria} name="idDocumentNumber" defaultValue={state.data?.idDocumentNumber ?? ""} />}
        </Field>
        {kind === "representative" && (
          <Field id="release-poa" label="Procuration signée du client" hint={HINT} error={e.powerOfAttorney}>
            {(aria) => <Input {...aria} name="powerOfAttorney" type="file" accept={ACCEPT} required />}
          </Field>
        )}
        <Field id="release-discharge" label="Décharge signée du bénéficiaire" hint={HINT} error={e.discharge}>
          {(aria) => <Input {...aria} name="discharge" type="file" accept={ACCEPT} required />}
        </Field>
      </div>
      <Field id="release-notes" label="Remarque (facultatif)" error={e.notes}>
        {(aria) => <Textarea {...aria} name="notes" rows={2} defaultValue={state.data?.notes ?? ""} />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer la remise des documents
        </Button>
      </div>
    </form>
  );
}
