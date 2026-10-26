-- Phase 2, lot 2b — ordre d'achat (US-2.3), résultat d'enchère (US-2.4), étapes et statuts (US-2.5).
-- Sources : docs/13_workflow_statuts.md, docs/15_user_stories.md, règles R4, R13, R15 (docs/10_regles_metier.md),
-- hypothèses P1 et P2 (docs/00_points_de_clarification.md).

-- ---------------------------------------------------------------------------
-- Référentiels complétés
-- ---------------------------------------------------------------------------
insert into public.workflow_statuses (stage, code, label, position) values ('closing', 'cancelled', 'Annulé', 7);

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'contract', 'signed_contract', 'acceptance_proof', 'purchase_order', 'auction_invoice', 'pickup_proof', 'title',
  'bill_of_lading', 'payment_proof', 'power_of_attorney', 'release_receipt', 'photos', 'other'
));

alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note'
));

create function public.stage_label(p_stage public.dossier_stage) returns text
language sql immutable set search_path = '' as $$
  select case p_stage
    when 'opening' then 'Ouverture' when 'purchase' then 'Achat' when 'us_transport' then 'Transport USA'
    when 'container' then 'Conteneur' when 'ocean' then 'Maritime' when 'dakar' then 'Dakar' else 'Clôture'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Résultat d'enchère et annulation : colonnes du dossier écrites uniquement par les fonctions métier
-- ---------------------------------------------------------------------------
alter table public.dossiers
  add column auction_result text check (auction_result in ('won', 'lost')),
  add column hammer_price_cents bigint check (hammer_price_cents is null or hammer_price_cents > 0),
  add column lot_won_notified_at timestamptz,
  add column payment1_due_at timestamptz,
  add column price_override_reason text,
  add column price_override_by uuid references public.profiles (id),
  add column cancelled_reason text,
  add constraint dossiers_won_complete check (
    auction_result is distinct from 'won' or (hammer_price_cents is not null and lot_won_notified_at is not null)
  );

comment on column public.dossiers.payment1_due_at is
  'Échéance du paiement 1 : notification du lot remporté + payment1.due_hours_after_win (R4), paramètre à l’ouverture.';

-- ---------------------------------------------------------------------------
-- Ordre d'achat (annexe B) : un par dossier (R14)
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null unique references public.dossiers (id),
  auction_at timestamptz,
  max_bid_cents bigint not null check (max_bid_cents > 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),   -- montant attendu (I2, P2)
  -- draft : saisi, document à générer ; pending : généré, en attente de signature ; puis décision du client.
  status text not null default 'draft' check (status in ('draft', 'pending', 'accepted', 'refused')),
  document_id uuid references public.documents (id),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  template_version text,
  platform public.auction_platform,   -- identité du véhicule figée à la génération du document
  lot_number text,
  vin text,
  decided_at timestamptz,
  ack_vehicle_info boolean not null default false,
  ack_import_age boolean not null default false,
  ack_binding_win boolean not null default false,
  ack_duties_excluded boolean not null default false,
  age_override_reason text,
  age_override_by uuid references public.profiles (id),
  age_override_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft') or document_id is not null)
);

comment on table public.purchase_orders is 'Ordres d’achat et mandats d’enchère (annexe B), un par dossier.';

create trigger purchase_orders_touch_updated_at
  before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

