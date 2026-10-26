import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function MotDePasseOubliePage() {
  return (
    <AuthShell
      title="Mot de passe oublié"
      description="Saisissez l’adresse e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe."
    >
      <div className="flex flex-col gap-4">
        <ResetForm />
        <Link href="/connexion" className="text-primary text-sm underline underline-offset-2">
          Retour à la connexion
        </Link>
      </div>
    </AuthShell>
  );
}
