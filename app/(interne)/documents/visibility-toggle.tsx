"use client";

import { Badge } from "@/components/ui/feedback";
import { useFormAction } from "@/lib/use-form-action";
import { setDocumentVisibility } from "./actions";

/** Bascule « visible du client / interne » d'un document (US-2.8). */
export function VisibilityToggle({
  documentId,
  visible,
  label,
}: {
  documentId: string;
  visible: boolean;
  label: string;
}) {
  const { state, pending, formProps } = useFormAction(setDocumentVisibility);
  return (
    <form {...formProps} className="flex flex-col items-start gap-1">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="visible" value={visible ? "false" : "true"} />
      {visible ? <Badge tone="info">Visible</Badge> : <Badge>Interne</Badge>}
      <button
        type="submit"
        disabled={pending}
        aria-label={`${visible ? "Rendre interne" : "Rendre visible du client"} : ${label}`}
        className="text-primary text-xs underline underline-offset-2 disabled:opacity-60"
      >
        {visible ? "Rendre interne" : "Rendre visible"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-danger text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}
