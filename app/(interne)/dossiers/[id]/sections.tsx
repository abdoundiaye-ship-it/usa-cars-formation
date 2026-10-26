import { Download } from "lucide-react";
import type { Route } from "next";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ACCEPTANCE_METHOD_LABELS,
  CONFIRMATION_LABELS,
  CONTAINER_STATUS_LABELS,
  DOCUMENT_KIND_LABELS,
  PURCHASE_ORDER_ACKNOWLEDGEMENTS,
  PURCHASE_ORDER_STATUS_LABELS,
  STAGE_LABELS,
  STAGES,
} from "@/lib/dossiers/labels";
import { formatDate, formatDateTime, formatUsd } from "@/lib/format";
import { arrivalLabel } from "@/lib/tracking";
import type {
  AcceptanceRow,
  ConfirmationCode,
  ContainerStatus,
  DocumentRow,
  DossierConfirmationRow,
  DossierRow,
  PurchaseOrderRow,
} from "@/lib/supabase/database.types";
import { VisibilityToggle } from "../../documents/visibility-toggle";
import { AcceptanceForm } from "../dossier-forms";
import {
  AdvanceStageForm,
  AgeOverrideForm,
  AssignContainerForm,
  AuctionResultForm,
  CancelDossierForm,
  ConfirmForm,
  PurchaseOrderForm,
  StatusForm,
  UploadDocumentForm,
} from "../workflow-forms";

export const downloadHref = (documentId: string) => `/documents/${documentId}` as Route;

const linkButton = buttonClasses("secondary");

type StaffName = (userId: string | null) => string | null;

