-- Phase 2, lot 2a — clients, dossiers, documents, contrats, acceptations, chronologie.
-- Sources : docs/15_user_stories.md (US-2.1, US-2.2), docs/13_workflow_statuts.md, docs/12_roles_permissions.md,
-- règles R14 et R15 (docs/10_regles_metier.md), décisions B1, B3, D3, X7 (docs/00_points_de_clarification.md).

-- ---------------------------------------------------------------------------
-- Fonctions d'accès utilitaires
-- ---------------------------------------------------------------------------
-- Rôles internes autorisés à écrire les données opérationnelles (admin, agent opérations).
create function public.is_operations_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'ops'), false);
$$;

revoke execute on function public.is_operations_writer() from public, anon;
grant execute on function public.is_operations_writer() to authenticated;

-- Annuaire interne : nom et rôle des membres de l'équipe (responsable d'un dossier, auteur d'un événement).
-- Les profils restent protégés par leur RLS (un agent ne lit que le sien) ; cette vue n'expose que le nom,
-- et seulement aux utilisateurs internes. Vue exécutée avec les droits de son propriétaire, filtrée par is_internal().
create view public.staff_directory as
  select p.id, p.full_name, p.role, p.active
  from public.profiles p
  where p.role <> 'client' and public.is_internal();

comment on view public.staff_directory is 'Noms et rôles de l’équipe interne, lisibles par les utilisateurs internes.';

revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated;

-- ---------------------------------------------------------------------------
-- Clients (US-2.1)
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'company')),
  name text not null check (length(trim(name)) > 1),
  id_document_type text check (id_document_type in ('national_id', 'passport', 'residence_permit', 'other')),
  id_document_number text,
  ninea text,
  rccm text,
  representative_name text,          -- société : représentant légal
  representative_title text,
  address text,
  notify_phone text not null check (notify_phone ~ '^\+[1-9][0-9]{7,14}$'),  -- WhatsApp de notification (art. 17, 31)
  notify_email text check (notify_email is null or notify_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is 'Clients de USA CARS (personnes ou sociétés).';
comment on column public.clients.notify_phone is 'Numéro WhatsApp de notification, format international E.164 (+221…).';

create index clients_name_idx on public.clients (lower(name));

create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function public.touch_updated_at();

alter table public.profiles
  add constraint profiles_client_fk foreign key (client_id) references public.clients (id);

-- ---------------------------------------------------------------------------
-- Étapes et statuts du dossier (docs/13_workflow_statuts.md)
-- ---------------------------------------------------------------------------
create type public.dossier_stage as enum (
  'opening', 'purchase', 'us_transport', 'container', 'ocean', 'dakar', 'closing'
);

create table public.workflow_statuses (
  stage public.dossier_stage not null,
  code text not null check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  position int not null,
  primary key (stage, code)
);

comment on table public.workflow_statuses is 'Statuts possibles dans chaque étape du dossier (référentiel, lecture seule).';

insert into public.workflow_statuses (stage, code, label, position) values
  ('opening', 'new', 'Nouveau', 1),
  ('opening', 'info_missing', 'Informations à compléter', 2),
  ('opening', 'contract_signed', 'Contrat signé', 3),
  ('opening', 'purchase_order_signed', 'Ordre d’achat signé', 4),
  ('opening', 'validation_required', 'Validation requise', 5),
  ('purchase', 'bidding', 'Enchère en cours', 1),
  ('purchase', 'won', 'Gagné', 2),
  ('purchase', 'quote_issued', 'Devis émis', 3),
  ('purchase', 'quote_accepted', 'Devis validé', 4),
  ('purchase', 'payment1_pending', 'Paiement 1 attendu', 5),
  ('purchase', 'confirmed', 'Confirmé', 6),
  ('purchase', 'cancelled', 'Annulé', 7),
  ('us_transport', 'pickup_to_schedule', 'Enlèvement à planifier', 1),
  ('us_transport', 'picked_up', 'Enlevé', 2),
  ('us_transport', 'in_transit', 'En transit', 3),
  ('us_transport', 'received_at_port', 'Reçu au site/port', 4),
  ('container', 'loading_planned', 'Chargement planifié', 1),
  ('container', 'loaded', 'Chargé', 2),
  ('container', 'container_confirmed', 'Conteneur confirmé', 3),
  ('container', 'documents_pending', 'Documents attendus', 4),
  ('ocean', 'booking_confirmed', 'Réservation confirmée', 1),
  ('ocean', 'departure_planned', 'Départ prévu', 2),
  ('ocean', 'at_sea', 'En transit', 3),
  ('ocean', 'transshipment', 'Transbordement', 4),
  ('ocean', 'arrival_estimated', 'Arrivée estimée', 5),
  ('ocean', 'arrived', 'Arrivé', 6),
  ('dakar', 'documents_to_finalize', 'Documents à finaliser', 1),
  ('dakar', 'balance_pending', 'Solde attendu', 2),
  ('dakar', 'documents_released', 'Documents remis', 3),
  ('dakar', 'customs_clearance', 'Dédouanement en cours', 4),
  ('dakar', 'collected', 'Enlevé', 5),
  ('closing', 'completed', 'Terminé', 1),
  ('closing', 'archived', 'Archivé', 2),
  ('closing', 'claim', 'Réclamation', 3),
  ('closing', 'dispute', 'Litige', 4),
  ('closing', 'suspended', 'Suspendu', 5),
  ('closing', 'unclaimed', 'Non réclamé (procédure en cours)', 6);

-- ---------------------------------------------------------------------------
-- Dossiers : un véhicule par dossier (B1, R14)
-- ---------------------------------------------------------------------------
create type public.auction_platform as enum ('copart', 'iaa', 'other');
create type public.vehicle_category as enum ('passenger', 'light_utility', 'truck_or_bus');

create table public.dossiers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,      -- UC-AAAA-#### (B3), attribuée par la base
  client_id uuid not null references public.clients (id),
  owner_id uuid references public.profiles (id) default auth.uid(),   -- responsable interne
  stage public.dossier_stage not null default 'opening',
  status text not null default 'new',
  platform public.auction_platform,
  lot_number text,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),       -- 17 caractères, sans I, O ni Q
  make text,
  model text,
  model_year int check (model_year is null or model_year between 1900 and 2100),
  mileage int check (mileage is null or mileage >= 0),
  vehicle_category public.vehicle_category,
  title_status text,
  color text,
  keys_present boolean,
  declared_condition text,
  purchase_location text,
  departure_port text,
  notes text,
  params_as_of timestamptz not null default now(),   -- date d'effet des paramètres applicables (X7)
  duplicated_from uuid references public.dossiers (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (stage, status) references public.workflow_statuses (stage, code)
);

