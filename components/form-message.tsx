import { Alert } from "@/components/ui/feedback";
import type { FormState } from "@/lib/forms";

/** Message global d’un formulaire (succès ou erreur), annoncé aux lecteurs d’écran. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}
