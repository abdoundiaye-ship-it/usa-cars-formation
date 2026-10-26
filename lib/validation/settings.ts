import { z } from "zod";

/** Date d’effet saisie dans un champ datetime-local, interprétée à l’heure de Dakar (UTC+0). */
export function parseEffectiveFrom(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const settingVersionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, "Paramètre inconnu."),
  value: z.string().max(1000, "Valeur trop longue."),
  status: z.enum(["confirme", "a_confirmer"], "Choisissez un statut."),
  effectiveFrom: z
    .string()
    .optional()
    .refine((v) => !v || parseEffectiveFrom(v) !== null, "Date d’effet invalide."),
  reason: z
    .string()
    .trim()
    .min(3, "Indiquez le motif de la modification (il sera conservé dans l’historique).")
    .max(500, "Le motif ne doit pas dépasser 500 caractères."),
});
