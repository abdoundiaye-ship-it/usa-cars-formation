// Types de la base (schéma public), au format de `supabase gen types typescript`.
// Tenus à la main : plus précis que la génération (énumérations de statuts, colonnes en lecture seule).
// À mettre à jour avec chaque migration ; `pnpm db:types` sert seulement de référence de comparaison.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "admin" | "ops" | "accounting" | "management" | "client";
export type DossierStage = "opening" | "purchase" | "us_transport" | "container" | "ocean" | "dakar" | "closing";
export type AuctionPlatform = "copart" | "iaa" | "other";
export type VehicleCategory = "passenger" | "light_utility" | "truck_or_bus";
export type AcceptanceMethod = "scanned_paper" | "whatsapp" | "portal";
export type ClientKind = "person" | "company";
export type IdDocumentType = "national_id" | "passport" | "residence_permit" | "other";
export type DocumentKind =
  | "contract"
  | "signed_contract"
  | "acceptance_proof"
  | "purchase_order"
  | "auction_invoice"
  | "pickup_proof"
  | "title"
  | "bill_of_lading"
  | "payment_proof"
  | "power_of_attorney"
  | "release_receipt"
  | "photos"
  | "cost_receipt"
  | "other"
  | "quote"
  | "deposit_invoice"
  | "balance_invoice"
  | "cash_receipt"
  | "refund_note"
  | "reminder_letter"
  | "formal_notice"
  | "letter_sending_proof";
export type ContractStatus = "pending" | "accepted" | "refused";
export type AcceptanceSubject = "contract" | "purchase_order" | "quote" | "extra_cost";
export type AcceptanceDecision = "accepted" | "refused";
export type DossierEventKind =
  | "opened"
  | "status_changed"
  | "stage_changed"
  | "contract_generated"
  | "purchase_order_generated"
  | "acceptance_recorded"
  | "auction_result"
  | "confirmation"
  | "stage_exception"
  | "cancelled"
  | "document_added"
  | "note"
  | "container_assigned"
  | "container_changed"
  | "eta_changed"
  | "tracking_event"
  | "financial_document"
  | "payment_recorded"
  | "adjustment"
  | "refund"
  | "arrival_notified"
  | "unclaimed_letter"
  | "unclaimed_procedure";
export type ContainerStatus =
  | "booking_confirmed"
  | "departure_planned"
  | "at_sea"
  | "transshipment"
  | "arrival_estimated"
  | "arrived";
export type EtaSource = "carrier_site" | "carrier_notice" | "manual";
export type TrackingEventKind = "departure" | "transshipment" | "arrival" | "eta_changed" | "delay" | "note";
export type PurchaseOrderStatus = "draft" | "pending" | "accepted" | "refused";
export type ConfirmationCode = "quote_accepted" | "payment1_received" | "balance_invoice_issued" | "balance_paid";

/** Insertion : colonnes obligatoires `Required`, les autres facultatives (valeurs par défaut de la base). */
type InsertOf<Row, Required extends keyof Row> = Pick<Row, Required> & Partial<Omit<Row, Required>>;

export type ClientRow = {
  id: string;
  kind: ClientKind;
  name: string;
  id_document_type: IdDocumentType | null;
  id_document_number: string | null;
  ninea: string | null;
  rccm: string | null;
  representative_name: string | null;
  representative_title: string | null;
  address: string | null;
  notify_phone: string;
  notify_email: string | null;
  notes: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierRow = {
  id: string;
  reference: string;
  client_id: string;
  owner_id: string | null;
  stage: DossierStage;
  status: string;
  platform: AuctionPlatform | null;
  lot_number: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  mileage: number | null;
  vehicle_category: VehicleCategory | null;
  title_status: string | null;
  color: string | null;
  keys_present: boolean | null;
  declared_condition: string | null;
  purchase_location: string | null;
  departure_port: string | null;
  notes: string | null;
  params_as_of: string;
  duplicated_from: string | null;
  auction_result: "won" | "lost" | null;
  hammer_price_cents: number | null;
  lot_won_notified_at: string | null;
  payment1_due_at: string | null;
  price_override_reason: string | null;
  price_override_by: string | null;
  cancelled_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** R9 : paiement intégral, propriété transférée (renseigné par la base). */
  ownership_transferred_at: string | null;
  /** Enlèvement du véhicule : date du passage au statut « Enlevé » (renseignée par la base, lot 6a). */
  collected_at: string | null;
  /** Clôture (Terminé, Archivé, Annulé) : départ des durées de conservation (renseignée par la base, G2-a). */
  closed_at: string | null;
};

/**
 * Colonnes modifiables directement d’un dossier. Figées par la base : référence, client, date d’ouverture ;
 * écrites par les fonctions métier seulement : étape, résultat d’enchère, annulation.
 */
type DossierEditable = Omit<
  DossierRow,
  | "id"
  | "reference"
  | "client_id"
  | "params_as_of"
  | "created_by"
  | "created_at"
  | "updated_at"
  | "duplicated_from"
  | "stage"
  | "auction_result"
  | "hammer_price_cents"
  | "lot_won_notified_at"
  | "payment1_due_at"
  | "price_override_reason"
  | "price_override_by"
  | "cancelled_reason"
  | "collected_at"
  | "closed_at"
>;

export type DocumentRow = {
  id: string;
  dossier_id: string | null;
  client_id: string;
  kind: DocumentKind;
  version: number;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  visible_client: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  /** Photo rattachée à une réclamation (lot 6d), le cas échéant. */
  claim_id: string | null;
};

export type ClaimSource = "agent" | "client";
export type ClaimStatus = "open" | "forwarded" | "resolved" | "rejected";

/** Réclamation après l'enlèvement (lot 6d, contrat art. 19). Écriture par fonctions seulement. */
export type ClaimRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  source: ClaimSource;
  reserves: string;
  filed_by: string | null;
  filed_at: string;
  collected_at: string;
  deadline_at: string;
  out_of_time: boolean;
  status: ClaimStatus;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
};

