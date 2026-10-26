import { z } from "zod";
import { parseUsdToCents } from "@/lib/money/cents";

/** Validation des formulaires du lot 2a : clients, dossiers, acceptations (US-2.1, US-2.2). */

/** Indicatif utilisé quand un numéro sénégalais est saisi sans indicatif (9 chiffres). */
const DEFAULT_COUNTRY_CODE = "221";

/**
 * Numéro de téléphone → format international E.164 (+221771234567).
 * Accepte espaces, points, tirets, parenthèses, préfixe 00 et numéro sénégalais local à 9 chiffres.
 * Renvoie null si le numéro n'est pas exploitable.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-()]/g, "");
  let digits: string;
  if (compact.startsWith("+")) digits = compact.slice(1);
  else if (compact.startsWith("00")) digits = compact.slice(2);
  else if (/^[0-9]{9}$/.test(compact)) digits = DEFAULT_COUNTRY_CODE + compact;
  else return null;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

const phoneField = z.string("Saisissez le numéro WhatsApp de notification.").transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({
      code: "custom",
      message: "Numéro invalide : saisissez-le au format international, ex. +221 77 123 45 67.",
    });
    return z.NEVER;
  }
  return phone;
});

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.email("Adresse e-mail invalide.").nullable())
  .nullable()
  .default(null);

export const clientSchema = z
  .object({
    kind: z.enum(["person", "company"], "Choisissez « Particulier » ou « Société »."),
    name: z.string().trim().min(2, "Saisissez le nom (2 caractères minimum).").max(160, "160 caractères au maximum."),
    idDocumentType: z
      .enum(["national_id", "passport", "residence_permit", "other", ""])
      .transform((v) => (v === "" ? null : v))
      .prefault(""),
    idDocumentNumber: optionalText(60, "60 caractères au maximum."),
    ninea: optionalText(40, "40 caractères au maximum."),
    rccm: optionalText(60, "60 caractères au maximum."),
    representativeName: optionalText(120, "120 caractères au maximum."),
    representativeTitle: optionalText(80, "80 caractères au maximum."),
    address: optionalText(300, "300 caractères au maximum."),
    notifyPhone: phoneField,
    notifyEmail: optionalEmail,
    notes: optionalText(2000, "2 000 caractères au maximum."),
  })
  .superRefine((client, ctx) => {
    if (client.idDocumentNumber && !client.idDocumentType) {
      ctx.addIssue({ code: "custom", path: ["idDocumentType"], message: "Précisez le type de pièce d’identité." });
    }
  });

export type ClientInput = z.infer<typeof clientSchema>;

/** Informations manquantes pour qu'un client soit « complet » (condition de passage de l'étape Ouverture). */
export function missingClientInformation(client: {
  kind: "person" | "company";
  id_document_type: string | null;
  id_document_number: string | null;
  ninea: string | null;
  rccm: string | null;
  representative_name: string | null;
  address: string | null;
  notify_phone: string | null;
}): string[] {
  const missing: string[] = [];
  if (!client.notify_phone) missing.push("numéro WhatsApp de notification");
  if (!client.address) missing.push("adresse");
  if (client.kind === "person" && !(client.id_document_type && client.id_document_number)) {
    missing.push("pièce d’identité");
  }
  if (client.kind === "company") {
    if (!client.ninea && !client.rccm) missing.push("NINEA ou RCCM");
    if (!client.representative_name) missing.push("représentant légal");
  }
  return missing;
}

const currentYear = () => new Date().getFullYear();

/** VIN : 17 caractères, majuscules, sans I, O ni Q (norme ISO 3779). */
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export const vehicleSchema = z.object({
  platform: z
    .enum(["copart", "iaa", "other", ""])
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  lotNumber: optionalText(40, "40 caractères au maximum."),
  vin: z
    .string()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || VIN_PATTERN.test(v), "Le VIN compte 17 caractères (lettres I, O et Q exclues).")
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  make: optionalText(60, "60 caractères au maximum."),
  model: optionalText(80, "80 caractères au maximum."),
  modelYear: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const year = Number(v);
      if (!Number.isInteger(year) || year < 1950 || year > currentYear() + 1) {
        ctx.addIssue({ code: "custom", message: `Saisissez une année entre 1950 et ${currentYear() + 1}.` });
        return z.NEVER;
      }
      return year;
    })
    .prefault(""),
  mileage: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const compact = v.replace(/[\s  ]/g, "");
      if (compact === "") return null;
      const miles = Number(compact);
      if (!Number.isInteger(miles) || miles < 0 || miles > 2_000_000) {
        ctx.addIssue({ code: "custom", message: "Saisissez un nombre entier de miles (ex. 48000)." });
        return z.NEVER;
      }
      return miles;
    })
    .prefault(""),
  vehicleCategory: z
    .enum(["passenger", "light_utility", "truck_or_bus", ""])
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  titleStatus: optionalText(80, "80 caractères au maximum."),
  color: optionalText(40, "40 caractères au maximum."),
  purchaseLocation: optionalText(120, "120 caractères au maximum."),
  departurePort: optionalText(80, "80 caractères au maximum."),
  notes: optionalText(2000, "2 000 caractères au maximum."),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export const newDossierSchema = vehicleSchema.extend({
  clientId: z.uuid("Choisissez le client du dossier."),
});

