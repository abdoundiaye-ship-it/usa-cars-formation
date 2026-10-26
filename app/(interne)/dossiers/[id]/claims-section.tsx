import { Alert, Badge, Card, EmptyState } from "@/components/ui/feedback";
import { CLAIM_SOURCE_LABELS, CLAIM_STATUS_LABELS, claimStatusTone, deadlineLabel } from "@/lib/claims";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ClaimOverviewRow, DocumentRow } from "@/lib/supabase/database.types";
import { FileClaimForm, RespondClaimForm } from "../claims-forms";
import { downloadHref } from "./sections";

/**
 * Lot 6d (contrat art. 19) : réclamations après l'enlèvement. L'agent dépose une réclamation (réserves, photos) et
 * la traite ; le délai est de quelques jours ouvrés après l'enlèvement, au-delà « hors délai ». Section visible
 * seulement une fois le véhicule enlevé.
 */
export function ClaimsSection({
  dossierId,
  collected,
  claims,
  photos,
  canWrite,
}: {
  dossierId: string;
  collected: boolean;
  claims: ClaimOverviewRow[];
  photos: Pick<DocumentRow, "id" | "claim_id" | "file_name">[];
  canWrite: boolean;
}) {
  if (!collected && claims.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold">Réclamations</h2>
        <p className="text-muted mt-1 text-sm">
          Réserves à l’enlèvement (contrat art. 19) : à signaler dans le délai, sinon le recours contre les tiers peut
          être compromis.
        </p>
      </div>

      {claims.length === 0 ? (
        <EmptyState title="Aucune réclamation" />
      ) : (
        <ul className="flex flex-col gap-4">
          {claims.map((c) => {
            const claimPhotos = photos.filter((p) => p.claim_id === c.id);
            return (
              <li key={c.id} className="border-border rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={claimStatusTone(c.status)}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                  <Badge tone={c.out_of_time ? "danger" : "success"}>{deadlineLabel(c.out_of_time)}</Badge>
                  <span className="text-muted text-xs">
                    Déposée par {CLAIM_SOURCE_LABELS[c.source]} le {formatDate(c.filed_at)} · délai au{" "}
                    {formatDate(c.deadline_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-line">{c.reserves}</p>
                {claimPhotos.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                    {claimPhotos.map((p) => (
                      <li key={p.id}>
                        <a href={downloadHref(p.id)} className="text-primary underline underline-offset-2">
                          {p.file_name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {c.response && (
                  <div className="bg-background mt-3 rounded-md p-3 text-sm">
                    <p className="text-muted text-xs">
                      Réponse de USA CARS {c.responded_at && `· ${formatDateTime(c.responded_at)}`}
                    </p>
                    <p className="mt-1 whitespace-pre-line">{c.response}</p>
                  </div>
                )}
                {canWrite && <RespondClaimForm claimId={c.id} dossierId={dossierId} status={c.status} />}
              </li>
            );
          })}
        </ul>
      )}

      {collected && canWrite && (
        <div className="border-border border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">Déposer une réclamation pour le client</h3>
          <FileClaimForm dossierId={dossierId} />
        </div>
      )}
      {!collected && <Alert tone="info">Les réclamations s’ouvrent après l’enlèvement du véhicule.</Alert>}
    </Card>
  );
}
