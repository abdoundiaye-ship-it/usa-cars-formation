-- Phase 3, lot 3d — remise des documents et transfert de propriété (US-3.11, R9), contrôles financiers automatiques
-- des passages d'étape (fin de l'hypothèse P1), vue d'ensemble financière (écran Finances, tableau de bord).

-- ---------------------------------------------------------------------------
-- Transfert de propriété au paiement intégral (R9)
-- ---------------------------------------------------------------------------
alter table public.dossiers add column ownership_transferred_at timestamptz;

comment on column public.dossiers.ownership_transferred_at is
  'Paiement intégral (R9) : la propriété du véhicule est transférée au client ; renseigné par la base.';

create function public.dossiers_ownership_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ownership_transferred_at is distinct from old.ownership_transferred_at
     and coalesce(current_setting('app.ownership', true), '') <> 'on' then
    raise exception 'La date de transfert de propriété est fixée par le paiement intégral.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger dossiers_ownership_guard
  before update of ownership_transferred_at on public.dossiers
  for each row execute function public.dossiers_ownership_guard();

-- Statuts « payé » des factures et transfert de propriété (remplace la version du lot 3c).
create or replace function public.refresh_invoice_statuses(p_dossier_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_balance record;
  v_paid_at timestamptz;
begin
  select * into v_balance from public.dossier_balance(p_dossier_id);
  perform set_config('app.financial_document', 'on', true);
  update public.financial_documents
    set status = case when v_balance.payment1_remaining_cents = 0 then 'paid' else 'issued' end
    where dossier_id = p_dossier_id and doc_type = 'deposit_invoice' and status in ('issued', 'paid')
      and status is distinct from (case when v_balance.payment1_remaining_cents = 0 then 'paid' else 'issued' end);
  update public.financial_documents
    set status = case when v_balance.balance_remaining_cents <= 0 then 'paid' else 'issued' end
    where dossier_id = p_dossier_id and doc_type = 'balance_invoice' and status in ('issued', 'paid')
      and status is distinct from (case when v_balance.balance_remaining_cents <= 0 then 'paid' else 'issued' end);
  perform set_config('app.financial_document', 'off', true);

  -- R9 : paiement intégral (facture de solde émise et réglée) → transfert de propriété, une seule fois.
  if v_balance.has_accepted_quote and v_balance.balance_remaining_cents <= 0 and exists (
    select 1 from public.financial_documents f
    where f.dossier_id = p_dossier_id and f.doc_type = 'balance_invoice' and f.status = 'paid'
  ) and exists (
    select 1 from public.dossiers d where d.id = p_dossier_id and d.ownership_transferred_at is null
  ) then
    select max(p.credited_at) into v_paid_at
      from public.payments p where p.dossier_id = p_dossier_id and p.cancelled_at is null;
    perform set_config('app.ownership', 'on', true);
    update public.dossiers set ownership_transferred_at = coalesce(v_paid_at, now()) where id = p_dossier_id;
    perform set_config('app.ownership', 'off', true);
    perform public.add_dossier_event(
      p_dossier_id, 'payment_recorded',
      'Paiement intégral : la propriété du véhicule est transférée au client ; documents à remettre', true
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- US-3.11 : remise des documents (B/L, titre, factures) au client ou à son mandataire (R9, contrat art. 15)
-- ---------------------------------------------------------------------------
create table public.document_releases (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null unique references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  released_at timestamptz not null,
  beneficiary_kind text not null check (beneficiary_kind in ('client', 'representative')),
  beneficiary_name text not null check (length(trim(beneficiary_name)) > 1),
  id_document_type text not null check (id_document_type in ('national_id', 'passport', 'residence_permit', 'other')),
  id_document_number text not null check (length(trim(id_document_number)) > 1),
  power_of_attorney_document_id uuid references public.documents (id),
  discharge_document_id uuid not null references public.documents (id),
  notes text,
  recorded_by uuid references public.profiles (id) default auth.uid(),
  recorded_at timestamptz not null default now(),
  check (beneficiary_kind = 'client' or power_of_attorney_document_id is not null)
);

comment on table public.document_releases is
  'Remise des documents (R9) : bénéficiaire, pièce vérifiée, procuration si mandataire, décharge signée.';

create trigger document_releases_immutable
  before update or delete on public.document_releases
  for each row execute function public.forbid_update_delete();

create function public.record_document_release(
  p_dossier_id uuid, p_beneficiary_kind text, p_beneficiary_name text, p_id_document_type text,
  p_id_document_number text, p_discharge_document_id uuid, p_power_of_attorney_document_id uuid default null,
  p_released_at timestamptz default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_balance record;
  v_id uuid;
begin
  if not public.is_operations_writer() then
    raise exception 'Remise réservée à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  select * into v_balance from public.dossier_balance(p_dossier_id);
  -- R9 : remise impossible tant que le solde total du dossier n'est pas réglé.
  if not v_balance.has_accepted_quote or v_balance.balance_remaining_cents > 0 then
    raise exception 'Le solde du dossier n’est pas réglé : les documents ne peuvent pas être remis.' using errcode = '22023';
  end if;
  if exists (select 1 from public.document_releases r where r.dossier_id = p_dossier_id) then
    raise exception 'Les documents ont déjà été remis.' using errcode = '22023';
  end if;
  if p_beneficiary_kind = 'representative' and (p_power_of_attorney_document_id is null or not exists (
    select 1 from public.documents doc
    where doc.id = p_power_of_attorney_document_id and doc.dossier_id = p_dossier_id and doc.kind = 'power_of_attorney'
  )) then
    raise exception 'Mandataire : joignez la procuration signée du client.' using errcode = '22023';
  end if;
  if p_discharge_document_id is null or not exists (
    select 1 from public.documents doc
    where doc.id = p_discharge_document_id and doc.dossier_id = p_dossier_id and doc.kind = 'release_receipt'
  ) then
    raise exception 'Joignez la décharge signée par le bénéficiaire.' using errcode = '22023';
  end if;
  if coalesce(p_released_at, now()) > now() + interval '5 minutes' then
    raise exception 'La date de remise ne peut pas être dans le futur.' using errcode = '22023';
  end if;

  insert into public.document_releases (
    dossier_id, client_id, released_at, beneficiary_kind, beneficiary_name, id_document_type, id_document_number,
    power_of_attorney_document_id, discharge_document_id, notes
  ) values (
    p_dossier_id, v_dossier.client_id, coalesce(p_released_at, now()), p_beneficiary_kind, trim(p_beneficiary_name),
    p_id_document_type, trim(p_id_document_number), p_power_of_attorney_document_id, p_discharge_document_id,
    nullif(trim(p_notes), '')
  ) returning id into v_id;

  perform public.add_dossier_event(
    p_dossier_id, 'document_added',
    'Documents remis à ' || trim(p_beneficiary_name)
      || case when p_beneficiary_kind = 'representative' then ' (mandataire, procuration jointe)' else '' end,
    true
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conditions de passage d'étape : contrôles financiers automatiques (fin de l'hypothèse P1). Les confirmations
-- manuelles enregistrées en phase 2 restent valables pour les dossiers concernés ; on n'en crée plus.
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
  v_balance record;
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
  select * into v_balance from public.dossier_balance(p_dossier_id);

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
      ('quote_accepted', 'Devis accepté par le client, avec son choix d’assurance',
        v_balance.has_accepted_quote
        or exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'quote_accepted')),
      ('payment1_received', 'Paiement 1 intégralement reçu (facture d’acompte réglée)',
        exists (select 1 from public.financial_documents f
                where f.dossier_id = p_dossier_id and f.doc_type = 'deposit_invoice' and f.status = 'paid')
        or exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'payment1_received')),
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
      ('balance_invoice_issued', 'Facture de solde émise (choix d’assurance enregistré)',
        exists (select 1 from public.financial_documents f
                where f.dossier_id = p_dossier_id and f.doc_type = 'balance_invoice' and f.status in ('issued', 'paid'))
        or exists (select 1 from public.dossier_confirmations k
                   where k.dossier_id = p_dossier_id and k.code = 'balance_invoice_issued'));
  elsif v_dossier.stage = 'ocean' then
    return query values
      ('ata', 'ATA saisie sur le conteneur', v_container.ata is not null);
  elsif v_dossier.stage = 'dakar' then
    return query values
      ('balance_paid', 'Solde réglé (paiement intégral)',
        (v_balance.has_accepted_quote and v_balance.balance_remaining_cents <= 0)
        or exists (select 1 from public.dossier_confirmations k where k.dossier_id = p_dossier_id and k.code = 'balance_paid')),
      ('release_receipt', 'Documents remis (décharge signée archivée)',
        exists (select 1 from public.document_releases r where r.dossier_id = p_dossier_id)
        or exists (select 1 from public.documents doc where doc.dossier_id = p_dossier_id and doc.kind = 'release_receipt')),
      ('collected', 'Enlèvement enregistré (statut « Enlevé »)', v_dossier.status = 'collected');
  end if;
end;
$$;

-- Plus de nouvelles confirmations manuelles (P1) : les contrôles sont automatiques.
drop policy dossier_confirmations_insert on public.dossier_confirmations;
revoke insert on public.dossier_confirmations from authenticated;

-- ---------------------------------------------------------------------------
-- Vue d'ensemble financière (écran Finances, tableau de bord) — internes uniquement, aucun coût interne.
-- ---------------------------------------------------------------------------
create function public.finance_overview()
returns table (
  dossier_id uuid, reference text, client_name text, stage public.dossier_stage, dossier_status text,
  total_due_cents bigint, net_paid_cents bigint, payment1_remaining_cents bigint, balance_remaining_cents bigint,
  payment1_due_at timestamptz, balance_due_at timestamptz, has_accepted_quote boolean, quote_expired boolean,
  balance_invoice_issued boolean, proposed_late_fees int, pending_client_extra_costs int, open_refunds int,
  overdue_refunds int, ownership_transferred_at timestamptz, documents_released boolean, release_due_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours int := coalesce((public.setting_value('documents.release_business_hours') #>> '{}')::int, 48);
begin
  if not public.is_internal() then
    return;
  end if;
  return query
  select d.id, d.reference, c.name, d.stage, d.status,
    b.total_due_cents, b.net_paid_cents, b.payment1_remaining_cents, b.balance_remaining_cents,
    coalesce(fa.due_at, d.payment1_due_at), fs.due_at, b.has_accepted_quote,
    -- Devis expiré sans devis en cours ni accepté : un nouveau devis est à émettre.
    exists (select 1 from public.financial_documents q where q.dossier_id = d.id and q.doc_type = 'quote'
            and (q.status = 'expired' or (q.status = 'issued' and q.valid_until <= now())))
      and not exists (select 1 from public.financial_documents q where q.dossier_id = d.id and q.doc_type = 'quote'
                      and (q.status = 'accepted' or (q.status = 'issued' and q.valid_until > now()))),
    fs.id is not null,
    (select count(*)::int from public.adjustments a where a.dossier_id = d.id and a.status = 'proposed'),
    (select count(*)::int from public.adjustments a where a.dossier_id = d.id and a.status = 'pending_client_approval'),
    (select count(*)::int from public.refunds r where r.dossier_id = d.id and r.status in ('requested', 'approved')),
    (select count(*)::int from public.refunds r
       where r.dossier_id = d.id and r.status in ('requested', 'approved') and r.due_by < now()),
    d.ownership_transferred_at,
    exists (select 1 from public.document_releases r where r.dossier_id = d.id),
    case when d.ownership_transferred_at is not null
      then public.add_business_days(d.ownership_transferred_at, ceil(v_hours / 24.0)::int) end
  from public.dossiers d
  join public.clients c on c.id = d.client_id
  cross join lateral public.dossier_balance(d.id) b
  left join lateral (select f.due_at from public.financial_documents f
                     where f.dossier_id = d.id and f.doc_type = 'deposit_invoice' and f.status <> 'cancelled') fa on true
  left join lateral (select f.id, f.due_at from public.financial_documents f
                     where f.dossier_id = d.id and f.doc_type = 'balance_invoice' and f.status <> 'cancelled') fs on true
  where d.status <> 'cancelled' or exists (
    select 1 from public.refunds r where r.dossier_id = d.id and r.status in ('requested', 'approved')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
create trigger document_releases_audit after insert on public.document_releases
  for each row execute function public.audit_row('id');

alter table public.document_releases enable row level security;

-- Internes L ; le client voit la remise de ses documents. Écriture : fonction record_document_release.
create policy document_releases_select on public.document_releases for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));

revoke all on public.document_releases from anon;
revoke insert, update, delete, truncate on public.document_releases from authenticated;

revoke execute on function public.dossiers_ownership_guard() from public, anon, authenticated;
revoke execute on function public.record_document_release(uuid, text, text, text, text, uuid, uuid, timestamptz, text)
  from public, anon;
revoke execute on function public.finance_overview() from public, anon;
grant execute on function public.record_document_release(uuid, text, text, text, text, uuid, uuid, timestamptz, text)
  to authenticated;
grant execute on function public.finance_overview() to authenticated;
