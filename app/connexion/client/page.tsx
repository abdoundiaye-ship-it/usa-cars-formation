import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ClientLinkRequestForm } from "./client-link-form";

export const metadata: Metadata = { title: "Espace client" };

/** US-4.1 : le client reçoit un lien de connexion à usage unique par e-mail et par WhatsApp. */
export default function ClientConnexionPage() {
  return (
    <AuthShell
      title="Espace client"
      description="Suivez vos dossiers : étapes, documents, paiements et arrivée de votre véhicule."
    >
      <div className="flex flex-col gap-4">
        <ClientLinkRequestForm />
        <Link href="/connexion" className="text-primary text-sm underline underline-offset-2">
          Espace de l’équipe USA CARS
        </Link>
      </div>
    </AuthShell>
  );
}
