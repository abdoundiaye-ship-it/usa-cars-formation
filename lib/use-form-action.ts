"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { initialFormState, type FormState } from "@/lib/forms";

type ServerAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * Soumet un formulaire à une action serveur SANS la réinitialisation automatique de React 19 (`<form action>`) :
 * cette réinitialisation survient juste après la réponse et effaçait la saisie (et le fichier joint) qu'un agent
 * venait de corriger après une erreur. Ici, la saisie reste telle quelle ; `resetOnSuccess` vide le formulaire
 * après un succès (formulaires d'ajout).
 */
export function useFormAction(action: ServerAction, { resetOnSuccess = false } = {}) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === "success") formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Le bouton cliqué (name/value) fait partie de la saisie : ex. « Ajouter au solde » / « Écarter ».
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => dispatch(formData));
  };

  return { state, pending, formProps: { ref: formRef, onSubmit } };
}
