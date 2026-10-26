import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContainerForm } from "../container-forms";

export const metadata: Metadata = { title: "Nouveau conteneur" };

export default async function NouveauConteneurPage() {
  const access = await requireInternal(SCREEN_ROLES.operationsWrite);
  const supabase = await createSupabaseServerClient();
  const { data: carriers, error } = await supabase
    .from("carriers")
    .select("id, name, link_type")
    .eq("active", true)
    .order("name");

  return (
    <>
      <PageHeader title="Nouveau conteneur" description="Numéro ISO 6346, transporteur et références d’expédition." />
      <Card>
        {error ? (
          <Alert tone="danger">La liste des transporteurs n’a pas pu être chargée. Rechargez la page.</Alert>
        ) : !carriers?.length ? (
          <EmptyState title="Aucun transporteur">
            {access.role === "admin" ? (
              <>
                Ajoutez d’abord un transporteur dans{" "}
                <Link href="/parametres/transporteurs" className="text-primary underline">
                  Paramètres → Transporteurs
                </Link>
                .
              </>
            ) : (
              "Demandez à l’administrateur d’ajouter les transporteurs (Paramètres → Transporteurs)."
            )}
          </EmptyState>
        ) : (
          <ContainerForm carriers={carriers} />
        )}
      </Card>
    </>
  );
}
