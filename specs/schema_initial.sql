-- USA CARS — proposition de schéma initial (PostgreSQL / Supabase)
-- Point de départ pour la phase 1. À revoir par Claude Code avec les réponses aux clarifications
-- Décisions intégrées le 17/10/2026 : un contrat par véhicule (B1), forfaits saisis manuellement (C1),
-- taux du devis réactualisé au paiement (C4), trop-perçu remboursé (C6), 3 modes d'acceptation (D3).
-- Montants : USD en centimes entiers (bigint). Horodatages : timestamptz (UTC).

create extension if not exists pgcrypto;

-- ---------- Types ----------
create type app_role as enum ('admin', 'ops', 'accounting', 'management', 'client');
create type stage as enum ('ouverture', 'achat', 'transport_usa', 'conteneur', 'maritime', 'dakar', 'cloture');
create type platform as enum ('copart', 'iaa', 'other');
create type fin_doc_type as enum ('quote', 'deposit_invoice', 'balance_invoice', 'cash_receipt', 'refund_note');
create type forfait_mode as enum ('manual', 'proposed_with_approval');
create type acceptance_method as enum ('scanned_paper', 'whatsapp', 'portal');
create type refund_status as enum ('requested', 'approved', 'paid', 'rejected');
create type fin_doc_status as enum ('draft', 'issued', 'accepted', 'expired', 'paid', 'cancelled');
create type insurance_choice as enum ('pending', 'accepted', 'refused');
create type adjustment_kind as enum ('extra_cost', 'late_fee', 'discount', 'vat');
create type adjustment_status as enum ('proposed', 'pending_client_approval', 'approved', 'rejected');
create type payment_mode as enum ('bank_transfer', 'wave', 'orange_money', 'cash');
create type event_source as enum ('manual', 'api', 'carrier_link');
create type link_type as enum ('officiel', 'tiers');
create type notif_channel as enum ('email', 'whatsapp');
create type notif_status as enum ('queued', 'simulated', 'sent', 'failed');

-- ---------- Utilisateurs et rôles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role app_role not null,
  client_id uuid,                       -- renseigné uniquement pour le rôle client
  mfa_required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Paramètres ----------
create table settings (
  key text not null,
  value jsonb not null,
  status text not null check (status in ('confirme', 'a_confirmer')),
  source text,
  effective_from timestamptz not null default now(),
  updated_by uuid references profiles(id),
  primary key (key, effective_from)
);

create table number_sequences (
  doc_type text not null,               -- dossier, quote, deposit_invoice, balance_invoice, cash_receipt
  year int not null,
  last_value int not null default 0,
  primary key (doc_type, year)
);

-- ---------- Clients et contrats ----------
create table clients (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'company')),
  name text not null,
  id_document text,                     -- pièce d'identité (type + n°)
  ninea text, rccm text,
  address text,
  notify_phone text,                    -- WhatsApp de notification (contrat art. 17, 31)
  notify_email text,
  status text not null default 'actif',
  privacy_notice_at timestamptz,        -- information données personnelles (art. 33)
  created_at timestamptz not null default now()
);
alter table profiles add constraint profiles_client_fk foreign key (client_id) references clients(id);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  reference text unique not null,
  template_version text not null,
  -- un contrat par véhicule (décision B1) : relation 1-1 avec dossiers.contract_id (unique)
  signed_at timestamptz,
  signed_file_path text,
  created_at timestamptz not null default now()
);

