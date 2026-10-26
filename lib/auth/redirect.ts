/** Chemin de retour après connexion : uniquement un chemin interne (pas de redirection ouverte). */
export function safeNextPath(value: unknown, fallback = "/tableau-de-bord"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/connexion") || value.startsWith("/auth/")) return fallback;
  return value;
}
