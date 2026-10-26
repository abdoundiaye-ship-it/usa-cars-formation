import { Alert, Card } from "@/components/ui/feedback";
import { ID_DOCUMENT_LABELS } from "@/lib/dossiers/labels";
import { formatDateTime, formatUsd } from "@/lib/format";
import type { DocumentReleaseRow, DossierBalance, DossierRow } from "@/lib/supabase/database.types";
import { DocumentReleaseForm } from "../release-form";
import { downloadHref } from "./sections";

/**
 * US-3.11 / R9 : remise des documents (B/L, titre, factures), possible seulement quand le solde du dossier est réglé ;
 * la propriété est transférée au paiement intégral.
 */
export function ReleaseSection({
  dossier,
  balance,
  release,
  clientName,
  canWrite,
  today,
  staffName,
}: {
  dossier: DossierRow;
  balance: DossierBalance | null;
  release: DocumentReleaseRow | null;
  clientName: string;
  canWrite: boolean;
  today: string;
  staffName: (userId: string | null) => string | null;
}) {
  if (!balance?.has_accepted_quote) return null;
  const settled = balance.balance_remaining_cents <= 0;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Remise des documents</h2>
      {dossier.ownership_transferred_at && (
        <p className="text-sm">
          Paiement intégral le {formatDateTime(dossier.ownership_transferred_at)} : la propriété du véhicule est
          transférée au client.
        </p>
      )}
      {release ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Remis le</dt>
            <dd>{formatDateTime(release.released_at)}</dd>
          </div>
          <div>
            <dt className="text-muted">Bénéficiaire</dt>
            <dd>
              {release.beneficiary_name}
              {release.beneficiary_kind === "representative" ? " (mandataire)" : " (client)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Pièce vérifiée</dt>
            <dd>
              {ID_DOCUMENT_LABELS[release.id_document_type]} n° {release.id_document_number}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Enregistrée par</dt>
            <dd>{staffName(release.recorded_by) ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={downloadHref(release.discharge_document_id)} className="text-primary underline">
              Décharge signée
            </a>
            {release.power_of_attorney_document_id && (
              <a href={downloadHref(release.power_of_attorney_document_id)} className="text-primary underline">
                Procuration
              </a>
            )}
          </div>
        </dl>
      ) : !settled ? (
        <Alert tone="info">
          Remise impossible tant que le solde n’est pas réglé (reste dû : {formatUsd(balance.balance_remaining_cents)}).
        </Alert>
      ) : canWrite ? (
        <DocumentReleaseForm dossierId={dossier.id} clientName={clientName} today={today} />
      ) : (
        <p className="text-muted text-sm">Solde réglé : documents à remettre au client.</p>
      )}
    </Card>
  );
}
