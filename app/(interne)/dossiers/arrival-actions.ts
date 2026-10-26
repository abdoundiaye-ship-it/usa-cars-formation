"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { arrivalNoticeSchema } from "@/lib/validation/shipping";

/**
 * Contrat art. 17 : l'agent enregistre que le client a été informé de l'arrivée par un autre moyen que la
 * notification automatique (non envoyée, simulée ou en échec). Chronologie interne ; l'alerte disparaît.
 */
export async function recordArrivalNotice(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.operationsWrite))) {
    return failure("Action réservée à l’administrateur et aux agents opérations.");
  }
  const parsed = arrivalNoticeSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_arrival_notice", {
    p_dossier_id: parsed.data.dossierId,
    p_channel: parsed.data.channel,
    p_note: parsed.data.note,
  });
  if (error) {
    return withValues(
      failure(error.code === "22023" ? error.message : "L’information du client n’a pas pu être enregistrée."),
      formData,
    );
  }
  revalidatePath(`/dossiers/${parsed.data.dossierId}` as Route);
  revalidatePath("/tableau-de-bord");
  return success("Information du client enregistrée.");
}
