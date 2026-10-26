import { z } from "zod";
import { parseUsdToCents } from "@/lib/money/cents";
import { parseRate } from "@/lib/money/fx";
import { normalizePhone } from "./operations";

/** Validation des formulaires du lot 3a : taux, forfaits, coûts internes, comptes officiels. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères au maximum.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .prefault("");

/** Montant en dollars → centimes ; vide accepté si `optional`. */
const usd = (message: string, { optional = false, allowZero = false } = {}) =>
  z
    .string()
    .prefault("")
    .transform((value, ctx) => {
      if (value.trim() === "") {
        if (optional) return null;
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      const cents = parseUsdToCents(value);
      if (cents === null || cents < 0 || (!allowZero && cents === 0)) {
        ctx.addIssue({ code: "custom", message: "Montant invalide : chiffres en dollars, ex. 11500 ou 11500,50." });
        return z.NEVER;
      }
      return cents;
    });

/** US-3.5 : taux FCFA pour 1 USD (4 décimales), date-heure du relevé (Dakar = UTC), source. */
export const fxRateSchema = z.object({
  rate: z.string().transform((value, ctx) => {
    try {
      parseRate(value);
      return value.trim().replace(",", ".");
    } catch {
      ctx.addIssue({ code: "custom", message: "Taux invalide : FCFA pour 1 USD, 4 décimales au plus (ex. 587,1050)." });
      return z.NEVER;
    }
  }),
  capturedAt: z.string().transform((value, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Saisissez la date et l’heure du relevé." });
      return z.NEVER;
    }
    return new Date(`${value}:00Z`).toISOString();
  }),
  source: z.string().trim().min(2, "Indiquez la source du taux.").max(120, "120 caractères au maximum."),
});

/** US-3.2 : forfaits A et B, prime d'assurance C (facultative). */
export const forfaitsSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  forfaitA: usd("Saisissez le forfait A.", { optional: true }),
  forfaitB: usd("Saisissez le forfait B.", { optional: true }),
  insurance: usd("Saisissez la prime d’assurance.", { optional: true, allowZero: true }),
});

type Section = "A" | "B";
const CATEGORIES = [
  "hammer_price",
  "auction_fees",
  "us_taxes",
  "acquisition_other",
  "inland_transport",
  "loading",
  "ocean_freight",
  "port_fees",
  "documentation",
  "logistics_other",
] as const;

/** US-3.1 : poste de coût interne. */
export const internalCostSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  costId: z.uuid().optional(),
  category: z.enum(CATEGORIES, "Choisissez le poste."),
  label: optionalText(120),
  amount: usd("Saisissez le montant.", { allowZero: true }).pipe(z.number()), // obligatoire : jamais nul
  status: z.enum(["estimated", "final"], "Indiquez si le montant est estimé ou définitif."),
});

/** Section déduite du poste (la base contrôle aussi la cohérence). */
export function sectionOf(category: (typeof CATEGORIES)[number]): Section {
  return ["hammer_price", "auction_fees", "us_taxes", "acquisition_other"].includes(category) ? "A" : "B";
}

/** US-3.10 : compte officiel (création ou remplacement d'un compte actif). */
export const officialAccountSchema = z
  .object({
    kind: z.enum(["bank", "wave", "orange_money", "cash_office"], "Choisissez le type de compte."),
    label: z.string().trim().min(2, "Saisissez un libellé.").max(80, "80 caractères au maximum."),
    holderName: z.string().trim().min(2, "Saisissez le titulaire.").max(120, "120 caractères au maximum."),
    bankName: optionalText(80),
    accountNumber: optionalText(60),
    iban: optionalText(60),
    swift: optionalText(20),
    phone: z.string().prefault(""),
    instructions: optionalText(500),
    replacesId: z
      .string()
      .prefault("")
      .transform((v) => (v === "" ? null : v))
      .pipe(z.uuid().nullable()),
  })
  .transform((value, ctx) => {
    let phone: string | null = null;
    if (value.kind === "wave" || value.kind === "orange_money") {
      phone = normalizePhone(value.phone);
      if (!phone) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: "Numéro du compte au format international (+221…)." });
        return z.NEVER;
      }
    }
    if (value.kind === "bank" && (!value.bankName || (!value.accountNumber && !value.iban))) {
      ctx.addIssue({
        code: "custom",
        path: ["bankName"],
        message: "Compte bancaire : banque et numéro de compte ou IBAN obligatoires.",
      });
      return z.NEVER;
    }
    return { ...value, phone };
  });

export const accountIdSchema = z.object({ accountId: z.uuid("Compte inconnu.") });

/** Montant en FCFA (entier, espaces acceptés : « 1 250 000 »). */
const xofAmount = (value: string) => {
  const digits = value.replace(/[\s ]/g, "");
  return /^\d{1,13}$/.test(digits) && Number(digits) > 0 ? Number(digits) : null;
};

/**
 * Date de crédit → instant retenu pour le taux du jour du paiement (R1) : fin de journée pour un jour passé
 * (dernier taux relevé ce jour-là), maintenant pour aujourd'hui (Africa/Dakar = UTC).
 */
export function creditedAtOf(creditedOn: string, now = new Date()): Date {
  const endOfDay = new Date(`${creditedOn}T23:59:59Z`);
  return endOfDay > now ? now : endOfDay;
}

