import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap " +
  "transition-colors focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-border bg-card text-foreground hover:bg-background",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-primary hover:bg-primary-soft",
};

/** Classes d'un bouton : aussi pour un lien présenté comme un bouton (`<Link className={buttonClasses()}>`). */
export function buttonClasses(variant: Variant = "primary", className?: string) {
  return cn(base, variants[variant], className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pending?: boolean;
}

export function Button({ variant = "primary", pending, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
