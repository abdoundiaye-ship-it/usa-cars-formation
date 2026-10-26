"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { getServerEnv } from "@/lib/env";
import { failure, formObject, invalid, success, type FormState } from "@/lib/forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, signInSchema } from "@/lib/validation/auth";

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "user_banned") return failure("Ce compte est désactivé. Contactez l’administrateur.");
    return failure("E-mail ou mot de passe incorrect.");
  }

  const { data: access } = await supabase.rpc("my_access").maybeSingle();
  if (!access || !access.active) {
    await supabase.auth.signOut();
    return failure("Ce compte est désactivé ou n’a pas encore de rôle. Contactez l’administrateur.");
  }

  const suite = safeNextPath(parsed.data.suite);
  if (access.mfa_required) redirect(`/connexion/mfa?suite=${encodeURIComponent(suite)}` as Route);
  if (access.role === "client") redirect("/espace");
  redirect(suite as Route);
}

export async function requestPasswordReset(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getServerEnv().APP_URL}/auth/confirm?next=/compte/mot-de-passe`,
  });
  // Réponse identique que le compte existe ou non (pas de divulgation des adresses enregistrées).
  return success("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
