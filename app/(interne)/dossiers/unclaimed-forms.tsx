"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { LETTER_SENDING_CHANNEL_LABELS, PROCEDURE_CLOSING_STATUS_LABELS } from "@/lib/dossiers/labels";
import { useFormAction } from "@/lib/use-form-action";
import {
  cancelUnclaimedLetter,
  closeUnclaimedProcedure,
  generateLetterFile,
  issueUnclaimedLetter,
  openUnclaimedProcedure,
  recordLetterSent,
} from "./unclaimed-actions";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";
const HINT = "Accusé signé, capture de l’e-mail ou du message, reçu du coursier — PDF ou image, 20 Mo au plus";

/** Émission d'une lettre de relance ou d'une mise en demeure (délai de régularisation ≥ minimum du contrat). */
export function IssueLetterForm({
  dossierId,
  kind,
  minCureDays,
}: {
  dossierId: string;
  kind: "reminder" | "formal_notice";
  minCureDays: number;
}) {
  const { state, pending, formProps } = useFormAction(issueUnclaimedLetter);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="kind" value={kind} />
      {kind === "formal_notice" && (
        <Field
          id="letter-cure-days"
          label="Délai de régularisation (jours)"
          hint={`Au moins ${minCureDays} jours à compter de la réception (contrat art. 21)`}
          error={e.cureDays}
        >
          {(aria) => (
            <Input
              {...aria}
              name="cureDays"
              type="number"
              inputMode="numeric"
              min={minCureDays}
              defaultValue={state.data?.cureDays ?? String(minCureDays)}
              className="max-w-32"
            />
          )}
        </Field>
      )}
      <div>
        <Button type="submit" pending={pending}>
          {kind === "reminder" ? "Émettre la lettre de relance" : "Émettre la mise en demeure"}
        </Button>
      </div>
    </form>
  );
}

/** Nouvelle tentative de génération du fichier Word d'un courrier émis. */
export function GenerateLetterFileForm({ dossierId, letterId }: { dossierId: string; letterId: string }) {
  const { state, pending, formProps } = useFormAction(generateLetterFile);
  return (
    <form {...formProps} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="letterId" value={letterId} />
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Générer le fichier
        </Button>
      </div>
    </form>
  );
}

/** U4 : envoi du courrier (date, canal, preuve) ; le client le voit ensuite dans son espace. */
export function LetterSentForm({
  dossierId,
  letterId,
  issuedOn,
  today,
}: {
  dossierId: string;
  letterId: string;
  issuedOn: string;
  today: string;
}) {
  const { state, pending, formProps } = useFormAction(recordLetterSent);
  const e = state.fieldErrors ?? {};
  const prefix = `letter-${letterId}`;
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="letterId" value={letterId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-sent-on`} label="Date d’envoi" error={e.sentOn}>
          {(aria) => (
            <Input
              {...aria}
              name="sentOn"
              type="date"
              min={issuedOn}
              max={today}
              defaultValue={state.data?.sentOn ?? today}
            />
          )}
        </Field>
        <Field id={`${prefix}-channel`} label="Envoyé par" error={e.channel}>
          {(aria) => (
            <Select {...aria} name="channel" defaultValue={state.data?.channel ?? ""}>
              <option value="" disabled>
                Choisir…
              </option>
              {Object.entries(LETTER_SENDING_CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${prefix}-proof`} label="Preuve d’envoi" hint={HINT} error={e.proof}>
          {(aria) => <Input {...aria} name="proof" type="file" accept={ACCEPT} required />}
        </Field>
        <Field id={`${prefix}-note`} label="Précision (facultatif)" error={e.note}>
          {(aria) => <Input {...aria} name="note" defaultValue={state.data?.note ?? ""} />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer l’envoi
        </Button>
      </div>
    </form>
  );
}

/** Annulation d'un courrier non envoyé (erreur), motif obligatoire ; le numéro reste consommé. */
export function CancelLetterForm({ dossierId, letterId }: { dossierId: string; letterId: string }) {
  const { state, pending, formProps } = useFormAction(cancelUnclaimedLetter);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="letterId" value={letterId} />
      <Field id={`cancel-letter-${letterId}`} label="Motif de l’annulation" error={e.reason}>
        {(aria) => <Input {...aria} name="reason" defaultValue={state.data?.reason ?? ""} />}
      </Field>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Annuler le courrier
        </Button>
      </div>
    </form>
  );
}

/** Ouverture de la procédure (art. 22) : aucune action sur la propriété du véhicule (R11). */
export function OpenProcedureForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(openUnclaimedProcedure);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field
        id="procedure-reason"
        label="Motif de l’ouverture"
        hint="Ex. mise en demeure restée sans suite, client injoignable"
        error={e.reason}
      >
        {(aria) => <Textarea {...aria} name="reason" rows={2} defaultValue={state.data?.reason ?? ""} />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          Ouvrir la procédure de non-réclamation
        </Button>
      </div>
    </form>
  );
}

/** Clôture de la procédure : issue décrite et statut final du dossier. */
export function CloseProcedureForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(closeUnclaimedProcedure);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="procedure-outcome" label="Issue de la procédure" error={e.outcome}>
          {(aria) => (
            <Textarea
              {...aria}
              name="outcome"
              rows={2}
              placeholder="Ex. solde réglé et véhicule enlevé ; autorisation de vente obtenue"
              defaultValue={state.data?.outcome ?? ""}
            />
          )}
        </Field>
        <Field id="procedure-status" label="Statut du dossier" error={e.closingStatus}>
          {(aria) => (
            <Select {...aria} name="closingStatus" defaultValue={state.data?.closingStatus ?? ""}>
              <option value="" disabled>
                Choisir…
              </option>
              {Object.entries(PROCEDURE_CLOSING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" pending={pending}>
          Clôturer la procédure
        </Button>
      </div>
    </form>
  );
}
