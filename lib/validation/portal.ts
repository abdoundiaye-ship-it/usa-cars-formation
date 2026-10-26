import { z } from "zod";

/**
 * R15 / US-4.2 / US-4.4 : décision du client dans le portail, sur la version affichée du document.
 * Toutes les erreurs sont signalées ensemble (consentement et choix d'assurance), pas seulement la première.
 */
export const portalDecisionSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    subject: z.enum(["quote", "extra_cost"], "Document inconnu."),
    subjectId: z.uuid("Document inconnu."),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "Version du document inconnue."),
    decision: z.enum(["accepted", "refused"], "Indiquez votre décision."),
    insuranceChoice: z.enum(["accepted", "refused"]).optional(),
    consent: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.consent !== "on") {
      ctx.addIssue({ code: "custom", path: ["consent"], message: "Cochez la case pour confirmer votre décision." });
    }
    if (v.subject === "quote" && v.decision === "accepted" && v.insuranceChoice === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["insuranceChoice"],
        message: "Indiquez si vous souhaitez l’assurance transport (option C).",
      });
    }
  });
