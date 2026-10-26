"use client";

import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { dispatchNow, retryNotification, sendTestNotification } from "./actions";

function ActionButton({
  action,
  label,
  variant,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  variant?: "secondary";
}) {
  const { state, pending, formProps } = useFormAction(action);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant={variant} pending={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}

export const DispatchNowButton = () => (
  <ActionButton action={async () => dispatchNow()} label="Envoyer maintenant" variant="secondary" />
);

export const TestNotificationButton = () => (
  <ActionButton action={async () => sendTestNotification()} label="Envoyer un message de test" variant="secondary" />
);

export function RetryNotificationButton({ id }: { id: string }) {
  const { state, pending, formProps } = useFormAction(retryNotification);
  return (
    <form {...formProps}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-primary text-xs underline underline-offset-2 disabled:opacity-60"
      >
        Renvoyer
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-danger text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
