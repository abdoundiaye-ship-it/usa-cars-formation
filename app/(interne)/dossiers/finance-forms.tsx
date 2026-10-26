"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { COST_CATEGORIES, COST_CATEGORY_LABELS, SECTION_LABELS } from "@/lib/finance/labels";
import type { DossierForfaitsRow, InternalCostRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { deleteInternalCost, saveForfaits, saveInternalCost } from "./finance-actions";

/** Centimes → saisie en dollars (« 11500 » ou « 11500,50 »). */
const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace(".", ",");

/** US-3.2 : forfaits A et B et prime d'assurance C (décision I4). */
export function ForfaitsForm({ dossierId, forfaits }: { dossierId: string; forfaits: DossierForfaitsRow | null }) {
  const { state, pending, formProps } = useFormAction(saveForfaits);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="forfaitA" label="Forfait A — acquisition (USD)" error={e.forfaitA}>
          {(aria) => (
            <Input
              {...aria}
              name="forfaitA"
              inputMode="decimal"
              defaultValue={state.data?.forfaitA ?? dollars(forfaits?.forfait_a_cents)}
            />
          )}
        </Field>
        <Field id="forfaitB" label="Forfait B — logistique et maritime (USD)" error={e.forfaitB}>
          {(aria) => (
            <Input
              {...aria}
              name="forfaitB"
              inputMode="decimal"
              defaultValue={state.data?.forfaitB ?? dollars(forfaits?.forfait_b_cents)}
            />
          )}
        </Field>
        <Field id="insurance" label="Prime d’assurance C (USD, facultative)" error={e.insurance}>
          {(aria) => (
            <Input
              {...aria}
              name="insurance"
              inputMode="decimal"
              defaultValue={state.data?.insurance ?? dollars(forfaits?.insurance_cents)}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer les forfaits
        </Button>
      </div>
    </form>
  );
}

/** US-3.1 : ajout (ou modification, si `cost`) d'un poste de coût interne. */
export function InternalCostForm({ dossierId, cost }: { dossierId: string; cost?: InternalCostRow }) {
  const { state, pending, formProps } = useFormAction(saveInternalCost, { resetOnSuccess: !cost });
  const e = state.fieldErrors ?? {};
  const id = (name: string) => `${cost ? `cost-${cost.id}` : "cost-new"}-${name}`;
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      {cost && (
        <>
          <input type="hidden" name="costId" value={cost.id} />
          <input type="hidden" name="category" value={cost.category} />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {!cost && (
          <Field id={id("category")} label="Poste" error={e.category}>
            {(aria) => (
              <Select {...aria} name="category" defaultValue={state.data?.category ?? ""}>
                <option value="">— Choisir —</option>
                {(["A", "B"] as const).map((section) => (
                  <optgroup key={section} label={SECTION_LABELS[section]}>
                    {COST_CATEGORIES[section].map((c) => (
                      <option key={c} value={c}>
                        {COST_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field id={id("label")} label="Précision (facultatif)" error={e.label}>
          {(aria) => <Input {...aria} name="label" defaultValue={state.data?.label ?? cost?.label ?? ""} />}
        </Field>
        <Field id={id("amount")} label="Montant (USD)" error={e.amount}>
          {(aria) => (
            <Input
              {...aria}
              name="amount"
              inputMode="decimal"
              defaultValue={state.data?.amount ?? dollars(cost?.amount_cents)}
            />
          )}
        </Field>
        <Field id={id("status")} label="Montant" error={e.status}>
          {(aria) => (
            <Select {...aria} name="status" defaultValue={state.data?.status ?? cost?.status ?? "estimated"}>
              <option value="estimated">Estimé</option>
              <option value="final">Définitif</option>
            </Select>
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          {cost ? "Enregistrer le coût" : "Ajouter le coût"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteCostButton({ dossierId, costId, label }: { dossierId: string; costId: string; label: string }) {
  const { state, pending, formProps } = useFormAction(deleteInternalCost);
  return (
    <form {...formProps}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="costId" value={costId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le coût : ${label}`}
        className="text-danger text-xs underline underline-offset-2 disabled:opacity-60"
      >
        Supprimer
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-danger text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