/** Récapitulatif d'une décision du client (contrat ou ordre d'achat). */
export function AcceptanceSummary({ acceptance, staffName }: { acceptance: AcceptanceRow; staffName: StaffName }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted">Décision</dt>
        <dd>{acceptance.decision === "accepted" ? "Accepté par le client" : "Refusé par le client"}</dd>
      </div>
      <div>
        <dt className="text-muted">Méthode</dt>
        <dd>{ACCEPTANCE_METHOD_LABELS[acceptance.method]}</dd>
      </div>
      <div>
        <dt className="text-muted">Date</dt>
        <dd>{formatDate(acceptance.decided_at)}</dd>
      </div>
      <div>
        <dt className="text-muted">Enregistrée par</dt>
        <dd>
          {staffName(acceptance.recorded_by) ?? "—"} le {formatDateTime(acceptance.recorded_at)}
        </dd>
      </div>
      {acceptance.whatsapp_from && (
        <div>
          <dt className="text-muted">Numéro émetteur</dt>
          <dd>{acceptance.whatsapp_from}</dd>
        </div>
      )}
      {acceptance.proof_document_id && (
        <div>
          <dt className="text-muted">Preuve</dt>
          <dd>
            <a href={downloadHref(acceptance.proof_document_id)} className="text-primary underline">
              Télécharger la preuve
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

export interface StageCondition {
  code: string;
  label: string;
  met: boolean;
}

/** US-2.5 : conditions de passage de l'étape en cours, statut, passage, annulation. */
export function StageSection({
  dossier,
  conditions,
  statuses,
  canWrite,
  isAdmin,
}: {
  dossier: DossierRow;
  conditions: StageCondition[];
  statuses: { code: string; label: string }[];
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const next = STAGES[STAGES.indexOf(dossier.stage) + 1];
  const ready = conditions.every((c) => c.met);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Passage à l’étape suivante</h2>
      {dossier.stage === "closing" ? (
        <p className="text-muted text-sm">
          Dossier clôturé{dossier.cancelled_reason ? ` — annulé : ${dossier.cancelled_reason}` : ""}.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 text-sm" aria-label="Conditions de passage">
            {conditions.map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <span aria-hidden="true" className={c.met ? "text-success" : "text-danger"}>
                  {c.met ? "✓" : "✗"}
                </span>
                <span>
                  <span className="sr-only">{c.met ? "Condition remplie : " : "Condition manquante : "}</span>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
          {canWrite && next && (
            <AdvanceStageForm dossierId={dossier.id} ready={ready} isAdmin={isAdmin} nextLabel={STAGE_LABELS[next]} />
          )}
        </>
      )}
      {canWrite && dossier.stage !== "closing" && (
        <div className="border-border flex flex-col gap-4 border-t pt-4">
          {/* key : le formulaire repart du statut en vigueur dès qu’il change ailleurs sur la fiche. */}
          <StatusForm
            key={`${dossier.stage}-${dossier.status}`}
            dossierId={dossier.id}
            current={dossier.status}
            options={statuses}
          />
          {(dossier.stage === "opening" || dossier.stage === "purchase") && (
            <details>
              <summary className="text-danger cursor-pointer text-sm font-medium">Annuler le dossier…</summary>
              <div className="mt-3">
                <CancelDossierForm dossierId={dossier.id} />
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export interface AgeCheck {
  status: "ok" | "too_old" | "unknown";
  age: number | null;
  max_age: number | null;
}

/** US-2.3 : ordre d'achat (annexe B), contrôle de l'âge, signature avec les 4 confirmations. */
export function PurchaseOrderSection({
  dossier,
  order,
  acceptance,
  ageCheck,
  canWrite,
  isAdmin,
  today,
  staffName,
}: {
  dossier: DossierRow;
  order: PurchaseOrderRow | null;
  acceptance: AcceptanceRow | null;
  ageCheck: AgeCheck | null;
  canWrite: boolean;
  isAdmin: boolean;
  today: string;
  staffName: StaffName;
}) {
  const editable =
    canWrite && dossier.stage === "opening" && (!order || order.status === "draft" || order.status === "pending");
  const ageOk = ageCheck?.status === "ok" || Boolean(order?.age_override_reason);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Ordre d’achat (annexe B)</h2>

      {ageCheck && (
        <Alert tone={ageCheck.status === "ok" ? "success" : order?.age_override_reason ? "info" : "danger"}>
          {ageCheck.status === "ok"
            ? `Âge du véhicule conforme : ${ageCheck.age} an${ageCheck.age === 1 ? "" : "s"} (limite ${ageCheck.max_age} ans).`
            : ageCheck.status === "too_old"
              ? `Véhicule trop âgé pour l’importation : ${ageCheck.age} ans (limite ${ageCheck.max_age} ans).`
              : "Âge non vérifiable : renseignez l’année et la catégorie du véhicule."}
          {order?.age_override_reason && ageCheck.status !== "ok" && (
            <>
              {" "}
              Dérogation de {staffName(order.age_override_by) ?? "l’administrateur"} : {order.age_override_reason}
            </>
          )}
        </Alert>
      )}

      {order ? (
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <Badge tone={order.status === "accepted" ? "success" : order.status === "refused" ? "danger" : "warning"}>
              {PURCHASE_ORDER_STATUS_LABELS[order.status]}
            </Badge>{" "}
            <span className="text-muted">
              Enchère maximale {formatUsd(order.max_bid_cents)}
              {order.deposit_cents > 0 && ` · dépôt attendu ${formatUsd(order.deposit_cents)}`}
              {order.auction_at && ` · enchère le ${formatDateTime(order.auction_at)}`}
            </span>
          </p>
          {order.document_id && (
            <a href={downloadHref(order.document_id)} className={linkButton}>
              <Download aria-hidden />
              Télécharger l’ordre d’achat (Word)
            </a>
          )}
        </div>
      ) : (
        <EmptyState title="Ordre d’achat non saisi">
          USA CARS n’enchérit que sur ordre d’achat signé : plateforme, lot, VIN et enchère maximale.
        </EmptyState>
      )}

      {acceptance && (
        <>
          <AcceptanceSummary acceptance={acceptance} staffName={staffName} />
          {acceptance.decision === "accepted" && (
            <ul className="text-muted list-inside list-disc text-xs">
              {PURCHASE_ORDER_ACKNOWLEDGEMENTS.map(([key, label]) => (
                <li key={key}>Le client {label}.</li>
              ))}
            </ul>
          )}
        </>
      )}

      {editable && <PurchaseOrderForm dossierId={dossier.id} order={order} />}
      {editable && isAdmin && !ageOk && order && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Déroger au contrôle de l’âge (administrateur)…
          </summary>
          <div className="mt-3">
            <AgeOverrideForm dossierId={dossier.id} />
          </div>
        </details>
      )}
      {canWrite && order?.status === "pending" && (
        <div className="border-border border-t pt-4">
          <h3 className="mb-3 font-medium">Enregistrer la signature de l’ordre d’achat</h3>
          <AcceptanceForm dossierId={dossier.id} subject="purchase_order" subjectId={order.id} today={today} />
        </div>
      )}
    </Card>
  );
}

/** US-2.4 : résultat de l'enchère et échéance du paiement 1 (R4). */
export function AuctionSection({
  dossier,
  order,
  canWrite,
  isAdmin,
  staffName,
}: {
  dossier: DossierRow;
  order: PurchaseOrderRow | null;
  canWrite: boolean;
  isAdmin: boolean;
  staffName: StaffName;
}) {
  if (dossier.stage !== "purchase" && !dossier.auction_result) return null;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Enchère</h2>
      {dossier.auction_result === "won" ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Prix d’adjudication</dt>
            <dd className="amount">
              {formatUsd(dossier.hammer_price_cents!)}
              {order && <span className="text-muted"> (enchère maximale {formatUsd(order.max_bid_cents)})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Lot remporté notifié le</dt>
            <dd>{formatDateTime(dossier.lot_won_notified_at!)}</dd>
          </div>
          <div>
            <dt className="text-muted">Échéance du paiement 1</dt>
            <dd className="font-medium">{dossier.payment1_due_at ? formatDateTime(dossier.payment1_due_at) : "—"}</dd>
          </div>
          {dossier.price_override_reason && (
            <div>
              <dt className="text-muted">
                Dépassement validé par {staffName(dossier.price_override_by) ?? "l’administrateur"}
              </dt>
              <dd>{dossier.price_override_reason}</dd>
            </div>
          )}
        </dl>
      ) : dossier.auction_result === "lost" ? (
        <p className="text-sm">Lot non remporté : le dépôt éventuel est à restituer au client (phase 3).</p>
      ) : canWrite ? (
        <AuctionResultForm dossierId={dossier.id} isAdmin={isAdmin} />
      ) : (
        <p className="text-muted text-sm">Enchère en cours.</p>
      )}
    </Card>
  );
}

/** Éléments financiers confirmés à la main à chaque étape, en attendant la phase 3 (hypothèse P1). */
const MANUAL_CONFIRMATIONS: Partial<Record<DossierRow["stage"], ConfirmationCode[]>> = {
  purchase: ["quote_accepted", "payment1_received"],
  container: ["balance_invoice_issued"],
  dakar: ["balance_paid"],
};
const ALL_CONFIRMATIONS: ConfirmationCode[] = [
  "quote_accepted",
  "payment1_received",
  "balance_invoice_issued",
  "balance_paid",
];

/** Hypothèse P1 : éléments financiers confirmés à la main en attendant la phase 3. */
export function ConfirmationsSection({
  dossier,
  confirmations,
  canConfirm,
  staffName,
}: {
  dossier: DossierRow;
  confirmations: DossierConfirmationRow[];
  canConfirm: boolean;
  staffName: StaffName;
}) {
  const expected = MANUAL_CONFIRMATIONS[dossier.stage] ?? [];
  const shown = ALL_CONFIRMATIONS.filter(
    (code) => expected.includes(code) || confirmations.some((c) => c.code === code),
  );
  if (shown.length === 0) return null;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Devis, factures et paiements</h2>
        <p className="text-muted text-sm">
          Confirmations manuelles, journalisées, en attendant les devis et paiements de la phase 3.
        </p>
      </div>
      <ul className="flex flex-col gap-3 text-sm">
        {shown.map((code) => {
          const done = confirmations.find((c) => c.code === code);
          return (
            <li key={code} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {done ? "✓" : "○"} {CONFIRMATION_LABELS[code]}
                {done && (
                  <span className="text-muted text-xs">
                    {" "}
                    — {staffName(done.confirmed_by) ?? "—"}, {formatDateTime(done.confirmed_at)}
                  </span>
                )}
              </span>
              {!done && canConfirm && expected.includes(code) && <ConfirmForm dossierId={dossier.id} code={code} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export interface ContainerAssignment {
  container_id: string;
  assigned_at: string;
  removed_at: string | null;
  removal_reason: string | null;
  containers: { number: string; eta: string | null; ata: string | null; status: ContainerStatus } | null;
}

/** US-2.6 / B4 : conteneur du véhicule, changement avec motif et historique. */
export function ContainerSection({
  dossier,
  assignments,
  options,
  canWrite,
}: {
  dossier: DossierRow;
  assignments: ContainerAssignment[];
  options: { id: string; number: string; eta: string | null }[];
  canWrite: boolean;
}) {
  const relevant = ["us_transport", "container", "ocean", "dakar", "closing"].includes(dossier.stage);
  if (!relevant && assignments.length === 0) return null;
  const current = assignments.find((a) => !a.removed_at) ?? null;
  const history = assignments.filter((a) => a.removed_at);
  const canAssign = canWrite && ["us_transport", "container", "ocean"].includes(dossier.stage);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Conteneur</h2>
      {current?.containers ? (
        <p className="text-sm">
          <a href={`/conteneurs/${current.container_id}`} className="text-primary font-mono font-medium underline">
            {current.containers.number}
          </a>{" "}
          ·{" "}
          <Badge tone={current.containers.ata ? "success" : "info"}>
            {CONTAINER_STATUS_LABELS[current.containers.status]}
          </Badge>{" "}
          · {arrivalLabel(current.containers)}
        </p>
      ) : (
        <EmptyState title="Véhicule non associé à un conteneur" />
      )}
      {history.length > 0 && (
        <ul className="text-muted flex flex-col gap-1 text-xs">
          {history.map((h) => (
            <li key={h.assigned_at}>
              Auparavant : {h.containers?.number ?? "—"} (du {formatDate(h.assigned_at)} au {formatDate(h.removed_at!)}
              {h.removal_reason ? ` — ${h.removal_reason}` : ""})
            </li>
          ))}
        </ul>
      )}
      {canAssign && (
        <AssignContainerForm
          dossierId={dossier.id}
          options={options.filter((o) => o.id !== current?.container_id)}
          changing={Boolean(current)}
        />
      )}
    </Card>
  );
}

/** Documents du dossier (liste et ajout) ; l'écran Documents complet arrive au lot 2d. */
export function DocumentsSection({
  dossierId,
  documents,
  canEdit,
}: {
  dossierId: string;
  documents: DocumentRow[];
  /** Ajout et visibilité client : admin, agent opérations, comptabilité (US-2.8). */
  canEdit: boolean;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Documents</h2>
      {documents.length === 0 ? (
        <EmptyState title="Aucun document" />
      ) : (
        <Table caption="Documents du dossier">
          <thead>
            <tr>
              <Th>Document</Th>
              <Th className="hidden sm:table-cell">Ajouté le</Th>
              <Th>Client</Th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <Td>
                  <a href={downloadHref(d.id)} className="text-primary font-medium underline-offset-2 hover:underline">
                    {DOCUMENT_KIND_LABELS[d.kind]}
                    {d.version > 1 && ` (v${d.version})`}
                  </a>
                  <p className="text-muted text-xs break-all">{d.file_name}</p>
                </Td>
                <Td className="hidden sm:table-cell">{formatDateTime(d.uploaded_at)}</Td>
                <Td>
                  {canEdit ? (
                    <VisibilityToggle
                      documentId={d.id}
                      visible={d.visible_client}
                      label={DOCUMENT_KIND_LABELS[d.kind]}
                    />
                  ) : d.visible_client ? (
                    <Badge tone="info">Visible</Badge>
                  ) : (
                    <Badge>Interne</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Ajouter un document…</summary>
          <div className="mt-3">
            <UploadDocumentForm dossierId={dossierId} />
          </div>
        </details>
      )}
    </Card>
  );
}
