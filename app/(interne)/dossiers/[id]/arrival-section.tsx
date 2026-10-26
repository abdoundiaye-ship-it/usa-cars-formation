import { Alert, Badge, Card } from "@/components/ui/feedback";
import { formatDate, formatDateTime } from "@/lib/format";
import { NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_STATUS_LABELS } from "@/lib/notifications/labels";
import type { DocumentReleaseRow, DossierEventRow, DossierRow, NotificationRow } from "@/lib/supabase/database.types";
import { ArrivalNoticeForm } from "../arrival-form";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Arrivée à Dakar : information du client (contrat art. 17, `arrival.notify_within_hours`) et enlèvement attendu
 * après la remise des documents (R10, `pickup.days_after_documents`). Affichée dès que l'ATA est saisie.
 */
export function ArrivalSection({
  dossier,
  container,
  messages,
  notices,
  release,
  notifyHours,
  pickupDays,
  canWrite,
  staffName,
}: {
  dossier: Pick<DossierRow, "id" | "status">;
  container: { number: string; ata: string | null } | null;
  messages: Pick<NotificationRow, "id" | "channel" | "status" | "created_at" | "sent_at">[];
  notices: Pick<DossierEventRow, "id" | "label" | "occurred_at" | "actor_id">[];
  release: Pick<DocumentReleaseRow, "released_at"> | null;
  notifyHours: number | null;
  pickupDays: number | null;
  canWrite: boolean;
  staffName: (userId: string | null) => string | null;
}) {
  if (!container?.ata) return null;
  const informed = messages.some((m) => m.status === "sent") || notices.length > 0;
  const pickupExpected =
    release && pickupDays !== null ? new Date(new Date(release.released_at).getTime() + pickupDays * DAY) : null;

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Arrivée à Dakar</h2>
      <p className="text-sm">
        Arrivé le <strong>{formatDate(container.ata)}</strong> (conteneur{" "}
        <span className="font-mono">{container.number}</span>).
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Information du client</h3>
        {messages.length === 0 && notices.length === 0 ? (
          <p className="text-muted text-sm">Aucun message d’arrivée (aucun canal renseigné sur la fiche client).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span>Message automatique · {NOTIFICATION_CHANNEL_LABELS[m.channel]}</span>
                <Badge tone={m.status === "sent" ? "success" : m.status === "failed" ? "danger" : "neutral"}>
                  {NOTIFICATION_STATUS_LABELS[m.status]}
                </Badge>
                <span className="text-muted text-xs">{formatDateTime(m.sent_at ?? m.created_at)}</span>
              </li>
            ))}
            {notices.map((n) => (
              <li key={n.id}>
                {n.label}{" "}
                <span className="text-muted text-xs">
                  · {formatDateTime(n.occurred_at)}
                  {staffName(n.actor_id) && ` · ${staffName(n.actor_id)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!informed && (
          <>
            <Alert tone="warning">
              Le client n’a pas encore été informé de l’arrivée
              {notifyHours !== null && ` (délai : ${notifyHours} h après la saisie de l’ATA)`}. Un message simulé ou en
              échec ne l’informe pas : prévenez-le et enregistrez-le ci-dessous.
            </Alert>
            {canWrite && <ArrivalNoticeForm dossierId={dossier.id} />}
          </>
        )}
      </div>

      {release && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Enlèvement</h3>
          {dossier.status === "collected" ? (
            <p className="text-sm">Véhicule enlevé.</p>
          ) : (
            <p className="text-sm">
              Documents remis le {formatDate(release.released_at)}
              {pickupExpected && (
                <>
                  {" "}
                  · enlèvement attendu au plus tard le <strong>{formatDate(pickupExpected.toISOString())}</strong>
                  {pickupExpected < new Date() && (
                    <>
                      {" "}
                      <Badge tone="warning">Délai dépassé</Badge>
                    </>
                  )}
                </>
              )}
              . Passez le statut à « Enlevé » une fois le véhicule récupéré.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
