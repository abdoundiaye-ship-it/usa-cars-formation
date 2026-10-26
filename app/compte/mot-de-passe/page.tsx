import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Mot de passe" };

export default async function MotDePassePage() {
  const access = await getAccess();
  if (!access) redirect("/connexion");

  // Un compte déjà protégé par la MFA doit la valider avant de changer de mot de passe.
  if (access.aal !== "aal2") {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const hasVerifiedFactor = (data?.all ?? []).some((f) => f.status === "verified");
    if (hasVerifiedFactor) redirect("/connexion/mfa?suite=%2Fcompte%2Fmot-de-passe");
  }

  return (
    <AuthShell title="Choisir votre mot de passe" description={`Compte : ${access.email}`}>
      <PasswordForm />
    </AuthShell>
  );
}