-- Un ordre signé est figé ; modifier ses conditions impose de régénérer le document ;
-- seule l'administration peut déroger au contrôle de l'âge (avec motif).
create function public.purchase_orders_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('accepted', 'refused') and coalesce(current_setting('app.po_decision', true), '') <> 'on' then
      raise exception 'L’ordre d’achat a fait l’objet d’une décision du client : il ne peut plus être modifié.'
        using errcode = '42501';
    end if;
    if new.dossier_id is distinct from old.dossier_id then
      raise exception 'Un ordre d’achat ne peut pas être rattaché à un autre dossier.' using errcode = '42501';
    end if;
    if old.status = 'pending'
       and (new.max_bid_cents, new.deposit_cents, new.auction_at) is distinct from (old.max_bid_cents, old.deposit_cents, old.auction_at)
       and new.document_id is not distinct from old.document_id then
      new.status := 'draft';          -- conditions modifiées : document à régénérer
      new.document_id := null;
      new.document_sha256 := null;
    end if;
  end if;
  if (tg_op = 'INSERT' and new.age_override_reason is not null)
     or (tg_op = 'UPDATE' and new.age_override_reason is distinct from old.age_override_reason) then
    if public.current_role_app() is distinct from 'admin' and auth.uid() is not null then
      raise exception 'Seul l’administrateur peut déroger au contrôle de l’âge du véhicule.' using errcode = '42501';
    end if;
    if new.age_override_reason is not null and length(trim(new.age_override_reason)) < 5 then
      raise exception 'Motif de dérogation obligatoire.' using errcode = '22023';
    end if;
    new.age_override_by := case when new.age_override_reason is null then null else auth.uid() end;
    new.age_override_at := case when new.age_override_reason is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger purchase_orders_before_write
  before insert or update on public.purchase_orders
  for each row execute function public.purchase_orders_before_write();

