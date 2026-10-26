import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/feedback";
import { ConnexionForm } from "./connexion-form";

export const metadata: Metadata = { title: "Connexion" };

const MESSAGES: Record<string, string> = {
  lien: "Ce lien n’est plus valide. Demandez une nouvelle invitation à l’administrateur ou une réinitialisation du mot de passe.",
};

export default async function ConnexionPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const suite = typeof params.suite === "string" ? params.suite : undefined;
  const erreur = typeof params.erreur === "string" ? MESSAGES[params.erreur] : undefined;

  return (
    <AuthShell title="Connexion" description="Espace de gestion des dossiers USA CARS.">
      <div className="flex flex-col gap-4">
        {erreur && <Alert tone="danger">{erreur}</Alert>}
        <ConnexionForm suite={suite} />
        <Link href="/connexion/mot-de-passe-oublie" className="text-primary text-sm underline underline-offset-2">
          Mot de passe oublié ?
        </Link>
        <Link href="/connexion/client" className="text-primary text-sm underline underline-offset-2">
          Vous êtes client ? Accédez à votre espace
        </Link>
      </div>
    </AuthShell>
  );
}
