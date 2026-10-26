"use server";

import { redirect } from "next/navigation";
import { failure, formObject, invalid, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { newPasswordSchema } from "@/lib/validation/auth";

export async function setPassword(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return failure("Choisissez un mot de passe différent de l’ancien.");
    if (error.code === "weak_password") {
      return failure("Mot de passe trop faible : 12 caractères minimum, avec minuscules, majuscules et chiffres.");
    }
    if (error.code === "insufficient_aal") {
      return failure("Validez d’abord votre double authentification, puis recommencez.");
    }
    return failure("Le mot de passe n’a pas pu être enregistré. Votre lien a peut-être expiré : reconnectez-vous.");
  }

  const { data: access } = await supabase.rpc("my_access").maybeSingle();
  if (access?.mfa_required && access.aal !== "aal2") redirect("/connexion/mfa");
  redirect("/tableau-de-bord");
}
