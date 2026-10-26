import { z } from "zod";

/** Validation des formulaires de réclamation (lot 6d, contrat art. 19). */

export const fileClaimSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  reserves: z
    .string()
    .trim()
    .min(5, "Décrivez vos réserves (au moins 5 caractères).")
    .max(4000, "4000 caractères au maximum."),
});

export const respondClaimSchema = z.object({
  claimId: z.uuid("Réclamation inconnue."),
  status: z.enum(["open", "forwarded", "resolved", "rejected"]),
  response: z
    .string()
    .trim()
    .max(4000, "4000 caractères au maximum.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .prefault(""),
});

export const claimIdSchema = z.object({ claimId: z.uuid("Réclamation inconnue.") });