comment on table public.dossiers is 'Dossiers : un véhicule, un contrat, un ordre d’achat (décision B1, règle R14).';
comment on column public.dossiers.params_as_of is 'Les paramètres contractuels applicables sont ceux en vigueur à cette date (décision X7).';

create index dossiers_client_idx on public.dossiers (client_id);
create index dossiers_stage_idx on public.dossiers (stage, status);
create index dossiers_vin_idx on public.dossiers (vin);
create index dossiers_lot_idx on public.dossiers (lot_number);

create trigger dossiers_touch_updated_at
  before update on public.dossiers
  for each row execute function public.touch_updated_at();

-- Référence attribuée par la base (numérotation continue, B3). Un utilisateur ne la choisit jamais ;
-- le seed de démonstration (sans utilisateur connecté) garde ses références DEMO-.
create function public.dossiers_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or new.reference is null then
    new.reference := public.next_number('dossier');
  end if;
  if auth.uid() is not null then
    new.stage := 'opening';
    new.status := 'new';
    new.params_as_of := now();
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger dossiers_before_insert
  before insert on public.dossiers
  for each row execute function public.dossiers_before_insert();

-- Référence, client et date d'effet des paramètres sont figés. Le changement d'étape passe par la fonction
-- de passage d'étape (lot 2b), qui active app.stage_transition le temps de la transaction.
create function public.dossiers_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.reference is distinct from old.reference
     or new.client_id is distinct from old.client_id
     or new.params_as_of is distinct from old.params_as_of
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'La référence, le client et la date d’ouverture d’un dossier ne peuvent pas être modifiés.'
      using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage
     and coalesce(current_setting('app.stage_transition', true), '') <> 'on' then
    raise exception 'Le changement d’étape passe par l’action « Passer à l’étape suivante ».'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger dossiers_before_update
  before update on public.dossiers
  for each row execute function public.dossiers_before_update();

