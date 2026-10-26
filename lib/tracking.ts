import { formatDate } from "@/lib/format";
import type { CarrierRow, ContainerRow } from "@/lib/supabase/database.types";

/**
 * Suivi maritime (US-2.6, US-2.7, R12). Règle 6 de CLAUDE.md : l'ETA est toujours « indicative » tant que l'ATA
 * n'est pas saisie ; jamais de langage laissant croire à une position en temps réel.
 */

const LETTER_VALUES: Record<string, number> = {};
{
  let value = 10;
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (value % 11 === 0) value += 1; // les multiples de 11 sont sautés
    LETTER_VALUES[letter] = value;
    value += 1;
  }
}

/** Numéro de conteneur ISO 6346 : 3 lettres + U/J/Z + 6 chiffres + chiffre de contrôle (même règle que la base). */
export function isValidContainerNumber(number: string): boolean {
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(number)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const char = number[i]!;
    sum += (LETTER_VALUES[char] ?? Number(char)) * 2 ** i;
  }
  return (sum % 11) % 10 === Number(number[10]);
}

/** Saisie libre → numéro normalisé (majuscules, sans espaces ni tirets). */
export function normalizeContainerNumber(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export interface TrackingLink {
  url: string;
  /** Référence à saisir sur la page du transporteur quand le lien ne la contient pas. */
  referenceToEnter: string | null;
  /** Service tiers (ex. TrackingMCP pour Grimaldi) : mention obligatoire (US-2.6). */
  thirdParty: boolean;
}

/** Lien de suivi construit depuis la configuration du transporteur. */
export function trackingLink(
  carrier: Pick<CarrierRow, "tracking_url" | "url_template" | "link_type">,
  container: Pick<ContainerRow, "number" | "bl_number">,
): TrackingLink {
  const thirdParty = carrier.link_type === "tiers";
  const template = carrier.url_template;
  if (template) {
    const usesBl = template.includes("{bl}");
    if (!usesBl || container.bl_number) {
      const url = template
        .replace("{container}", encodeURIComponent(container.number))
        .replace("{bl}", encodeURIComponent(container.bl_number ?? ""));
      return { url, referenceToEnter: null, thirdParty };
    }
  }
  return { url: carrier.tracking_url, referenceToEnter: container.number, thirdParty };
}

/** « ETA indicative : 20/11/2026 », « Arrivé le 18/10/2026 (ATA) » ou « ETA à confirmer ». */
export function arrivalLabel(container: Pick<ContainerRow, "eta" | "ata">): string {
  if (container.ata) return `Arrivé le ${formatDate(container.ata)} (ATA)`;
  if (container.eta) return `ETA indicative : ${formatDate(container.eta)}`;
  return "ETA à confirmer";
}

/** R12 : conteneur en mer dont le suivi n'a pas été vérifié depuis plus de `maxDays` jours. */
export function trackingCheckOverdue(
  container: Pick<ContainerRow, "status" | "departed_on" | "ata" | "last_checked_at">,
  maxDays: number,
  now = new Date(),
): boolean {
  const inTransit = !container.ata && (container.status === "at_sea" || container.status === "transshipment");
  if (!inTransit) return false;
  const reference = container.last_checked_at ?? container.departed_on;
  if (!reference) return true;
  return now.getTime() - new Date(reference).getTime() > maxDays * 24 * 60 * 60 * 1000;
}
