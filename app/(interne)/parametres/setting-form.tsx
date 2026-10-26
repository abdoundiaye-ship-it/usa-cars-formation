"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { initialFormState } from "@/lib/forms";
import { isNullable, parseSettingType } from "@/lib/settings/types";
import { createSettingVersion } from "./actions";

interface Props {
  settingKey: string;
  valueType: string;
  currentInput: string;
  currentStatus: "confirme" | "a_confirmer";
}

const HINTS: Record<string, string> = {
  money: "Montant en dollars (ex. 250 ou 250,50).",
  number: "Nombre (ex. 10 ou 10,5).",
  integer: "Nombre entier.",
  "integer[]": "Nombres entiers séparés par des virgules (ex. 7, 3, 2).",
  "string[]": "Valeurs séparées par des virgules.",
};

export function SettingForm({ settingKey, valueType, currentInput, currentStatus }: Props) {
  const [state, action, pending] = useActionState(createSettingVersion, initialFormState);
  const { kind, options } = parseSettingType(valueType);
  const nullableHint = isNullable(valueType) ? " Laissez vide pour « non défini »." : "";

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="key" value={settingKey} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="value"
          label="Nouvelle valeur"
          hint={`${HINTS[kind] ?? ""}${nullableHint}`.trim() || undefined}
          error={state.fieldErrors?.value}
        >
          {(aria) =>
            kind === "boolean" ? (
              <Select {...aria} name="value" defaultValue={currentInput}>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
              </Select>
            ) : kind === "enum" ? (
              <Select {...aria} name="value" defaultValue={currentInput}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                {...aria}
                name="value"
                defaultValue={currentInput}
                inputMode={kind === "string" || kind === "string[]" ? "text" : "decimal"}
              />
            )
          }
        </Field>
        <Field id="status" label="Statut" error={state.fieldErrors?.status}>
          {(aria) => (
            <Select {...aria} name="status" defaultValue={currentStatus}>
              <option value="confirme">Confirmé</option>
              <option value="a_confirmer">À confirmer</option>
            </Select>
          )}
        </Field>
        <Field
          id="effectiveFrom"
          label="Date d’effet (heure de Dakar)"
          hint="Laissez vide pour une application immédiate. Pas d’effet rétroactif."
          error={state.fieldErrors?.effectiveFrom}
        >
          {(aria) => <Input {...aria} name="effectiveFrom" type="datetime-local" />}
        </Field>
      </div>
      <Field id="reason" label="Motif de la modification" error={state.fieldErrors?.reason}>
        {(aria) => <Textarea {...aria} name="reason" required maxLength={500} />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          {pending ? "Enregistrement…" : "Enregistrer la nouvelle version"}
        </Button>
      </div>
    </form>
  );
}
