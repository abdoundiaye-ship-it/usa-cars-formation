"use server";

import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { carrierSchema } from "@/lib/validation/shipping";

/** P4 : transporteurs et lien de suivi, gérés par l'administrateur (journalisé). */
export async function saveCarrier(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.settingsWrite))) {
    return failure("Action réservée à l’administrateur (avec double authentification validée).");
  }
  const parsed = carrierSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const { carrierId, code, name, trackingUrl, urlTemplate, linkType, apiStatus, note, active } = parsed.data;
  const row = {
    code,
    name,
    tracking_url: trackingUrl,
    url_template: urlTemplate,
    link_type: linkType,
    api_status: apiStatus,
    note,
  };

  const supabase = await createSupabaseServerClient();
  const { error } = carrierId
    ? await supabase
        .from("carriers")
        .update({ ...row, active })
        .eq("id", carrierId)
    : await supabase.from("carriers").insert({ ...row, active: true });
  if (error) {
    return withValues(
      failure(
        error.code === "23505" ? "Ce code de transporteur existe déjà." : "Le transporteur n’a pas pu être enregistré.",
      ),
      formData,
    );
  }
  revalidatePath("/parametres/transporteurs");
  return success(carrierId ? "Transporteur enregistré." : "Transporteur ajouté.");
}