-- ---------------------------------------------------------------------------
-- Contrôle de l'âge à l'importation (US-2.3) : paramètres import.max_age_years_* en vigueur à l'ouverture (X7)
-- ---------------------------------------------------------------------------
create function public.vehicle_age_check(p_dossier_id uuid)
returns table (status text, age int, max_age int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_key text;
begin
  if not public.is_internal() then
    return;
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if not found then
    return;
  end if;
  v_key := case v_dossier.vehicle_category
    when 'passenger' then 'import.max_age_years_passenger'
    when 'light_utility' then 'import.max_age_years_light_utility'
    when 'truck_or_bus' then 'import.max_age_years_trucks_passenger_transport'
  end;
  max_age := (public.setting_as_of(v_key, v_dossier.params_as_of) #>> '{}')::int;
  age := extract(year from (now() at time zone 'Africa/Dakar'))::int - v_dossier.model_year;
  status := case
    when v_key is null or v_dossier.model_year is null or max_age is null then 'unknown'
    when age > max_age then 'too_old'
    else 'ok'
  end;
  return next;
end;
$$;

revoke execute on function public.vehicle_age_check(uuid) from public, anon;
grant execute on function public.vehicle_age_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Gardes du dossier (remplace la version du lot 2a)
-- ---------------------------------------------------------------------------
create or replace function public.dossiers_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.stage_transition', true), '') = 'on'
                   or coalesce(current_setting('app.auction_result', true), '') = 'on';
begin
  if new.reference is distinct from old.reference
     or new.client_id is distinct from old.client_id
     or new.params_as_of is distinct from old.params_as_of
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'La référence, le client et la date d’ouverture d’un dossier ne peuvent pas être modifiés.'
      using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage and coalesce(current_setting('app.stage_transition', true), '') <> 'on' then
    raise exception 'Le changement d’étape passe par l’action « Passer à l’étape suivante ».'
      using errcode = '42501';
  end if;
  if not v_system and (
       new.auction_result, new.hammer_price_cents, new.lot_won_notified_at, new.payment1_due_at,
       new.price_override_reason, new.price_override_by, new.cancelled_reason
     ) is distinct from (
       old.auction_result, old.hammer_price_cents, old.lot_won_notified_at, old.payment1_due_at,
       old.price_override_reason, old.price_override_by, old.cancelled_reason
     ) then
    raise exception 'Le résultat d’enchère et l’annulation passent par les actions dédiées.' using errcode = '42501';
  end if;
  -- Mandat signé : le véhicule désigné (plateforme, lot, VIN) ne change plus.
  if (new.platform, new.lot_number, new.vin) is distinct from (old.platform, old.lot_number, old.vin)
     and exists (select 1 from public.purchase_orders po where po.dossier_id = new.id and po.status = 'accepted') then
    raise exception 'L’ordre d’achat est signé : la plateforme, le lot et le VIN ne peuvent plus être modifiés.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Chronologie : libellé d'étape lisible ; un ordre en attente redevient brouillon si le véhicule change.
create or replace function public.dossiers_after_write() returns trigger
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
    return null;
  end if;
  if new.stage is distinct from old.stage then
    perform public.add_dossier_event(
      new.id, 'stage_changed',
      'Étape ' || public.stage_label(new.stage) || ' · ' || public.status_label(new.stage, new.status), true
    );
  elsif new.status is distinct from old.status then
    perform public.add_dossier_event(
      new.id, 'status_changed',
      'Statut : ' || public.status_label(old.stage, old.status) || ' → ' || public.status_label(new.stage, new.status), true
    );
  end if;
  if (new.platform, new.lot_number, new.vin) is distinct from (old.platform, old.lot_number, old.vin) then
    update public.purchase_orders
      set status = 'draft', document_id = null, document_sha256 = null
      where dossier_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Document de l'ordre d'achat (généré par la fonction generate-document, au nom de l'utilisateur)
-- ---------------------------------------------------------------------------
create function public.register_purchase_order_document(
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
  v_po public.purchase_orders%rowtype;
  v_age record;
  v_missing text[] := '{}';
  v_document_id uuid;
begin
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  select * into v_po from public.purchase_orders po where po.dossier_id = p_dossier_id for update;
  if v_dossier.id is null or v_po.id is null then
    raise exception 'Saisissez d’abord l’ordre d’achat (enchère maximale).' using errcode = '22023';
  end if;
  if v_po.status not in ('draft', 'pending') then
    raise exception 'L’ordre d’achat a fait l’objet d’une décision du client : il ne peut plus être régénéré.'
      using errcode = '22023';
  end if;
  if v_dossier.platform is null then v_missing := v_missing || 'la plateforme'::text; end if;
  if v_dossier.lot_number is null then v_missing := v_missing || 'le numéro de lot'::text; end if;
  if v_dossier.vin is null then v_missing := v_missing || 'le VIN'::text; end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Complétez le véhicule avant de générer l’ordre d’achat : %.', array_to_string(v_missing, ', ')
      using errcode = '22023';
  end if;
  select * into v_age from public.vehicle_age_check(p_dossier_id);
  if v_age.status <> 'ok' and v_po.age_override_reason is null then
    raise exception '%', case v_age.status
      when 'too_old' then 'Véhicule trop âgé pour l’importation (' || v_age.age || ' ans, limite ' || v_age.max_age
        || ' ans) : seul l’administrateur peut déroger, avec un motif.'
      else 'Âge du véhicule non vérifiable : renseignez l’année et la catégorie du véhicule.'
    end using errcode = '22023';
  end if;

  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client)
  values (
    p_dossier_id, v_dossier.client_id, 'purchase_order', p_storage_path, p_file_name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', p_size_bytes, p_sha256, true
  )
  returning id into v_document_id;

  update public.purchase_orders
    set status = 'pending', document_id = v_document_id, document_sha256 = p_sha256,
        template_version = p_template_version,
        platform = v_dossier.platform, lot_number = v_dossier.lot_number, vin = v_dossier.vin
    where id = v_po.id;
  return v_po.id;
end;
$$;

revoke execute on function public.register_purchase_order_document(uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_purchase_order_document(uuid, text, text, bigint, text, text) to authenticated;

-- Chronologie : l'ordre d'achat généré (le contrat garde son libellé propre).
create or replace function public.documents_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dossier_id is null then
    return null;
  end if;
  if new.kind = 'contract' then
    perform public.add_dossier_event(new.dossier_id, 'contract_generated', 'Contrat généré (version ' || new.version || ')', true);
  elsif new.kind = 'purchase_order' then
    perform public.add_dossier_event(new.dossier_id, 'purchase_order_generated', 'Ordre d’achat généré (version ' || new.version || ')', true);
  else
    perform public.add_dossier_event(new.dossier_id, 'document_added', 'Document ajouté', new.visible_client);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptations : l'ordre d'achat s'ajoute au contrat (R15), avec les 4 confirmations de l'annexe B
-- ---------------------------------------------------------------------------
alter table public.acceptances add column acknowledgements jsonb;

comment on column public.acceptances.acknowledgements is
  'Ordre d’achat : confirmations cochées par le client (vehicle_info, import_age, binding_win, duties_excluded).';

create or replace function public.acceptances_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contract public.contracts%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
    new.recorded_at := now();
  end if;
  if new.decided_at > now() + interval '5 minutes' then
    raise exception 'La date de l’acceptation ne peut pas être dans le futur.' using errcode = '22023';
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
  elsif new.subject = 'purchase_order' then
    select * into v_po from public.purchase_orders po where po.id = new.subject_id for update;
    if not found then
      raise exception 'Ordre d’achat introuvable.' using errcode = '22023';
    end if;
    if v_po.status <> 'pending' then
      raise exception '%', case when v_po.status = 'draft'
        then 'Générez l’ordre d’achat avant d’enregistrer la décision du client.'
        else 'Une décision a déjà été enregistrée pour cet ordre d’achat.' end
        using errcode = '22023';
    end if;
    new.dossier_id := v_po.dossier_id;
    new.document_id := v_po.document_id;
    new.document_sha256 := v_po.document_sha256;
    if new.decision = 'accepted' and not (
      coalesce((new.acknowledgements ->> 'vehicle_info')::boolean, false)
      and coalesce((new.acknowledgements ->> 'import_age')::boolean, false)
      and coalesce((new.acknowledgements ->> 'binding_win')::boolean, false)
      and coalesce((new.acknowledgements ->> 'duties_excluded')::boolean, false)
    ) then
      raise exception 'Les 4 confirmations de l’ordre d’achat doivent être cochées par le client.' using errcode = '22023';
    end if;
  end if;

  if new.proof_document_id is not null and not exists (
    select 1 from public.documents doc
    where doc.id = new.proof_document_id and doc.dossier_id = new.dossier_id and doc.kind = 'acceptance_proof'
  ) then
    raise exception 'La preuve doit être un document « preuve d’acceptation » du même dossier.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.acceptances_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_method text := case new.method
    when 'scanned_paper' then 'papier signé scanné'
    when 'whatsapp' then 'WhatsApp'
    else 'portail client'
  end;
begin
  if new.subject = 'contract' then
    update public.contracts set status = new.decision, decided_at = new.decided_at where id = new.subject_id;
    if new.decision = 'accepted' then
      update public.dossiers set status = 'contract_signed'
        where id = new.dossier_id and stage = 'opening' and status in ('new', 'info_missing', 'validation_required');
    end if;
    perform public.add_dossier_event(
      new.dossier_id, 'acceptance_recorded',
      case when new.decision = 'accepted' then 'Contrat accepté (' else 'Contrat refusé (' end || v_method || ')', true
    );
  elsif new.subject = 'purchase_order' then
    perform set_config('app.po_decision', 'on', true);
    update public.purchase_orders
      set status = new.decision, decided_at = new.decided_at,
          ack_vehicle_info = coalesce((new.acknowledgements ->> 'vehicle_info')::boolean, false),
          ack_import_age = coalesce((new.acknowledgements ->> 'import_age')::boolean, false),
          ack_binding_win = coalesce((new.acknowledgements ->> 'binding_win')::boolean, false),
          ack_duties_excluded = coalesce((new.acknowledgements ->> 'duties_excluded')::boolean, false)
      where id = new.subject_id;
    perform set_config('app.po_decision', 'off', true);
    if new.decision = 'accepted' then
      update public.dossiers set status = 'purchase_order_signed'
        where id = new.dossier_id and stage = 'opening'
          and status in ('new', 'info_missing', 'contract_signed', 'validation_required');
    end if;
    perform public.add_dossier_event(
      new.dossier_id, 'acceptance_recorded',
      case when new.decision = 'accepted' then 'Ordre d’achat signé (' else 'Ordre d’achat refusé (' end || v_method || ')', true
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmations manuelles en attendant la phase 3 (hypothèse P1)
-- ---------------------------------------------------------------------------
create table public.dossier_confirmations (
  dossier_id uuid not null references public.dossiers (id),
  code text not null check (code in ('quote_accepted', 'payment1_received', 'balance_invoice_issued', 'balance_paid')),
  note text,
  confirmed_by uuid references public.profiles (id) default auth.uid(),
  confirmed_at timestamptz not null default now(),
  primary key (dossier_id, code)
);

comment on table public.dossier_confirmations is
  'Confirmations manuelles d’éléments financiers (P1), remplacées par des contrôles automatiques en phase 3.';

create trigger dossier_confirmations_immutable
  before update or delete on public.dossier_confirmations
  for each row execute function public.forbid_update_delete();

create function public.confirmation_label(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_code
    when 'quote_accepted' then 'Devis accepté par le client'
    when 'payment1_received' then 'Paiement 1 intégralement reçu'
    when 'balance_invoice_issued' then 'Facture de solde émise'
    when 'balance_paid' then 'Solde réglé'
    else p_code
  end;
$$;

create function public.dossier_confirmations_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.add_dossier_event(
    new.dossier_id, 'confirmation', 'Confirmé manuellement : ' || public.confirmation_label(new.code), false
  );
  return null;
end;
$$;

revoke execute on function public.dossier_confirmations_after_insert() from public, anon, authenticated;

create trigger dossier_confirmations_after_insert
  after insert on public.dossier_confirmations
  for each row execute function public.dossier_confirmations_after_insert();

-- ---------------------------------------------------------------------------
-- Résultat d'enchère (US-2.4, R4)
-- ---------------------------------------------------------------------------
create function public.record_auction_result(
  p_dossier_id uuid,
  p_result text,
  p_hammer_price_cents bigint default null,
  p_notified_at timestamptz default null,
  p_override_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_po public.purchase_orders%rowtype;
  v_due_hours int;
  v_over_max boolean;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  select * into v_po from public.purchase_orders po where po.dossier_id = p_dossier_id;
  if v_dossier.stage <> 'purchase' or v_po.status is distinct from 'accepted' then
    raise exception 'Le résultat d’enchère s’enregistre à l’étape Achat, une fois l’ordre d’achat signé.'
      using errcode = '22023';
  end if;
  if v_dossier.auction_result is not null then
    raise exception 'Le résultat de l’enchère est déjà enregistré.' using errcode = '22023';
  end if;
  if p_result not in ('won', 'lost') then
    raise exception 'Résultat inconnu.' using errcode = '22023';
  end if;

  perform set_config('app.auction_result', 'on', true);
  if p_result = 'lost' then
    perform set_config('app.stage_transition', 'on', true);   -- clôture du dossier
    update public.dossiers
      set auction_result = 'lost', stage = 'closing', status = 'cancelled', cancelled_reason = 'Lot non remporté'
      where id = p_dossier_id;
    perform public.add_dossier_event(p_dossier_id, 'auction_result', 'Lot non remporté : dossier clôturé (dépôt à restituer)', true);
    perform set_config('app.stage_transition', 'off', true);
  else
    if p_hammer_price_cents is null or p_hammer_price_cents <= 0 or p_notified_at is null then
      raise exception 'Saisissez le prix d’adjudication et la date de notification du lot remporté.' using errcode = '22023';
    end if;
    if p_notified_at > now() + interval '5 minutes' then
      raise exception 'La date de notification ne peut pas être dans le futur.' using errcode = '22023';
    end if;
    v_over_max := p_hammer_price_cents > v_po.max_bid_cents;
    if v_over_max and (public.current_role_app() is distinct from 'admin' or coalesce(length(trim(p_override_reason)), 0) < 5) then
      raise exception 'Prix supérieur à l’enchère maximale : validation de l’administrateur obligatoire, avec un motif.'
        using errcode = '42501';
    end if;
    v_due_hours := (public.setting_as_of('payment1.due_hours_after_win', v_dossier.params_as_of) #>> '{}')::int;
    update public.dossiers
      set auction_result = 'won', hammer_price_cents = p_hammer_price_cents, lot_won_notified_at = p_notified_at,
          payment1_due_at = p_notified_at + make_interval(hours => coalesce(v_due_hours, 0)),
          price_override_reason = case when v_over_max then p_override_reason end,
          price_override_by = case when v_over_max then auth.uid() end,
          status = 'won'
      where id = p_dossier_id;
    perform public.add_dossier_event(p_dossier_id, 'auction_result', 'Lot remporté', true);
    if v_over_max then
      perform public.log_audit('auction_price_override', 'dossiers', p_dossier_id::text,
        jsonb_build_object('max_bid_cents', v_po.max_bid_cents),
        jsonb_build_object('hammer_price_cents', p_hammer_price_cents), p_override_reason);
    end if;
  end if;
  perform set_config('app.auction_result', 'off', true);
end;
$$;

revoke execute on function public.record_auction_result(uuid, text, bigint, timestamptz, text) from public, anon;
grant execute on function public.record_auction_result(uuid, text, bigint, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conditions de passage d'étape (docs/13_workflow_statuts.md, R13)
-- Les conditions des étapes Conteneur, Maritime et Dakar arrivent avec le lot 2c.
-- ---------------------------------------------------------------------------
create function public.stage_conditions(p_dossier_id uuid)
returns table (code text, label text, met boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_client public.clients%rowtype;
  v_po public.purchase_orders%rowtype;
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
  elsif v_dossier.stage in ('container', 'ocean', 'dakar') then
    return query values ('defined_later', 'Conditions de cette étape : livrées avec le lot 2c (conteneurs et suivi)', false);
  end if;
end;
$$;

revoke execute on function public.stage_conditions(uuid) from public, anon;
grant execute on function public.stage_conditions(uuid) to authenticated;

-- Passage à l'étape suivante ; exception réservée à l'administrateur, avec motif journalisé (R13).
create function public.advance_stage(p_dossier_id uuid, p_override_reason text default null)
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

revoke execute on function public.advance_stage(uuid, text) from public, anon;
grant execute on function public.advance_stage(uuid, text) to authenticated;

-- Annulation (Ouverture ou Achat → Clôture), motif obligatoire.
create function public.cancel_dossier(p_dossier_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
begin
  if not public.is_operations_writer() then
    raise exception 'Action réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’annulation.' using errcode = '22023';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_dossier.stage not in ('opening', 'purchase') then
    raise exception 'Seul un dossier à l’étape Ouverture ou Achat peut être annulé.' using errcode = '22023';
  end if;
  perform set_config('app.stage_transition', 'on', true);
  update public.dossiers set stage = 'closing', status = 'cancelled', cancelled_reason = trim(p_reason) where id = p_dossier_id;
  perform set_config('app.stage_transition', 'off', true);
  perform public.add_dossier_event(p_dossier_id, 'cancelled', 'Dossier annulé : ' || trim(p_reason), true);
end;
$$;

revoke execute on function public.cancel_dossier(uuid, text) from public, anon;
grant execute on function public.cancel_dossier(uuid, text) to authenticated;

revoke execute on function public.purchase_orders_before_write() from public, anon, authenticated;
revoke execute on function public.stage_label(public.dossier_stage) from public, anon;
grant execute on function public.stage_label(public.dossier_stage) to authenticated;
revoke execute on function public.confirmation_label(text) from public, anon;
grant execute on function public.confirmation_label(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
create trigger purchase_orders_audit after insert or update on public.purchase_orders
  for each row execute function public.audit_row('id');
create trigger dossier_confirmations_audit after insert on public.dossier_confirmations
  for each row execute function public.audit_row('dossier_id,code');

alter table public.purchase_orders enable row level security;
alter table public.dossier_confirmations enable row level security;

-- Ordres d'achat : internes L ; admin et agent E ; un client lit les siens.
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (
    (select public.is_internal())
    or dossier_id in (select d.id from public.dossiers d where d.client_id = (select public.current_client_id()))
  );
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check ((select public.is_operations_writer()));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using ((select public.is_operations_writer()))
  with check ((select public.is_operations_writer()));

-- Acceptations : l'agent enregistre aussi la signature de l'ordre d'achat (scan ou WhatsApp).
-- (La politique acceptances_insert du lot 2a couvre déjà tous les sujets.)

-- Confirmations manuelles : internes L ; admin, agent et comptabilité E (paiement reçu).
create policy dossier_confirmations_select on public.dossier_confirmations for select to authenticated
  using ((select public.is_internal()));
create policy dossier_confirmations_insert on public.dossier_confirmations for insert to authenticated
  with check (
    (select public.current_role_app()) in ('admin', 'ops', 'accounting')
    and confirmed_by = (select auth.uid())
  );

revoke delete, truncate on public.purchase_orders, public.dossier_confirmations from anon, authenticated;
revoke update on public.dossier_confirmations from anon, authenticated;
revoke all on public.purchase_orders, public.dossier_confirmations from anon;
