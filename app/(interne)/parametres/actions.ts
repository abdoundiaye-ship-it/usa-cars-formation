"use server";

import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, type FormState } from "@/lib/forms";
import { parseSettingInput } from "@/lib/settings/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseEffectiveFrom, settingVersionSchema } from "@/lib/validation/settings";

/** US-1.3 : nouvelle version datée d’un paramètre (l’ancienne reste consultable). */
export async function createSettingVersion(_previous: FormState, formData: FormData): Promise<FormState> {
  const access = await getInternalAccess(SCREEN_ROLES.settingsWrite);
  if (!access) return failure("Action réservée à l’administrateur (avec double authentification validée).");

  const parsed = settingVersionSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { key, status, reason } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from("settings")
    .select("value_type, source")
    .eq("key", key)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return failure("Paramètre inconnu.");

  const value = parseSettingInput(latest.value_type, parsed.data.value);
  if (!value.ok) return { status: "error", message: "La valeur est à corriger.", fieldErrors: { value: value.error } };

  const effectiveFrom = parseEffectiveFrom(parsed.data.effectiveFrom) ?? new Date();
  if (effectiveFrom.getTime() < Date.now() - 60_000) {
    return {
      status: "error",
      message: "La date d’effet est à corriger.",
      fieldErrors: { effectiveFrom: "Choisissez maintenant ou une date future (pas d’effet rétroactif)." },
    };
  }

  const { error } = await supabase.from("settings").insert({
    key,
    value: value.value,
    value_type: latest.value_type,
    status,
    source: "Écran Paramètres",
    reason,
    effective_from: effectiveFrom.toISOString(),
  });
  if (error?.code === "23505")
    return failure("Une version existe déjà à cette date d’effet. Choisissez une autre date.");
  if (error) return failure("La nouvelle version n’a pas pu être enregistrée.");

  revalidatePath("/parametres");
  revalidatePath(`/parametres/${encodeURIComponent(key)}`);
  return success("Nouvelle version enregistrée. Elle apparaît dans l’historique ci-dessous.");
}
