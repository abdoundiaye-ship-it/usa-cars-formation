-- Phase 2, lot 2c — transporteurs, conteneurs, ETA et événements (US-2.6, US-2.7), décisions B4 et P4,
-- règles R12 (suivi) et R13 (conditions des étapes Conteneur, Maritime, Dakar). CLAUDE.md règle 6 : l'ETA reste
-- « indicative » tant que l'ATA n'est pas saisie ; aucune donnée de localisation.

-- ---------------------------------------------------------------------------
-- Numéro de conteneur ISO 6346 : 3 lettres (propriétaire) + U/J/Z + 6 chiffres + chiffre de contrôle
-- ---------------------------------------------------------------------------
create function public.iso6346_valid(p_number text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_sum int := 0;
  v_value int;
  v_char text;
begin
  if p_number is null or p_number !~ '^[A-Z]{3}[UJZ][0-9]{7}$' then
    return false;
  end if;
  for i in 1..10 loop
    v_char := substr(p_number, i, 1);
    if v_char ~ '[A-Z]' then
      -- A=10, B=12 … Z=38 : les multiples de 11 (11, 22, 33) sont sautés.
      v_value := case
        when v_char = 'A' then 10
        when v_char between 'B' and 'K' then ascii(v_char) - ascii('B') + 12
        when v_char between 'L' and 'U' then ascii(v_char) - ascii('L') + 23
        else ascii(v_char) - ascii('V') + 34
      end;
    else
      v_value := v_char::int;
    end if;
    v_sum := v_sum + v_value * (2 ^ (i - 1))::int;
  end loop;
  return (v_sum % 11) % 10 = substr(p_number, 11, 1)::int;
end;
$$;

comment on function public.iso6346_valid(text) is 'Contrôle du numéro de conteneur ISO 6346 (format et chiffre de contrôle).';

-- ---------------------------------------------------------------------------
-- Transporteurs (P4 : créés par l'administrateur, Paramètres → Transporteurs)
-- ---------------------------------------------------------------------------
create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,30}$'),
  name text not null check (length(trim(name)) > 1),
  tracking_url text not null check (tracking_url ~ '^https://'),
  -- Lien direct : {container} ou {bl} remplacés par la référence ; sinon page de suivi + référence à saisir.
  url_template text check (url_template is null or (url_template ~ '^https://' and url_template ~ '\{(container|bl)\}')),
  link_type text not null default 'officiel' check (link_type in ('officiel', 'tiers')),
  note text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.carriers is 'Transporteurs maritimes et configuration du lien de suivi (« service tiers » si link_type = tiers).';

create trigger carriers_touch_updated_at
  before update on public.carriers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Conteneurs
-- ---------------------------------------------------------------------------
create table public.containers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (public.iso6346_valid(number)),
  carrier_id uuid not null references public.carriers (id),
  bl_number text,
  vessel text,
  voyage text,
  port_of_loading text,
  port_of_discharge text not null default 'Dakar',
  etd date,
  eta date,                                          -- ETA indicative en vigueur (historique : eta_history)
  departed_on date,                                  -- départ réel du navire
  ata date,                                          -- arrivée réelle : l'ETA n'est plus affichée
  -- Mêmes codes que les statuts de l'étape Maritime du dossier (propagation, docs/13).
  status text not null default 'booking_confirmed' check (status in (
    'booking_confirmed', 'departure_planned', 'at_sea', 'transshipment', 'arrival_estimated', 'arrived'
  )),
  last_checked_at timestamptz,                       -- « vérifié aujourd'hui » (R12)
  last_checked_by uuid references public.profiles (id),
  notes text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ata is null or departed_on is null or ata >= departed_on),
  check (eta is null or etd is null or eta >= etd)
);

comment on table public.containers is 'Conteneurs (ISO 6346) : transporteur, B/L, navire, ETA indicative, départ et ATA.';
comment on column public.containers.eta is 'ETA indicative, jamais présentée comme une position en temps réel (CLAUDE.md règle 6).';

create trigger containers_touch_updated_at
  before update on public.containers
  for each row execute function public.touch_updated_at();

-- Historique de l'ETA (US-2.7) : chaque valeur, sa source et son auteur.
create table public.eta_history (
  id bigint generated always as identity primary key,
  container_id uuid not null references public.containers (id),
  previous_eta date,
  eta date not null,
  source text not null check (source in ('carrier_site', 'carrier_notice', 'manual')),
  note text,
  changed_by uuid references public.profiles (id) default auth.uid(),
  changed_at timestamptz not null default now()
);

