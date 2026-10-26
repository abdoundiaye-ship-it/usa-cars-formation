/**
 * Outils communs aux documents Word générés (contrat, ordre d'achat) — module autonome, sans alias Next.js :
 * exécuté par la fonction Supabase generate-document (Deno) et testé par Vitest.
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/** Espace réservé imprimé à la place d'une information encore inconnue (à compléter à la main). */
export const BLANK = "____________";

export type AuctionPlatform = "copart" | "iaa" | "other";

/** Valeur imprimable ; espace réservé si absente. */
export const text = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return BLANK;
  const trimmed = String(value).trim();
  return trimmed === "" ? BLANK : trimmed;
};

const NBSP = " ";
const group = (formatted: string) => formatted.replace(/[\s ]/g, NBSP);

/** Date JJ/MM/AAAA, fuseau Africa/Dakar (CLAUDE.md §5). */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Dakar",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** « 19/10/2026 à 14h30 (heure de Dakar) ». */
export function formatDateTimeDakar(date: Date): string {
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Dakar",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(":", "h");
  return `${formatDate(date)} à ${time} (heure de Dakar)`;
}

/** 48000 → « 48 000 » (espace insécable, comme lib/format.ts). */
export function formatInteger(value: number): string {
  return group(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value));
}

/** Centimes USD → « 12 450 $US » ou « 12 450,50 $US » (comme lib/format.ts). */
export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Montant en centimes invalide : ${cents}`);
  const dollars =
    cents % 100 === 0
      ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(cents / 100)
      : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  return `${group(dollars)}${NBSP}$US`;
}

/** Cases « ☒ COPART   ☐ IAA   ☐ Autre » (article 3 du contrat, annexe B). */
export function platformBoxes(platform: AuctionPlatform | null): string {
  const box = (value: AuctionPlatform) => (platform === value ? "☒" : "☐");
  return `${box("copart")} COPART   ${box("iaa")} IAA   ${box("other")} Autre`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Remplit un modèle ; une balise sans valeur fait échouer la génération (jamais de « undefined » imprimé). */
export function renderTemplate(templateBase64: string, data: Record<string, unknown>): Uint8Array {
  const doc = new Docxtemplater(new PizZip(base64ToBytes(templateBase64)), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part) => {
      throw new Error(`Balise sans valeur dans le modèle : ${part.value}`);
    },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

/** Empreinte SHA-256 (hexadécimal) d'un fichier — version figée d'un document accepté (R15). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