-- ---------- Dossiers (un véhicule par dossier) ----------
create table dossiers (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,       -- UC-AAAA-####
  client_id uuid not null references clients(id),
  contract_id uuid unique references contracts(id),   -- un contrat par véhicule (B1)
  owner_id uuid references profiles(id),            -- responsable interne
  stage stage not null default 'ouverture',
  status text not null default 'Nouveau',
  platform platform,
  lot_number text,
  vin text check (vin is null or length(vin) = 17),
  make text, model text, model_year int, mileage int,
  vehicle_category text check (vehicle_category in ('passenger', 'light_utility', 'truck_or_bus')),
  title_status text, keys_present boolean, declared_condition text, color text,
  purchase_location text,
  hammer_price_cents bigint,
  lot_won_notified_at timestamptz,
  ownership_transferred_at timestamptz,
  documents_released_at timestamptz,
  picked_up_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_orders (                    -- annexe B du contrat
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  platform platform not null,
  lot_number text not null,
  vin text,
  auction_at timestamptz,
  max_bid_cents bigint not null check (max_bid_cents > 0),
  deposit_cents bigint not null default 0,          -- = forfait A estimé sur l'enchère max (C2 / I2)
  ack_vehicle_info boolean not null default false,
  ack_import_age boolean not null default false,
  ack_binding_win boolean not null default false,
  ack_duties_excluded boolean not null default false,
  age_check_override_reason text,
  signed_at timestamptz,
  signed_file_path text,
  created_at timestamptz not null default now()
);

-- ---------- Coûts internes (JAMAIS visibles par le client) ----------
create table internal_costs (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  section text not null check (section in ('A', 'B')),
  cost_type text not null,              -- enchere, frais_plateforme, taxes_usa, autres_acquisition, transport_terrestre, manutention, mise_conteneur, fret, frais_documentaires
  amount_cents bigint not null,
  is_estimate boolean not null default true,
  proof_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Taux de change ----------
create table fx_rates (
  id uuid primary key default gen_random_uuid(),
  rate_xof_per_usd numeric(12,4) not null check (rate_xof_per_usd > 0),
  captured_at timestamptz not null,
  source text not null default 'XE.com — taux moyen du marché',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Devis et factures ----------
create table financial_documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  doc_type fin_doc_type not null,
  number text unique,                   -- attribué à l'émission (DV/FA/FS/RC-AAAA-####)
  status fin_doc_status not null default 'draft',
  forfait_a_cents bigint,               -- ligne A
  forfait_b_cents bigint,               -- ligne B
  forfait_mode forfait_mode not null default 'manual',   -- C1 : saisie manuelle par l'agent
  proposed_a_cents bigint, proposed_b_cents bigint,     -- mode futur 'proposed_with_approval'
  forfait_approved_by uuid references profiles(id),
  forfait_approved_at timestamptz,
  insurance insurance_choice not null default 'pending',
  insurance_cents bigint not null default 0,
  vat_rate numeric(5,2) not null default 0,
  fx_rate_id uuid references fx_rates(id),   -- taux du jour d'émission du DEVIS, repris sur FA/FS (C4)
  issued_at timestamptz,
  valid_until timestamptz,              -- devis
  reference_eta date,                   -- facture de solde
  due_at timestamptz,
  accepted_at timestamptz,
  accepted_via text,                    -- portail, whatsapp, email, signature
  cancelled_reason text,
  file_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table adjustments (               -- ligne D
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  financial_document_id uuid references financial_documents(id),
  kind adjustment_kind not null,
  label text not null,
  amount_cents bigint not null,         -- négatif pour une remise
  status adjustment_status not null default 'proposed',
  urgent boolean not null default false,
  reason text,
  proof_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Paiements ----------
create table official_accounts (
  id uuid primary key default gen_random_uuid(),
  mode payment_mode not null,
  label text not null,
  details text not null,                -- RIB/IBAN, numéro Wave/OM
  active boolean not null default false,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),   -- double validation (≠ created_by)
  approved_at timestamptz,
  check (approved_by is null or approved_by <> created_by)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  applies_to fin_doc_type not null check (applies_to in ('deposit_invoice', 'balance_invoice')),
  amount_cents bigint not null check (amount_cents > 0),   -- montant imputé en USD
  paid_currency text not null default 'USD' check (paid_currency in ('USD', 'XOF')),
  amount_xof bigint,                                       -- montant reçu en FCFA, le cas échéant
  fx_rate_id uuid references fx_rates(id),                 -- taux réactualisé du jour du paiement (C4)
  mode payment_mode not null,
  official_account_id uuid references official_accounts(id),
  reference text not null,
  credited_at timestamptz not null,
  proof_path text,
  receipt_document_id uuid references financial_documents(id),
  validated_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table refunds (                 -- trop-perçu restitué au client (C6)
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  reason text not null check (reason in ('overpayment', 'deposit_excess', 'lot_not_won', 'cancellation')),
  amount_cents bigint not null check (amount_cents > 0),
  fx_rate_id uuid references fx_rates(id),
  mode payment_mode not null,
  beneficiary text not null,
  status refund_status not null default 'requested',
  requested_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  paid_at timestamptz,
  payment_reference text,
  proof_path text,
  refund_note_id uuid references financial_documents(id),   -- RB-AAAA-####
  created_at timestamptz not null default now()
);

create table acceptances (              -- 3 modes d'acceptation (D3)
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  subject text not null check (subject in ('contract', 'purchase_order', 'quote', 'extra_cost')),
  subject_id uuid not null,
  document_version text not null,       -- numéro + empreinte SHA-256 du fichier accepté
  method acceptance_method not null,
  decision text not null check (decision in ('accepted', 'refused')),
  insurance insurance_choice,           -- obligatoire pour subject = 'quote'
  proof_path text,                      -- scan ou capture WhatsApp
  whatsapp_from text,
  portal_ip inet,
  portal_session text,
  accepted_at timestamptz not null default now(),
  recorded_by uuid references profiles(id),   -- null si acceptation dans le portail
  check (subject <> 'quote' or insurance in ('accepted', 'refused'))
);

-- ---------- Transporteurs, conteneurs, tracking ----------
create table carriers (
  code text primary key,
  name text not null,
  tracking_url text not null,
  url_template text,
  link_type link_type not null,
  api_status text not null default 'non_etudie',
  active boolean not null default true
);

create table containers (
  id uuid primary key default gen_random_uuid(),
  number text unique not null check (number ~ '^[A-Z]{4}[0-9]{7}$'),
  carrier_code text not null references carriers(code),
  bill_of_lading text,
  vessel text, voyage text,
  port_of_loading text, transshipment text, port_of_discharge text not null default 'Dakar (SNDKR)',
  etd date, atd date, eta date, ata date,
  status text not null default 'Chargement planifié',
  last_checked_at timestamptz,
  internal_notes text,
  created_at timestamptz not null default now()
);

create table dossier_containers (       -- historique des affectations
  dossier_id uuid not null references dossiers(id),
  container_id uuid not null references containers(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  primary key (dossier_id, container_id, assigned_at)
);

create table eta_history (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references containers(id),
  eta date not null,
  source event_source not null,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now()
);

create table tracking_events (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references containers(id),
  occurred_on date not null,
  location text,
  description text not null,
  source event_source not null,
  visible_client boolean not null default true,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now()
);

-- ---------- Documents, chronologie, réclamations, recouvrement ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid references dossiers(id),
  client_id uuid references clients(id),
  doc_kind text not null,               -- contrat, ordre_achat, facture_enchere, titre, bl, preuve_paiement, procuration, decharge, photos, ...
  version int not null default 1,
  storage_path text not null,           -- bucket privé
  visible_client boolean not null default false,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

create table dossier_events (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  occurred_at timestamptz not null default now(),
  label text not null,
  visible_client boolean not null default true,
  actor_id uuid references profiles(id)
);

create table document_releases (        -- remise des documents (art. 15)
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  recipient_name text not null,
  recipient_is_proxy boolean not null default false,
  id_checked boolean not null,
  proxy_document_id uuid references documents(id),
  discharge_document_id uuid references documents(id),
  released_at timestamptz not null default now(),
  released_by uuid references profiles(id)
);

create table claims (                   -- réclamations (art. 19)
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  reported_at timestamptz not null default now(),
  description text not null,
  late boolean not null default false,
  status text not null default 'ouverte',
  forwarded_to text,
  created_by uuid references profiles(id)
);

create table collection_actions (       -- relances, mises en demeure (art. 21-22)
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id),
  kind text not null check (kind in ('reminder', 'formal_notice', 'procedure_alert')),
  due_on date not null,
  done_at timestamptz,
  document_id uuid references documents(id),
  notes text
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid references dossiers(id),
  client_id uuid references clients(id),
  channel notif_channel not null,
  template text not null,
  payload jsonb,
  status notif_status not null default 'queued',
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role app_role,
  action text not null,
  object_type text not null,
  object_id text not null,
  before jsonb,
  after jsonb
);

-- ---------- RLS : principes (à compléter pour chaque table) ----------
create or replace function current_role_app() returns app_role
  language sql stable security definer set search_path = public as
  $$ select role from profiles where id = auth.uid() and active $$;

create or replace function current_client_id() returns uuid
  language sql stable security definer set search_path = public as
  $$ select client_id from profiles where id = auth.uid() and role = 'client' $$;

alter table dossiers enable row level security;
create policy dossiers_internal_read on dossiers for select
  using (current_role_app() in ('admin', 'ops', 'accounting', 'management'));
create policy dossiers_client_read on dossiers for select
  using (current_role_app() = 'client' and client_id = current_client_id());
create policy dossiers_ops_write on dossiers for update
  using (current_role_app() in ('admin', 'ops'));

alter table internal_costs enable row level security;
create policy internal_costs_internal_read on internal_costs for select
  using (current_role_app() in ('admin', 'ops', 'accounting', 'management'));
create policy internal_costs_write on internal_costs for insert
  with check (current_role_app() in ('admin', 'ops', 'accounting'));
create policy internal_costs_update on internal_costs for update
  using (current_role_app() in ('admin', 'ops', 'accounting'));
-- C1 : l'agent (ops) établit la structure des coûts. Aucun accès pour 'client' : test automatisé obligatoire.

alter table documents enable row level security;
create policy documents_internal on documents for select
  using (current_role_app() in ('admin', 'ops', 'accounting', 'management'));
create policy documents_client on documents for select
  using (current_role_app() = 'client' and visible_client
         and (client_id = current_client_id()
              or dossier_id in (select id from dossiers where client_id = current_client_id())));

alter table audit_log enable row level security;
create policy audit_read on audit_log for select
  using (current_role_app() in ('admin', 'management'));
-- Écriture de l'audit uniquement par fonctions serveur (security definer) ou triggers.

-- TODO phase 1 : activer RLS et écrire les politiques de toutes les autres tables
-- (clients, contracts, purchase_orders, financial_documents, adjustments, payments, official_accounts,
--  containers, dossier_containers, eta_history, tracking_events, dossier_events, document_releases,
--  claims, collection_actions, notifications, settings, fx_rates, carriers, number_sequences, profiles,
--  refunds, acceptances),
-- puis exposer au client des VUES limitées (ex. client_financial_view sans coûts internes).
