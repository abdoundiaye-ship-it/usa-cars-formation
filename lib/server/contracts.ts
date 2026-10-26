import "server-only";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GeneratedDocumentKind = "contract" | "purchase_order";
export type GenerateDocumentResult = { ok: true; id: string } | { ok: false; message: string };

/** Code renvoyé par Supabase quand une fonction dépasse ses limites (calcul, mémoire), ex. au démarrage à froid. */
const WORKER_LIMIT_STATUS = 546;
const UNAVAILABLE = "Le service de génération des documents ne répond pas. Réessayez dans un instant.";

type Attempt = GenerateDocumentResult & { transient?: boolean };

type InvokeBody =
  | { dossierId: string; kind: GeneratedDocumentKind }
  | { financialDocumentId: string; kind: "financial_document" }
  | { letterId: string; kind: "unclaimed_letter" };

async function invokeOnce(body: InvokeBody): Promise<Attempt> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.functions.invoke<{ id: string }>("generate-document", { body });
  if (data?.id && !error) return { ok: true, id: data.id };

  if (error instanceof FunctionsHttpError) {
    const status = (error.context as Response).status;
    const body = (await error.context.json().catch(() => null)) as { message?: unknown } | null;
    if (status === WORKER_LIMIT_STATUS) return { ok: false, message: UNAVAILABLE, transient: true };
    if (typeof body?.message === "string") return { ok: false, message: body.message };
  }
  const transient = error instanceof FunctionsRelayError || error instanceof FunctionsFetchError;
  return { ok: false, message: UNAVAILABLE, transient };
}

/**
 * Génère (ou régénère, tant qu'il n'est pas signé) le contrat ou l'ordre d'achat d'un dossier.
 * Le travail est fait par la fonction Supabase generate-document (supabase/functions), appelée avec le jeton
 * de l'utilisateur connecté : la RLS s'applique, et le calcul ne pèse pas sur Cloudflare Workers.
 * Une seconde tentative est faite si la fonction a été interrompue (démarrage à froid, réseau) :
 * la génération est rejouable sans risque (au pire une version supplémentaire du document).
 */
export async function generateDocument(
  dossierId: string,
  kind: GeneratedDocumentKind,
): Promise<GenerateDocumentResult> {
  return invokeWithRetry({ dossierId, kind });
}

/**
 * Fichier Word d'un devis ou d'une facture déjà émis (numéro et montants figés en base) ; rattaché une seule fois.
 * Rejouable : si le fichier est déjà rattaché, la fonction refuse sans rien créer.
 */
export async function generateFinancialDocumentFile(financialDocumentId: string): Promise<GenerateDocumentResult> {
  return invokeWithRetry({ financialDocumentId, kind: "financial_document" });
}

/** US-5.3 : fichier Word d'une lettre de relance ou d'une mise en demeure déjà émise en base. */
export async function generateUnclaimedLetterFile(letterId: string): Promise<GenerateDocumentResult> {
  return invokeWithRetry({ letterId, kind: "unclaimed_letter" });
}

async function invokeWithRetry(body: InvokeBody): Promise<GenerateDocumentResult> {
  const first = await invokeOnce(body);
  if (first.ok || !first.transient) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await invokeOnce(body);
  return second.ok ? second : { ok: false, message: second.message };
}

export const generateContract = (dossierId: string) => generateDocument(dossierId, "contract");