create index eta_history_container_idx on public.eta_history (container_id, changed_at desc);

create trigger eta_history_immutable
  before update or delete on public.eta_history
  for each row execute function public.forbid_update_delete();

-- Événements de suivi (départ, transbordement, arrivée, retard, note), avec leur source.
create table public.tracking_events (
  id bigint generated always as identity primary key,
  container_id uuid not null references public.containers (id),
  occurred_at timestamptz not null,
  kind text not null check (kind in ('departure', 'transshipment', 'arrival', 'eta_changed', 'delay', 'note')),
  label text not null check (length(trim(label)) > 0),
  location text,
  source text not null default 'manual' check (source in ('manual', 'carrier_link', 'api')),
  visible_client boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index tracking_events_container_idx on public.tracking_events (container_id, occurred_at desc);

create trigger tracking_events_immutable
  before update or delete on public.tracking_events
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Affectation d'un véhicule à un conteneur, avec historique (B4)
-- ---------------------------------------------------------------------------
create table public.dossier_containers (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  container_id uuid not null references public.containers (id),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) default auth.uid(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removal_reason text
);

comment on table public.dossier_containers is 'Affectations des véhicules aux conteneurs ; un changement ferme l’affectation précédente (B4).';

-- Un seul conteneur en cours par dossier.
create unique index dossier_containers_active_idx on public.dossier_containers (dossier_id) where removed_at is null;
create index dossier_containers_container_idx on public.dossier_containers (container_id) where removed_at is null;

-- Conteneur en cours d'un dossier.
create function public.active_container_id(p_dossier_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select dc.container_id from public.dossier_containers dc where dc.dossier_id = p_dossier_id and dc.removed_at is null;
$$;

revoke execute on function public.active_container_id(uuid) from public, anon;
grant execute on function public.active_container_id(uuid) to authenticated;

-- Associer un véhicule à un conteneur, ou le changer de conteneur (motif obligatoire, historique conservé).
create function public.assign_container(p_dossier_id uuid, p_container_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_container public.containers%rowtype;
  v_current uuid;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  select * into v_container from public.containers c where c.id = p_container_id;
  if v_dossier.id is null or v_container.id is null then
    raise exception 'Dossier ou conteneur introuvable.' using errcode = '22023';
  end if;
  if v_dossier.stage not in ('us_transport', 'container', 'ocean') then
    raise exception 'Un véhicule s’associe à un conteneur entre les étapes Transport USA et Maritime.' using errcode = '22023';
  end if;
  if v_container.status = 'arrived' then
    raise exception 'Ce conteneur est déjà arrivé : choisissez un autre conteneur.' using errcode = '22023';
  end if;
  v_current := public.active_container_id(p_dossier_id);
  if v_current = p_container_id then
    raise exception 'Le véhicule est déjà dans ce conteneur.' using errcode = '22023';
  end if;
  if v_current is not null then
    if coalesce(length(trim(p_reason)), 0) < 5 then
      raise exception 'Indiquez le motif du changement de conteneur.' using errcode = '22023';
    end if;
    update public.dossier_containers
      set removed_at = now(), removed_by = auth.uid(), removal_reason = trim(p_reason)
      where dossier_id = p_dossier_id and removed_at is null;
    perform public.add_dossier_event(p_dossier_id, 'container_changed',
      'Changement de conteneur : ' || (select c.number from public.containers c where c.id = v_current)
        || ' → ' || v_container.number || ' (' || trim(p_reason) || ')', true);
  else
    perform public.add_dossier_event(p_dossier_id, 'container_assigned',
      'Véhicule associé au conteneur ' || v_container.number, true);
  end if;
  insert into public.dossier_containers (dossier_id, container_id) values (p_dossier_id, p_container_id);
end;
$$;

revoke execute on function public.assign_container(uuid, uuid, text) from public, anon;
grant execute on function public.assign_container(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Chronologie et propagation
-- ---------------------------------------------------------------------------
alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note',
  'container_assigned', 'container_changed', 'eta_changed', 'tracking_event'
));

create function public.format_date_fr(p_date date) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_date, 'DD/MM/YYYY');
$$;

-- Écrit l'historique de l'ETA, les événements du conteneur et ceux des dossiers associés ;
-- propage le statut du conteneur aux dossiers à l'étape Maritime (docs/13, sans changer d'étape).
create function public.containers_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.eta_source', true), ''), 'manual');
  v_note text := nullif(current_setting('app.eta_note', true), '');
  v_label text;
  v_dossier_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.eta is not null then
      insert into public.eta_history (container_id, previous_eta, eta, source, note)
      values (new.id, null, new.eta, v_source, v_note);
    end if;
    return null;
  end if;

  if new.eta is distinct from old.eta and new.eta is not null then
    insert into public.eta_history (container_id, previous_eta, eta, source, note)
    values (new.id, old.eta, new.eta, v_source, v_note);
    v_label := case when old.eta is null
      then 'ETA indicative : ' || public.format_date_fr(new.eta)
      else 'ETA indicative modifiée : ' || public.format_date_fr(old.eta) || ' → ' || public.format_date_fr(new.eta)
    end;
    insert into public.tracking_events (container_id, occurred_at, kind, label, source)
    values (new.id, now(), 'eta_changed', v_label, case when v_source = 'manual' then 'manual' else 'carrier_link' end);
    for v_dossier_id in
      select dc.dossier_id from public.dossier_containers dc where dc.container_id = new.id and dc.removed_at is null
    loop
      perform public.add_dossier_event(v_dossier_id, 'eta_changed', v_label || ' (conteneur ' || new.number || ')', true);
    end loop;
  end if;

  if new.status is distinct from old.status then
    update public.dossiers d
      set status = new.status
      from public.dossier_containers dc
      where dc.container_id = new.id and dc.removed_at is null and dc.dossier_id = d.id
        and d.stage = 'ocean' and d.status is distinct from new.status;
  end if;
  return null;