-- ---------------------------------------------------------------------------
-- Documents (stockage privé) — téléversements et documents générés
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  kind text not null check (kind in (
    'contract', 'signed_contract', 'acceptance_proof', 'purchase_order', 'auction_invoice', 'title',
    'bill_of_lading', 'payment_proof', 'power_of_attorney', 'release_receipt', 'photos', 'other'
  )),
  version int not null default 1 check (version >= 1),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  visible_client boolean not null default false,
  uploaded_by uuid references public.profiles (id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);

comment on table public.documents is 'Documents des dossiers (bucket privé « documents »). Seul visible_client est modifiable.';

create index documents_dossier_idx on public.documents (dossier_id, kind, version desc);

-- Client déduit du dossier, version incrémentée par dossier et par type, auteur imposé.
create function public.documents_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dossier_id is not null then
    select d.client_id into new.client_id from public.dossiers d where d.id = new.dossier_id;
    -- Verrou du dossier : deux téléversements simultanés ne reçoivent pas le même numéro de version.
    perform 1 from public.dossiers d where d.id = new.dossier_id for update;
    select coalesce(max(doc.version), 0) + 1 into new.version
    from public.documents doc
    where doc.dossier_id = new.dossier_id and doc.kind = new.kind;
  end if;
  if auth.uid() is not null then
    new.uploaded_by := auth.uid();
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.documents_before_insert() from public, anon, authenticated;

create trigger documents_before_insert
  before insert on public.documents
  for each row execute function public.documents_before_insert();

-- Un document est figé : seule sa visibilité client peut changer.
create function public.documents_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'visible_client') is distinct from (to_jsonb(old) - 'visible_client') then
    raise exception 'Un document enregistré ne peut pas être modifié (seule sa visibilité client peut changer).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger documents_before_update
  before update on public.documents
  for each row execute function public.documents_before_update();

-- Bucket privé : jamais d'accès public ; liens signés expirants créés côté serveur (US-2.8).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 20971520,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy documents_bucket_select_internal on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select public.is_internal()));
create policy documents_bucket_insert_writers on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.current_role_app()) in ('admin', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- Contrats : un contrat par véhicule (B1, R14), généré à l'ouverture du dossier
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null unique references public.dossiers (id),   -- un dossier, un contrat — et inversement
  client_id uuid not null references public.clients (id),
  reference text not null unique,
  template_version text not null,
  document_id uuid not null references public.documents (id),        -- version en vigueur du contrat généré
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  decided_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contracts is 'Contrat de prestation d’un dossier (un contrat par véhicule, décision B1).';

create trigger contracts_touch_updated_at
  before update on public.contracts
  for each row execute function public.touch_updated_at();

-- Un contrat accepté est figé ; un contrat en attente peut être régénéré (nouvelle version du document).
create function public.contracts_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.dossier_id is distinct from old.dossier_id
     or new.client_id is distinct from old.client_id
     or new.reference is distinct from old.reference then
    raise exception 'Un contrat ne peut pas être rattaché à un autre dossier.' using errcode = '42501';
  end if;
  if old.status = 'accepted'
     and (new.document_id is distinct from old.document_id or new.status is distinct from old.status) then
    raise exception 'Le contrat a été accepté : il ne peut plus être modifié.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger contracts_before_update
  before update on public.contracts
  for each row execute function public.contracts_before_update();

-- ---------------------------------------------------------------------------
-- Chronologie du dossier
-- ---------------------------------------------------------------------------
create table public.dossier_events (
  id bigint generated always as identity primary key,
  dossier_id uuid not null references public.dossiers (id),
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in (
    'opened', 'status_changed', 'stage_changed', 'contract_generated', 'acceptance_recorded',
    'document_added', 'note'
  )),
  label text not null check (length(trim(label)) > 0),
  visible_client boolean not null default false,
  actor_id uuid references public.profiles (id) default auth.uid()
);

comment on table public.dossier_events is 'Chronologie du dossier (visible du client si visible_client).';

create index dossier_events_dossier_idx on public.dossier_events (dossier_id, occurred_at desc);

create trigger dossier_events_immutable
  before update or delete on public.dossier_events
  for each row execute function public.forbid_update_delete();

