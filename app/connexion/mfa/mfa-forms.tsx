"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { initialFormState, type FormState } from "@/lib/forms";
import { startEnrollment, verifyMfaCode } from "./actions";

function CodeForm({ factorId, suite, mode }: { factorId: string; suite: string; mode: "enroll" | "verify" }) {
  const [state, action, pending] = useActionState(verifyMfaCode, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="suite" value={suite} />
      <input type="hidden" name="mode" value={mode} />
      <Field
        id="code"
        label="Code à 6 chiffres"
        hint="Code affiché par votre application d’authentification (Google Authenticator, Microsoft Authenticator…)."
        error={state.fieldErrors?.code}
      >
        {(aria) => (
          <Input
            {...aria}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="tracking-[0.3em]"
          />
        )}
      </Field>
      <Button type="submit" pending={pending}>
        {pending ? "Vérification…" : "Valider le code"}
      </Button>
    </form>
  );
}

export function MfaVerifyForm({ factorId, suite }: { factorId: string; suite: string }) {
  return <CodeForm factorId={factorId} suite={suite} mode="verify" />;
}

export function MfaEnrollForm({ suite }: { suite: string }) {
  const [state, action, pending] = useActionState<FormState>(startEnrollment, initialFormState);
  const enrollment = state.status === "success" ? state.data : undefined;

  if (!enrollment?.factorId || !enrollment.qrCode || !enrollment.secret) {
    return (
      <form action={action} className="flex flex-col gap-4">
        <FormMessage state={state} />
        <p className="text-sm">
          Votre rôle exige une double authentification. Installez une application d’authentification sur votre
          téléphone, puis lancez la configuration.
        </p>
        <Button type="submit" pending={pending}>
          {pending ? "Préparation…" : "Configurer la double authentification"}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Ouvrez votre application d’authentification et scannez ce QR code.</li>
        <li>Saisissez ensuite le code à 6 chiffres qu’elle affiche.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- QR code SVG fourni en data URL par Supabase */}
      <img
        src={enrollment.qrCode}
        alt="QR code de configuration de la double authentification"
        width={180}
        height={180}
        className="self-center rounded-md bg-white p-2"
      />
      <p className="text-sm">
        Impossible de scanner ? Saisissez cette clé dans l’application :{" "}
        <code data-testid="totp-secret" className="bg-background rounded px-1 py-0.5 break-all">
          {enrollment.secret}
        </code>
      </p>
      <CodeForm factorId={enrollment.factorId} suite={suite} mode="enroll" />
    </div>
  );
}
