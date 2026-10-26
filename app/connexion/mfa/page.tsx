import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getAccess } from "@/lib/auth/access";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { MfaEnrollForm, MfaVerifyForm } from "./mfa-forms";

export const metadata: Metadata = { title: "Double authentification" };

export default async function MfaPage({ searchParams }: PageProps<"/connexion/mfa">) {
  const params = await searchParams;
  const suite = safeNextPath(typeof params.suite === "string" ? params.suite : undefined);

  const access = await getAccess();
  if (!access) redirect("/connexion");
  if (access.aal === "aal2") redirect(suite as Route);

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.all ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");

  if (!verified && !access.mfaRequired) redirect(suite as Route);

  return (
    <AuthShell
      title="Double authentification"
      description={
        verified
          ? "Saisissez le code affiché par votre application d’authentification."
          : "Première connexion : configurez votre application d’authentification."
      }
    >
      <div className="flex flex-col gap-4">
        {verified ? <MfaVerifyForm factorId={verified.id} suite={suite} /> : <MfaEnrollForm suite={suite} />}
        <form action={signOut}>
          <button type="submit" className="text-primary text-sm underline underline-offset-2">
            Se déconnecter
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
