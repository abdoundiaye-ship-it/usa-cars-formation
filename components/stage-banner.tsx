import { Check } from "lucide-react";
import { STAGE_LABELS, STAGES } from "@/lib/dossiers/labels";
import type { DossierStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** Fil des 7 étapes du dossier (docs/14_ecrans_ux.md) : terminées (✓), en cours, à venir. Passe à la ligne au besoin. */
export function StageBanner({ stage }: { stage: DossierStage }) {
  const current = STAGES.indexOf(stage);
  return (
    <nav aria-label="Étapes du dossier">
      <ol className="flex flex-wrap items-center gap-1.5">
        {STAGES.map((s, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          return (
            <li key={s}>
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                  state === "done" && "border-primary/30 bg-primary-soft text-primary",
                  state === "current" && "border-primary bg-primary text-primary-foreground shadow-sm",
                  state === "todo" && "border-border text-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-bold",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" && "text-primary-foreground bg-white/25",
                    state === "todo" && "border-border border",
                  )}
                >
                  {state === "done" ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                <span className="sr-only">
                  {state === "done"
                    ? "Étape terminée : "
                    : state === "current"
                      ? "Étape en cours : "
                      : "Étape à venir : "}
                </span>
                {STAGE_LABELS[s]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
