"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CONFIRMATION_LABELS, DOCUMENT_KIND_LABELS, UPLOADABLE_DOCUMENT_KINDS } from "@/lib/dossiers/labels";
import type { ConfirmationCode, PurchaseOrderRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import {
  advanceStage,
  assignContainer,
  cancelDossier,
  changeStatus,
  confirmManually,
  overrideImportAge,
  recordAuctionResult,
  savePurchaseOrder,
  uploadDossierDocument,
} from "./actions";

/** Centimes → saisie en dollars (« 12450 » ou « 12450,50 »). */
const dollarsInput = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace(".", ",");

/** ISO → valeur d'un champ datetime-local (heure de Dakar = UTC). */
const dateTimeInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : "");

/** US-2.3 : conditions de l'ordre d'achat, puis génération du document à signer. */
export function PurchaseOrderForm({ dossierId, order }: { dossierId: string; order: PurchaseOrderRow | null }) {
  const { state, pending, formProps } = useFormAction(savePurchaseOrder);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="maxBid" label="Enchère maximale (USD)" error={e.maxBid}>
          {(aria) => (
            <Input
              {...aria}
              name="maxBid"
              inputMode="decimal"
              defaultValue={state.data?.maxBid ?? dollarsInput(order?.max_bid_cents)}
              required
            />
          )}
        </Field>
        <Field
          id="deposit"
          label="Dépôt attendu (USD)"
          hint="Forfait A estimé (I2) ; encaissement en phase 3"
          error={e.deposit}
        >
          {(aria) => (
            <Input
              {...aria}
              name="deposit"
              inputMode="decimal"
              defaultValue={state.data?.deposit ?? dollarsInput(order?.deposit_cents)}
            />
          )}
        </Field>
        <Field id="auctionAt" label="Date et heure de l’enchère (Dakar)" error={e.auctionAt}>
          {(aria) => (
            <Input
              {...aria}
              name="auctionAt"
              type="datetime-local"
              defaultValue={state.data?.auctionAt ?? dateTimeInput(order?.auction_at)}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          {order?.document_id ? "Enregistrer et régénérer l’ordre d’achat" : "Enregistrer et générer l’ordre d’achat"}
        </Button>
      </div>
    </form>
  );
}

/** Dérogation au contrôle de l'âge (administrateur seulement, motif journalisé). */
export function AgeOverrideForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(overrideImportAge);
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field id="age-reason" label="Motif de la dérogation" error={state.fieldErrors?.reason}>
        {(aria) => <Textarea {...aria} name="reason" defaultValue={state.data?.reason ?? ""} required />}
      </Field>
      <div>
        <Button type="submit" variant="danger" pending={pending}>
          Déroger au contrôle de l’âge
        </Button>
      </div>
    </form>
  );
}

/** US-2.4 : lot remporté (prix, notification) ou non remporté. */
export function AuctionResultForm({ dossierId, isAdmin }: { dossierId: string; isAdmin: boolean }) {
  const { state, pending, formProps } = useFormAction(recordAuctionResult);
  const [result, setResult] = useState(state.data?.result ?? "won");
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 w-full text-sm font-medium">Résultat</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="result" value="won" checked={result === "won"} onChange={() => setResult("won")} />
          Lot remporté
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="result"
            value="lost"
            checked={result === "lost"}
            onChange={() => setResult("lost")}
          />
          Lot non remporté (le dossier sera clôturé)
        </label>
      </fieldset>
      {result === "won" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="hammerPrice" label="Prix d’adjudication (USD)" error={e.hammerPrice}>
            {(aria) => (
              <Input {...aria} name="hammerPrice" inputMode="decimal" defaultValue={state.data?.hammerPrice ?? ""} />
            )}
          </Field>
          <Field
            id="notifiedAt"
            label="Notification du lot remporté (Dakar)"
            hint="Point de départ de l’échéance du paiement 1"
            error={e.notifiedAt}
          >
            {(aria) => (
              <Input {...aria} name="notifiedAt" type="datetime-local" defaultValue={state.data?.notifiedAt ?? ""} />
            )}
          </Field>
          {isAdmin && (
            <div className="sm:col-span-2">
              <Field
                id="overrideReason"
                label="Motif si le prix dépasse l’enchère maximale (administrateur)"
                error={e.overrideReason}
              >
                {(aria) => <Textarea {...aria} name="overrideReason" defaultValue={state.data?.overrideReason ?? ""} />}
              </Field>
            </div>
          )}
        </div>
      )}
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer le résultat de l’enchère
        </Button>
      </div>
    </form>
  );
}

