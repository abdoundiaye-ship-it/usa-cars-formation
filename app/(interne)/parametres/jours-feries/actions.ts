"use server";

import { revalidatePath } from "next/cache";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { failure, formObject, invalid, success, withValues, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { holidaySchema } from "@/lib/validation/finance";

const ADMIN_ONLY = "Action réservée à l’administrateur.";
const PATH = "/parametres/jours-feries";

/** Ajout d'un jour férié (fête religieuse annoncée, jour férié exceptionnel) ; journalisé par la base. */
export async function addHoliday(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.holidaysWrite))) return failure(ADMIN_ONLY);
  const parsed = holidaySchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues(invalid(parsed.error), formData);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("public_holidays").insert(parsed.data);
  if (error) {
    return withValues(
      failure(
        error.code === "23505" ? "Cette date figure déjà au calendrier." : "Le jour férié n’a pas pu être ajouté.",
      ),
      formData,
    );
  }
  revalidatePath(PATH);
  return success("Jour férié ajouté.");
}

/** Suppression d'une date saisie par erreur ; journalisée par la base. */
export async function deleteHoliday(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!(await getInternalAccess(SCREEN_ROLES.holidaysWrite))) return failure(ADMIN_ONLY);
  const day = String(formData.get("day") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return failure("Date inconnue.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("public_holidays").delete().eq("day", day);
  if (error) return failure("Le jour férié n’a pas pu être supprimé.");
  revalidatePath(PATH);
  return success("Jour férié supprimé.");
}