export type ClaimOverviewRow = ClaimRow & {
  reference: string;
  client_name: string;
  photo_count: number;
};

export type ContractRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  reference: string;
  template_version: string;
  document_id: string;
  document_sha256: string;
  status: ContractStatus;
  decided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierEventRow = {
  id: number;
  dossier_id: string;
  occurred_at: string;
  kind: DossierEventKind;
  label: string;
  visible_client: boolean;
  actor_id: string | null;
};

export type AcceptanceRow = {
  id: string;
  dossier_id: string;
  subject: AcceptanceSubject;
  subject_id: string;
  document_id: string;
  document_sha256: string;
  method: AcceptanceMethod;
  decision: AcceptanceDecision;
  decided_at: string;
  proof_document_id: string | null;
  whatsapp_from: string | null;
  portal_ip: string | null;
  portal_session: string | null;
  acknowledgements: Json | null;
  /** Devis : choix de l'assurance transport dans la même acceptation (X1). */
  insurance_choice: "accepted" | "refused" | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

export type PurchaseOrderRow = {
  id: string;
  dossier_id: string;
  auction_at: string | null;
  max_bid_cents: number;
  deposit_cents: number;
  status: PurchaseOrderStatus;
  document_id: string | null;
  document_sha256: string | null;
  template_version: string | null;
  platform: AuctionPlatform | null;
  lot_number: string | null;
  vin: string | null;
  decided_at: string | null;
  ack_vehicle_info: boolean;
  ack_import_age: boolean;
  ack_binding_win: boolean;
  ack_duties_excluded: boolean;
  age_override_reason: string | null;
  age_override_by: string | null;
  age_override_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ArrivalNoticeChannel = "phone" | "whatsapp" | "email" | "in_person";

export type CarrierApiStatus = "non_etudie" | "non_verifie" | "demande" | "obtenu" | "refuse";

export type CarrierRow = {
  id: string;
  code: string;
  name: string;
  tracking_url: string;
  url_template: string | null;
  link_type: "officiel" | "tiers";
  /** État de l'accès API (décision F2-a : liens seulement tant qu'aucun accès n'est obtenu). */
  api_status: CarrierApiStatus;
  note: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContainerRow = {
  id: string;
  number: string;
  carrier_id: string;
  bl_number: string | null;
  vessel: string | null;
  voyage: string | null;
  port_of_loading: string | null;
  port_of_discharge: string;
  etd: string | null;
  eta: string | null;
  departed_on: string | null;
  ata: string | null;
  status: ContainerStatus;
  last_checked_at: string | null;
  last_checked_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EtaHistoryRow = {
  id: number;
  container_id: string;
  previous_eta: string | null;
  eta: string;
  source: EtaSource;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type TrackingEventRow = {
  id: number;
  container_id: string;
  occurred_at: string;
  kind: TrackingEventKind;
  label: string;
  location: string | null;
  source: "manual" | "carrier_link" | "api";
  visible_client: boolean;
  created_by: string | null;
  created_at: string;
};

export type DossierContainerRow = {
  id: string;
  dossier_id: string;
  container_id: string;
  assigned_at: string;
  assigned_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removal_reason: string | null;
};

export type FxRateRow = {
  id: string;
  /** numeric(12,4) : renvoyé en nombre par PostgREST ; manipulé en chaîne exacte pour les calculs (lib/money/fx). */
  rate: number;
  source: string;
  captured_at: string;
  created_by: string | null;
  created_at: string;
};

export type OfficialAccountKind = "bank" | "wave" | "orange_money" | "cash_office";
export type OfficialAccountRow = {
  id: string;
  kind: OfficialAccountKind;
  label: string;
  holder_name: string;
  bank_name: string | null;
  account_number: string | null;
  iban: string | null;
  swift: string | null;
  phone: string | null;
  instructions: string | null;
  status: "pending_approval" | "active" | "inactive";
  replaces_id: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  deactivated_by: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
};

export type CostSection = "A" | "B";
export type CostCategory =
  | "hammer_price"
  | "auction_fees"
  | "us_taxes"
  | "acquisition_other"
  | "inland_transport"
  | "loading"
  | "ocean_freight"
  | "port_fees"
  | "documentation"
  | "logistics_other";
export type InternalCostRow = {
  id: string;
  dossier_id: string;
  section: CostSection;
  category: CostCategory;
  label: string | null;
  amount_cents: number;
  status: "estimated" | "final";
  document_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierForfaitsRow = {
  dossier_id: string;
  forfait_a_cents: number | null;
  forfait_b_cents: number | null;
  insurance_cents: number | null;
  mode: "manual" | "proposed_with_approval";
  proposed_a_cents: number | null;
  proposed_b_cents: number | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FinancialDocType = "quote" | "deposit_invoice" | "balance_invoice" | "cash_receipt" | "refund_note";
export type FinancialDocStatus = "issued" | "accepted" | "refused" | "expired" | "paid" | "cancelled";
export type InsuranceChoice = "pending" | "accepted" | "refused";
/** Devis et factures émis (R3) : lignes visibles du client uniquement — jamais de coût interne. */
export type FinancialDocumentRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  doc_type: FinancialDocType;
  number: string;
  status: FinancialDocStatus;
  quote_id: string | null;
  forfait_a_cents: number | null;
  forfait_b_cents: number | null;
  insurance_premium_cents: number;
  insurance_choice: InsuranceChoice;
  vat_rate_percent: number;
  vat_cents: number;
  insurance_vat_cents: number;
  total_cents: number;
  deposit_applied_cents: number;
  deposit_excess_cents: number;
  amount_due_cents: number;
  fx_rate_id: string;
  fx_rate: number;
  fx_source: string;
  fx_captured_at: string;
  edition_fx_rate: number;
  edition_fx_captured_at: string;
  issued_at: string;
  valid_until: string | null;
  due_at: string | null;
  decided_at: string | null;
  document_id: string | null;
  document_sha256: string | null;
  template_version: string | null;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  issued_by: string | null;
  updated_at: string;
  /** Facture de solde : total des lignes D, ETA de référence figée (R4). */
  adjustments_cents: number;
  reference_eta: string | null;
  /** Reçu espèces : paiement ; note de remboursement : remboursement. */
  payment_id: string | null;
  refund_id: string | null;
};

export type PaymentMode = "bank_transfer" | "wave" | "orange_money" | "cash";
export type PaymentRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  purpose: "deposit" | "payment1" | "balance";
  amount_cents: number;
  paid_currency: "USD" | "XOF";
  amount_xof: number | null;
  fx_rate_id: string | null;
  fx_rate: number | null;
  fx_captured_at: string | null;
  fx_rate_same_day: boolean;
  mode: PaymentMode;
  official_account_id: string | null;
  reference: string;
  credited_at: string;
  proof_document_id: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  receipt_id: string | null;
};

export type AdjustmentKind = "extra_cost" | "late_fee" | "discount";
export type AdjustmentStatus = "proposed" | "pending_client_approval" | "approved" | "rejected" | "cancelled";
/** Ligne D (R2) : frais supplémentaires (R7), frais de retard (R5), remises. */
export type AdjustmentRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  kind: AdjustmentKind;
  label: string;
  section: "A" | "B" | null;
  amount_cents: number;
  status: AdjustmentStatus;
  urgent: boolean;
  reason: string | null;
  proof_document_id: string | null;
  late_fee_target: "payment1" | "balance" | null;
  late_fee_period: number | null;
  financial_document_id: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_by: string | null;
  created_at: string;
};

export type RefundReason = "overpayment" | "deposit_excess" | "lot_not_won" | "cancellation";
export type RefundStatus = "requested" | "approved" | "paid" | "rejected";
export type RefundRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  reason: RefundReason;
  amount_cents: number;
  mode: PaymentMode;
  beneficiary: string;
  status: RefundStatus;
  requested_at: string;
  requested_by: string | null;
  due_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  proof_document_id: string | null;
  fx_rate: number | null;
  refund_note_id: string | null;
};

/** Situation financière d'un dossier (fonction dossier_balance). */
export type DossierBalance = {
  a_total_cents: number;
  total_due_cents: number;
  paid_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  payment1_remaining_cents: number;
  balance_remaining_cents: number;
  pending_refunds_cents: number;
  adjustments_cents: number;
  has_accepted_quote: boolean;
};

/** US-3.11 : remise des documents (R9). */
/** Phase 5 — procédure « véhicule non réclamé » (US-5.3, art. 21–22). */
export type UnclaimedLetterKind = "reminder" | "formal_notice";
export type UnclaimedLetterStatus = "issued" | "sent" | "cancelled";
export type UnclaimedLetterReason = "unpaid" | "not_collected" | "unpaid_not_collected";
export type LetterSendingChannel = "hand" | "email" | "whatsapp" | "courier";
export type ProcedureClosingStatus = "completed" | "archived" | "claim" | "dispute" | "suspended";
export type UnclaimedNextStep = "none" | "reminder" | "formal_notice" | "procedure" | "procedure_open" | "closed";

export type UnclaimedLetterRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  kind: UnclaimedLetterKind;
  number: string;
  status: UnclaimedLetterStatus;
  arrival_date: string;
  reason: UnclaimedLetterReason;
  amount_due_cents: number;
  late_fees_cents: number;
  fx_rate: number;
  fx_captured_at: string;
  cure_days: number | null;
  cure_deadline: string | null;
  issued_at: string;
  issued_by: string | null;
  document_id: string | null;
  document_sha256: string | null;
  template_version: string | null;
  sent_at: string | null;
  sent_channel: LetterSendingChannel | null;
  sent_note: string | null;
  sent_proof_document_id: string | null;
  sent_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_reason: string | null;
};

export type UnclaimedProcedureRow = {
  id: string;
  dossier_id: string;
  opened_at: string;
  opened_by: string | null;
  open_reason: string;
  closed_at: string | null;
  closed_by: string | null;
  outcome: string | null;
  closing_status: ProcedureClosingStatus | null;
};

/** Ligne d'un rapport (colonnes définies dans supabase/functions/_shared/reports.ts). */
export type ReportRow = Record<string, string | number | boolean | null>;

/** Page « Confidentialité » du portail (G1-a) : coordonnées officielles et durées de conservation (G2-a). */
export type PrivacyNotice = {
  office_address: string | null;
  email: string | null;
  phone: string | null;
  retention_years: number | null;
  retention_years_accounting: number | null;
  validated: boolean;
};

/** Compte à rebours d'un dossier arrivé (fonction unclaimed_overview). */
export type UnclaimedOverviewRow = {
  dossier_id: string;
  reference: string;
  arrival_date: string;
  days_since_arrival: number;
  amount_due_cents: number;
  collected: boolean;
  applies: boolean;
  reminder_due_on: string;
  formal_notice_due_on: string;
  procedure_possible_on: string;
  min_cure_days: number;
  reminder_status: UnclaimedLetterStatus | null;
  reminder_sent_at: string | null;
  formal_notice_status: UnclaimedLetterStatus | null;
  formal_notice_sent_at: string | null;
  cure_deadline: string | null;
  procedure_opened_at: string | null;
  procedure_closed_at: string | null;
  next_step: UnclaimedNextStep;
};

export type DocumentReleaseRow = {
  id: string;
  dossier_id: string;
  client_id: string;
  released_at: string;
  beneficiary_kind: "client" | "representative";
  beneficiary_name: string;
  id_document_type: IdDocumentType;
  id_document_number: string;
  power_of_attorney_document_id: string | null;
  discharge_document_id: string;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

/** Vue d'ensemble financière d'un dossier (fonction finance_overview, internes uniquement). */
export type FinanceOverviewRow = {
  dossier_id: string;
  reference: string;
  client_name: string;
  stage: DossierStage;
  dossier_status: string;
  total_due_cents: number;
  net_paid_cents: number;
  payment1_remaining_cents: number;
  balance_remaining_cents: number;
  payment1_due_at: string | null;
  balance_due_at: string | null;
  has_accepted_quote: boolean;
  quote_expired: boolean;
  balance_invoice_issued: boolean;
  proposed_late_fees: number;
  pending_client_extra_costs: number;
  open_refunds: number;
  overdue_refunds: number;
  ownership_transferred_at: string | null;
  documents_released: boolean;
  release_due_at: string | null;
};

/** Jours fériés au Sénégal (jours ouvrés, décision du 20/10/2026). */
export type PublicHolidayRow = { day: string; label: string; created_by: string | null; created_at: string };

/** Lien de connexion client à usage unique (empreinte seule ; accès serveur, clé service_role). */
export type ClientLoginTokenRow = {
  id: string;
  user_id: string;
  client_id: string;
  token_hash: string;
  channel: "email" | "whatsapp" | "invitation";
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type NotificationTemplate =
  | "login_link"
  | "lot_won"
  | "quote_issued"
  | "payment_due_reminder"
  | "vessel_departed"
  | "eta_changed"
  | "arrived"
  | "documents_ready"
  | "payment_overdue"
  | "test_message"
  | "unclaimed_reminder"
  | "formal_notice"
  | "claim_update";
export type NotificationStatus = "queued" | "sending" | "sent" | "simulated" | "failed";
/** File d'attente et journal des notifications (US-4.5). */
export type NotificationRow = {
  id: string;
  client_id: string | null;
  dossier_id: string | null;
  template: NotificationTemplate;
  channel: "email" | "whatsapp";
  recipient: string;
  variables: Json;
  dedupe_key: string | null;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  redirected_to: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
};

export type DossierConfirmationRow = {
  dossier_id: string;
  code: ConfirmationCode;
  note: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
};

export type WorkflowStatusRow = {
  stage: DossierStage;
  code: string;
  label: string;
  position: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: AppRole;
          client_id: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: AppRole;
          client_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: AppRole;
          client_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          value: Json;
          value_type: string;
          status: "confirme" | "a_confirmer";
          source: string | null;
          reason: string | null;
          effective_from: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          value_type: string;
          status: "confirme" | "a_confirmer";
          source?: string | null;
          reason?: string | null;
          effective_from?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      clients: {
        Row: ClientRow;
        Insert: InsertOf<ClientRow, "kind" | "name" | "notify_phone">;
        Update: Partial<Omit<ClientRow, "id" | "created_by" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      workflow_statuses: {
        Row: WorkflowStatusRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dossiers: {
        Row: DossierRow;
        // La référence est attribuée par la base (trigger) : la valeur fournie est ignorée.
        Insert: InsertOf<DossierRow, "client_id">;
        Update: Partial<DossierEditable>;
        Relationships: [
          {
            foreignKeyName: "dossiers_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dossiers_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: DocumentRow;
        Insert: InsertOf<
          DocumentRow,
          "client_id" | "kind" | "storage_path" | "file_name" | "mime_type" | "size_bytes" | "sha256"
        >;
        Update: Pick<DocumentRow, "visible_client">;
        Relationships: [
          {
            foreignKeyName: "documents_dossier_id_fkey";
            columns: ["dossier_id"];
            isOneToOne: false;
            referencedRelation: "dossiers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      contracts: {
        Row: ContractRow;
        Insert: never; // via register_contract_document
        Update: never;
        Relationships: [
          {
            foreignKeyName: "contracts_dossier_id_fkey";
            columns: ["dossier_id"];
            isOneToOne: true;
            referencedRelation: "dossiers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      dossier_events: {
        Row: DossierEventRow;
        Insert: InsertOf<DossierEventRow, "dossier_id" | "kind" | "label">;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "dossier_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      acceptances: {
        Row: AcceptanceRow;
        // Dossier, version et empreinte du contrat sont imposés par la base (trigger).
        Insert: InsertOf<
          AcceptanceRow,
          | "dossier_id"
          | "subject"
          | "subject_id"
          | "document_id"
          | "document_sha256"
          | "method"
          | "decision"
          | "decided_at"
        >;
        Update: never;
        Relationships: [];
      };
      purchase_orders: {
        Row: PurchaseOrderRow;
        Insert: InsertOf<PurchaseOrderRow, "dossier_id" | "max_bid_cents">;
        // Document, statut et décision : écrits par les fonctions métier.
        Update: Partial<Pick<PurchaseOrderRow, "auction_at" | "max_bid_cents" | "deposit_cents" | "age_override_reason">>;
        Relationships: [];
      };
      dossier_confirmations: {
        Row: DossierConfirmationRow;
        Insert: InsertOf<DossierConfirmationRow, "dossier_id" | "code">;
        Update: never;
        Relationships: [];
      };
      carriers: {
        Row: CarrierRow;
        Insert: InsertOf<CarrierRow, "code" | "name" | "tracking_url">;
        Update: Partial<Omit<CarrierRow, "id" | "created_by" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      containers: {
        Row: ContainerRow;
        Insert: InsertOf<ContainerRow, "number" | "carrier_id">;
        // ETA, départ, ATA, statut et vérification : écrits par les fonctions dédiées.
        Update: Partial<
          Pick<
            ContainerRow,
            "carrier_id" | "bl_number" | "vessel" | "voyage" | "port_of_loading" | "port_of_discharge" | "etd" | "notes"
          >
        >;
        Relationships: [
          {
            foreignKeyName: "containers_carrier_id_fkey";
            columns: ["carrier_id"];
            isOneToOne: false;
            referencedRelation: "carriers";
            referencedColumns: ["id"];
          },
        ];
      };
      eta_history: {
        Row: EtaHistoryRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      tracking_events: {
        Row: TrackingEventRow;
        Insert: InsertOf<TrackingEventRow, "container_id" | "occurred_at" | "kind" | "label">;
        Update: never;
        Relationships: [];
      };
      dossier_containers: {
        Row: DossierContainerRow;
        Insert: never; // via assign_container
        Update: never;
        Relationships: [
          {
            foreignKeyName: "dossier_containers_container_id_fkey";
            columns: ["container_id"];
            isOneToOne: false;
            referencedRelation: "containers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dossier_containers_dossier_id_fkey";
            columns: ["dossier_id"];
            isOneToOne: false;
            referencedRelation: "dossiers";
            referencedColumns: ["id"];
          },
        ];
      };
      fx_rates: {
        Row: FxRateRow;
        Insert: InsertOf<FxRateRow, "rate" | "source" | "captured_at">;
        Update: never;
        Relationships: [];
      };
      official_accounts: {
        Row: OfficialAccountRow;
        Insert: never; // via create_official_account
        Update: never; // via approve_official_account / deactivate_official_account
        Relationships: [];
      };
      internal_costs: {
        Row: InternalCostRow;
        Insert: InsertOf<InternalCostRow, "dossier_id" | "section" | "category" | "amount_cents">;
        Update: Partial<Pick<InternalCostRow, "label" | "amount_cents" | "status" | "document_id">>;
        Relationships: [];
      };
      dossier_forfaits: {
        Row: DossierForfaitsRow;
        Insert: InsertOf<DossierForfaitsRow, "dossier_id">;
        Update: Partial<Pick<DossierForfaitsRow, "forfait_a_cents" | "forfait_b_cents" | "insurance_cents">>;
        Relationships: [];
      };
      financial_documents: {
        Row: FinancialDocumentRow;
        Insert: never; // via issue_quote / issue_deposit_invoice
        Update: never; // via cancel_financial_document / register_financial_document_file / acceptances
        Relationships: [];
      };
      payments: {
        Row: PaymentRow;
        Insert: never; // via record_deposit / record_payment
        Update: never; // via cancel_payment
        Relationships: [];
      };
      adjustments: {
        Row: AdjustmentRow;
        Insert: never; // via add_extra_cost / add_discount / propose_late_fees
        Update: never; // via decide_late_fee / cancel_adjustment / acceptances
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: never; // via enqueue_notification et les déclencheurs
        Update: never; // via retry_notification et la fonction d'envoi
        Relationships: [
          {
            foreignKeyName: "notifications_dossier_id_fkey";
            columns: ["dossier_id"];
            isOneToOne: false;
            referencedRelation: "dossiers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_login_tokens: {
        Row: ClientLoginTokenRow;
        Insert: Pick<ClientLoginTokenRow, "user_id" | "client_id" | "token_hash" | "channel" | "expires_at"> &
          Partial<Pick<ClientLoginTokenRow, "created_by">>;
        Update: Partial<Pick<ClientLoginTokenRow, "used_at">>;
        Relationships: [];
      };
      public_holidays: {
        Row: PublicHolidayRow;
        Insert: Pick<PublicHolidayRow, "day" | "label">;
        Update: never;
        Relationships: [];
      };
      document_releases: {
        Row: DocumentReleaseRow;
        Insert: never; // via record_document_release
        Update: never;
        Relationships: [];
      };
      unclaimed_letters: {
        Row: UnclaimedLetterRow;
        Insert: never; // via issue_unclaimed_letter
        Update: never; // via register_unclaimed_letter_file, record_letter_sent, cancel_unclaimed_letter
        Relationships: [];
      };
      unclaimed_procedures: {
        Row: UnclaimedProcedureRow;
        Insert: never; // via open_unclaimed_procedure
        Update: never; // via close_unclaimed_procedure
        Relationships: [];
      };
      refunds: {
        Row: RefundRow;
        Insert: never; // demandes créées par la base (trop-perçu, excédent de dépôt, lot non remporté)
        Update: never; // via decide_refund / execute_refund
        Relationships: [];
      };
      claims: {
        Row: ClaimRow;
        Insert: never; // via file_claim
        Update: never; // via respond_to_claim
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          at: string;
          actor_id: string | null;
          actor_role: AppRole | null;
          actor_label: string | null;
          action: string;
          object_type: string;
          object_id: string;
          before: Json | null;
          after: Json | null;
          reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      staff_directory: {
        Row: { id: string; full_name: string; role: AppRole; active: boolean };
        Relationships: [];
      };
      claims_overview: {
        Row: ClaimOverviewRow;
        Relationships: [];
      };
      settings_current: {
        Row: {
          key: string;
          value: Json;
          value_type: string;
          status: "confirme" | "a_confirmer";
          source: string | null;
          reason: string | null;
          effective_from: string;
          created_by: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_role_app: { Args: Record<string, never>; Returns: AppRole | null };
      is_internal: { Args: Record<string, never>; Returns: boolean };
      my_access: {
        Args: Record<string, never>;
        Returns: { role: AppRole; active: boolean; full_name: string; mfa_required: boolean; aal: string }[];
      };
      next_number: { Args: { p_doc_type: string; p_year?: number }; Returns: string };
      is_operations_writer: { Args: Record<string, never>; Returns: boolean };
      status_label: { Args: { p_stage: DossierStage; p_code: string }; Returns: string };
      register_contract_document: {
        Args: {
          p_dossier_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_size_bytes: number;
          p_sha256: string;
          p_template_version: string;
        };
        Returns: string;
      };
      duplicate_dossier: { Args: { p_dossier_id: string }; Returns: string };
      vehicle_age_check: {
        Args: { p_dossier_id: string };
        Returns: { status: "ok" | "too_old" | "unknown"; age: number | null; max_age: number | null }[];
      };
      register_purchase_order_document: {
        Args: {
          p_dossier_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_size_bytes: number;
          p_sha256: string;
          p_template_version: string;
        };
        Returns: string;
      };
      record_auction_result: {
        Args: {
          p_dossier_id: string;
          p_result: "won" | "lost";
          p_hammer_price_cents?: number;
          p_notified_at?: string;
          p_override_reason?: string;
        };
        Returns: undefined;
      };
      stage_conditions: {
        Args: { p_dossier_id: string };
        Returns: { code: string; label: string; met: boolean }[];
      };
      advance_stage: { Args: { p_dossier_id: string; p_override_reason?: string }; Returns: DossierStage };
      cancel_dossier: { Args: { p_dossier_id: string; p_reason: string }; Returns: undefined };
      active_container_id: { Args: { p_dossier_id: string }; Returns: string | null };
      assign_container: {
        Args: { p_dossier_id: string; p_container_id: string; p_reason?: string };
        Returns: undefined;
      };
      update_container_eta: {
        Args: { p_container_id: string; p_eta: string; p_source: EtaSource; p_note?: string };
        Returns: undefined;
      };
      record_container_departure: { Args: { p_container_id: string; p_departed_on: string }; Returns: undefined };
      record_container_arrival: { Args: { p_container_id: string; p_ata: string }; Returns: undefined };
      mark_container_checked: { Args: { p_container_id: string }; Returns: undefined };
      record_arrival_notice: {
        Args: { p_dossier_id: string; p_channel: ArrivalNoticeChannel; p_note?: string | null };
        Returns: undefined;
      };
      fx_rate_as_of: {
        Args: { p_at: string };
        Returns: { id: string; rate: number; source: string; captured_at: string }[];
      };
      fx_rate_exists_on: { Args: { p_day: string }; Returns: boolean };
      create_official_account: {
        Args: {
          p_kind: OfficialAccountKind;
          p_label: string;
          p_holder_name: string;
          p_bank_name?: string;
          p_account_number?: string;
          p_iban?: string;
          p_swift?: string;
          p_phone?: string;
          p_instructions?: string;
          p_replaces_id?: string;
        };
        Returns: string;
      };
      approve_official_account: { Args: { p_account_id: string }; Returns: undefined };
      deactivate_official_account: { Args: { p_account_id: string; p_reason: string }; Returns: undefined };
      is_finance_writer: { Args: Record<string, never>; Returns: boolean };
      is_quote_writer: { Args: Record<string, never>; Returns: boolean };
      expire_due_quotes: { Args: { p_dossier_id?: string }; Returns: number };
      issue_quote: { Args: { p_dossier_id: string }; Returns: string };
      issue_deposit_invoice: { Args: { p_dossier_id: string }; Returns: string };
      cancel_financial_document: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      register_financial_document_file: {
        Args: {
          p_financial_document_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_size_bytes: number;
          p_sha256: string;
          p_template_version: string;
        };
        Returns: string;
      };
      record_deposit: {
        Args: {
          p_dossier_id: string;
          p_paid_currency: "USD" | "XOF";
          p_amount_cents: number | null;
          p_amount_xof: number | null;
          p_mode: PaymentMode;
          p_official_account_id: string | null;
          p_reference: string;
          p_credited_at: string;
          p_proof_document_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      cancel_payment: { Args: { p_payment_id: string; p_reason: string }; Returns: undefined };
      dossier_balance: { Args: { p_dossier_id: string }; Returns: DossierBalance[] };
      finance_overview: { Args: Record<string, never>; Returns: FinanceOverviewRow[] };
      unclaimed_overview: { Args: { p_dossier_id?: string | null }; Returns: UnclaimedOverviewRow[] };
      // Phase 6 — rapports (US-6.1) : lignes décrites par supabase/functions/_shared/reports.ts.
      report_active_dossiers: { Args: Record<string, never>; Returns: ReportRow[] };
      report_delays: { Args: Record<string, never>; Returns: ReportRow[] };
      report_receivables: { Args: { p_as_of?: string | null }; Returns: ReportRow[] };
      report_transit_times: { Args: { p_from: string; p_to: string }; Returns: ReportRow[] };
      report_margins: { Args: { p_from: string; p_to: string }; Returns: ReportRow[] };
      report_retention: { Args: { p_as_of?: string | null }; Returns: ReportRow[] };
      report_access_review: { Args: Record<string, never>; Returns: ReportRow[] };
      privacy_notice: { Args: Record<string, never>; Returns: PrivacyNotice | null };
      log_report_export: { Args: { p_report: string; p_filters?: Json }; Returns: undefined };
      file_claim: { Args: { p_dossier_id: string; p_reserves: string }; Returns: string };
      respond_to_claim: { Args: { p_claim_id: string; p_status: string; p_response: string }; Returns: undefined };
      register_claim_photo: {
        Args: {
          p_claim_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_mime_type: string;
          p_size_bytes: number;
          p_sha256: string;
        };
        Returns: string;
      };
      is_recovery_writer: { Args: Record<string, never>; Returns: boolean };
      issue_unclaimed_letter: {
        Args: { p_dossier_id: string; p_kind: UnclaimedLetterKind; p_cure_days?: number | null };
        Returns: string;
      };
      register_unclaimed_letter_file: {
        Args: {
          p_letter_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_size_bytes: number;
          p_sha256: string;
          p_template_version: string;
        };
        Returns: string;
      };
      record_letter_sent: {
        Args: {
          p_letter_id: string;
          p_sent_on: string;
          p_channel: LetterSendingChannel;
          p_note: string | null;
          p_proof_storage_path: string;
          p_proof_file_name: string;
          p_proof_mime_type: string;
          p_proof_size_bytes: number;
          p_proof_sha256: string;
        };
        Returns: undefined;
      };
      cancel_unclaimed_letter: { Args: { p_letter_id: string; p_reason: string }; Returns: undefined };
      open_unclaimed_procedure: { Args: { p_dossier_id: string; p_reason: string }; Returns: undefined };
      close_unclaimed_procedure: {
        Args: { p_dossier_id: string; p_outcome: string; p_closing_status: ProcedureClosingStatus };
        Returns: undefined;
      };
      register_client_portal_access: {
        Args: { p_user_id: string; p_client_id: string; p_email: string };
        Returns: undefined;
      };
      client_portal_accounts: {
        Args: { p_client_id: string };
        Returns: {
          user_id: string;
          email: string;
          active: boolean;
          created_at: string;
          last_sign_in_at: string | null;
        }[];
      };
      enqueue_notification: {
        Args: {
          p_client_id: string;
          p_dossier_id: string | null;
          p_template: NotificationTemplate;
          p_variables?: Json;
          p_dedupe_key?: string | null;
        };
        Returns: number;
      };
      queue_payment_notifications: { Args: Record<string, never>; Returns: number };
      retry_notification: { Args: { p_id: string }; Returns: undefined };
      queue_test_notification: { Args: Record<string, never>; Returns: number };
      portal_fx_rate: { Args: Record<string, never>; Returns: { rate: number; source: string; captured_at: string }[] };
      accept_in_portal: {
        Args: {
          p_subject: "quote" | "extra_cost";
          p_subject_id: string;
          p_decision: "accepted" | "refused";
          p_document_sha256: string;
          p_session: string;
          p_ip: string | null;
          p_insurance_choice?: "accepted" | "refused" | null;
        };
        Returns: string;
      };
      record_document_release: {
        Args: {
          p_dossier_id: string;
          p_beneficiary_kind: "client" | "representative";
          p_beneficiary_name: string;
          p_id_document_type: IdDocumentType;
          p_id_document_number: string;
          p_discharge_document_id: string;
          p_power_of_attorney_document_id?: string | null;
          p_released_at?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      record_payment: {
        Args: {
          p_dossier_id: string;
          p_paid_currency: "USD" | "XOF";
          p_amount_cents: number | null;
          p_amount_xof: number | null;
          p_mode: PaymentMode;
          p_official_account_id: string | null;
          p_reference: string;
          p_credited_at: string;
          p_proof_document_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      issue_balance_invoice: { Args: { p_dossier_id: string }; Returns: string };
      propose_late_fees: { Args: Record<string, never>; Returns: number };
      add_extra_cost: {
        Args: {
          p_dossier_id: string;
          p_section: "A" | "B";
          p_label: string;
          p_amount_cents: number;
          p_proof_document_id: string;
          p_urgent?: boolean;
          p_reason?: string | null;
        };
        Returns: string;
      };
      add_discount: { Args: { p_dossier_id: string; p_label: string; p_amount_cents: number }; Returns: string };
      decide_late_fee: { Args: { p_adjustment_id: string; p_approve: boolean; p_note?: string | null }; Returns: undefined };
      cancel_adjustment: { Args: { p_adjustment_id: string; p_reason: string }; Returns: undefined };
      decide_refund: { Args: { p_refund_id: string; p_approve: boolean; p_reason?: string | null }; Returns: undefined };
      execute_refund: {
        Args: { p_refund_id: string; p_paid_at: string; p_reference: string; p_proof_document_id: string };
        Returns: string;
      };
      log_audit: {
        Args: {
          p_action: string;
          p_object_type: string;
          p_object_id: string;
          p_before?: Json;
          p_after?: Json;
          p_reason?: string;
          p_actor_label?: string;
        };
        Returns: number;
      };
    };
    Enums: {
      app_role: AppRole;
      dossier_stage: DossierStage;
      auction_platform: AuctionPlatform;
      vehicle_category: VehicleCategory;
      acceptance_method: AcceptanceMethod;
    };
    CompositeTypes: Record<string, never>;
  };
};
