/**
 * Recherche globale de la barre supérieure (dossier, VIN, lot, client, conteneur, B/L) : préparation de la saisie.
 * La recherche passe par la RLS : chacun ne trouve que ce qu'il a le droit de lire.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;

/** Saisie nettoyée (espaces, longueur maximale), ou null si elle est trop courte pour lancer une recherche. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

/**
 * Motif `ilike` « contient » : les caractères spéciaux du motif (% _ \) et du filtre PostgREST (, ( ) « " ») sont
 * remplacés par des espaces, si bien que la saisie ne peut ni élargir la recherche ni modifier le filtre `or`.
 */
export function likePattern(q: string): string {
  return `%${q
    .replace(/[\\%_,()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()}%`;
}
