"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ACCOUNT_KIND_LABELS } from "@/lib/finance/labels";
import type { OfficialAccountKind, OfficialAccountRow } from "@/lib/supabase/database.types";
import { useFormAction } from "@/lib/use-form-action";
import { approveAccount, createAccount, deactivateAccount } from "./actions";

/** US-3.10 : nouveau compte, ou remplacement d'un compte actif (`replaces`). */
export function AccountForm({ replaces }: { replaces?: OfficialAccountRow }) {
  const { state, pending, formProps } = useFormAction(createAccount, { resetOnSuccess: true });
  const [kind, setKind] = useState<OfficialAccountKind>(replaces?.kind ?? "bank");
  const e = state.fieldErrors ?? {};
  const v = (name: string, saved: string | null | undefined) => state.data?.[name] ?? saved ?? "";
  const id = (name: string) => `${replaces ? `replace-${replaces.id}` : "account-new"}-${name}`;
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {replaces && <input type="hidden" name="replacesId" value={replaces.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("kind")} label="Type" error={e.kind}>
          {(aria) => (
            <Select
              {...aria}
              name="kind"
              defaultValue={kind}
              onChange={(event) => setKind(event.currentTarget.value as OfficialAccountKind)}
            >
              {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={id("label")} label="Libellé" hint="Ex. Compte CBAO principal" error={e.label}>
          {(aria) => <Input {...aria} name="label" defaultValue={v("label", replaces?.label)} />}
        </Field>
        <Field id={id("holderName")} label="Titulaire" error={e.holderName}>
          {(aria) => <Input {...aria} name="holderName" defaultValue={v("holderName", replaces?.holder_name)} />}
        </Field>
        {kind === "bank" && (
          <>
            <Field id={id("bankName")} label="Banque" error={e.bankName}>
              {(aria) => <Input {...aria} name="bankName" defaultValue={v("bankName", replaces?.bank_name)} />}
            </Field>
            <Field id={id("accountNumber")} label="Numéro de compte" error={e.accountNumber}>
              {(aria) => (
                <Input {...aria} name="accountNumber" defaultValue={v("accountNumber", replaces?.account_number)} />
              )}
            </Field>
            <Field id={id("iban")} label="IBAN" error={e.iban}>
              {(aria) => <Input {...aria} name="iban" defaultValue={v("iban", replaces?.iban)} />}
            </Field>
            <Field id={id("swift")} label="SWIFT / BIC" error={e.swift}>
              {(aria) => <Input {...aria} name="swift" defaultValue={v("swift", replaces?.swift)} />}
            </Field>
          </>
        )}
        {(kind === "wave" || kind === "orange_money") && (
          <Field id={id("phone")} label="Numéro du compte" hint="+221 77 …" error={e.phone}>
            {(aria) => <Input {...aria} name="phone" type="tel" defaultValue={v("phone", replaces?.phone)} />}
          </Field>
        )}
      </div>
      <Field id={id("instructions")} label="Instructions pour le client (facultatif)" error={e.instructions}>
        {(aria) => <Textarea {...aria} name="instructions" defaultValue={v("instructions", replaces?.instructions)} />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          {replaces ? "Enregistrer le compte de remplacement" : "Enregistrer le compte"}
        </Button>
      </div>
    </form>
  );
}

export function ApproveAccountForm({ accountId, label }: { accountId: string; label: string }) {
  const { state, pending, formProps } = useFormAction(approveAccount);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="accountId" value={accountId} />
      <div>
        <Button type="submit" pending={pending} aria-label={`Approuver le compte ${label}`}>
          Approuver et activer
        </Button>
      </div>
    </form>
  );
}

export function DeactivateAccountForm({ accountId }: { accountId: string }) {
  const { state, pending, formProps } = useFormAction(deactivateAccount);
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="accountId" value={accountId} />
      <Field id={`deactivate-${accountId}`} label="Motif de la désactivation" error={state.fieldErrors?.reason}>
        {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
      </Field>
      <div>
        <Button type="submit" variant="danger" pending={pending}>
          Désactiver le compte
        </Button>
      </div>
    </form>
  );
}
