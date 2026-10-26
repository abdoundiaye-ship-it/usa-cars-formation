/**
 * Client minimal de l'API Supabase (PostgREST et stockage) pour les fonctions : quelques appels `fetch`,
 * au nom de l'utilisateur (son jeton : la RLS s'applique). Remplace @supabase/supabase-js, dont le chargement
 * pèse trop lourd au démarrage à froid d'une fonction (limite de calcul).
 */

export interface RestError {
  status: number;
  code?: string;
  message: string;
}

export type RestResult<T> = { data: T; error: null } | { data: null; error: RestError };

export class SupabaseRest {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly authorization: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.apiKey, Authorization: this.authorization, ...extra };
  }

  private async parse<T>(response: Response): Promise<RestResult<T>> {
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return {
        data: null,
        error: {
          status: response.status,
          code: body?.code,
          message: body?.message ?? body?.error ?? response.statusText,
        },
      };
    }
    return { data: body as T, error: null };
  }

  /** Lignes d'une table ou d'une vue ; `query` : paramètres PostgREST (select, filtres, order). */
  async select<T>(table: string, query: Record<string, string>): Promise<RestResult<T[]>> {
    const params = new URLSearchParams(query);
    const response = await fetch(`${this.url}/rest/v1/${table}?${params}`, { headers: this.headers() });
    return this.parse<T[]>(response);
  }

  /** Première ligne correspondante, ou null. */
  async first<T>(table: string, query: Record<string, string>): Promise<T | null> {
    const { data } = await this.select<T>(table, { ...query, limit: "1" });
    return data?.[0] ?? null;
  }

  /** Appel d'une fonction SQL exposée (rpc). */
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<RestResult<T>> {
    const response = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(args),
    });
    return this.parse<T>(response);
  }

  /** Dépôt d'un fichier dans un bucket (sans écrasement). */
  async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<RestError | null> {
    const response = await fetch(
      `${this.url}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: this.headers({ "Content-Type": contentType, "x-upsert": "false" }),
        body: bytes as BodyInit,
      },
    );
    if (response.ok) return null;
    const body = await response.json().catch(() => null);
    return { status: response.status, message: body?.message ?? response.statusText };
  }
}
