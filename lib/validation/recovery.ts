import { z } from "zod";

/** Validation des formulaires de la procédure « véhicule non réclamé » (US-5.3, art. 21–22, décisions U1 à U4). */

const reason = (message: string) => z.string(message).trim().min(5, message).max(500, "500 caractères au maximum.");

export const issueLetterSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    kind: z.enum(["reminder", "formal_notice"], "Type de courrier inconnu."),
    // Mise en demeure : délai de régularisation en jours (la base refuse moins que le minimum du contrat).
    cureDays: z
      .string()
      .trim()
      .prefault("")
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number("Délai invalide.").int("Délai en jours entiers.").min(1, "Délai invalide.").max(365).nullable()),
  })
  .refine((v) => v.kind === "reminder" || v.cureDays !== null, {
    path: ["cureDays"],
    message: "Indiquez le délai de régularisation.",
  })
  .transform((v) => ({ ...v, cureDays: v.kind === "reminder" ? null : v.cureDays }));

export const letterIdSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  letterId: z.uuid("Courrier inconnu."),
});

export const letterSentSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  letterId: z.uuid("Courrier inconnu."),
  sentOn: z.iso.date("Saisissez la date d’envoi."),
  channel: z.enum(["hand", "email", "whatsapp", "courier"], "Indiquez comment le courrier a été envoyé."),
  note: z
    .string()
    .trim()
    .max(300, "300 caractères au maximum.")
    .prefault("")
    .transform((v) => (v === "" ? null : v)),
});

export const cancelLetterSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  letterId: z.uuid("Courrier inconnu."),
  reason: reason("Indiquez le motif de l’annulation (5 caractères au moins)."),
});

export const openProcedureSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  reason: reason("Indiquez le motif de l’ouverture (5 caractères au moins)."),
});

export const closeProcedureSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  outcome: reason("Décrivez l’issue de la procédure (5 caractères au moins)."),
  closingStatus: z.enum(["completed", "archived", "claim", "dispute", "suspended"], "Choisissez le statut du dossier."),
});
