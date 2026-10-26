import type {
  AcceptanceMethod,
  ArrivalNoticeChannel,
  LetterSendingChannel,
  ProcedureClosingStatus,
  UnclaimedLetterKind,
  CarrierApiStatus,
  TrackingEventRow,
  ConfirmationCode,
  ContainerStatus,
  EtaSource,
  TrackingEventKind,
  PurchaseOrderStatus,
  AuctionPlatform,
  ClientKind,
  ContractStatus,
  DocumentKind,
  DossierStage,
  IdDocumentType,
  VehicleCategory,
} from "@/lib/supabase/database.types";

/** Libellés français des données opérationnelles (vocabulaire métier, CLAUDE.md §5). */

/** Les 7 étapes du dossier, dans l'ordre (docs/13_workflow_statuts.md). */
export const STAGES: readonly DossierStage[] = [
  "opening",
  "purchase",
  "us_transport",
  "container",
  "ocean",
  "dakar",
  "closing",
];

export const STAGE_LABELS: Record<DossierStage, string> = {
  opening: "Ouverture",
  purchase: "Achat",
  us_transport: "Transport USA",
  container: "Conteneur",
  ocean: "Maritime",
  dakar: "Dakar",
  closing: "Clôture",
};

export const PLATFORM_LABELS: Record<AuctionPlatform, string> = {
  copart: "COPART",
  iaa: "IAA",
  other: "Autre",
};

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  passenger: "Véhicule de tourisme",
  light_utility: "Utilitaire léger (< 3,5 t)",
  truck_or_bus: "Camion ou transport de personnes",
};

export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  person: "Particulier",
  company: "Société",
};

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  national_id: "Carte d’identité",
  passport: "Passeport",
  residence_permit: "Titre de séjour",
  other: "Autre pièce",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  contract: "Contrat (généré)",
  signed_contract: "Contrat signé",
  acceptance_proof: "Preuve d’acceptation",
  purchase_order: "Ordre d’achat",
  auction_invoice: "Facture d’enchère",
  pickup_proof: "Preuve de prise en charge",
  title: "Titre du véhicule",
  bill_of_lading: "B/L",
  payment_proof: "Preuve de paiement",
  power_of_attorney: "Procuration",
  release_receipt: "Décharge de remise",
  photos: "Photos",
  cost_receipt: "Justificatif de coût (interne)",
  other: "Autre document",
  quote: "Devis",
  deposit_invoice: "Facture d’acompte",
  balance_invoice: "Facture de solde",
  cash_receipt: "Reçu espèces",
  refund_note: "Note de remboursement",
  reminder_letter: "Lettre de relance",
  formal_notice: "Mise en demeure",
  letter_sending_proof: "Preuve d’envoi d’un courrier (interne)",
};

/** Procédure « véhicule non réclamé » (US-5.3, art. 21–22). */
export const UNCLAIMED_LETTER_LABELS: Record<UnclaimedLetterKind, string> = {
  reminder: "Lettre de relance",
  formal_notice: "Mise en demeure",
};

export const LETTER_SENDING_CHANNEL_LABELS: Record<LetterSendingChannel, string> = {
  hand: "Remise en main propre",
  email: "E-mail",
  whatsapp: "WhatsApp",
  courier: "Coursier ou courrier",
};

export const PROCEDURE_CLOSING_STATUS_LABELS: Record<ProcedureClosingStatus, string> = {
  completed: "Terminé (situation régularisée)",
  archived: "Archivé",
  claim: "Réclamation",
  dispute: "Litige",
  suspended: "Suspendu",
};

/** Types de documents téléversés par l'équipe (les autres sont générés ou enregistrés par l'application). */
export const UPLOADABLE_DOCUMENT_KINDS = [
  "auction_invoice",
  "pickup_proof",
  "title",
  "bill_of_lading",
  "payment_proof",
  "power_of_attorney",
  "release_receipt",
  "signed_contract",
  "photos",
  "other",
] as const satisfies readonly DocumentKind[];

export const ACCEPTANCE_METHOD_LABELS: Record<AcceptanceMethod, string> = {
  scanned_paper: "Papier signé et scanné",
  whatsapp: "Validation par WhatsApp",
  portal: "Acceptation dans le portail",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  pending: "En attente de signature",
  accepted: "Accepté",
  refused: "Refusé",
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Saisi — document à générer",
  pending: "En attente de signature",
  accepted: "Signé",
  refused: "Refusé",
};

/** Confirmations manuelles en attendant la phase 3 (hypothèse P1). */
export const CONFIRMATION_LABELS: Record<ConfirmationCode, string> = {
  quote_accepted: "Devis accepté par le client",
  payment1_received: "Paiement 1 intégralement reçu",
  balance_invoice_issued: "Facture de solde émise",
  balance_paid: "Solde réglé",
};

/** Les 4 confirmations de l’annexe B, cochées par le client sur l’ordre d’achat signé. */
export const PURCHASE_ORDER_ACKNOWLEDGEMENTS = [
  ["vehicle_info", "a pris connaissance des informations et photos de la plateforme et accepte le véhicule en l’état"],
  ["import_age", "a vérifié que l’âge du véhicule respecte la limite d’importation au Sénégal"],
  ["binding_win", "sait que le lot remporté l’engage et que le paiement 1 est dû dans le délai de l’article 9.1"],
  ["duties_excluded", "sait que les droits et taxes au Sénégal ne sont pas inclus, sauf mention au devis"],
] as const;

/** Statuts du conteneur (mêmes codes que l’étape Maritime du dossier). */
export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  booking_confirmed: "Réservation confirmée",
  departure_planned: "Départ prévu",
  at_sea: "En transit",
  transshipment: "Transbordement",
  arrival_estimated: "Arrivée estimée",
  arrived: "Arrivé",
};

export const ETA_SOURCE_LABELS: Record<EtaSource, string> = {
  carrier_site: "Site de suivi du transporteur",
  carrier_notice: "Avis du transporteur (e-mail, courrier)",
  manual: "Estimation de l’agent",
};

/** Source d'un événement de suivi (R12) ; les saisies manuelles sont distinguées à l'affichage. */
export const TRACKING_SOURCE_LABELS: Record<TrackingEventRow["source"], string> = {
  manual: "Saisie manuelle",
  carrier_link: "Lien du transporteur",
  api: "API du transporteur",
};

/** État de l'accès API d'un transporteur (cahier des charges §5.1, décision F2-a). */
export const CARRIER_API_STATUS_LABELS: Record<CarrierApiStatus, string> = {
  non_etudie: "Non étudié",
  non_verifie: "Non vérifié",
  demande: "Demandé",
  obtenu: "Obtenu",
  refuse: "Refusé",
};

/** Moyen par lequel l'agent a informé le client de l'arrivée (contrat art. 17). */
export const ARRIVAL_NOTICE_CHANNEL_LABELS: Record<ArrivalNoticeChannel, string> = {
  phone: "Téléphone",
  whatsapp: "WhatsApp (message de l’agent)",
  email: "E-mail (message de l’agent)",
  in_person: "En personne",
};

export const TRACKING_EVENT_LABELS: Record<TrackingEventKind, string> = {
  departure: "Départ",
  transshipment: "Transbordement",
  arrival: "Arrivée",
  eta_changed: "ETA modifiée",
  delay: "Retard",
  note: "Information",
};
