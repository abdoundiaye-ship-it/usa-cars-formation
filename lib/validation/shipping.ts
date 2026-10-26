import { z } from "zod";
import { isValidContainerNumber, normalizeContainerNumber } from "@/lib/tracking";

/** Validation des formulaires du lot 2c : transporteurs, conteneurs, ETA, événements (US-2.6, US-2.7). */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères au maximum.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .prefault("");

const httpsUrl = (message: string) =>
  z
    .string(message)
    .trim()
    .refine((v) => /^https:\/\/[^\s]+$/.test(v), message);

/** Date JJ/MM/AAAA saisie dans un champ date (AAAA-MM-JJ). */
const isoDate = (message: string) => z.iso.date(message);
const optionalIsoDate = (message: string) =>
  z
    .string()
    .prefault("")
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .pipe(isoDate(message).nullable());

export const carrierSchema = z.object({
  carrierId: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,30}$/, "Code : 2 à 30 lettres minuscules, chiffres, tirets (ex. maersk)."),
  name: z.string().trim().min(2, "Saisissez le nom du transporteur.").max(80, "80 caractères au maximum."),
  trackingUrl: httpsUrl("Adresse de la page de suivi : commence par https://"),
  urlTemplate: z
    .string()
    .trim()
    .prefault("")
    .transform((v) => (v === "" ? null : v))
    .refine(
      (v) => v === null || (/^https:\/\/[^\s]+$/.test(v) && /\{(container|bl)\}/.test(v)),
      "Lien direct : adresse https:// contenant {container} ou {bl} (laisser vide sinon).",
    ),
  linkType: z.enum(["officiel", "tiers"], "Indiquez si le lien est officiel ou un service tiers."),
  apiStatus: z.enum(["non_etudie", "non_verifie", "demande", "obtenu", "refuse"], "Indiquez l’état de l’accès API."),
  note: optionalText(500),
  active: z
    .enum(["on"])
    .optional()
    .transform((v) => v === "on"),
});

export const containerSchema = z
  .object({
    containerId: z.uuid().optional(),
    number: z
      .string("Saisissez le numéro du conteneur.")
      .transform(normalizeContainerNumber)
      .refine(isValidContainerNumber, "Numéro invalide (ISO 6346) : 4 lettres, 7 chiffres, chiffre de contrôle exact."),
    carrierId: z.uuid("Choisissez le transporteur."),
    blNumber: optionalText(60),
    vessel: optionalText(80),
    voyage: optionalText(40),
    portOfLoading: optionalText(80),
    portOfDischarge: z
      .string()
      .trim()
      .max(80)
      .prefault("")
      .transform((v) => v || "Dakar"),
    etd: optionalIsoDate("Date de départ prévue invalide."),
    eta: optionalIsoDate("ETA indicative invalide."),
    notes: optionalText(1000),
  })
  .refine((c) => !c.etd || !c.eta || c.eta >= c.etd, {
    path: ["eta"],
    message: "L’ETA indicative ne peut pas précéder la date de départ prévue.",
  });

export type ContainerInput = z.infer<typeof containerSchema>;

export const containerIdSchema = z.object({ containerId: z.uuid("Conteneur inconnu.") });

export const etaSchema = z.object({
  containerId: z.uuid("Conteneur inconnu."),
  eta: isoDate("Saisissez la nouvelle ETA indicative."),
  source: z.enum(["carrier_site", "carrier_notice", "manual"], "Indiquez la source de l’ETA."),
  note: optionalText(300),
});

export const containerDateSchema = z.object({
  containerId: z.uuid("Conteneur inconnu."),
  date: isoDate("Saisissez la date."),
});

export const trackingEventSchema = z.object({
  containerId: z.uuid("Conteneur inconnu."),
  kind: z.enum(["transshipment", "delay", "note"], "Choisissez le type d’événement."),
  source: z.enum(["manual", "carrier_link"], "Indiquez la source de l’information."),
  occurredOn: isoDate("Saisissez la date de l’événement."),
  label: z.string().trim().min(3, "Décrivez l’événement.").max(200, "200 caractères au maximum."),
  location: optionalText(80),
  visibleClient: z
    .enum(["on"])
    .optional()
    .transform((v) => v === "on"),
});

/** Contrat art. 17 : information du client sur l'arrivée, donnée par l'agent hors notification automatique. */
export const arrivalNoticeSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  channel: z.enum(["phone", "whatsapp", "email", "in_person"], "Indiquez comment le client a été informé."),
  note: optionalText(300),
});

export const assignContainerSchema = z.object({
  dossierId: z.uuid("Dossier inconnu."),
  containerId: z.uuid("Choisissez le conteneur."),
  reason: z.string().trim().max(300, "300 caractères au maximum.").prefault(""),
});
