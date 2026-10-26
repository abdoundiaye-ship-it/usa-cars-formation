"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ETA_SOURCE_LABELS } from "@/lib/dossiers/labels";
import type { FormState } from "@/lib/forms";
import type { ContainerRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import {
  addTrackingEvent,
  createContainer,
  markChecked,
  recordArrival,
  recordDeparture,
  updateContainer,
  updateEta,
} from "./actions";

export interface CarrierOption {
  id: string;
  name: string;
  link_type: "officiel" | "tiers";
}

const valueOf = (state: FormState) => (name: string, saved: string | null | undefined) =>
  state.data?.[name] ?? saved ?? "";

/** US-2.6 : création ou modification des références d'un conteneur. */
export function ContainerForm({ carriers, container }: { carriers: CarrierOption[]; container?: ContainerRow }) {
  const { state, pending, formProps } = useFormAction(container ? updateContainer : createContainer);
  const v = valueOf(state);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {container && (
        <>
          <input type="hidden" name="containerId" value={container.id} />
          <input type="hidden" name="number" value={container.number} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!container && (
          <Field id="number" label="Numéro du conteneur" hint="ISO 6346, ex. MSKU9070323" error={e.number}>
            {(aria) => (
              <Input
                {...aria}
                name="number"
                defaultValue={v("number", null)}
                autoCapitalize="characters"
                className="font-mono uppercase"
                required
              />
            )}
          </Field>
        )}
        <Field id="carrierId" label="Transporteur" error={e.carrierId}>
          {(aria) => (
            <Select {...aria} name="carrierId" defaultValue={v("carrierId", container?.carrier_id)} required>
              <option value="">— Choisir —</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.link_type === "tiers" ? " (suivi par un service tiers)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="blNumber" label="N° de B/L" error={e.blNumber}>
          {(aria) => <Input {...aria} name="blNumber" defaultValue={v("blNumber", container?.bl_number)} />}
        </Field>
        <Field id="vessel" label="Navire" error={e.vessel}>
          {(aria) => <Input {...aria} name="vessel" defaultValue={v("vessel", container?.vessel)} />}
        </Field>
        <Field id="voyage" label="Voyage" error={e.voyage}>
          {(aria) => <Input {...aria} name="voyage" defaultValue={v("voyage", container?.voyage)} />}
        </Field>
        <Field id="portOfLoading" label="Port de chargement" error={e.portOfLoading}>
          {(aria) => (
            <Input {...aria} name="portOfLoading" defaultValue={v("portOfLoading", container?.port_of_loading)} />
          )}
        </Field>
        <Field id="portOfDischarge" label="Port d’arrivée" error={e.portOfDischarge}>
          {(aria) => (
            <Input
              {...aria}
              name="portOfDischarge"
              defaultValue={v("portOfDischarge", container?.port_of_discharge ?? "Dakar")}
            />
          )}
        </Field>
        <Field id="etd" label="Départ prévu (ETD)" error={e.etd}>
          {(aria) => <Input {...aria} name="etd" type="date" defaultValue={v("etd", container?.etd)} />}
        </Field>
        {!container && (
          <Field id="eta" label="ETA indicative" hint="Modifiable ensuite, avec sa source" error={e.eta}>
            {(aria) => <Input {...aria} name="eta" type="date" defaultValue={v("eta", null)} />}
          </Field>
        )}
      </div>
      <Field id="container-notes" label="Notes internes (facultatif)" error={e.notes}>
        {(aria) => <Textarea {...aria} name="notes" defaultValue={v("notes", container?.notes)} />}
      </Field>
      <div>
        <Button type="submit" variant={container ? "secondary" : "primary"} pending={pending}>
          {container ? "Enregistrer le conteneur" : "Créer le conteneur"}
        </Button>
      </div>
    </form>
  );
}

/** US-2.7 : nouvelle ETA indicative avec sa source. */
export function EtaForm({ containerId, current }: { containerId: string; current: string | null }) {
  const { state, pending, formProps } = useFormAction(updateEta);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="containerId" value={containerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-eta" label="Nouvelle ETA indicative" error={e.eta}>
          {(aria) => <Input {...aria} name="eta" type="date" defaultValue={state.data?.eta ?? current ?? ""} />}
        </Field>
        <Field id="eta-source" label="Source" error={e.source}>
          {(aria) => (
            <Select {...aria} name="source" defaultValue={state.data?.source ?? ""}>
              <option value="">— Choisir —</option>
              {Object.entries(ETA_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field id="eta-note" label="Remarque (facultatif)" error={e.note}>
        {(aria) => <Input {...aria} name="note" defaultValue={state.data?.note ?? ""} />}
      </Field>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer l’ETA indicative
        </Button>
      </div>
    </form>
  );
}

/** Départ réel ou ATA : une date, une action dédiée. */
export function ContainerDateForm({
  containerId,
  kind,
  today,
}: {
  containerId: string;
  kind: "departure" | "arrival";
  today: string;
}) {
  const { state, pending, formProps } = useFormAction(kind === "departure" ? recordDeparture : recordArrival);
  const id = `${kind}-date`;
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="containerId" value={containerId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          id={id}
          label={kind === "departure" ? "Date de départ du navire" : "Date d’arrivée réelle (ATA)"}
          error={state.fieldErrors?.date}
        >
          {(aria) => <Input {...aria} name="date" type="date" max={today} defaultValue={state.data?.date ?? today} />}
        </Field>
        <Button type="submit" variant={kind === "arrival" ? "primary" : "secondary"} pending={pending}>
          {kind === "departure" ? "Enregistrer le départ" : "Enregistrer l’arrivée (ATA)"}
        </Button>
      </div>
    </form>
  );
}

/** R12 : l'agent a consulté le suivi du transporteur aujourd'hui. */
export function CheckedTodayForm({ containerId }: { containerId: string }) {
  const { state, pending, formProps } = useFormAction(markChecked);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="containerId" value={containerId} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Vérifié aujourd’hui
        </Button>
      </div>
    </form>
  );
}

/** US-2.7 : événement de suivi (transbordement, retard, information). */
export function TrackingEventForm({ containerId, today }: { containerId: string; today: string }) {
  const { state, pending, formProps } = useFormAction(addTrackingEvent, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="containerId" value={containerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="event-kind" label="Type" error={e.kind}>
          {(aria) => (
            <Select {...aria} name="kind" defaultValue={state.data?.kind ?? "note"}>
              <option value="transshipment">Transbordement</option>
              <option value="delay">Retard</option>
              <option value="note">Information</option>
            </Select>
          )}
        </Field>
        <Field id="event-date" label="Date" error={e.occurredOn}>
          {(aria) => (
            <Input {...aria} name="occurredOn" type="date" max={today} defaultValue={state.data?.occurredOn ?? today} />
          )}
        </Field>
        <Field id="event-source" label="Source de l’information" error={e.source}>
          {(aria) => (
            <Select {...aria} name="source" defaultValue={state.data?.source ?? "carrier_link"}>
              <option value="carrier_link">Lien du transporteur (vu sur son site)</option>
              <option value="manual">Saisie manuelle (autre information)</option>
            </Select>
          )}
        </Field>
        <Field id="event-location" label="Lieu (facultatif)" error={e.location}>
          {(aria) => <Input {...aria} name="location" defaultValue={state.data?.location ?? ""} />}
        </Field>
      </div>
      <Field id="event-label" label="Description" error={e.label}>
        {(aria) => <Input {...aria} name="label" defaultValue={state.data?.label ?? ""} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="visibleClient"
          defaultChecked={state.data ? state.data.visibleClient === "on" : true}
        />
        Visible du client (chronologie de ses dossiers)
      </label>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Ajouter l’événement
        </Button>
      </div>
    </form>
  );
}
