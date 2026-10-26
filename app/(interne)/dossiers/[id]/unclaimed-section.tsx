import { Alert, Badge, Card } from "@/components/ui/feedback";
import {
  LETTER_SENDING_CHANNEL_LABELS,
  PROCEDURE_CLOSING_STATUS_LABELS,
  UNCLAIMED_LETTER_LABELS,
} from "@/lib/dossiers/labels";
import { formatDate, formatDateTime, formatUsd } from "@/lib/format";
import type {
  UnclaimedLetterKind,
  UnclaimedLetterRow,
  UnclaimedOverviewRow,
  UnclaimedProcedureRow,
} from "@/lib/supabase/database.types";
import {
  CancelLetterForm,
  CloseProcedureForm,
  GenerateLetterFileForm,
  IssueLetterForm,
  LetterSentForm,
  OpenProcedureForm,
} from "../unclaimed-forms";
import { downloadHref } from "./sections";

const LETTER_STATUS: Record<UnclaimedLetterRow["status"], { tone: "success" | "warning" | "neutral"; label: string }> =
  {
    issued: { tone: "warning", label: "Émis — envoi à enregistrer" },
    sent: { tone: "success", label: "Envoyé" },
    cancelled: { tone: "neutral", label: "Annulé" },
  };

/**
 * US-5.3 : procédure « véhicule non réclamé » (contrat art. 21–22, R11). Compte à rebours depuis l'ATA, courriers
 * (relance, mise en demeure) et procédure à l'échéance. Aucune action automatique sur la propriété du véhicule.
 */
