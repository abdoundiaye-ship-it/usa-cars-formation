import { Download } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StageBanner } from "@/components/stage-banner";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { CONTRACT_STATUS_LABELS, PLATFORM_LABELS, STAGE_LABELS, VEHICLE_CATEGORY_LABELS } from "@/lib/dossiers/labels";
import { formatDate, formatDateTime, formatInteger } from "@/lib/format";
import { currentNumbers } from "@/lib/server/settings-values";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { missingClientInformation } from "@/lib/validation/operations";
import { ArrivalSection } from "./arrival-section";
import { BillingSection } from "./billing-section";
import { FinanceSection } from "./finance-section";
import { ReleaseSection } from "./release-section";
import { SettlementSection } from "./settlement-section";
import { ClaimsSection } from "./claims-section";
import { UnclaimedSection } from "./unclaimed-section";
import { DuplicateDossierForm, AcceptanceForm, RegenerateContractForm, VehicleForm } from "../dossier-forms";
import {
  AcceptanceSummary,
  AuctionSection,
  ConfirmationsSection,
  ContainerSection,
  DocumentsSection,
  downloadHref,
  PurchaseOrderSection,
  StageSection,
  type AgeCheck,
} from "./sections";

export const metadata: Metadata = { title: "Fiche dossier" };

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  ouvert: { tone: "success", text: "Dossier ouvert et contrat généré. Téléchargez-le pour le faire signer." },
  duplique: {
    tone: "success",
    text: "Dossier dupliqué : nouveau dossier pour le même client, avec son propre contrat.",
  },
  "contrat-erreur": {
    tone: "danger",
    text: "Le dossier est ouvert, mais le contrat n’a pas pu être généré. Utilisez « Générer le contrat » ci-dessous.",
  },
  devis: { tone: "success", text: "Devis émis. Téléchargez le fichier pour l’envoyer au client." },
  solde: { tone: "success", text: "Facture de solde émise. Téléchargez le fichier pour l’envoyer au client." },
  facture: { tone: "success", text: "Facture d’acompte émise. Téléchargez le fichier pour l’envoyer au client." },
  "fichier-erreur": {
    tone: "danger",
    text: "Le document est émis, mais son fichier n’a pas pu être généré. Utilisez « Générer le fichier » sur le document.",
  },
};

