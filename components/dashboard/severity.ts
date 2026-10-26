import { Clock, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Severity } from "@/lib/dashboard";

/** Gravité d'un élément « À traiter » : ton, libellé et icône (jamais la couleur seule). */
export const SEVERITY_DISPLAY: Record<
  Severity,
  { tone: "danger" | "warning" | "info"; label: string; icon: LucideIcon }
> = {
  danger: { tone: "danger", label: "Urgent", icon: TriangleAlert },
  warning: { tone: "warning", label: "À faire", icon: Clock },
  info: { tone: "info", label: "À suivre", icon: Info },
};
