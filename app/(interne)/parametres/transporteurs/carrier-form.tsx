"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CARRIER_API_STATUS_LABELS } from "@/lib/dossiers/labels";
import type { CarrierRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { saveCarrier } from "./actions";

/** P4 : transporteur et configuration du lien de suivi (administrateur). */
export function CarrierForm({ carrier }: { carrier?: CarrierRow }) {
  const { state, pending, formProps } = useFormAction(saveCarrier, { resetOnSuccess: !carrier });
  const v = (name: string, saved: string | null | undefined) => state.data?.[name] ?? saved ?? "";
  const e = state.fieldErrors ?? {};
  const prefix = carrier ? `carrier-${carrier.code}` : "carrier-new";
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {carrier && <input type="hidden" name="carrierId" value={carrier.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-name`} label="Nom" error={e.name}>
          {(aria) => <Input {...aria} name="name" defaultValue={v("name", carrier?.name)} />}
        </Field>
        <Field id={`${prefix}-code`} label="Code" hint="Ex. maersk, msc, grimaldi" error={e.code}>
          {(aria) => <Input {...aria} name="code" defaultValue={v("code", carrier?.code)} />}
        </Field>
        <Field id={`${prefix}-tracking`} label="Page de suivi" hint="https://…" error={e.trackingUrl}>
          {(aria) => (
            <Input {...aria} name="trackingUrl" type="url" defaultValue={v("trackingUrl", carrier?.tracking_url)} />
          )}
        </Field>
        <Field
          id={`${prefix}-template`}
          label="Lien direct (facultatif)"
          hint="Avec {container} ou {bl}, ex. https://www.maersk.com/tracking/{container}"
          error={e.urlTemplate}
        >
          {(aria) => <Input {...aria} name="urlTemplate" defaultValue={v("urlTemplate", carrier?.url_template)} />}
        </Field>
        <Field id={`${prefix}-type`} label="Type de lien" error={e.linkType}>
          {(aria) => (
            <Select {...aria} name="linkType" defaultValue={v("linkType", carrier?.link_type ?? "officiel")}>
              <option value="officiel">Officiel (site du transporteur)</option>
              <option value="tiers">Service tiers (mention affichée au client)</option>
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-api`}
          label="Accès API"
          hint="Sans accès obtenu, le suivi se fait par le lien (F2-a)"
          error={e.apiStatus}
        >
          {(aria) => (
            <Select {...aria} name="apiStatus" defaultValue={v("apiStatus", carrier?.api_status ?? "non_etudie")}>
              {Object.entries(CARRIER_API_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field id={`${prefix}-note`} label="Note (facultatif)" error={e.note}>
        {(aria) => <Textarea {...aria} name="note" defaultValue={v("note", carrier?.note)} />}
      </Field>
      {carrier && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={carrier.active} />
          Transporteur actif (proposé pour les nouveaux conteneurs)
        </label>
      )}
      <div>
        <Button type="submit" variant={carrier ? "secondary" : "primary"} pending={pending}>
          {carrier ? "Enregistrer le transporteur" : "Ajouter le transporteur"}
        </Button>
      </div>
    </form>
  );
}
