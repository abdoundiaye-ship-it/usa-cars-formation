import type { NotificationStatus, NotificationTemplate } from "@/lib/supabase/database.types";

/** Libellés du journal des notifications (docs/19). */
export const NOTIFICATION_TEMPLATE_LABELS: Record<NotificationTemplate, string> = {
  login_link: "Lien de connexion",
  lot_won: "Lot remporté",
  quote_issued: "Devis émis",
  payment_due_reminder: "Rappel d’échéance",
  vessel_departed: "Départ du navire",
  eta_changed: "ETA modifiée",
  arrived: "Arrivée à Dakar",
  documents_ready: "Documents prêts",
  payment_overdue: "Relance",
  test_message: "Message de test",
  unclaimed_reminder: "Lettre de relance adressée",
  formal_notice: "Mise en demeure adressée",
  claim_update: "Réponse à une réclamation",
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: "En attente",
  sending: "En cours d’envoi",
  sent: "Envoyé",
  simulated: "Simulé (fournisseur non configuré)",
  failed: "Échec",
};

export const NOTIFICATION_CHANNEL_LABELS = { email: "E-mail", whatsapp: "WhatsApp" } as const;
