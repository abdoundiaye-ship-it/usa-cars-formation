"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/lib/use-form-action";
import { Field, Input, Textarea } from "@/components/ui/field";
import { decideInPortal, fileClaimByClient } from "./actions";

/** Case de consentement + boutons : la décision porte sur la version affichée (empreinte, R15). */
function Consent({ text, error }: { text: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consent"
          className="mt-1"
          aria-describedby={error ? "consent-erreur" : undefined}
        />
        <span>{text}</span>
      </label>
      {error && (
        <p id="consent-erreur" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** US-4.2 : acceptation du devis dans le portail, avec le choix d'assurance (X1). */
export function QuoteDecisionForm({
  dossierId,
  quoteId,
  sha256,
  insurancePremium,
}: {
  dossierId: string;
  quoteId: string;
  sha256: string;
  insurancePremium: string;
}) {
  const { state, pending, formProps } = useFormAction(decideInPortal);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="subject" value="quote" />
      <input type="hidden" name="subjectId" value={quoteId} />
      <input type="hidden" name="sha256" value={sha256} />
      <fieldset className="flex flex-col gap-2" aria-describedby={e.insuranceChoice ? "insurance-erreur" : undefined}>
        <legend className="mb-1 text-sm font-medium">
          Assurance transport maritime (option C : {insurancePremium})
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="insuranceChoice" value="accepted" />
          Je souhaite l’assurance transport
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="insuranceChoice" value="refused" />
          Je refuse l’assurance et j’en assume les conséquences (article 24 du contrat)
        </label>
        {e.insuranceChoice && (
          <p id="insurance-erreur" className="text-danger text-xs">
            {e.insuranceChoice}
          </p>
        )}
      </fieldset>
      <Consent
        text="J’ai lu le devis affiché et je confirme ma décision ainsi que mon choix relatif à l’assurance transport. Je reconnais que le montant en USD fait foi."
        error={e.consent}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="accepted" pending={pending}>
          Accepter le devis
        </Button>
        <Button type="submit" name="decision" value="refused" variant="secondary" pending={pending}>
          Refuser le devis
        </Button>
      </div>
    </form>
  );
}

/** US-4.4 : approbation ou refus de frais supplémentaires (R7), sur le justificatif présenté. */
export function ExtraCostDecisionForm({
  dossierId,
  adjustmentId,
  sha256,
}: {
  dossierId: string;
  adjustmentId: string;
  sha256: string;
}) {
  const { state, pending, formProps } = useFormAction(decideInPortal);
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="subject" value="extra_cost" />
      <input type="hidden" name="subjectId" value={adjustmentId} />
      <input type="hidden" name="sha256" value={sha256} />
      <Consent text="J’ai consulté le justificatif et je confirme ma décision sur ces frais." error={e.consent} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="accepted" pending={pending}>
          Approuver les frais
        </Button>
        <Button type="submit" name="decision" value="refused" variant="secondary" pending={pending}>
          Refuser les frais
        </Button>
      </div>
    </form>
  );
}

/** Lot 6d (contrat art. 19) : le client signale une réclamation après l'enlèvement, avec une photo facultative. */
export function FileClaimPortalForm({ dossierId }: { dossierId: string }) {
  const { state, pending, formProps } = useFormAction(fileClaimByClient, { resetOnSuccess: true });
  const e = state.fieldErrors ?? {};
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="dossierId" value={dossierId} />
      <Field id="portal-claim-reserves" label="Décrivez le problème constaté" error={e.reserves}>
        {(aria) => <Textarea {...aria} name="reserves" rows={3} defaultValue={state.data?.reserves ?? ""} />}
      </Field>
      <Field id="portal-claim-photo" label="Photo (facultatif)" hint="JPEG, PNG, WebP, HEIC ou PDF, 20 Mo max.">
        {(aria) => <Input {...aria} type="file" name="photo" accept="image/*,application/pdf" />}
      </Field>
      <div>
        <Button type="submit" pending={pending}>
          Envoyer la réclamation
        </Button>
      </div>
    </form>
  );
}