/** US-3.4 : dépôt reçu (I2), en USD ou en FCFA converti au taux du jour du paiement par la base. */
export const depositSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    currency: z.enum(["USD", "XOF"], "Choisissez la devise reçue."),
    amount: z.string().prefault(""),
    mode: z.enum(["bank_transfer", "wave", "orange_money", "cash"], "Choisissez le mode de paiement."),
    accountId: z
      .string()
      .prefault("")
      .transform((v) => (v === "" ? null : v))
      .pipe(z.uuid("Compte inconnu.").nullable()),
    reference: z.string().trim().min(2, "Saisissez la référence du paiement.").max(120, "120 caractères au maximum."),
    creditedOn: z.iso.date("Saisissez la date de crédit."),
    notes: optionalText(500),
  })
  .transform((value, ctx) => {
    let amountCents: number | null = null;
    let amountXof: number | null = null;
    if (value.currency === "USD") {
      amountCents = parseUsdToCents(value.amount);
      if (amountCents === null || amountCents <= 0) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide : dollars, ex. 2500 ou 2500,50." });
        return z.NEVER;
      }
    } else {
      amountXof = xofAmount(value.amount);
      if (amountXof === null) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide : FCFA entiers, ex. 1 500 000." });
        return z.NEVER;
      }
    }
    if (value.mode !== "cash" && !value.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Choisissez le compte officiel crédité." });
      return z.NEVER;
    }
    return { ...value, amountCents, amountXof };
  });

export const financialDocumentIdSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  financialDocumentId: z.uuid("Document inconnu."),
});

export const cancelFinancialSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  targetId: z.uuid("Élément inconnu."),
  reason: z.string().trim().min(5, "Indiquez le motif (5 caractères au moins).").max(300, "300 caractères au maximum."),
});

export const deactivateAccountSchema = z.object({
  accountId: z.uuid("Compte inconnu."),
  reason: z.string().trim().min(5, "Indiquez le motif (5 caractères au moins).").max(300),
});

/** US-3.6 : paiement 1 et solde — mêmes champs que le dépôt (justificatif contrôlé par l'action, sauf espèces). */
export const paymentSchema = depositSchema;

/** US-3.9 / R7 : frais supplémentaires justifiés ; l'urgence (stockage, port, transporteur) exige un motif. */
export const extraCostSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    section: z.enum(["A", "B"], "Indiquez le forfait concerné."),
    label: z.string().trim().min(2, "Décrivez les frais.").max(120, "120 caractères au maximum."),
    amount: usd("Saisissez le montant.").pipe(z.number()),
    urgent: z.string().optional(),
    reason: optionalText(300),
  })
  .transform((value, ctx) => {
    const urgent = value.urgent === "on";
    if (urgent && (value.reason ?? "").length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Urgence : indiquez le motif (5 caractères au moins).",
      });
      return z.NEVER;
    }
    return { ...value, urgent };
  });

export const discountSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  label: z.string().trim().min(2, "Indiquez le motif de la remise.").max(120, "120 caractères au maximum."),
  amount: usd("Saisissez le montant de la remise.").pipe(z.number()),
});

/** C5 : frais de retard proposés, validés ou écartés (motif) par la comptabilité. */
export const lateFeeDecisionSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    adjustmentId: z.uuid("Ligne inconnue."),
    decision: z.enum(["approve", "reject"], "Décision inconnue."),
    note: optionalText(300),
  })
  .refine((v) => v.decision === "approve" || (v.note ?? "").length >= 5, {
    path: ["note"],
    message: "Indiquez pourquoi ces frais sont écartés (5 caractères au moins).",
  });

/** C9 : validation d'un remboursement par l'administrateur (motif en cas de refus). */
export const refundDecisionSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    refundId: z.uuid("Remboursement inconnu."),
    decision: z.enum(["approve", "reject"], "Décision inconnue."),
    reason: optionalText(300),
  })
  .refine((v) => v.decision === "approve" || (v.reason ?? "").length >= 5, {
    path: ["reason"],
    message: "Indiquez le motif du refus (5 caractères au moins).",
  });

/** US-3.12 : exécution d'un remboursement validé (date, référence ; justificatif contrôlé par l'action). */
export const refundExecutionSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  refundId: z.uuid("Remboursement inconnu."),
  paidOn: z.iso.date("Saisissez la date du remboursement."),
  reference: z
    .string()
    .trim()
    .min(2, "Saisissez la référence du remboursement.")
    .max(120, "120 caractères au maximum."),
});

/** US-3.11 / R9 : remise des documents (bénéficiaire, pièce vérifiée ; procuration et décharge contrôlées par l'action). */
export const documentReleaseSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  beneficiaryKind: z.enum(["client", "representative"], "Indiquez qui reçoit les documents."),
  beneficiaryName: z.string().trim().min(2, "Saisissez le nom du bénéficiaire.").max(120, "120 caractères au maximum."),
  idDocumentType: z.enum(["national_id", "passport", "residence_permit", "other"], "Choisissez la pièce vérifiée."),
  idDocumentNumber: z.string().trim().min(2, "Saisissez le numéro de la pièce.").max(60, "60 caractères au maximum."),
  releasedOn: z.iso.date("Saisissez la date de la remise."),
  notes: optionalText(500),
});

/** Jours fériés (décision du 20/10/2026) : date et libellé ; tenus par l'administrateur. */
export const holidaySchema = z.object({
  day: z.iso.date("Saisissez la date du jour férié."),
  label: z.string().trim().min(2, "Saisissez le nom de la fête.").max(80, "80 caractères au maximum."),
});
