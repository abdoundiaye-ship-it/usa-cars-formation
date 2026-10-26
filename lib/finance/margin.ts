import type { Cents } from "@/lib/money/cents";
import type { CostSection } from "@/lib/supabase/database.types";

/**
 * Marge implicite d'un dossier (US-3.1) : forfaits saisis − coûts internes, par section et au total.
 * Information INTERNE uniquement (CLAUDE.md règle 2) : jamais dans un document ni pour le rôle client.
 */

export interface SectionMargin {
  forfaitCents: Cents | null;
  costsCents: Cents;
  marginCents: Cents | null;
  /** Marge rapportée au forfait, en pour cent arrondi à une décimale. */
  marginPercent: number | null;
}

export interface DossierMargin {
  A: SectionMargin;
  B: SectionMargin;
  total: SectionMargin;
}

function section(forfaitCents: Cents | null, costsCents: Cents): SectionMargin {
  if (forfaitCents === null) return { forfaitCents, costsCents, marginCents: null, marginPercent: null };
  const marginCents = forfaitCents - costsCents;
  const marginPercent = forfaitCents > 0 ? Math.round((marginCents / forfaitCents) * 1000) / 10 : null;
  return { forfaitCents, costsCents, marginCents, marginPercent };
}

export function dossierMargin(
  forfaits: { forfait_a_cents: Cents | null; forfait_b_cents: Cents | null } | null,
  costs: { section: CostSection; amount_cents: Cents }[],
): DossierMargin {
  const sum = (s: CostSection) => costs.filter((c) => c.section === s).reduce((t, c) => t + c.amount_cents, 0);
  const a = section(forfaits?.forfait_a_cents ?? null, sum("A"));
  const b = section(forfaits?.forfait_b_cents ?? null, sum("B"));
  const totalForfait = a.forfaitCents !== null && b.forfaitCents !== null ? a.forfaitCents + b.forfaitCents : null;
  return { A: a, B: b, total: section(totalForfait, a.costsCents + b.costsCents) };
}
