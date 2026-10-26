import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewDossierForm } from "../dossier-forms";

export const metadata: Metadata = { title: "Ouvrir un dossier" };

export default async function NouveauDossierPage({ searchParams }: PageProps<"/dossiers/nouveau">) {
  await requireInternal(SCREEN_ROLES.operationsWrite);
  const params = await searchParams;
  const clientId = typeof params.client === "string" ? params.client : undefined;

  const supabase = await createSupabaseServerClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, notify_phone")
    .eq("active", true)
    .order("name");

  return (
    <>
      <PageHeader
        title="Ouvrir un dossier"
        description="Un dossier = un véhicule = un contrat. Le contrat est généré dès l’ouverture (mention « PROJET » tant que les modèles ne sont pas validés)."
      />
      <Card>
        {error ? (
          <Alert tone="danger">La liste des clients n’a pas pu être chargée. Rechargez la page.</Alert>
        ) : !clients?.length ? (
          <EmptyState title="Aucun client">
            Créez d’abord la fiche du client :{" "}
            <Link href="/clients/nouveau" className="text-primary underline">
              nouveau client
            </Link>
            .
          </EmptyState>
        ) : (
          <NewDossierForm clients={clients} clientId={clientId} />
        )}
      </Card>
    </>
  );
}