-- Ajout d'un événement par les triggers et fonctions métier (propriétaire des tables).
create function public.add_dossier_event(
  p_dossier_id uuid, p_kind text, p_label text, p_visible_client boolean
) returns void
language sql security definer set search_path = '' as $$
  insert into public.dossier_events (dossier_id, kind, label, visible_client, actor_id)
  values (p_dossier_id, p_kind, p_label, p_visible_client, auth.uid());
$$;

revoke execute on function public.add_dossier_event(uuid, text, text, boolean) from public, anon, authenticated;

create function public.status_label(p_stage public.dossier_stage, p_code text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select ws.label from public.workflow_statuses ws where ws.stage = p_stage and ws.code = p_code), p_code);
$$;

create function public.dossiers_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.add_dossier_event(
      new.id, 'opened',
      case when new.duplicated_from is not null
        then 'Dossier ouvert (copie de ' || (select d.reference from public.dossiers d where d.id = new.duplicated_from) || ')'
        else 'Dossier ouvert'
      end,
      true
    );
  elsif new.stage is distinct from old.stage then
    perform public.add_dossier_event(
      new.id, 'stage_changed',
      'Étape suivante : ' || public.status_label(new.stage, new.status), true
    );
  elsif new.status is distinct from old.status then
    perform public.add_dossier_event(
      new.id, 'status_changed',
      'Statut : ' || public.status_label(old.stage, old.status) || ' → ' || public.status_label(new.stage, new.status), true
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.dossiers_after_write() from public, anon, authenticated;

create trigger dossiers_after_write
  after insert or update on public.dossiers
  for each row execute function public.dossiers_after_write();

-- Chaque document ajouté au dossier apparaît dans la chronologie (visible du client s'il lui est visible).
create function public.documents_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dossier_id is null then
    return null;
  end if;
  if new.kind = 'contract' then
    perform public.add_dossier_event(new.dossier_id, 'contract_generated', 'Contrat généré (version ' || new.version || ')', true);
  else
    perform public.add_dossier_event(new.dossier_id, 'document_added', 'Document ajouté', new.visible_client);
  end if;
  return null;
end;
$$;

revoke execute on function public.documents_after_insert() from public, anon, authenticated;

create trigger documents_after_insert
  after insert on public.documents
  for each row execute function public.documents_after_insert();

-- ---------------------------------------------------------------------------
-- Acceptations (D3, R15) : papier scanné, WhatsApp (agent) ou portail (client, phase 4)
-- ---------------------------------------------------------------------------
create type public.acceptance_method as enum ('scanned_paper', 'whatsapp', 'portal');

create table public.acceptances (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  subject text not null check (subject in ('contract', 'purchase_order', 'quote', 'extra_cost')),
  subject_id uuid not null,
  document_id uuid not null references public.documents (id),        -- version exacte acceptée
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  method public.acceptance_method not null,
  decision text not null check (decision in ('accepted', 'refused')),
  decided_at timestamptz not null,                                     -- date de signature / du message
  proof_document_id uuid references public.documents (id),           -- scan ou capture WhatsApp
  whatsapp_from text check (whatsapp_from is null or whatsapp_from ~ '^\+[1-9][0-9]{7,14}$'),
  portal_ip inet,
  portal_session text,
  notes text,
  recorded_by uuid references public.profiles (id) default auth.uid(),
  recorded_at timestamptz not null default now(),
  check (method <> 'scanned_paper' or proof_document_id is not null),
  check (method <> 'whatsapp' or (proof_document_id is not null and whatsapp_from is not null)),
  check (method <> 'portal' or portal_session is not null)
);

comment on table public.acceptances is 'Acceptations et refus des documents (R15) : version figée (empreinte SHA-256) et preuve.';

create index acceptances_subject_idx on public.acceptances (subject, subject_id);

create trigger acceptances_immutable
  before update or delete on public.acceptances
  for each row execute function public.forbid_update_delete();

-- Contrat : l'acceptation porte sur la version en vigueur du contrat, encore en attente.
create function public.acceptances_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contract public.contracts%rowtype;
begin
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
    new.recorded_at := now();
  end if;
  if new.decided_at > now() + interval '5 minutes' then
    raise exception 'La date de l’acceptation ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  if new.proof_document_id is not null and not exists (
    select 1 from public.documents doc
    where doc.id = new.proof_document_id and doc.dossier_id = new.dossier_id and doc.kind = 'acceptance_proof'
  ) then
    raise exception 'La preuve doit être un document « preuve d’acceptation » du même dossier.' using errcode = '22023';
  end if;

  if new.subject = 'contract' then
    select * into v_contract from public.contracts c where c.id = new.subject_id for update;
    if not found then
      raise exception 'Contrat introuvable.' using errcode = '22023';
    end if;
    if v_contract.status <> 'pending' then
      raise exception 'Une décision a déjà été enregistrée pour ce contrat.' using errcode = '22023';
    end if;
    new.dossier_id := v_contract.dossier_id;
    new.document_id := v_contract.document_id;
    new.document_sha256 := v_contract.document_sha256;
  end if;
  return new;
end;
$$;

revoke execute on function public.acceptances_before_insert() from public, anon, authenticated;

create trigger acceptances_before_insert
  before insert on public.acceptances
  for each row execute function public.acceptances_before_insert();

create function public.acceptances_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_method text := case new.method
    when 'scanned_paper' then 'papier signé scanné'
    when 'whatsapp' then 'WhatsApp'
    else 'portail client'
  end;
begin
  if new.subject = 'contract' then
    update public.contracts
      set status = new.decision, decided_at = new.decided_at
      where id = new.subject_id;
    if new.decision = 'accepted' then
      update public.dossiers
        set status = 'contract_signed'
        where id = new.dossier_id and stage = 'opening' and status in ('new', 'info_missing', 'validation_required');
    end if;
    perform public.add_dossier_event(
      new.dossier_id, 'acceptance_recorded',
      case when new.decision = 'accepted' then 'Contrat accepté (' else 'Contrat refusé (' end || v_method || ')',
      true
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.acceptances_after_insert() from public, anon, authenticated;

create trigger acceptances_after_insert
  after insert on public.acceptances
  for each row execute function public.acceptances_after_insert();

-- ---------------------------------------------------------------------------
-- Fonctions métier (exécutées avec les droits de l'utilisateur : la RLS s'applique)
-- ---------------------------------------------------------------------------
-- Enregistre la version générée du contrat d'un dossier (création ou régénération tant qu'il est en attente).
create function public.register_contract_document(
  p_dossier_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_sha256 text,
  p_template_version text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_document_id uuid;
  v_contract_id uuid;
begin
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if exists (select 1 from public.contracts c where c.dossier_id = p_dossier_id and c.status <> 'pending') then
    raise exception 'Une décision a déjà été enregistrée pour ce contrat : il ne peut plus être régénéré.'
      using errcode = '22023';
  end if;

  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client)
  values (
    p_dossier_id, v_dossier.client_id, 'contract', p_storage_path, p_file_name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', p_size_bytes, p_sha256, true
  )
  returning id into v_document_id;

  insert into public.contracts (dossier_id, client_id, reference, template_version, document_id, document_sha256)
  values (p_dossier_id, v_dossier.client_id, v_dossier.reference, p_template_version, v_document_id, p_sha256)
  on conflict (dossier_id) do update
    set document_id = excluded.document_id,
        document_sha256 = excluded.document_sha256,
        template_version = excluded.template_version
  returning id into v_contract_id;

  return v_contract_id;
end;
$$;

revoke execute on function public.register_contract_document(uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_contract_document(uuid, text, text, bigint, text, text) to authenticated;

-- « Dupliquer le dossier » (R14) : copie le client, la plateforme et le responsable ;
-- jamais les montants, le véhicule ni les documents signés.
create function public.duplicate_dossier(p_dossier_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_new_id uuid;
begin
  insert into public.dossiers (client_id, owner_id, platform, duplicated_from)
  select d.client_id, coalesce(d.owner_id, auth.uid()), d.platform, d.id
  from public.dossiers d
  where d.id = p_dossier_id
  returning id into v_new_id;
  if v_new_id is null then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  return v_new_id;
end;
$$;

revoke execute on function public.duplicate_dossier(uuid) from public, anon;
grant execute on function public.duplicate_dossier(uuid) to authenticated;

-- Fonctions internes appelées par les politiques et triggers uniquement.
revoke execute on function public.status_label(public.dossier_stage, text) from public, anon;
grant execute on function public.status_label(public.dossier_stage, text) to authenticated;
revoke execute on function public.dossiers_before_insert() from public, anon, authenticated;
revoke execute on function public.dossiers_before_update() from public, anon, authenticated;
revoke execute on function public.documents_before_update() from public, anon, authenticated;
revoke execute on function public.contracts_before_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit (CLAUDE.md règle 5)
-- ---------------------------------------------------------------------------
create trigger clients_audit after insert or update on public.clients
  for each row execute function public.audit_row('id');
create trigger dossiers_audit after insert or update on public.dossiers
  for each row execute function public.audit_row('id');
create trigger documents_audit after insert or update on public.documents
  for each row execute function public.audit_row('id');
create trigger contracts_audit after insert or update on public.contracts
  for each row execute function public.audit_row('id');
create trigger acceptances_audit after insert on public.acceptances
  for each row execute function public.audit_row('id');

-- ---------------------------------------------------------------------------
-- RLS (docs/12_roles_permissions.md)
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.workflow_statuses enable row level security;
alter table public.dossiers enable row level security;
alter table public.documents enable row level security;
alter table public.contracts enable row level security;
alter table public.dossier_events enable row level security;
alter table public.acceptances enable row level security;

-- Clients : internes L ; admin et agent E ; un client lit sa propre fiche.
create policy clients_select on public.clients for select to authenticated
  using ((select public.is_internal()) or id = (select public.current_client_id()));
create policy clients_insert on public.clients for insert to authenticated
  with check ((select public.is_operations_writer()));
create policy clients_update on public.clients for update to authenticated
  using ((select public.is_operations_writer()))
  with check ((select public.is_operations_writer()));

-- Référentiel des statuts : lecture pour tout utilisateur connecté.
create policy workflow_statuses_select on public.workflow_statuses for select to authenticated using (true);

-- Dossiers : internes L ; admin et agent E ; un client lit les siens.
create policy dossiers_select on public.dossiers for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));
create policy dossiers_insert on public.dossiers for insert to authenticated
  with check ((select public.is_operations_writer()));
create policy dossiers_update on public.dossiers for update to authenticated
  using ((select public.is_operations_writer()))
  with check ((select public.is_operations_writer()));

-- Documents : internes L ; admin, agent et comptabilité E ; un client lit ses documents visibles.
create policy documents_select on public.documents for select to authenticated
  using (
    (select public.is_internal())
    or (visible_client and client_id = (select public.current_client_id()))
  );
create policy documents_insert on public.documents for insert to authenticated
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));
create policy documents_update on public.documents for update to authenticated
  using ((select public.current_role_app()) in ('admin', 'ops', 'accounting'))
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));

