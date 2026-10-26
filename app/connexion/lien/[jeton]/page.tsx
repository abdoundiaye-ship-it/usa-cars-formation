import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { RedeemLinkForm } from "../../client/client-link-form";

export const metadata: Metadata = { title: "Connexion à votre espace" };

/** Lien de connexion reçu par e-mail ou WhatsApp : la session s'ouvre au clic (usage unique). */
export default async function ClientLinkPage({ params }: PageProps<"/connexion/lien/[jeton]">) {
  const { jeton } = await params;
  return (
    <AuthShell title="Votre espace USA CARS" description="Ce lien personnel ne fonctionne qu’une fois et expire vite.">
      <div className="flex flex-col gap-4">
        <RedeemLinkForm token={jeton} />
        <Link href="/connexion/client" className="text-primary text-sm underline underline-offset-2">
          Recevoir un nouveau lien
        </Link>
      </div>
    </AuthShell>
  );
}