export const dossierIdSchema = z.object({ dossierId: z.uuid("Dossier inconnu.") });

/** Types et taille des fichiers acceptés comme preuve (scan, photo, capture WhatsApp). */
export const PROOF_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Les 4 confirmations de l'annexe B (cases cochées par le client sur l'ordre d'achat signé). */
export const ACKNOWLEDGEMENT_KEYS = ["vehicle_info", "import_age", "binding_win", "duties_excluded"] as const;

/**
 * Décision du client sur un document (contrat, ordre d'achat ou devis), par scan ou WhatsApp (R15).
 * Devis : l'heure compte (validité, X2) et le choix d'assurance figure dans la même acceptation (X1).
 */
export const acceptanceSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    subject: z.enum(["contract", "purchase_order", "quote", "extra_cost"], "Document inconnu."),
    subjectId: z.uuid("Document inconnu."),
    method: z.enum(["scanned_paper", "whatsapp"], "Choisissez la méthode d’acceptation."),
    decision: z.enum(["accepted", "refused"], "Indiquez si le client accepte ou refuse."),
    decidedOn: z.iso.date("Saisissez la date de signature ou du message."),
    decidedTime: z
      .string()
      .prefault("")
      .refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Heure invalide (HH:MM)."),
    insuranceChoice: z.enum(["accepted", "refused"]).optional(),
    whatsappFrom: z.string().prefault(""),
    notes: optionalText(1000, "1 000 caractères au maximum."),
    ack_vehicle_info: z.string().optional(),
    ack_import_age: z.string().optional(),
    ack_binding_win: z.string().optional(),
    ack_duties_excluded: z.string().optional(),
  })
  .transform((value, ctx) => {
    let whatsappFrom: string | null = null;
    if (value.method === "whatsapp") {
      whatsappFrom = normalizePhone(value.whatsappFrom);
      if (!whatsappFrom) {
        ctx.addIssue({
          code: "custom",
          path: ["whatsappFrom"],
          message: "Saisissez le numéro qui a envoyé le message (format international).",
        });
        return z.NEVER;
      }
    }
    let acknowledgements: Record<(typeof ACKNOWLEDGEMENT_KEYS)[number], boolean> | null = null;
    if (value.subject === "purchase_order") {
      acknowledgements = {
        vehicle_info: value.ack_vehicle_info === "on",
        import_age: value.ack_import_age === "on",
        binding_win: value.ack_binding_win === "on",
        duties_excluded: value.ack_duties_excluded === "on",
      };
      if (value.decision === "accepted" && Object.values(acknowledgements).some((v) => !v)) {
        ctx.addIssue({
          code: "custom",
          path: ["acknowledgements"],
          message: "Le client doit avoir coché les 4 confirmations de l’ordre d’achat.",
        });
        return z.NEVER;
      }
    }
    let insuranceChoice: "accepted" | "refused" | null = null;
    if (value.subject === "quote") {
      if (value.decidedTime === "") {
        ctx.addIssue({
          code: "custom",
          path: ["decidedTime"],
          message: "Saisissez l’heure de la signature ou du message.",
        });
        return z.NEVER;
      }
      if (value.decision === "accepted") {
        if (!value.insuranceChoice) {
          ctx.addIssue({
            code: "custom",
            path: ["insuranceChoice"],
            message: "Indiquez si le client accepte ou refuse l’assurance transport (option C).",
          });
          return z.NEVER;
        }
        insuranceChoice = value.insuranceChoice;
      }
    }
    return {
      dossierId: value.dossierId,
      subject: value.subject,
      subjectId: value.subjectId,
      method: value.method,
      decision: value.decision,
      decidedOn: value.decidedOn,
      // Sans heure (contrat, ordre d'achat) : midi à Dakar (UTC+0), pour éviter tout décalage de jour.
      decidedAt: new Date(`${value.decidedOn}T${value.decidedTime || "12:00"}:00Z`),
      insuranceChoice,
      notes: value.notes,
      whatsappFrom,
      acknowledgements,
    };
  });