/** Hypothèse P1 : confirmation manuelle d'un élément financier (journalisée). */
export function ConfirmForm({ dossierId, code }: { dossierId: string; code: ConfirmationCode }) {
  const { state, pending, formProps } = useFormAction(confirmManually);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="code" value={code} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Confirmer : {CONFIRMATION_LABELS[code].toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

/** US-2.5 / R13 : passage à l'étape suivante ; l'administrateur peut forcer avec un motif. */
export function AdvanceStageForm({
  dossierId,
  ready,
  isAdmin,
  nextLabel,
}: {
  dossierId: string;
  ready: boolean;
  isAdmin: boolean;
  nextLabel: string;
}) {
  const { state, pending, formProps } = useFormAction(advanceStage);
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      {!ready && isAdmin && (
        <Field
          id="stage-reason"
          label="Motif de l’exception (administrateur)"
          hint="Obligatoire pour passer malgré les conditions manquantes ; journalisé."
          error={state.fieldErrors?.reason}
        >
          {(aria) => <Textarea {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
        </Field>
      )}
      <div>
        <Button type="submit" variant={ready ? "primary" : "secondary"} pending={pending} disabled={!ready && !isAdmin}>
          {ready
            ? `Passer à l’étape ${nextLabel}`
            : isAdmin
              ? `Passer à l’étape ${nextLabel} par exception`
              : `Passer à l’étape ${nextLabel}`}
        </Button>
      </div>
    </form>
  );
}

/** US-2.5 : statut à l'intérieur de l'étape en cours. */
export function StatusForm({
  dossierId,
  current,
  options,
}: {
  dossierId: string;
  current: string;
  options: { code: string; label: string }[];
}) {
  const { state, pending, formProps } = useFormAction(changeStatus);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field id="status" label="Statut dans l’étape">
          {(aria) => (
            <Select {...aria} name="status" defaultValue={current}>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" pending={pending}>
          Enregistrer le statut
        </Button>
      </div>
    </form>
  );
}

/** Annulation (Ouverture ou Achat), motif obligatoire. */
export function CancelDossierForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(cancelDossier);
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field id="cancel-reason" label="Motif de l’annulation" error={state.fieldErrors?.reason}>
        {(aria) => <Textarea {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
      </Field>
      <div>
        <Button type="submit" variant="danger" pending={pending}>
          Annuler le dossier
        </Button>
      </div>
    </form>
  );
}

/** US-2.6 / B4 : associer le véhicule à un conteneur ou le changer de conteneur (motif obligatoire). */
export function AssignContainerForm({
  dossierId,
  options,
  changing,
}: {
  dossierId: string;
  options: { id: string; number: string; eta: string | null }[];
  changing: boolean;
}) {
  const { state, pending, formProps } = useFormAction(assignContainer);
  const e = state.fieldErrors ?? {};
  if (options.length === 0) {
    return <p className="text-muted text-sm">Aucun autre conteneur en cours : créez-le dans l’écran Conteneurs.</p>;
  }
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field id="assign-container" label={changing ? "Nouveau conteneur" : "Conteneur"} error={e.containerId}>
        {(aria) => (
          <Select {...aria} name="containerId" defaultValue={state.data?.containerId ?? ""}>
            <option value="">— Choisir —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {changing && (
        <Field id="assign-reason" label="Motif du changement" error={e.reason}>
          {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
        </Field>
      )}
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          {changing ? "Changer de conteneur" : "Associer au conteneur"}
        </Button>
      </div>
    </form>
  );
}

/** Ajout d'un document au dossier (facture d'enchère, preuve de prise en charge…). */
export function UploadDocumentForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(uploadDossierDocument, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="doc-kind" label="Type de document" error={e.kind}>
          {(aria) => (
            <Select {...aria} name="kind" defaultValue="">
              <option value="">— Choisir —</option>
              {UPLOADABLE_DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {DOCUMENT_KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="doc-file" label="Fichier" hint="PDF, JPEG, PNG, WebP ou HEIC — 20 Mo au plus" error={e.file}>
          {(aria) => (
            <Input
              {...aria}
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="visibleClient" />
        Visible du client
      </label>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Ajouter le document
        </Button>
      </div>
    </form>
  );
}
