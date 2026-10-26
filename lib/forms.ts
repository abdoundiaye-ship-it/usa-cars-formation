import type { z } from "zod";

/** État renvoyé par une action serveur à un formulaire (useActionState). */
export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Données à réafficher (ex. secret TOTP lors de l’enrôlement). */
  data?: Record<string, string>;
}

export const initialFormState: FormState = { status: "idle" };

/** Premier message d’erreur par champ. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_");
    result[field] ??= issue.message;
  }
  return result;
}

export function invalid(error: z.ZodError, message = "Certains champs sont à corriger."): FormState {
  return { status: "error", message, fieldErrors: fieldErrorsOf(error) };
}

export function failure(message: string): FormState {
  return { status: "error", message };
}

export function success(message: string, data?: Record<string, string>): FormState {
  return { status: "success", message, data };
}

/** FormData → objet simple (valeurs texte uniquement). */
export function formObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

/** Renvoie aussi les valeurs saisies : React vide le formulaire après l'envoi, elles sont réaffichées en cas d'erreur. */
export function withValues(state: FormState, formData: FormData): FormState {
  return state.status === "error" ? { ...state, data: { ...formObject(formData), ...state.data } } : state;
}
