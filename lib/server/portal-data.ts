import "server-only";
import type { ClientDossierState } from "@/lib/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Situation d'un dossier vue par le client (portail) : uniquement des données qu'il a le droit de lire (RLS) —
 * devis émis, lignes D soumises à son accord, situation financière, remise des documents.
 */
export async function clientDossierState(dossierId: string): Promise<ClientDossierState> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const [
    { data: quotes },
    { data: extras },
    { data: balanceRows },
    { data: invoices },
    { data: release },
    { data: dossier },
  ] = await Promise.all([
    supabase
      .from("financial_documents")
      .select("status, valid_until, document_id")
      .eq("dossier_id", dossierId)
      .eq("doc_type", "quote"),
    supabase.from("adjustments").select("id").eq("dossier_id", dossierId).eq("status", "pending_client_approval"),
    supabase.rpc("dossier_balance", { p_dossier_id: dossierId }),
    supabase
      .from("financial_documents")
      .select("doc_type, due_at")
      .eq("dossier_id", dossierId)
      .in("doc_type", ["deposit_invoice", "balance_invoice"])
      .neq("status", "cancelled"),
    supabase.from("document_releases").select("id").eq("dossier_id", dossierId).maybeSingle(),
    supabase.from("dossiers").select("ownership_transferred_at").eq("id", dossierId).maybeSingle(),
  ]);
  const balance = balanceRows?.[0];
  return {
    quoteToDecide: (quotes ?? []).some(
      (q) => q.status === "issued" && q.document_id !== null && q.valid_until !== null && new Date(q.valid_until) > now,
    ),
    extraCostsToApprove: extras?.length ?? 0,
    payment1RemainingCents: balance?.has_accepted_quote ? balance.payment1_remaining_cents : 0,
    payment1DueAt: invoices?.find((i) => i.doc_type === "deposit_invoice")?.due_at ?? null,
    balanceRemainingCents: balance?.has_accepted_quote ? Math.max(balance.balance_remaining_cents, 0) : 0,
    balanceDueAt: invoices?.find((i) => i.doc_type === "balance_invoice")?.due_at ?? null,
    documentsReady: Boolean(dossier?.ownership_transferred_at) && !release,
  };
}
