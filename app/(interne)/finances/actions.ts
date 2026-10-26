"use server";

import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fxRateSchema } from "@/lib/validation/finance";

/** US-3.5 : nouveau relevé du taux USD → FCFA (historique conservé, jamais modifié). */
export async function addFxRate(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.fxWrite))) {
    return failure("Saisie réservée à l’administrateur et à la comptabilité.");
  }
  const parsed = fxRateSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("fx_rates").insert({
    rate: Number(parsed.data.rate), // numeric(12,4) en base ; la saisie est contrôlée à 4 décimales
    source: parsed.data.source,
    captured_at: parsed.data.capturedAt,
  });
  if (error) {
    return withValues(
      failure(error.code === "22023" ? error.message : "Le taux n’a pas pu être enregistré."),
      formData,
    );
  }
  revalidatePath("/finances");
  return success("Taux enregistré.");
}
