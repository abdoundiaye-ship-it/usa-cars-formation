import type { ClaimSource, ClaimStatus } from "@/lib/supabase/database.types";

/** Réclamations après l'enlèvement (lot 6d, contrat art. 19). */

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Reçue",
  forwarded: "Transmise aux tiers",
  resolved: "Résolue",
  rejected: "Rejetée",
};

export const CLAIM_SOURCE_LABELS: Record<ClaimSource, string> = {
  agent: "USA CARS",
  client: "Client",
};

/** Ton d'affichage du statut (cohérent avec les badges). */
export function claimStatusTone(status: ClaimStatus): "info" | "warning" | "success" | "danger" {
  if (status === "resolved") return "success";
  if (status === "rejected") return "danger";
  if (status === "forwarded") return "warning";
  return "info";
}

/** Délai respecté : réserves transmises dans le délai de l'art. 19 (sinon le recours contre les tiers est compromis). */
export function deadlineLabel(outOfTime: boolean): string {
  return outOfTime ? "Hors délai" : "Dans le délai";
}