export default async function DossierPage({ params, searchParams }: PageProps<"/dossiers/[id]">) {
  const access = await requireInternal(SCREEN_ROLES.dossiers);
  const canWrite = canAccess(access.role, SCREEN_ROLES.operationsWrite);
  const isAdmin = access.role === "admin";
  const { id } = await params;
  const query = await searchParams;
  const notice =
    query.ouvert === "1"
      ? NOTICES.ouvert
      : query.duplique === "1"
        ? NOTICES.duplique
        : query.contrat === "erreur"
          ? NOTICES["contrat-erreur"]
          : typeof query.facturation === "string" &&
              ["devis", "facture", "solde", "fichier-erreur"].includes(query.facturation)
            ? NOTICES[query.facturation]
            : null;

  const supabase = await createSupabaseServerClient();
  const { data: dossier } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
  if (!dossier) notFound();

  const [
    { data: client },
    { data: contract },
    { data: order },
    { data: acceptances },
    { data: events, error: eventsError },
    { data: statuses },
    { data: staff },
    { data: conditions },
    { data: ageRows },
    { data: confirmations },
    { data: documents },
    { data: containerAssignments },
    { data: openContainers },
    { data: forfaits },
    { data: costs },
    { data: financialDocuments },
    { data: payments },
    { data: activeAccounts },
    { data: todayRateExists },
    { data: adjustments },
    { data: refunds },
    { data: balanceRows },
    { data: currentRate },
    { data: release },
    { data: arrivalMessages },
    { data: arrivalNotices },
    arrivalSettings,
    { data: unclaimedRows },
    { data: unclaimedLetters },
    { data: unclaimedProcedure },
    { data: claims },
    { data: claimPhotos },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", dossier.client_id).maybeSingle(),
    supabase
      .from("contracts")
      .select("*, documents!contracts_document_id_fkey(version, uploaded_at)")
      .eq("dossier_id", id)
      .maybeSingle(),
    supabase.from("purchase_orders").select("*").eq("dossier_id", id).maybeSingle(),
    supabase.from("acceptances").select("*").eq("dossier_id", id),
    supabase
      .from("dossier_events")
      .select("*")
      .eq("dossier_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("workflow_statuses")
      .select("stage, code, label, position")
      .eq("stage", dossier.stage)
      .order("position"),
    supabase.from("staff_directory").select("id, full_name"),
    supabase.rpc("stage_conditions", { p_dossier_id: id }),
    supabase.rpc("vehicle_age_check", { p_dossier_id: id }),
    supabase.from("dossier_confirmations").select("*").eq("dossier_id", id),
    supabase.from("documents").select("*").eq("dossier_id", id).order("uploaded_at", { ascending: false }),
    supabase
      .from("dossier_containers")
      .select("container_id, assigned_at, removed_at, removal_reason, containers(number, eta, ata, status, bl_number)")
      .eq("dossier_id", id)
      .order("assigned_at", { ascending: false }),
    supabase.from("containers").select("id, number, eta").is("ata", null).order("number"),
    supabase.from("dossier_forfaits").select("*").eq("dossier_id", id).maybeSingle(),
    supabase.from("internal_costs").select("*").eq("dossier_id", id).order("created_at"),
    supabase.from("financial_documents").select("*").eq("dossier_id", id).order("issued_at", { ascending: false }),
    supabase.from("payments").select("*").eq("dossier_id", id).order("credited_at"),
    supabase.from("official_accounts").select("id, kind, label").eq("status", "active").order("label"),
    supabase.rpc("fx_rate_exists_on", { p_day: new Date().toISOString().slice(0, 10) }),
    supabase.from("adjustments").select("*").eq("dossier_id", id).order("created_at"),
    supabase.from("refunds").select("*").eq("dossier_id", id).order("requested_at"),
    supabase.rpc("dossier_balance", { p_dossier_id: id }),
    supabase.rpc("fx_rate_as_of", { p_at: new Date().toISOString() }),
    supabase.from("document_releases").select("*").eq("dossier_id", id).maybeSingle(),
    supabase
      .from("notifications")
      .select("id, channel, status, created_at, sent_at")
      .eq("dossier_id", id)
      .eq("template", "arrived")
      .order("created_at"),
    supabase
      .from("dossier_events")
      .select("id, label, occurred_at, actor_id")
      .eq("dossier_id", id)
      .eq("kind", "arrival_notified")
      .order("occurred_at"),
    currentNumbers(["arrival.notify_within_hours", "pickup.days_after_documents"] as const),
    supabase.rpc("unclaimed_overview", { p_dossier_id: id }),
    supabase.from("unclaimed_letters").select("*").eq("dossier_id", id).order("issued_at"),
    supabase.from("unclaimed_procedures").select("*").eq("dossier_id", id).maybeSingle(),
    supabase.from("claims_overview").select("*").eq("dossier_id", id).order("filed_at", { ascending: false }),
    supabase.from("documents").select("id, claim_id, file_name").eq("dossier_id", id).not("claim_id", "is", null),
  ]);
  const contractAcceptance = acceptances?.find((a) => a.subject === "contract") ?? null;
  const orderAcceptance = acceptances?.find((a) => a.subject === "purchase_order") ?? null;

  const statusLabel = statuses?.find((s) => s.code === dossier.status)?.label ?? dossier.status;
  const staffName = (userId: string | null) => staff?.find((s) => s.id === userId)?.full_name ?? null;
  const missing = client ? missingClientInformation(client) : [];
  const vehicle = [dossier.make, dossier.model, dossier.model_year].filter(Boolean).join(" ");
  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC+0
  const ageCheck = (ageRows?.[0] ?? null) as AgeCheck | null;
  const currentContainer = containerAssignments?.find((a) => a.removed_at === null)?.containers ?? null;

  return (
    <>
      <PageHeader
        title={`Dossier ${dossier.reference}`}
        description={[vehicle || "Véhicule à préciser", client?.name].filter(Boolean).join(" · ")}
      />

      <div className="flex flex-col gap-6">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        <Card className="flex flex-col gap-3">
          <StageBanner stage={dossier.stage} />
          <p className="text-sm">
            Étape <strong>{STAGE_LABELS[dossier.stage]}</strong> · statut <Badge tone="info">{statusLabel}</Badge>
          </p>
          <dl className="text-muted grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt className="inline">Client : </dt>
              <dd className="inline">
                {client ? (
                  <Link href={`/clients/${client.id}` as Route} className="text-primary underline">
                    {client.name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="inline">Responsable : </dt>
              <dd className="inline">{staffName(dossier.owner_id) ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline">Ouvert le : </dt>
              <dd className="inline">{formatDate(dossier.created_at)}</dd>
            </div>
          </dl>
          {missing.length > 0 && <Alert tone="warning">Fiche client à compléter : {missing.join(", ")}.</Alert>}
        </Card>

        <StageSection
          dossier={dossier}
          conditions={conditions ?? []}
          statuses={statuses ?? []}
          canWrite={canWrite}
          isAdmin={isAdmin}
        />

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Contrat de prestation</h2>
          {!contract ? (
            <>
              <EmptyState title="Contrat non généré">
                Un contrat par véhicule, généré à l’ouverture du dossier.
              </EmptyState>
              {canWrite && <RegenerateContractForm dossierId={dossier.id} label="Générer le contrat" />}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p>
                  <Badge
                    tone={
                      contract.status === "accepted" ? "success" : contract.status === "refused" ? "danger" : "warning"
                    }
                  >
                    {CONTRACT_STATUS_LABELS[contract.status]}
                  </Badge>{" "}
                  <span className="text-muted">
                    Référence {contract.reference} · version {contract.documents?.version ?? 1}
                    {contract.documents?.uploaded_at && ` du ${formatDateTime(contract.documents.uploaded_at)}`}
                  </span>
                </p>
                <a href={downloadHref(contract.document_id)} className={buttonClasses("secondary")}>
                  <Download aria-hidden />
                  Télécharger le contrat (Word)
                </a>
              </div>
              <p className="text-muted text-xs break-all">
                Empreinte SHA-256 de la version en vigueur :{" "}
                <span className="font-mono">{contract.document_sha256}</span>
              </p>

              {contractAcceptance ? (
                <AcceptanceSummary acceptance={contractAcceptance} staffName={staffName} />
              ) : canWrite ? (
                <>
                  <RegenerateContractForm dossierId={dossier.id} label="Régénérer le contrat" />
                  <div className="border-border border-t pt-4">
                    <h3 className="mb-3 font-medium">Enregistrer la décision du client</h3>
                    <AcceptanceForm dossierId={dossier.id} subject="contract" subjectId={contract.id} today={today} />
                  </div>
                </>
              ) : (
                <p className="text-muted text-sm">En attente de la décision du client.</p>
              )}
            </>
          )}
        </Card>

        <PurchaseOrderSection
          dossier={dossier}
          order={order}
          acceptance={orderAcceptance}
          ageCheck={ageCheck}
          canWrite={canWrite}
          isAdmin={isAdmin}
          today={today}
          staffName={staffName}
        />

        <AuctionSection dossier={dossier} order={order} canWrite={canWrite} isAdmin={isAdmin} staffName={staffName} />

        <ContainerSection
          dossier={dossier}
          assignments={containerAssignments ?? []}
          options={openContainers ?? []}
          canWrite={canWrite}
        />

        <ArrivalSection
          dossier={dossier}
          container={currentContainer}
          messages={arrivalMessages ?? []}
          notices={arrivalNotices ?? []}
          release={release}
          notifyHours={arrivalSettings["arrival.notify_within_hours"]}
          pickupDays={arrivalSettings["pickup.days_after_documents"]}
          canWrite={canWrite}
          staffName={staffName}
        />

        <FinanceSection
          dossierId={dossier.id}
          forfaits={forfaits}
          costs={costs ?? []}
          canEdit={canAccess(access.role, SCREEN_ROLES.forfaitsWrite)}
        />

        <BillingSection
          dossier={dossier}
          order={order}
          forfaits={forfaits}
          documents={financialDocuments ?? []}
          payments={payments ?? []}
          acceptances={acceptances ?? []}
          accounts={activeAccounts ?? []}
          todayRateExists={todayRateExists === true}
          canWriteQuote={canAccess(access.role, SCREEN_ROLES.quotesWrite)}
          canWriteInvoice={canAccess(access.role, SCREEN_ROLES.invoicesWrite)}
          canWritePayment={canAccess(access.role, SCREEN_ROLES.paymentsWrite)}
          today={today}
          staffName={staffName}
        />

        <SettlementSection
          dossier={dossier}
          balance={balanceRows?.[0] ?? null}
          documents={financialDocuments ?? []}
          payments={payments ?? []}
          adjustments={adjustments ?? []}
          refunds={refunds ?? []}
          acceptances={acceptances ?? []}
          accounts={activeAccounts ?? []}
          todayRate={currentRate?.[0] ?? null}
          shippingReady={(containerAssignments ?? []).some(
            (a) => a.removed_at === null && a.containers?.bl_number && a.containers?.eta,
          )}
          canWriteInvoice={canAccess(access.role, SCREEN_ROLES.invoicesWrite)}
          canWritePayment={canAccess(access.role, SCREEN_ROLES.paymentsWrite)}
          isAdmin={isAdmin}
          today={today}
          staffName={staffName}
        />

        <ReleaseSection
          dossier={dossier}
          balance={balanceRows?.[0] ?? null}
          release={release}
          clientName={client?.name ?? ""}
          canWrite={canWrite}
          today={today}
          staffName={staffName}
        />

        <UnclaimedSection
          dossierId={dossier.id}
          overview={unclaimedRows?.[0] ?? null}
          letters={unclaimedLetters ?? []}
          procedure={unclaimedProcedure}
          canWriteLetters={canAccess(access.role, SCREEN_ROLES.recoveryWrite)}
          canWriteProcedure={canAccess(access.role, SCREEN_ROLES.procedureWrite)}
          today={today}
          staffName={staffName}
        />

        <ClaimsSection
          dossierId={dossier.id}
          collected={dossier.collected_at !== null}
          claims={claims ?? []}
          photos={claimPhotos ?? []}
          canWrite={canWrite}
        />

        {/* Confirmations manuelles de la phase 2 (P1) : conservées pour les dossiers concernés, en lecture seule. */}
        {(confirmations?.length ?? 0) > 0 && (
          <ConfirmationsSection
            dossier={dossier}
            confirmations={confirmations ?? []}
            canConfirm={false}
            staffName={staffName}
          />
        )}

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Véhicule</h2>
          {canWrite ? (
            <VehicleForm dossier={dossier} />
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {[
                ["Plateforme", dossier.platform ? PLATFORM_LABELS[dossier.platform] : null],
                ["N° de lot", dossier.lot_number],
                ["VIN", dossier.vin],
                ["Véhicule", vehicle],
                ["Kilométrage", dossier.mileage === null ? null : `${formatInteger(dossier.mileage)} miles`],
                ["Catégorie", dossier.vehicle_category ? VEHICLE_CATEGORY_LABELS[dossier.vehicle_category] : null],
                ["Statut du titre", dossier.title_status],
                ["Lieu d’achat", dossier.purchase_location],
                ["Port de départ", dossier.departure_port],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="break-words">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <DocumentsSection
          dossierId={dossier.id}
          documents={documents ?? []}
          canEdit={canAccess(access.role, SCREEN_ROLES.documentsWrite)}
        />

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Chronologie</h2>
          {eventsError ? (
            <Alert tone="danger">La chronologie n’a pas pu être chargée. Rechargez la page.</Alert>
          ) : !events?.length ? (
            <EmptyState title="Aucun événement" />
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="border-border border-l-2 pl-3 text-sm">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-muted text-xs">
                    {formatDateTime(e.occurred_at)}
                    {staffName(e.actor_id) && ` · ${staffName(e.actor_id)}`}
                    {e.visible_client ? " · visible du client" : " · interne"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {canWrite && (
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">Autre véhicule pour ce client</h2>
            <p className="text-muted text-sm">
              Crée un nouveau dossier (et son propre contrat) en reprenant le client, la plateforme et le responsable —
              jamais le véhicule, les montants ni les documents signés.
            </p>
            <DuplicateDossierForm dossierId={dossier.id} />
          </Card>
        )}
      </div>
    </>
  );
}