end;
$$;

revoke execute on function public.containers_after_write() from public, anon, authenticated;

create trigger containers_after_write
  after insert or update on public.containers
  for each row execute function public.containers_after_write();

-- Un événement de suivi visible du client apparaît aussi dans la chronologie de ses dossiers.
create function public.tracking_events_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier_id uuid;
begin
  if new.kind = 'eta_changed' then
    return null;                       -- déjà inscrit par containers_after_write
  end if;
  for v_dossier_id in
    select dc.dossier_id from public.dossier_containers dc where dc.container_id = new.container_id and dc.removed_at is null
  loop
    perform public.add_dossier_event(v_dossier_id, 'tracking_event', new.label, new.visible_client);
  end loop;
  return null;
end;
$$;

revoke execute on function public.tracking_events_after_insert() from public, anon, authenticated;

create trigger tracking_events_after_insert
  after insert on public.tracking_events
  for each row execute function public.tracking_events_after_insert();

-- ---------------------------------------------------------------------------
-- Actions sur le conteneur (US-2.7)
-- ---------------------------------------------------------------------------
-- Nouvelle ETA indicative, avec sa source (historique et événements écrits par le trigger).
create function public.update_container_eta(p_container_id uuid, p_eta date, p_source text, p_note text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_source not in ('carrier_site', 'carrier_notice', 'manual') then
    raise exception 'Source de l’ETA inconnue.' using errcode = '22023';
  end if;
  if exists (select 1 from public.containers c where c.id = p_container_id and c.ata is not null) then
    raise exception 'L’ATA est saisie : l’ETA n’est plus modifiable.' using errcode = '22023';
  end if;
  perform set_config('app.eta_source', p_source, true);
  perform set_config('app.eta_note', coalesce(trim(p_note), ''), true);
  update public.containers set eta = p_eta where id = p_container_id;
  if not found then
    raise exception 'Conteneur introuvable ou modification non autorisée.' using errcode = '42501';
  end if;
  perform set_config('app.eta_source', '', true);
  perform set_config('app.eta_note', '', true);
end;
$$;

-- Départ réel du navire : statut « En transit » et événement de départ.
create function public.record_container_departure(p_container_id uuid, p_departed_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_number text;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  if p_departed_on > (now() at time zone 'Africa/Dakar')::date then
    raise exception 'La date de départ ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  update public.containers set departed_on = p_departed_on, status = 'at_sea'
    where id = p_container_id and ata is null
    returning number into v_number;
  if v_number is null then
    raise exception 'Conteneur introuvable, déjà arrivé, ou modification non autorisée.' using errcode = '22023';
  end if;
  insert into public.tracking_events (container_id, occurred_at, kind, label)
  values (p_container_id, p_departed_on::timestamptz, 'departure',
          'Départ du navire le ' || public.format_date_fr(p_departed_on) || ' (conteneur ' || v_number || ')');
end;
$$;

-- Arrivée réelle (ATA) : statut « Arrivé » ; l'ETA cesse d'être affichée.
create function public.record_container_arrival(p_container_id uuid, p_ata date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_number text;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  if p_ata > (now() at time zone 'Africa/Dakar')::date then
    raise exception 'L’ATA ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  update public.containers set ata = p_ata, status = 'arrived'
    where id = p_container_id and (departed_on is null or departed_on <= p_ata)
    returning number into v_number;
  if v_number is null then
    raise exception 'ATA antérieure au départ, conteneur introuvable ou modification non autorisée.' using errcode = '22023';
  end if;
  insert into public.tracking_events (container_id, occurred_at, kind, label)
  values (p_container_id, p_ata::timestamptz, 'arrival',
          'Arrivée à ' || (select c.port_of_discharge from public.containers c where c.id = p_container_id)
            || ' le ' || public.format_date_fr(p_ata) || ' (conteneur ' || v_number || ')');
end;
$$;

-- « Vérifié aujourd'hui » (R12) : l'agent a consulté le suivi du transporteur.
create function public.mark_container_checked(p_container_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.containers set last_checked_at = now(), last_checked_by = auth.uid() where id = p_container_id;
  if not found then
    raise exception 'Conteneur introuvable ou modification non autorisée.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.update_container_eta(uuid, date, text, text) from public, anon;
revoke execute on function public.record_container_departure(uuid, date) from public, anon;
revoke execute on function public.record_container_arrival(uuid, date) from public, anon;
revoke execute on function public.mark_container_checked(uuid) from public, anon;
grant execute on function public.update_container_eta(uuid, date, text, text) to authenticated;
grant execute on function public.record_container_departure(uuid, date) to authenticated;
grant execute on function public.record_container_arrival(uuid, date) to authenticated;
grant execute on function public.mark_container_checked(uuid) to authenticated;

-- Départ, ATA et vérification passent par les actions dédiées (cohérence des événements).
create function public.containers_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.number is distinct from old.number then
    raise exception 'Le numéro d’un conteneur ne peut pas être modifié.' using errcode = '42501';
  end if;
  if old.ata is not null and (new.ata, new.departed_on, new.eta) is distinct from (old.ata, old.departed_on, old.eta) then
    raise exception 'Le conteneur est arrivé : départ, ETA et ATA sont figés.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger containers_before_update
  before update on public.containers
  for each row execute function public.containers_before_update();

-- ---------------------------------------------------------------------------
-- Conditions de passage complétées (remplace la version du lot 2b)
-- ---------------------------------------------------------------------------
create or replace function public.stage_conditions(p_dossier_id uuid)
returns table (code text, label text, met boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_client public.clients%rowtype;
  v_po public.purchase_orders%rowtype;
  v_container public.containers%rowtype;
  v_carrier public.carriers%rowtype;
  v_age record;
begin
  if not public.is_internal() then
    return;
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if not found then
    return;
  end if;
  select * into v_client from public.clients c where c.id = v_dossier.client_id;
  select * into v_po from public.purchase_orders po where po.dossier_id = p_dossier_id;
  select * into v_container from public.containers c where c.id = public.active_container_id(p_dossier_id);
  select * into v_carrier from public.carriers k where k.id = v_container.carrier_id;

  if v_dossier.stage = 'opening' then
    select * into v_age from public.vehicle_age_check(p_dossier_id);
    return query values
      ('client_complete', 'Fiche client complète (WhatsApp, adresse, pièce d’identité ou NINEA/RCCM et représentant)',
        v_client.notify_phone is not null and v_client.address is not null and case v_client.kind
          when 'person' then v_client.id_document_type is not null and v_client.id_document_number is not null
          else (v_client.ninea is not null or v_client.rccm is not null) and v_client.representative_name is not null
        end),
      ('contract_accepted', 'Contrat du véhicule accepté par le client',
        exists (select 1 from public.contracts c where c.dossier_id = p_dossier_id and c.status = 'accepted')),
      ('purchase_order_signed', 'Ordre d’achat signé, avec enchère maximale et les 4 confirmations',
        coalesce(v_po.status = 'accepted' and v_po.ack_vehicle_info and v_po.ack_import_age and v_po.ack_binding_win
          and v_po.ack_duties_excluded, false)),
      ('import_age', 'Âge du véhicule conforme à la limite d’importation (ou dérogation de l’administrateur)',
        v_age.status = 'ok' or v_po.age_override_reason is not null);
  elsif v_dossier.stage = 'purchase' then
    return query values
      ('lot_won', 'Lot remporté (prix ≤ enchère maximale ou validé par l’administrateur)',
        v_dossier.auction_result is not distinct from 'won'),
      ('vin', 'VIN de 17 caractères', v_dossier.vin is not null),
      ('quote_accepted', 'Devis accepté (confirmation manuelle en attendant la phase 3)',
        exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'quote_accepted')),
      ('payment1_received', 'Paiement 1 intégralement reçu (confirmation manuelle en attendant la phase 3)',
        exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'payment1_received')),
      ('auction_invoice', 'Facture d’enchère archivée',
        exists (select 1 from public.documents doc where doc.dossier_id = p_dossier_id and doc.kind = 'auction_invoice'));
  elsif v_dossier.stage = 'us_transport' then
    return query values
      ('received_at_port', 'Statut « Reçu au site/port »', v_dossier.status = 'received_at_port'),
      ('pickup_proof', 'Preuve de prise en charge archivée',
        exists (select 1 from public.documents doc where doc.dossier_id = p_dossier_id and doc.kind = 'pickup_proof'));
  elsif v_dossier.stage = 'container' then
    return query values
      ('container_assigned', 'Véhicule associé à un conteneur', v_container.id is not null),
      ('shipping_details', 'Transporteur, B/L, navire et voyage saisis',
        v_container.id is not null and v_container.bl_number is not null and v_container.vessel is not null
          and v_container.voyage is not null),
      ('tracking_link', 'Lien de suivi disponible', v_carrier.tracking_url is not null),
      ('balance_invoice_issued', 'Facture de solde émise, choix d’assurance enregistré (confirmation manuelle en attendant la phase 3)',
        exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'balance_invoice_issued'));
  elsif v_dossier.stage = 'ocean' then
    return query values
      ('ata', 'ATA saisie sur le conteneur', v_container.ata is not null);
  elsif v_dossier.stage = 'dakar' then
    return query values
      ('balance_paid', 'Solde réglé (confirmation manuelle en attendant la phase 3)',
        exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'balance_paid')),
      ('release_receipt', 'Décharge de remise des documents archivée',
        exists (select 1 from public.documents doc where doc.dossier_id = p_dossier_id and doc.kind = 'release_receipt')),
      ('collected', 'Enlèvement enregistré (statut « Enlevé »)', v_dossier.status = 'collected');
  end if;
end;
$$;

-- Passage d'étape : à l'entrée en Maritime, le dossier reprend le statut de son conteneur.
create or replace function public.advance_stage(p_dossier_id uuid, p_override_reason text default null)
returns public.dossier_stage
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_missing text[];
  v_next public.dossier_stage;
  v_status text;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  select v.next_stage, v.first_status into v_next, v_status
  from (values
    ('opening'::public.dossier_stage, 'purchase'::public.dossier_stage, 'bidding'),
    ('purchase', 'us_transport', 'pickup_to_schedule'),
    ('us_transport', 'container', 'loading_planned'),
    ('container', 'ocean', 'booking_confirmed'),
    ('ocean', 'dakar', 'documents_to_finalize'),
    ('dakar', 'closing', 'completed')
  ) as v (stage, next_stage, first_status)
  where v.stage = v_dossier.stage;
  if v_next is null then
    raise exception 'Le dossier est à la dernière étape.' using errcode = '22023';
  end if;
  if v_next = 'ocean' then
    v_status := coalesce(
      (select c.status from public.containers c where c.id = public.active_container_id(p_dossier_id)), v_status);
  end if;

  select array_agg(c.label) into v_missing from public.stage_conditions(p_dossier_id) c where not c.met;
  if cardinality(v_missing) > 0 then
    if public.current_role_app() is distinct from 'admin' or coalesce(length(trim(p_override_reason)), 0) < 5 then
      raise exception 'Conditions non remplies : %.', array_to_string(v_missing, ' ; ') using errcode = '22023';
    end if;
    perform public.log_audit('stage_exception', 'dossiers', p_dossier_id::text,
      jsonb_build_object('stage', v_dossier.stage, 'missing', to_jsonb(v_missing)),
      jsonb_build_object('stage', v_next), p_override_reason);
    perform public.add_dossier_event(p_dossier_id, 'stage_exception',
      'Passage d’étape par exception de l’administrateur : ' || trim(p_override_reason), false);
  end if;

  perform set_config('app.stage_transition', 'on', true);
  update public.dossiers set stage = v_next, status = v_status where id = p_dossier_id;
  perform set_config('app.stage_transition', 'off', true);
  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit et RLS (docs/12_roles_permissions.md)
-- ---------------------------------------------------------------------------
create trigger carriers_audit after insert or update on public.carriers
  for each row execute function public.audit_row('id');
create trigger containers_audit after insert or update on public.containers
  for each row execute function public.audit_row('id');
create trigger dossier_containers_audit after insert or update on public.dossier_containers
  for each row execute function public.audit_row('id');

alter table public.carriers enable row level security;
alter table public.containers enable row level security;
alter table public.eta_history enable row level security;
alter table public.tracking_events enable row level security;
alter table public.dossier_containers enable row level security;

-- Conteneurs visibles d'un client : ceux qui portent actuellement l'un de ses véhicules.
create function public.client_container_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select dc.container_id
  from public.dossier_containers dc
  join public.dossiers d on d.id = dc.dossier_id
  where dc.removed_at is null and d.client_id = public.current_client_id();
$$;

revoke execute on function public.client_container_ids() from public, anon;
grant execute on function public.client_container_ids() to authenticated;

-- Transporteurs : internes L ; administrateur E ; un client lit le transporteur de ses conteneurs (portail).
create policy carriers_select on public.carriers for select to authenticated
  using (
    (select public.is_internal())
    or id in (select c.carrier_id from public.containers c where c.id in (select public.client_container_ids()))
  );
create policy carriers_insert on public.carriers for insert to authenticated
  with check ((select public.current_role_app()) = 'admin');
create policy carriers_update on public.carriers for update to authenticated
  using ((select public.current_role_app()) = 'admin')
  with check ((select public.current_role_app()) = 'admin');

-- Conteneurs : internes L ; admin et agent E ; un client lit le conteneur de ses dossiers.
create policy containers_select on public.containers for select to authenticated
  using ((select public.is_internal()) or id in (select public.client_container_ids()));
create policy containers_insert on public.containers for insert to authenticated
  with check ((select public.is_operations_writer()));
create policy containers_update on public.containers for update to authenticated
  using ((select public.is_operations_writer()))
  with check ((select public.is_operations_writer()));

-- Historique de l'ETA : interne (le client voit les événements « ETA modifiée »).
create policy eta_history_select on public.eta_history for select to authenticated
  using ((select public.is_internal()));

-- Événements de suivi : internes L ; admin et agent ajoutent des événements ; un client lit les visibles.
create policy tracking_events_select on public.tracking_events for select to authenticated
  using (
    (select public.is_internal())
    or (visible_client and container_id in (select public.client_container_ids()))
  );
create policy tracking_events_insert on public.tracking_events for insert to authenticated
  with check (
    (select public.is_operations_writer()) and kind in ('transshipment', 'delay', 'note') and created_by = (select auth.uid())
  );

-- Affectations : internes L ; un client lit celles de ses dossiers ; écriture par assign_container uniquement.
create policy dossier_containers_select on public.dossier_containers for select to authenticated
  using (
    (select public.is_internal())
    or dossier_id in (select d.id from public.dossiers d where d.client_id = (select public.current_client_id()))
  );

revoke execute on function public.iso6346_valid(text) from public, anon;
grant execute on function public.iso6346_valid(text) to authenticated;
revoke execute on function public.containers_before_update() from public, anon, authenticated;
revoke execute on function public.format_date_fr(date) from public, anon;
grant execute on function public.format_date_fr(date) to authenticated;

revoke delete, truncate on public.carriers, public.containers, public.eta_history, public.tracking_events,
  public.dossier_containers from anon, authenticated;
revoke insert, update on public.eta_history, public.dossier_containers from anon, authenticated;
revoke update on public.tracking_events from anon, authenticated;
revoke all on public.carriers, public.containers, public.eta_history, public.tracking_events,
  public.dossier_containers from anon;
