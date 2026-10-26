import { STAGES } from "@/lib/dossiers/labels";
import type { DossierStage } from "@/lib/supabase/database.types";

const PORTAL_STAGE_LABELS: Record<DossierStage, string> = {
  opening: "Ouverture",
  purchase: "Achat",
  us_transport: "Transport USA",
  container: "Mise en conteneur",
  ocean: "Transport maritime",
  dakar: "Arrivée à Dakar",
  closing: "Clôture",
};

/** Barre d'avancement d'un dossier pour le client (étape en cours sur les 7 étapes). */
export function ClientStageProgress({ stage }: { stage: DossierStage }) {
  const index = STAGES.indexOf(stage);
  const percent = Math.round((index / (STAGES.length - 1)) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted flex items-center justify-between text-xs">
        <span>
          Étape {index + 1} sur {STAGES.length}
        </span>
        <span className="text-foreground font-medium">{PORTAL_STAGE_LABELS[stage]}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STAGES.length}
        aria-valuenow={index + 1}
        aria-label={`Avancement : ${PORTAL_STAGE_LABELS[stage]}`}
        className="bg-chart-track h-2 overflow-hidden rounded-full"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${Math.max(percent, 6)}%` }} />
      </div>
    </div>
  );
}
