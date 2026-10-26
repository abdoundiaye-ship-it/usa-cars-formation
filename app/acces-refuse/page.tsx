import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { getAccess } from "@/lib/auth/access";
import { isInternalRole } from "@/lib/auth/roles";
import { signOut } from "../connexion/actions";

export const metadata: Metadata = { title: "Accès refusé" };

export default async function AccesRefusePage() {
  const access = await getAccess();

  let message = "Vous n’avez pas accès à cette page.";
  if (!access) message = "Connectez-vous pour accéder à l’application.";
  else if (!access.role || !access.active)
    message = "Ce compte est désactivé ou n’a pas de rôle. Contactez l’administrateur.";
  else if (access.role === "client")
    message = "Le portail client ouvrira prochainement. Vous serez prévenu par e-mail.";
  else if (access.mfaRequired && access.aal !== "aal2") message = "Validez d’abord votre double authentification.";

  const canGoBack = access?.active && isInternalRole(access.role);

  return (
    <AuthShell title="Accès refusé">
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm">
          {message}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          {canGoBack && (
            <Link href="/tableau-de-bord" className="text-primary underline underline-offset-2">
              Retour au tableau de bord
            </Link>
          )}
          {access ? (
            <form action={signOut}>
              <button type="submit" className="text-primary underline underline-offset-2">
                Se déconnecter
              </button>
            </form>
          ) : (
            <Link href="/connexion" className="text-primary underline underline-offset-2">
              Se connecter
            </Link>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