export function UnclaimedSection({
  dossierId,
  overview,
  letters,
  procedure,
  canWriteLetters,
  canWriteProcedure,
  today,
  staffName,
}: {
  dossierId: string;
  overview: UnclaimedOverviewRow | null;
  letters: UnclaimedLetterRow[];
  procedure: UnclaimedProcedureRow | null;
  canWriteLetters: boolean;
  canWriteProcedure: boolean;
  today: string;
  staffName: (userId: string | null) => string | null;
}) {
  if (!overview || (!overview.applies && letters.length === 0 && !procedure)) return null;
  const active = (kind: UnclaimedLetterKind) => letters.find((l) => l.kind === kind && l.status !== "cancelled");
  const reminder = active("reminder");
  const notice = active("formal_notice");
  const overdue = (date: string) => today >= date;
  const procedureReady =
    overview.next_step === "procedure" &&
    overdue(overview.procedure_possible_on) &&
    overview.cure_deadline !== null &&
    overview.cure_deadline < today;

  const steps: { label: string; due: string; state: React.ReactNode }[] = [
    {
      label: "Lettre de relance",
      due: `au plus tard le ${formatDate(overview.reminder_due_on)} (J+${dayOffset(overview, overview.reminder_due_on)})`,
      state: letterState(reminder, overview.applies && overdue(overview.reminder_due_on)),
    },
    {
      label: "Mise en demeure",
      due: `au plus tard le ${formatDate(overview.formal_notice_due_on)} (J+${dayOffset(overview, overview.formal_notice_due_on)})`,
      state: (
        <>
          {letterState(notice, overview.applies && overdue(overview.formal_notice_due_on))}
          {overview.cure_deadline && (
            <span className="text-muted text-xs">
              {" "}
              · régularisation attendue au plus tard le {formatDate(overview.cure_deadline)}
            </span>
          )}
        </>
      ),
    },
    {
      label: "Procédure (droits et recours, art. 22)",
      due: `possible à partir du ${formatDate(overview.procedure_possible_on)}`,
      state: procedure ? (
        <Badge tone={procedure.closed_at ? "neutral" : "danger"}>
          {procedure.closed_at
            ? `Clôturée le ${formatDate(procedure.closed_at)}`
            : `Ouverte le ${formatDate(procedure.opened_at)}`}
        </Badge>
      ) : procedureReady ? (
        <Badge tone="danger">Possible</Badge>
      ) : (
        <span className="text-muted text-xs">Pas encore</span>
      ),
    },
  ];

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Véhicule non réclamé (contrat art. 21–22)</h2>
      <p className="text-sm">
        Arrivé le {formatDate(overview.arrival_date)} : <strong>J+{overview.days_since_arrival}</strong>.{" "}
        {overview.applies ? (
          <>
            {overview.amount_due_cents > 0 ? (
              <>
                Reste dû : <strong>{formatUsd(overview.amount_due_cents)}</strong>.{" "}
              </>
            ) : (
              "Solde réglé. "
            )}
            {overview.collected ? "Véhicule enlevé." : "Véhicule non enlevé."}
          </>
        ) : (
          "Solde réglé et véhicule enlevé : procédure sans objet."
        )}
      </p>

      <ol className="flex flex-col gap-2 text-sm">
        {steps.map((step, i) => (
          <li
            key={step.label}
            className="border-border flex flex-col gap-1 border-l-2 pl-3 sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="font-medium">
              {i + 1}. {step.label}
            </span>
            <span className="text-muted text-xs">{step.due}</span>
            <span>{step.state}</span>
          </li>
        ))}
      </ol>

      {letters.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Courriers</h3>
          {letters.map((letter) => (
            <div key={letter.id} className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {UNCLAIMED_LETTER_LABELS[letter.kind]} {letter.number}
                </span>
                <Badge tone={LETTER_STATUS[letter.status].tone}>{LETTER_STATUS[letter.status].label}</Badge>
                <span className="text-muted text-xs">
                  émis le {formatDateTime(letter.issued_at)}
                  {staffName(letter.issued_by) && ` par ${staffName(letter.issued_by)}`} · sommes dues{" "}
                  {formatUsd(letter.amount_due_cents)}
                  {letter.cure_days !== null && ` · délai de ${letter.cure_days} jours`}
                </span>
              </div>
              {letter.status === "sent" && letter.sent_at && (
                <p className="text-muted text-xs">
                  Envoyé le {formatDate(letter.sent_at)}
                  {letter.sent_channel && ` (${LETTER_SENDING_CHANNEL_LABELS[letter.sent_channel]})`}
                  {letter.sent_note && ` : ${letter.sent_note}`} · visible dans l’espace client
                </p>
              )}
              {letter.status === "cancelled" && (
                <p className="text-muted text-xs">Annulé : {letter.cancelled_reason}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {letter.document_id && (
                  <a href={downloadHref(letter.document_id)} className="text-primary underline">
                    Télécharger le courrier (Word)
                  </a>
                )}
                {letter.sent_proof_document_id && (
                  <a href={downloadHref(letter.sent_proof_document_id)} className="text-primary underline">
                    Preuve d’envoi
                  </a>
                )}
              </div>
              {canWriteLetters && letter.status === "issued" && (
                <>
                  {!letter.document_id ? (
                    <GenerateLetterFileForm dossierId={dossierId} letterId={letter.id} />
                  ) : (
                    <details>
                      <summary className="cursor-pointer font-medium">Enregistrer l’envoi…</summary>
                      <div className="mt-3">
                        <LetterSentForm
                          dossierId={dossierId}
                          letterId={letter.id}
                          issuedOn={letter.issued_at.slice(0, 10)}
                          today={today}
                        />
                      </div>
                    </details>
                  )}
                  <details>
                    <summary className="text-muted cursor-pointer text-xs">Annuler ce courrier (erreur)…</summary>
                    <div className="mt-3">
                      <CancelLetterForm dossierId={dossierId} letterId={letter.id} />
                    </div>
                  </details>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {canWriteLetters && overview.next_step === "reminder" && !reminder && (
        <IssueLetterForm dossierId={dossierId} kind="reminder" minCureDays={overview.min_cure_days} />
      )}
      {canWriteLetters && overview.next_step === "formal_notice" && !notice && (
        <IssueLetterForm dossierId={dossierId} kind="formal_notice" minCureDays={overview.min_cure_days} />
      )}
      {!canWriteLetters &&
        overview.applies &&
        (overview.next_step === "reminder" || overview.next_step === "formal_notice") && (
          <p className="text-muted text-sm">Courriers émis par l’administrateur, la direction ou la comptabilité.</p>
        )}

      {overview.next_step === "procedure" &&
        !procedure &&
        (procedureReady ? (
          canWriteProcedure ? (
            <OpenProcedureForm dossierId={dossierId} />
          ) : (
            <Alert tone="warning">Procédure possible : à ouvrir par l’administrateur ou la direction.</Alert>
          )
        ) : (
          <p className="text-muted text-sm">
            Procédure possible à partir du {formatDate(overview.procedure_possible_on)}, une fois le délai de la mise en
            demeure expiré.
          </p>
        ))}

      {procedure && (
        <div className="flex flex-col gap-2 text-sm">
          <h3 className="font-medium">Procédure</h3>
          <p>
            Ouverte le {formatDateTime(procedure.opened_at)}
            {staffName(procedure.opened_by) && ` par ${staffName(procedure.opened_by)}`} : {procedure.open_reason}
          </p>
          {procedure.closed_at ? (
            <p>
              Clôturée le {formatDateTime(procedure.closed_at)} : {procedure.outcome}
              {procedure.closing_status && ` (${PROCEDURE_CLOSING_STATUS_LABELS[procedure.closing_status]})`}
            </p>
          ) : (
            canWriteProcedure && <CloseProcedureForm dossierId={dossierId} />
          )}
        </div>
      )}

      <p className="text-muted text-xs">
        Le système ne change jamais la propriété du véhicule et ne déclenche aucune vente : chaque étape est décidée et
        enregistrée par l’équipe, et journalisée.
      </p>
    </Card>
  );
}

function dayOffset(overview: UnclaimedOverviewRow, date: string): number {
  return Math.round((new Date(date).getTime() - new Date(overview.arrival_date).getTime()) / (24 * 60 * 60 * 1000));
}

function letterState(letter: UnclaimedLetterRow | undefined, due: boolean): React.ReactNode {
  if (letter?.status === "sent" && letter.sent_at)
    return <Badge tone="success">Envoyée le {formatDate(letter.sent_at)}</Badge>;
  if (letter) return <Badge tone="warning">Émise, envoi à enregistrer</Badge>;
  return due ? <Badge tone="danger">À envoyer</Badge> : <span className="text-muted text-xs">Pas encore due</span>;
}