-- Contrats : internes L ; admin et agent E ; un client lit les siens.
create policy contracts_select on public.contracts for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));
create policy contracts_insert on public.contracts for insert to authenticated
  with check ((select public.is_operations_writer()));
create policy contracts_update on public.contracts for update to authenticated
  using ((select public.is_operations_writer()))
  with check ((select public.is_operations_writer()));

-- Chronologie : internes L ; un client lit les événements visibles de ses dossiers ;
-- admin et agent ajoutent des notes (les autres événements viennent des triggers).
create policy dossier_events_select on public.dossier_events for select to authenticated
  using (
    (select public.is_internal())
    or (
      visible_client
      and dossier_id in (select d.id from public.dossiers d where d.client_id = (select public.current_client_id()))
    )
  );
create policy dossier_events_insert_note on public.dossier_events for insert to authenticated
  with check ((select public.is_operations_writer()) and kind = 'note' and actor_id = (select auth.uid()));

-- Acceptations : internes L ; admin et agent enregistrent les acceptations par scan ou WhatsApp ;
-- un client lit les siennes (l'acceptation dans le portail arrive en phase 4).
create policy acceptances_select on public.acceptances for select to authenticated
  using (
    (select public.is_internal())
    or dossier_id in (select d.id from public.dossiers d where d.client_id = (select public.current_client_id()))
  );
create policy acceptances_insert on public.acceptances for insert to authenticated
  with check ((select public.is_operations_writer()) and method in ('scanned_paper', 'whatsapp'));

-- Aucune suppression par l'API ; référentiel en lecture seule.
revoke delete, truncate on public.clients, public.dossiers, public.documents, public.contracts,
  public.dossier_events, public.acceptances from anon, authenticated;
revoke insert, update, delete, truncate on public.workflow_statuses from anon, authenticated;
revoke update on public.dossier_events, public.acceptances from anon, authenticated;
revoke all on public.clients, public.dossiers, public.documents, public.contracts, public.dossier_events,
  public.acceptances, public.workflow_statuses from anon;
