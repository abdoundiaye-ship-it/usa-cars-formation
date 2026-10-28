"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  ACCEPTANCE_METHOD_LABELS,
  PLATFORM_LABELS,
  PURCHASE_ORDER_ACKNOWLEDGEMENTS,
  VEHICLE_CATEGORY_LABELS,
} from "@/lib/dossiers/labels";
import type { FormState } from "@/lib/forms";
import type { DossierRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { cn } from "@/lib/utils";
import { createDossier, duplicateDossier, recordAcceptance, regenerateContract, updateVehicle } from "./actions";

type Values = (name: string, saved: string | number | null | undefined) => string;

const valuesOf =
  (state: FormState): Values =>
  (name, saved) =>
    state.data?.[name] ?? (saved === null || saved === undefined ? "" : String(saved));

/** Champs du véhicule (création et modification du dossier). */
function VehicleFields({ state, dossier }: { state: FormState; dossier?: DossierRow }) {
  const v = valuesOf(state);
  const e = state.fieldErrors ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field id="platform" label="Plateforme" error={e.platform}>
        {(aria) => (
          <Select {...aria} name="platform" defaultValue={v("platform", dossier?.platform)}>
            <option value="">— À préciser —</option>
            {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="lotNumber" label="N° de lot" error={e.lotNumber}>
        {(aria) => (
          <Input {...aria} name="lotNumber" defaultValue={v("lotNumber", dossier?.lot_number)} autoComplete="off" />
        )}
      </Field>
      <Field id="vin" label="VIN / châssis" hint="17 caractères" error={e.vin}>
        {(aria) => (
          <Input
            {...aria}
            name="vin"
            defaultValue={v("vin", dossier?.vin)}
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono uppercase"
          />
        )}
      </Field>
      <Field id="make" label="Marque" error={e.make}>
        {(aria) => <Input {...aria} name="make" defaultValue={v("make", dossier?.make)} autoComplete="off" />}
      </Field>
      <Field id="model" label="Modèle" error={e.model}>
        {(aria) => <Input {...aria} name="model" defaultValue={v("model", dossier?.model)} autoComplete="off" />}
      </Field>
      <Field id="modelYear" label="Année" error={e.modelYear}>
        {(aria) => (
          <Input {...aria} name="modelYear" inputMode="numeric" defaultValue={v("modelYear", dossier?.model_year)} />
        )}
      </Field>
      <Field id="mileage" label="Kilométrage (miles, compteur US)" error={e.mileage}>
        {(aria) => <Input {...aria} name="mileage" inputMode="numeric" defaultValue={v("mileage", dossier?.mileage)} />}
      </Field>
      <Field
        id="vehicleCategory"
        label="Catégorie"
        hint="Sert au contrôle de l’âge à l’importation"
        error={e.vehicleCategory}
      >
        {(aria) => (
          <Select {...aria} name="vehicleCategory" defaultValue={v("vehicleCategory", dossier?.vehicle_category)}>
            <option value="">— À préciser —</option>
            {Object.entries(VEHICLE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="titleStatus" label="Statut du titre" error={e.titleStatus}>
        {(aria) => <Input {...aria} name="titleStatus" defaultValue={v("titleStatus", dossier?.title_status)} />}
      </Field>
      <Field id="color" label="Couleur" error={e.color}>
        {(aria) => <Input {...aria} name="color" defaultValue={v("color", dossier?.color)} />}
      </Field>
      <Field id="purchaseLocation" label="Lieu d’achat" error={e.purchaseLocation}>
        {(aria) => (
          <Input {...aria} name="purchaseLocation" defaultValue={v("purchaseLocation", dossier?.purchase_location)} />
        )}
      </Field>
      <Field id="departurePort" label="Port de départ prévu" error={e.departurePort}>
        {(aria) => <Input {...aria} name="departurePort" defaultValue={v("departurePort", dossier?.departure_port)} />}
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field id="notes" label="Notes internes (facultatif)" error={e.notes}>
          {(aria) => <Textarea {...aria} name="notes" defaultValue={v("notes", dossier?.notes)} />}
        </Field>
      </div>
    </div>
  );
}

export interface ClientOption {
  id: string;
  name: string;
  notify_phone: string;
}

/** Ouverture d'un dossier : client + véhicule (tout est complétable plus tard, sauf le client). */
/**
 * Choix du client : liste affichée dans la page (pas de liste déroulante native, dont la fenêtre est placée par le
 * navigateur et pouvait masquer le début du nom). Nom et téléphone complets, recherche par nom ou numéro.
 */
function ClientPicker({ clients, defaultId, error }: { clients: ClientOption[]; defaultId: string; error?: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const matches = (c: ClientOption) =>
    !q || c.name.toLowerCase().includes(q) || (digits !== "" && c.notify_phone.replace(/\D/g, "").includes(digits));
  const visible = clients.filter(matches).length;
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? "clientId-erreur" : undefined}>
      <legend className="mb-1.5 text-sm font-medium">Client</legend>
      <label htmlFor="client-recherche" className="sr-only">
        Rechercher un client
      </label>
      <Input
        id="client-recherche"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher par nom ou téléphone…"
        autoComplete="off"
      />
      {/* La clé recrée la liste quand la valeur par défaut change (même raison que pour Select). */}
      <ul
        key={defaultId}
        className={cn("border-border bg-card max-h-72 overflow-y-auto rounded-lg border p-1", error && "border-danger")}
      >
        {clients.map((c) => (
          // Les clients filtrés restent dans la page (masqués) : un client déjà choisi reste envoyé avec le formulaire.
          <li key={c.id} hidden={!matches(c)}>
            <label className="has-[:checked]:bg-primary/10 has-[:checked]:ring-primary hover:bg-background has-[:focus-visible]:outline-primary flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-3 py-2 has-[:checked]:ring-1 has-[:focus-visible]:outline-2">
              <input
                type="radio"
                name="clientId"
                value={c.id}
                defaultChecked={c.id === defaultId}
                className="accent-primary mt-1 size-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium break-words">{c.name}</span>
                <span className="text-muted block text-xs tabular-nums">{c.notify_phone}</span>
              </span>
            </label>
          </li>
        ))}
        {visible === 0 && (
          <li className="text-muted px-3 py-2 text-sm">Aucun client ne correspond à « {query.trim()} ».</li>
        )}
      </ul>
      {error && (
        <p id="clientId-erreur" className="text-danger text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function NewDossierForm({ clients, clientId }: { clients: ClientOption[]; clientId?: string }) {
  const { state, pending, formProps } = useFormAction(createDossier);
  return (
    <form {...formProps} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <ClientPicker
        clients={clients}
        defaultId={state.data?.clientId ?? clientId ?? ""}
        error={state.fieldErrors?.clientId}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Véhicule</legend>
        <p className="text-muted text-sm">
          Informations connues à ce stade ; elles pourront être complétées avant la signature.
        </p>
        <VehicleFields state={state} />
      </fieldset>
      <div>
        <Button type="submit" pending={pending}>
          Ouvrir le dossier et générer le contrat
        </Button>
      </div>
    </form>
  );
}

export function VehicleForm({ dossier }: { dossier: DossierRow }) {
  const { state, pending, formProps } = useFormAction(updateVehicle);
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossier.id} />
      <VehicleFields state={state} dossier={dossier} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer le véhicule
        </Button>
      </div>
    </form>
  );
}

export function RegenerateContractForm({ dossierId, label }: { dossierId: string; label: string }) {
  const { state, pending, formProps } = useFormAction(regenerateContract);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}

/** R15 : décision du client sur le contrat ou l'ordre d'achat, avec preuve (scan signé ou capture WhatsApp). */
export function AcceptanceForm({
  dossierId,
  subject,
  subjectId,
  today,
  insurancePremium,
}: {
  dossierId: string;
  subject: "contract" | "purchase_order" | "quote" | "extra_cost";
  subjectId: string;
  today: string;
  /** Devis : prime de l'option C affichée avec le choix d'assurance (X1). */
  insurancePremium?: string;
}) {
  const { state, pending, formProps } = useFormAction(recordAcceptance);
  const [method, setMethod] = useState(state.data?.method ?? "scanned_paper");
  const e = state.fieldErrors ?? {};
  const isOrder = subject === "purchase_order";
  const isQuote = subject === "quote";
  const isExtraCost = subject === "extra_cost";
  const noun = isOrder ? "l’ordre d’achat" : isQuote ? "le devis" : isExtraCost ? "les frais" : "le contrat";
  const id = (name: string) => `${subject}-${name}`; // deux formulaires peuvent coexister sur la fiche
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Méthode</legend>
        {(["scanned_paper", "whatsapp"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="method"
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
            />
            {ACCEPTANCE_METHOD_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Décision du client</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="decision" value="accepted" defaultChecked={state.data?.decision !== "refused"} />
            Accepte {noun}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="decision" value="refused" defaultChecked={state.data?.decision === "refused"} />
            Refuse {noun}
          </label>
        </div>
      </fieldset>
      {isQuote && (
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={e.insuranceChoice ? id("insurance-erreur") : undefined}
        >
          <legend className="mb-1 text-sm font-medium">
            Assurance transport (option C{insurancePremium ? ` : ${insurancePremium}` : ""}) — choix du client
          </legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="insuranceChoice"
                value="accepted"
                defaultChecked={state.data?.insuranceChoice === "accepted"}
              />
              Accepte l’assurance
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="insuranceChoice"
                value="refused"
                defaultChecked={state.data?.insuranceChoice === "refused"}
              />
              Refuse l’assurance
            </label>
          </div>
          {e.insuranceChoice && (
            <p id={id("insurance-erreur")} className="text-danger text-xs">
              {e.insuranceChoice}
            </p>
          )}
        </fieldset>
      )}
      {isOrder && (
        <fieldset className="flex flex-col gap-2" aria-describedby={e.acknowledgements ? id("acks-erreur") : undefined}>
          <legend className="mb-1 text-sm font-medium">Confirmations cochées par le client sur l’ordre signé</legend>
          {PURCHASE_ORDER_ACKNOWLEDGEMENTS.map(([key, label]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name={`ack_${key}`}
                defaultChecked={state.data?.[`ack_${key}`] === "on"}
                className="mt-1"
              />
              <span>Le client {label}</span>
            </label>
          ))}
          {e.acknowledgements && (
            <p id={id("acks-erreur")} className="text-danger text-xs">
              {e.acknowledgements}
            </p>
          )}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={id("decidedOn")}
          label={method === "whatsapp" ? "Date du message" : "Date de signature"}
          error={e.decidedOn}
        >
          {(aria) => (
            <Input
              {...aria}
              name="decidedOn"
              type="date"
              max={today}
              defaultValue={state.data?.decidedOn ?? today}
              required
            />
          )}
        </Field>
        {isQuote && (
          <Field
            id={id("decidedTime")}
            label={method === "whatsapp" ? "Heure du message" : "Heure de signature"}
            hint="Le devis doit être accepté avant la fin de sa validité."
            error={e.decidedTime}
          >
            {(aria) => (
              <Input {...aria} name="decidedTime" type="time" defaultValue={state.data?.decidedTime ?? ""} required />
            )}
          </Field>
        )}
        {method === "whatsapp" && (
          <Field id={id("whatsappFrom")} label="Numéro émetteur du message" error={e.whatsappFrom}>
            {(aria) => (
              <Input
                {...aria}
                name="whatsappFrom"
                type="tel"
                inputMode="tel"
                defaultValue={state.data?.whatsappFrom ?? ""}
              />
            )}
          </Field>
        )}
        <Field
          id={id("proof")}
          label={
            method === "whatsapp"
              ? "Capture ou export du message"
              : isOrder
                ? "Ordre d’achat signé scanné"
                : isQuote
                  ? "Devis signé scanné"
                  : isExtraCost
                    ? "Accord écrit du client scanné"
                    : "Contrat signé scanné"
          }
          hint="PDF, JPEG, PNG, WebP ou HEIC — 20 Mo au plus"
          error={e.proof}
        >
          {(aria) => (
            <Input
              {...aria}
              name="proof"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              required
            />
          )}
        </Field>
      </div>
      <Field id={id("notes")} label="Remarque (facultatif)" error={e.notes}>
        {(aria) => <Textarea {...aria} name="notes" defaultValue={state.data?.notes ?? ""} />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          {isOrder
            ? "Enregistrer la décision sur l’ordre d’achat"
            : isQuote
              ? "Enregistrer la décision sur le devis"
              : isExtraCost
                ? "Enregistrer la décision sur les frais"
                : "Enregistrer la décision du client"}
        </Button>
      </div>
    </form>
  );
}

export function DuplicateDossierForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(duplicateDossier);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Dupliquer le dossier
        </Button>
      </div>
    </form>
  );
}
