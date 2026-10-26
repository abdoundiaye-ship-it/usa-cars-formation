import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { CARRIER_API_STATUS_LABELS } from "@/lib/dossiers/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CarrierForm } from "./carrier-form";

export const metadata: Metadata = { title: "Transporteurs" };

/** P4 : transporteurs et lien de suivi (US-2.6) ; lecture pour l'équipe, écriture pour l'administrateur. */
export default async function TransporteursPage() {
  const access = await requireInternal(SCREEN_ROLES.settings);
  const isAdmin = access.role === "admin";
  const supabase = await createSupabaseServerClient();
  const { data: carriers, error } = await supabase.from("carriers").select("*").order("name");

  return (
    <>
      <PageHeader
        title="Transporteurs"
        description="Page de suivi et lien direct utilisés sur les fiches conteneur et, plus tard, dans le portail client."
      >
        <Link href="/parametres" className="text-primary text-sm underline">
          ← Paramètres contractuels
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-6">
        {isAdmin && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Ajouter un transporteur</h2>
            <CarrierForm />
          </Card>
        )}

        {error ? (
          <Alert tone="danger">La liste des transporteurs n’a pas pu être chargée. Rechargez la page.</Alert>
        ) : !carriers?.length ? (
          <EmptyState title="Aucun transporteur">
            {isAdmin
              ? "Ajoutez le premier transporteur ci-dessus."
              : "L’administrateur n’a pas encore saisi de transporteur."}
          </EmptyState>
        ) : (
          carriers.map((carrier) => (
            <Card key={carrier.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{carrier.name}</h2>
                <Badge tone={carrier.link_type === "tiers" ? "warning" : "info"}>
                  {carrier.link_type === "tiers" ? "Service tiers" : "Lien officiel"}
                </Badge>
                {carrier.api_status === "obtenu" && <Badge tone="success">API obtenue</Badge>}
                {!carrier.active && <Badge>Inactif</Badge>}
              </div>
              {isAdmin ? (
                <CarrierForm carrier={carrier} />
              ) : (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Page de suivi</dt>
                    <dd className="break-all">{carrier.tracking_url}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Lien direct</dt>
                    <dd className="break-all">{carrier.url_template ?? "— (référence à saisir sur la page)"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Accès API</dt>
                    <dd>{CARRIER_API_STATUS_LABELS[carrier.api_status]}</dd>
                  </div>
                </dl>
              )}
            </Card>
          ))
        )}
      </div>
    </>
  );
}
