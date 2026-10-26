import { CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "border-border bg-background text-foreground",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-info/25 bg-info-soft text-info",
};

const toneIcons: Record<Tone, LucideIcon> = {
  neutral: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: TriangleAlert,
  info: Info,
};

export function Badge({
  tone = "neutral",
  icon: Icon,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: LucideIcon }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}

/** Message dans la page, avec l'icône de son ton. role="alert" pour les erreurs, "status" sinon. */
export function Alert({
  tone = "info",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", toneClasses[tone], className)}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("border-border bg-card rounded-xl border p-4 sm:p-6", className)} {...props} />;
}

/** Indicateur chiffré du tableau de bord : libellé, valeur, précision, icône. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: LucideIcon;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted min-w-0 text-sm font-medium">{label}</p>
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
      {/* Taille réduite sur petit écran : un montant (espaces insécables, non coupable) ne déborde pas la tuile. */}
      <p className={cn("amount text-xl font-bold break-words sm:text-2xl", tone === "danger" && "text-danger")}>
        {value}
      </p>
      {hint && <p className="text-muted text-xs">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  icon: Icon = Info,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      <span aria-hidden className="bg-primary-soft text-primary flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-muted text-sm">{children}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted mt-1 text-sm">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
