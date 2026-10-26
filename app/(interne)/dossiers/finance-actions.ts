"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forfaitsSchema, internalCostSchema, sectionOf } from "@/lib/validation/finance";

const WRITERS = "Action réservée à l’administrateur, aux agents opérations et à la comptabilité.";
const dossierPath = (id: string) => `/dossiers/${id}` as Route;

/** US-3.2 : forfaits A et B et prime d'assurance C, saisis par l'agent (I4) ; chaque modification est journalisée. */
export async function saveForfaits(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.forfaitsWrite))) return failure(WRITERS);
  const parsed = forfaitsSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, forfaitA, forfaitB, insurance } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("dossier_forfaits").upsert({
    dossier_id: dossierId,
    forfait_a_cents: forfaitA,
    forfait_b_cents: forfaitB,
    insurance_cents: insurance,
  });
  if (error) return withValues(failure("Les forfaits n’ont pas pu être enregistrés."), formData);
  revalidatePath(dossierPath(dossierId));
  return success("Forfaits enregistrés.");
}

/** US-3.1 : ajout ou modification d'un poste de coût interne (jamais visible du client). */
export async function saveInternalCost(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.forfaitsWrite))) return failure(WRITERS);
  const parsed = internalCostSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { dossierId, costId, category, label, amount, status } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = costId
    ? await supabase.from("internal_costs").update({ label, amount_cents: amount, status }).eq("id", costId)
    : await supabase
        .from("internal_costs")
        .insert({ dossier_id: dossierId, section: sectionOf(category), category, label, amount_cents: amount, status });
  if (error) return withValues(failure("Le coût n’a pas pu être enregistré."), formData);
  revalidatePath(dossierPath(dossierId));
  return success(costId ? "Coût modifié." : "Coût ajouté.");
}

const deleteSchema = z.object({ dossierId: z.uuid(), costId: z.uuid() });

export async function deleteInternalCost(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.forfaitsWrite))) return failure(WRITERS);
  const parsed = deleteSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Coût inconnu.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("internal_costs").delete().eq("id", parsed.data.costId);
  if (error) return failure("Le coût n’a pas pu être supprimé.");
  revalidatePath(dossierPath(parsed.data.dossierId));
  return success("Coût supprimé (la suppression est journalisée).");
}