/** Montant en dollars saisi (« 12 450 » ou « 12450,50 ») → centimes. */
const usdField = (required: string, { allowZero = false } = {}) =>
  z.string(required).transform((value, ctx) => {
    if (value.trim() === "") {
      if (allowZero) return 0;
      ctx.addIssue({ code: "custom", message: required });
      return z.NEVER;
    }
    const cents = parseUsdToCents(value);
    if (cents === null || cents < 0 || (!allowZero && cents === 0)) {
      ctx.addIssue({ code: "custom", message: "Montant invalide : chiffres en dollars, ex. 12450 ou 12450,50." });
      return z.NEVER;
    }
    return cents;
  });

/** Date et heure saisies (champ datetime-local) → ISO ; heure de Dakar = UTC (CLAUDE.md §5). */
const dakarDateTime = (message: string) =>
  z.string().transform((value, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return new Date(`${value}:00Z`).toISOString();
  });

/** US-2.3 : ordre d'achat (enchère maximale, dépôt attendu — P2, date de l'enchère facultative). */
export const purchaseOrderSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  maxBid: usdField("Saisissez l’enchère maximale en dollars."),
  deposit: usdField("Saisissez le dépôt attendu.", { allowZero: true }).prefault(""),
  auctionAt: z
    .string()
    .prefault("")
    .transform((v) => (v.trim() === "" ? null : v))
    .pipe(dakarDateTime("Date et heure de l’enchère invalides.").nullable()),
});

/** Motif obligatoire (dérogation, exception, annulation) : 5 caractères au moins. */
const reasonField = (message: string) =>
  z.string(message).trim().min(5, message).max(500, "500 caractères au maximum.");

export const ageOverrideSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  reason: reasonField("Motif de la dérogation obligatoire (5 caractères au moins)."),
});

/** US-2.4 : résultat d'enchère ; motif de l'administrateur si le prix dépasse l'enchère maximale. */
export const auctionResultSchema = z
  .object({
    dossierId: z.uuid("Dossier inconnu."),
    result: z.enum(["won", "lost"], "Indiquez si le lot est remporté ou non."),
    hammerPrice: z.string().prefault(""),
    notifiedAt: z.string().prefault(""),
    overrideReason: z.string().trim().prefault(""),
  })
  .transform((value, ctx) => {
    if (value.result === "lost") return { dossierId: value.dossierId, result: value.result } as const;
    const cents = usdField("Saisissez le prix d’adjudication en dollars.").safeParse(value.hammerPrice);
    if (!cents.success) {
      ctx.addIssue({ code: "custom", path: ["hammerPrice"], message: cents.error.issues[0]!.message });
    }
    const notified = dakarDateTime("Saisissez la date et l’heure de notification du lot remporté.").safeParse(
      value.notifiedAt,
    );
    if (!notified.success) {
      ctx.addIssue({ code: "custom", path: ["notifiedAt"], message: notified.error.issues[0]!.message });
    }
    if (!cents.success || !notified.success) return z.NEVER;
    return {
      dossierId: value.dossierId,
      result: value.result,
      hammerPriceCents: cents.data,
      notifiedAt: notified.data,
      overrideReason: value.overrideReason || null,
    } as const;
  });

export const advanceStageSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  reason: z.string().trim().max(500, "500 caractères au maximum.").prefault(""),
});

export const cancelDossierSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  reason: reasonField("Motif de l’annulation obligatoire (5 caractères au moins)."),
});

export const statusSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  status: z.string().regex(/^[a-z0-9_]+$/, "Choisissez un statut dans la liste."),
});

export const confirmationSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  code: z.enum(
    ["quote_accepted", "payment1_received", "balance_invoice_issued", "balance_paid"],
    "Confirmation inconnue.",
  ),
  note: optionalText(500, "500 caractères au maximum."),
});

/** Vérifie le fichier de preuve ; renvoie un message d'erreur ou null. */
export function proofFileError(file: File | null): string | null {
  if (!file || file.size === 0) return "Joignez le scan signé ou la capture du message WhatsApp.";
  if (file.size > MAX_UPLOAD_BYTES) return "Le fichier dépasse 20 Mo.";
  if (!(PROOF_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Format accepté : PDF, JPEG, PNG, WebP ou HEIC.";
  }
  return null;
}
