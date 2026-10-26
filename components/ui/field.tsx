import { cn } from "@/lib/utils";

const controlClass =
  "block w-full min-h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary " +
  "aria-[invalid=true]:border-danger disabled:opacity-60";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // React ne met pas à jour la valeur par défaut d'une liste déjà affichée : après une erreur, la réinitialisation
  // du formulaire la remettrait à vide. La clé recrée la liste quand sa valeur par défaut change (saisie conservée).
  return <select key={String(props.defaultValue ?? "")} className={cn(controlClass, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, "min-h-20", className)} {...props} />;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (aria: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
}

/** Champ de formulaire : libellé, aide et message d’erreur reliés au contrôle (accessibilité). */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const describedBy = [hint ? `${id}-aide` : null, error ? `${id}-erreur` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && (
        <p id={`${id}-aide`} className="text-muted text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-erreur`} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
