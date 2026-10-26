-- Phase 3, lot 3c — paiements (US-3.6, R6), facture de solde (US-3.7, R4), frais de retard (US-3.8, R5, C5),
-- frais supplémentaires (US-3.9, R7), remboursement du trop-perçu (US-3.12, R6, C6, C9), reçus RC et notes RB (C7).
-- CLAUDE.md règles 1 (centimes entiers), 2 (aucun coût interne), 4 (paramètres), 5 (audit), 12 (trop-perçu restitué).

-- ---------------------------------------------------------------------------
-- Documents financiers : facture de solde, reçu espèces, note de remboursement
-- ---------------------------------------------------------------------------
alter table public.financial_documents
  add column adjustments_cents bigint not null default 0,          -- facture de solde : total des lignes D
  add column reference_eta date,                                    -- facture de solde : ETA figée à l'émission (R4)
  add column payment_id uuid references public.payments (id),      -- reçu espèces
  add column refund_id uuid,                                        -- note de remboursement (clé ajoutée plus bas)
  add constraint financial_documents_balance_check check (
    doc_type <> 'balance_invoice'
    or (forfait_b_cents is not null and quote_id is not null and due_at is not null and reference_eta is not null)
  ),
  add constraint financial_documents_receipt_check check (doc_type <> 'cash_receipt' or payment_id is not null),
  add constraint financial_documents_refund_check check (doc_type <> 'refund_note' or refund_id is not null);

comment on column public.financial_documents.deposit_applied_cents is
  'FA : dépôts imputés ; FS : paiements déjà imputés sur le solde à l’émission.';

create unique index financial_documents_one_balance_invoice on public.financial_documents (dossier_id)
  where doc_type = 'balance_invoice' and status <> 'cancelled';

-- Valeurs figées ; l'échéance d'une facture de solde peut seulement être avancée si l'ETA l'est (R4).
create or replace function public.financial_documents_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mutable text[] := array[
    'status', 'decided_at', 'insurance_choice', 'document_id', 'document_sha256', 'template_version',
    'cancelled_reason', 'cancelled_at', 'cancelled_by', 'updated_at'
  ];
begin
  if coalesce(current_setting('app.financial_document', true), '') <> 'on' then
    raise exception 'Un document financier émis ne se modifie pas : annulez-le et émettez-en un nouveau.'
      using errcode = '42501';
  end if;
  if old.doc_type = 'balance_invoice' then
    v_mutable := v_mutable || 'due_at'::text;
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Les montants et références d’un document émis sont figés.' using errcode = '42501';
  end if;
  if old.document_id is not null and new.document_id is distinct from old.document_id then
    raise exception 'Le fichier de ce document est déjà généré.' using errcode = '42501';
  end if;
  if old.status = 'cancelled' then
    raise exception 'Ce document est annulé.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter table public.payments add column receipt_id uuid references public.financial_documents (id);

-- ---------------------------------------------------------------------------
-- Ajustements — ligne D (R2) : frais supplémentaires (R7), frais de retard (R5), remises
-- ---------------------------------------------------------------------------
create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  kind text not null check (kind in ('extra_cost', 'late_fee', 'discount')),
  label text not null check (length(trim(label)) > 1),
  section text check (section in ('A', 'B')),                       -- forfait concerné (seuil R7)
  amount_cents bigint not null,                                     -- négatif pour une remise
  status text not null check (status in ('proposed', 'pending_client_approval', 'approved', 'rejected', 'cancelled')),
  urgent boolean not null default false,
  reason text,
  proof_document_id uuid references public.documents (id),
  late_fee_target text check (late_fee_target in ('payment1', 'balance')),
  late_fee_period int check (late_fee_period >= 1),
  financial_document_id uuid references public.financial_documents (id),   -- facture de solde qui l'a reprise
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  decision_note text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check ((kind = 'discount' and amount_cents < 0) or (kind <> 'discount' and amount_cents > 0)),
  check (kind <> 'extra_cost' or (proof_document_id is not null and section is not null)),
  check (kind <> 'late_fee' or (late_fee_target is not null and late_fee_period is not null)),
  check (not urgent or length(trim(coalesce(reason, ''))) >= 5)
);

comment on table public.adjustments is
  'Lignes D du devis révisé : frais supplémentaires justifiés (R7), frais de retard (R5, C5), remises.';

create index adjustments_dossier_idx on public.adjustments (dossier_id, created_at);
-- Une ligne par période de retard et par échéance : un frais refusé n'est jamais reproposé.
create unique index adjustments_late_fee_period_idx on public.adjustments (dossier_id, late_fee_target, late_fee_period)
  where kind = 'late_fee';

create function public.adjustments_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mutable text[] := array['status', 'financial_document_id', 'decided_at', 'decided_by', 'decision_note'];
begin
  if coalesce(current_setting('app.adjustment', true), '') <> 'on'
     or (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Une ligne D se décide ou s’annule par les actions dédiées.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger adjustments_before_update
  before update on public.adjustments
  for each row execute function public.adjustments_before_update();

create trigger adjustments_no_delete
  before delete on public.adjustments
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Remboursements du trop-perçu (R6, C6, C9) : demande automatique, validation par un administrateur, exécution
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  reason text not null check (reason in ('overpayment', 'deposit_excess', 'lot_not_won', 'cancellation')),
  amount_cents bigint not null check (amount_cents > 0),
  mode text not null check (mode in ('bank_transfer', 'wave', 'orange_money', 'cash')),   -- moyen d'origine (C9)
  beneficiary text not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'rejected')),
  requested_at timestamptz not null default now(),
  requested_by uuid references public.profiles (id) default auth.uid(),
  due_by timestamptz not null,                                      -- {refund.business_days} jours ouvrés (C9)
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  rejection_reason text,
  paid_at timestamptz,
  payment_reference text,
  proof_document_id uuid references public.documents (id),
  fx_rate numeric(12, 4),                                           -- taux du jour de l'exécution (équivalent FCFA)
  refund_note_id uuid references public.financial_documents (id),   -- RB-AAAA-####
  check (status <> 'paid' or (paid_at is not null and payment_reference is not null and proof_document_id is not null)),
  check (status <> 'rejected' or rejection_reason is not null)
);

comment on table public.refunds is 'Trop-perçu restitué au client (C6) : jamais conservé comme avoir (CLAUDE.md règle 12).';

create index refunds_dossier_idx on public.refunds (dossier_id, requested_at);

alter table public.financial_documents
  add constraint financial_documents_refund_fk foreign key (refund_id) references public.refunds (id);

create function public.refunds_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.refund', true), '') <> 'on'
     or new.amount_cents <> old.amount_cents or new.dossier_id <> old.dossier_id or new.reason <> old.reason then
    raise exception 'Un remboursement se valide ou s’exécute par les actions dédiées.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger refunds_before_update
  before update on public.refunds
  for each row execute function public.refunds_before_update();

create trigger refunds_no_delete
  before delete on public.refunds
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Événements de la chronologie
-- ---------------------------------------------------------------------------
alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note',
  'container_assigned', 'container_changed', 'eta_changed', 'tracking_event',
  'financial_document', 'payment_recorded', 'adjustment', 'refund'
));

-- ---------------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------------
-- Ajoute n jours ouvrés (lundi à vendredi ; jours fériés non gérés).
create function public.add_business_days(p_from timestamptz, p_days int) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare
  v_at timestamptz := p_from;
  v_left int := greatest(p_days, 0);
begin
  while v_left > 0 loop
    v_at := v_at + interval '1 day';
    if extract(isodow from v_at at time zone 'Africa/Dakar') < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_at;
end;
$$;

-- Situation financière d'un dossier (R2, R4, R6). Lignes : A (+ TVA) exigible au paiement 1 ; B, C si acceptée,
-- D approuvées (+ TVA) au solde. Les paiements s'imputent d'abord sur le paiement 1, puis sur le solde.
create function public.dossier_balance(p_dossier_id uuid)
returns table (
  a_total_cents bigint, total_due_cents bigint, paid_cents bigint, refunded_cents bigint, net_paid_cents bigint,
  payment1_remaining_cents bigint, balance_remaining_cents bigint, pending_refunds_cents bigint,
  adjustments_cents bigint, has_accepted_quote boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_quote public.financial_documents%rowtype;
  v_a bigint := 0;
  v_rest bigint := 0;
  v_d bigint;
  v_paid bigint;
  v_refunded bigint;
  v_pending bigint;
begin
  if auth.uid() is not null and not public.is_internal() and not exists (
    select 1 from public.dossiers d where d.id = p_dossier_id and d.client_id = public.current_client_id()
  ) then
    raise exception 'Dossier introuvable.' using errcode = '42501';
  end if;
  select * into v_quote from public.financial_documents
    where dossier_id = p_dossier_id and doc_type = 'quote' and status = 'accepted';
  select coalesce(sum(a.amount_cents), 0) into v_d
    from public.adjustments a where a.dossier_id = p_dossier_id and a.status = 'approved';
  if v_quote.id is not null then
    v_a := v_quote.forfait_a_cents + round(v_quote.forfait_a_cents * v_quote.vat_rate_percent / 100)::bigint;
    v_rest := v_quote.forfait_b_cents + v_d + round((v_quote.forfait_b_cents + v_d) * v_quote.vat_rate_percent / 100)::bigint;
    if v_quote.insurance_choice = 'accepted' then
      v_rest := v_rest + v_quote.insurance_premium_cents + v_quote.insurance_vat_cents;
    end if;
  end if;
  select coalesce(sum(p.amount_cents), 0) into v_paid
    from public.payments p where p.dossier_id = p_dossier_id and p.cancelled_at is null;
  select coalesce(sum(r.amount_cents) filter (where r.status = 'paid'), 0),
         coalesce(sum(r.amount_cents) filter (where r.status in ('requested', 'approved')), 0)
    into v_refunded, v_pending
    from public.refunds r where r.dossier_id = p_dossier_id;
  return query select
    v_a, v_a + v_rest, v_paid, v_refunded, v_paid - v_refunded,
    greatest(v_a - (v_paid - v_refunded), 0)::bigint,
    (v_a + v_rest) - (v_paid - v_refunded),
    v_pending, v_d, v_quote.id is not null;
end;
$$;

-- Statuts « payé » des factures selon la situation (après un paiement, une annulation ou un remboursement).
create function public.refresh_invoice_statuses(p_dossier_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_balance record;
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
end;
$$;

-- Demande de remboursement (R6) : montant, moyen d'origine, bénéficiaire, échéance en jours ouvrés (C9).
create function public.request_refund(p_dossier_id uuid, p_reason text, p_amount_cents bigint, p_mode text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_days int;
  v_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return null;
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  v_days := coalesce((public.setting_value('refund.business_days') #>> '{}')::int, 5);
  insert into public.refunds (dossier_id, client_id, reason, amount_cents, mode, beneficiary, due_by)
  select p_dossier_id, v_dossier.client_id, p_reason, p_amount_cents, coalesce(p_mode, 'bank_transfer'), c.name,
         public.add_business_days(now(), v_days)
  from public.clients c where c.id = v_dossier.client_id
  returning id into v_id;
  perform public.add_dossier_event(
    p_dossier_id, 'refund',
    'Remboursement de ' || public.format_usd_fr(p_amount_cents) || ' à valider ('
      || case p_reason when 'overpayment' then 'trop-perçu' when 'deposit_excess' then 'excédent de dépôt'
           when 'lot_not_won' then 'lot non remporté' else 'annulation' end || ')',
    true
  );
  return v_id;
end;
$$;

-- Trop-perçu non encore couvert par une demande de remboursement → nouvelle demande (CLAUDE.md règle 12).
create function public.request_overpayment_refund(p_dossier_id uuid, p_mode text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_balance record;
  v_excess bigint;
begin
  select * into v_balance from public.dossier_balance(p_dossier_id);
  if not v_balance.has_accepted_quote then
    return null;
  end if;
  v_excess := v_balance.net_paid_cents - v_balance.total_due_cents - v_balance.pending_refunds_cents;
  if v_excess <= 0 then
    return null;
  end if;
  return public.request_refund(p_dossier_id, 'overpayment', v_excess, p_mode);
end;
$$;

-- Excédent de dépôt constaté à la facture d'acompte (I2) → demande de remboursement.
create function public.financial_documents_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
begin
  if new.doc_type = 'deposit_invoice' and new.deposit_excess_cents > 0 then
    select p.mode into v_mode from public.payments p
      where p.dossier_id = new.dossier_id and p.purpose = 'deposit' and p.cancelled_at is null
      order by p.credited_at desc limit 1;
    perform public.request_refund(new.dossier_id, 'deposit_excess', new.deposit_excess_cents, v_mode);
  end if;
  return null;
end;
$$;

create trigger financial_documents_after_insert
  after insert on public.financial_documents
  for each row execute function public.financial_documents_after_insert();

-- Lot non remporté (I2) : dépôts intégralement restitués.
create function public.dossiers_after_auction_lost() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
  v_mode text;
begin
  select coalesce(sum(p.amount_cents), 0), max(p.mode) into v_total, v_mode
    from public.payments p where p.dossier_id = new.id and p.purpose = 'deposit' and p.cancelled_at is null;
  perform public.request_refund(new.id, 'lot_not_won', v_total, v_mode);
  return null;
end;
$$;

create trigger dossiers_after_auction_lost
  after update of auction_result on public.dossiers
  for each row when (new.auction_result = 'lost' and old.auction_result is distinct from 'lost')
  execute function public.dossiers_after_auction_lost();

-- ---------------------------------------------------------------------------
-- US-3.6 : paiement 1 et solde (après la facture d'acompte) ; reçu RC pour les espèces (C7)
-- ---------------------------------------------------------------------------
create function public.record_payment(
  p_dossier_id uuid, p_paid_currency text, p_amount_cents bigint, p_amount_xof bigint, p_mode text,
  p_official_account_id uuid, p_reference text, p_credited_at timestamptz, p_proof_document_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_account public.official_accounts%rowtype;
  v_account_kind text;
  v_rate record;
  v_same_day boolean;
  v_cents bigint;
  v_before record;
  v_after record;
  v_purpose text;
  v_id uuid;
  v_receipt uuid;
begin
  if not public.is_finance_writer() then
    raise exception 'Enregistrement réservé à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_dossier.status = 'cancelled' then
    raise exception 'Le dossier est annulé.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.financial_documents
                 where dossier_id = p_dossier_id and doc_type = 'deposit_invoice' and status in ('issued', 'paid')) then
    raise exception 'Émettez d’abord la facture d’acompte ; avant elle, un versement s’enregistre comme dépôt.'
      using errcode = '22023';
  end if;
  if p_credited_at is null or p_credited_at > now() + interval '5 minutes' then
    raise exception 'La date de crédit ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  if p_mode not in ('bank_transfer', 'wave', 'orange_money', 'cash') then
    raise exception 'Mode de paiement inconnu.' using errcode = '22023';
  end if;
  if p_mode <> 'cash' and p_proof_document_id is null then
    raise exception 'Joignez le justificatif du paiement (un reçu est généré pour les espèces).' using errcode = '22023';
  end if;
  v_account_kind := replace(replace(p_mode, 'bank_transfer', 'bank'), 'cash', 'cash_office');
  if p_official_account_id is not null then
    select * into v_account from public.official_accounts a where a.id = p_official_account_id;
    if not found or v_account.status <> 'active' or v_account.kind <> v_account_kind then
      raise exception 'Choisissez un compte officiel actif correspondant au mode de paiement.' using errcode = '22023';
    end if;
  elsif p_mode <> 'cash' then
    raise exception 'Indiquez le compte officiel crédité.' using errcode = '22023';
  end if;
  if p_proof_document_id is not null and not exists (
    select 1 from public.documents doc
    where doc.id = p_proof_document_id and doc.dossier_id = p_dossier_id and doc.kind = 'payment_proof'
  ) then
    raise exception 'Le justificatif doit être un document « preuve de paiement » du même dossier.' using errcode = '22023';
  end if;

  select * into v_rate from public.fx_rate_as_of(p_credited_at);
  v_same_day := public.fx_rate_exists_on((p_credited_at at time zone 'Africa/Dakar')::date);
  if p_paid_currency = 'XOF' then
    if p_amount_xof is null or p_amount_xof <= 0 then
      raise exception 'Saisissez le montant reçu en FCFA.' using errcode = '22023';
    end if;
    if not v_same_day then
      raise exception 'Aucun taux relevé le jour du paiement : relevez-le (Finances) pour convertir le montant en FCFA.'
        using errcode = '22023';
    end if;
    v_cents := round(p_amount_xof * 100 / v_rate.rate)::bigint;
  elsif p_paid_currency = 'USD' then
    if p_amount_cents is null or p_amount_cents <= 0 then
      raise exception 'Saisissez le montant reçu en dollars.' using errcode = '22023';
    end if;
    v_cents := p_amount_cents;
  else
    raise exception 'Devise inconnue.' using errcode = '22023';
  end if;

  -- R6 : imputation d'abord sur le paiement 1, puis sur le solde.
  select * into v_before from public.dossier_balance(p_dossier_id);
  v_purpose := case when v_before.payment1_remaining_cents > 0 then 'payment1' else 'balance' end;

  insert into public.payments (
    dossier_id, client_id, purpose, amount_cents, paid_currency, amount_xof, fx_rate_id, fx_rate, fx_captured_at,
    fx_rate_same_day, mode, official_account_id, reference, credited_at, proof_document_id, notes
  ) values (
    p_dossier_id, v_dossier.client_id, v_purpose, v_cents, p_paid_currency,
    case when p_paid_currency = 'XOF' then p_amount_xof end, v_rate.id, v_rate.rate, v_rate.captured_at,
    v_same_day, p_mode, p_official_account_id, trim(p_reference), p_credited_at, p_proof_document_id,
    nullif(trim(p_notes), '')
  ) returning id into v_id;

  -- Reçu espèces RC (C7) : numéroté et figé comme les autres documents financiers.
  if p_mode = 'cash' then
    if v_rate.id is null then
      raise exception 'Aucun taux de change enregistré : relevez le taux du jour (Finances).' using errcode = '22023';
    end if;
    insert into public.financial_documents (
      dossier_id, client_id, doc_type, number, payment_id, total_cents, amount_due_cents,
      fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, issued_by
    ) values (
      p_dossier_id, v_dossier.client_id, 'cash_receipt', public.next_number('cash_receipt'), v_id, v_cents, 0,
      v_rate.id, v_rate.rate, v_rate.source, v_rate.captured_at, v_rate.rate, v_rate.captured_at, auth.uid()
    ) returning id into v_receipt;
    perform set_config('app.payment', 'on', true);
    update public.payments set receipt_id = v_receipt where id = v_id;
    perform set_config('app.payment', 'off', true);
  end if;

  perform public.add_dossier_event(
    p_dossier_id, 'payment_recorded',
    'Paiement reçu : ' || public.format_usd_fr(v_cents)
      || case when v_purpose = 'payment1' then ' (paiement 1)' else ' (solde)' end,
    true
  );
  perform public.refresh_invoice_statuses(p_dossier_id);
  select * into v_after from public.dossier_balance(p_dossier_id);
  if v_before.payment1_remaining_cents > 0 and v_after.payment1_remaining_cents = 0 then
    perform public.add_dossier_event(
      p_dossier_id, 'payment_recorded', 'Paiement 1 soldé : le statut « Confirmé » peut être appliqué', false
    );
  end if;
  perform public.request_overpayment_refund(p_dossier_id, p_mode);
  return v_id;
end;
$$;

-- Le payment_id d'un reçu est posé une fois ; le paiement lui-même reste figé.
create or replace function public.payments_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mutable text[] := array['cancelled_reason', 'cancelled_at', 'cancelled_by', 'receipt_id'];
begin
  if coalesce(current_setting('app.payment', true), '') <> 'on'
     or (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or old.cancelled_at is not null
     or (old.receipt_id is not null and new.receipt_id is distinct from old.receipt_id) then
    raise exception 'Un paiement enregistré ne se modifie pas : annulez-le (motif) puis saisissez-le à nouveau.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
begin
  if not public.is_finance_writer() then
    raise exception 'Annulation réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’annulation (5 caractères au moins).' using errcode = '22023';
  end if;
  if v_payment.purpose = 'deposit' and exists (
    select 1 from public.financial_documents
    where dossier_id = v_payment.dossier_id and doc_type = 'deposit_invoice' and status <> 'cancelled'
  ) then
    raise exception 'Ce dépôt est imputé sur la facture d’acompte : annulez d’abord la facture.' using errcode = '22023';
  end if;
  if exists (select 1 from public.refunds r where r.dossier_id = v_payment.dossier_id and r.status = 'paid') then
    raise exception 'Un remboursement a déjà été exécuté sur ce dossier : corrigez par un nouvel enregistrement.'
      using errcode = '22023';
  end if;
  perform set_config('app.payment', 'on', true);
  update public.payments
    set cancelled_reason = trim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_payment_id;
  perform set_config('app.payment', 'off', true);
  if v_payment.receipt_id is not null then
    perform set_config('app.financial_document', 'on', true);
    update public.financial_documents
      set status = 'cancelled', cancelled_reason = 'Paiement annulé : ' || trim(p_reason), cancelled_at = now(),
          cancelled_by = auth.uid()
      where id = v_payment.receipt_id;
    perform set_config('app.financial_document', 'off', true);
  end if;
  -- Les demandes de trop-perçu encore en attente sont refusées : elles seront recalculées au prochain paiement.
  perform set_config('app.refund', 'on', true);
  update public.refunds
    set status = 'rejected', rejection_reason = 'Paiement annulé : trop-perçu à recalculer'
    where dossier_id = v_payment.dossier_id and reason = 'overpayment' and status in ('requested', 'approved');
  perform set_config('app.refund', 'off', true);
  perform public.refresh_invoice_statuses(v_payment.dossier_id);
  perform public.add_dossier_event(
    v_payment.dossier_id, 'payment_recorded',
    'Paiement de ' || public.format_usd_fr(v_payment.amount_cents) || ' annulé (erreur de saisie) : ' || trim(p_reason),
    false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- US-3.7 : facture de solde FS = B + C (si acceptée) + D approuvées (+ TVA) ; ETA de référence figée (R4)
-- ---------------------------------------------------------------------------
create function public.issue_balance_invoice(p_dossier_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_quote public.financial_documents%rowtype;
  v_container public.containers%rowtype;
  v_balance record;
  v_rate record;
  v_hours int;
  v_min_notice int;
  v_due timestamptz;
  v_d bigint;
  v_vat bigint;
  v_insurance bigint := 0;
  v_insurance_vat bigint := 0;
  v_total bigint;
  v_already bigint;
  v_number text;
  v_id uuid;
begin
  if not public.is_finance_writer() then
    raise exception 'Facturation réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_dossier.status = 'cancelled' then
    raise exception 'Le dossier est annulé.' using errcode = '22023';
  end if;
  select * into v_quote from public.financial_documents
    where dossier_id = p_dossier_id and doc_type = 'quote' and status = 'accepted';
  if not found then
    raise exception 'La facture de solde suit l’acceptation du devis.' using errcode = '22023';
  end if;
  if v_quote.insurance_choice = 'pending' then
    raise exception 'Le choix d’assurance du client est en attente : il est obligatoire avant la facture de solde.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.financial_documents
             where dossier_id = p_dossier_id and doc_type = 'balance_invoice' and status <> 'cancelled') then
    raise exception 'Une facture de solde est déjà émise pour ce dossier.' using errcode = '22023';
  end if;
  select c.* into v_container from public.containers c where c.id = public.active_container_id(p_dossier_id);
  if v_container.id is null or v_container.eta is null or v_container.bl_number is null then
    raise exception 'La facture de solde s’émet après l’embarquement : conteneur affecté, avec son B/L et son ETA.'
      using errcode = '22023';
  end if;

  v_hours := (public.setting_as_of('balance.due_hours_before_eta', v_dossier.params_as_of) #>> '{}')::int;
  v_min_notice := (public.setting_as_of('balance.min_hours_after_eta_advance_notice', v_dossier.params_as_of) #>> '{}')::int;
  v_due := (v_container.eta::timestamp at time zone 'UTC') - make_interval(hours => coalesce(v_hours, 0));
  -- ETA déjà proche ou passée : préavis minimal (même règle qu'une ETA avancée, R4).
  if v_due < now() then
    v_due := now() + make_interval(hours => coalesce(v_min_notice, 0));
  end if;

  select coalesce(sum(a.amount_cents), 0) into v_d
    from public.adjustments a where a.dossier_id = p_dossier_id and a.status = 'approved';
  v_vat := round((v_quote.forfait_b_cents + v_d) * v_quote.vat_rate_percent / 100)::bigint;
  if v_quote.insurance_choice = 'accepted' then
    v_insurance := v_quote.insurance_premium_cents;
    v_insurance_vat := v_quote.insurance_vat_cents;
  end if;
  v_total := v_quote.forfait_b_cents + v_d + v_vat + v_insurance + v_insurance_vat;
  select * into v_balance from public.dossier_balance(p_dossier_id);
  v_already := least(greatest(v_balance.net_paid_cents - v_balance.a_total_cents, 0), v_total);
  select * into v_rate from public.fx_rate_as_of(now());
  v_number := public.next_number('balance_invoice');

  insert into public.financial_documents (
    dossier_id, client_id, doc_type, number, quote_id, forfait_b_cents, insurance_premium_cents, insurance_choice,
    vat_rate_percent, vat_cents, insurance_vat_cents, adjustments_cents, total_cents, deposit_applied_cents,
    amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at,
    due_at, reference_eta, issued_by
  ) values (
    p_dossier_id, v_dossier.client_id, 'balance_invoice', v_number, v_quote.id, v_quote.forfait_b_cents,
    v_insurance, v_quote.insurance_choice, v_quote.vat_rate_percent, v_vat, v_insurance_vat, v_d, v_total, v_already,
    v_total - v_already, v_quote.fx_rate_id, v_quote.fx_rate, v_quote.fx_source, v_quote.fx_captured_at,
    coalesce(v_rate.rate, v_quote.fx_rate), coalesce(v_rate.captured_at, v_quote.fx_captured_at), v_due,
    v_container.eta, auth.uid()
  ) returning id into v_id;

  perform set_config('app.adjustment', 'on', true);
  update public.adjustments set financial_document_id = v_id
    where dossier_id = p_dossier_id and status = 'approved' and financial_document_id is null;
  perform set_config('app.adjustment', 'off', true);
  perform public.refresh_invoice_statuses(p_dossier_id);
  perform public.add_dossier_event(
    p_dossier_id, 'financial_document',
    'Facture de solde ' || v_number || ' émise : ' || public.format_usd_fr(v_total - v_already)
      || ' à régler avant le ' || public.format_datetime_fr(v_due)
      || ' (ETA de référence ' || public.format_date_fr(v_container.eta) || ', indicative)',
    true
  );
  return v_id;
end;
$$;

-- R4 : ETA avancée après la facture de solde → échéance = max(nouvelle ETA − délai, maintenant + préavis), jamais
-- repoussée ; ETA retardée : échéance inchangée.
create function public.containers_after_eta_advance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice record;
  v_hours int;
  v_notice int;
  v_due timestamptz;
begin
  for v_invoice in
    select f.id, f.dossier_id, f.due_at, d.params_as_of
    from public.financial_documents f
    join public.dossiers d on d.id = f.dossier_id
    where f.doc_type = 'balance_invoice' and f.status = 'issued'
      and public.active_container_id(f.dossier_id) = new.id
  loop
    v_hours := (public.setting_as_of('balance.due_hours_before_eta', v_invoice.params_as_of) #>> '{}')::int;
    v_notice := (public.setting_as_of('balance.min_hours_after_eta_advance_notice', v_invoice.params_as_of) #>> '{}')::int;
    v_due := greatest(
      (new.eta::timestamp at time zone 'UTC') - make_interval(hours => coalesce(v_hours, 0)),
      now() + make_interval(hours => coalesce(v_notice, 0))
    );
    if v_due < v_invoice.due_at then
      perform set_config('app.financial_document', 'on', true);
      update public.financial_documents set due_at = v_due where id = v_invoice.id;
      perform set_config('app.financial_document', 'off', true);
      perform public.add_dossier_event(
        v_invoice.dossier_id, 'financial_document',
        'ETA avancée au ' || public.format_date_fr(new.eta) || ' (indicative) : échéance du solde avancée au '
          || public.format_datetime_fr(v_due),
        true
      );
    end if;
  end loop;
  return null;
end;
$$;

create trigger containers_after_eta_advance
  after update of eta on public.containers
  for each row when (new.eta < old.eta)
  execute function public.containers_after_eta_advance();

-- ---------------------------------------------------------------------------
-- US-3.8 : frais de retard proposés chaque jour (R5), ajoutés après validation de la comptabilité (C5)
-- ---------------------------------------------------------------------------
create function public.propose_late_fees() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_amount bigint;
  v_period_days int;
  v_cap bigint;
  v_periods int;
  v_fee bigint;
  v_count int := 0;
  v_inserted int;
begin
  if auth.uid() is not null and not public.is_finance_writer() then
    raise exception 'Action réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  for v_row in
    -- Échéances dépassées et non soldées : paiement 1 (facture d'acompte) et solde (facture de solde).
    select f.dossier_id, f.client_id, f.due_at, d.params_as_of,
           case f.doc_type when 'deposit_invoice' then 'payment1' else 'balance' end as target,
           case f.doc_type when 'deposit_invoice' then b.payment1_remaining_cents else b.balance_remaining_cents end
             as remaining
    from public.financial_documents f
    join public.dossiers d on d.id = f.dossier_id
    cross join lateral public.dossier_balance(f.dossier_id) b
    where f.doc_type in ('deposit_invoice', 'balance_invoice') and f.status = 'issued' and f.due_at < now()
      and d.status <> 'cancelled'
  loop
    if v_row.remaining <= 0 then
      continue;
    end if;
    v_amount := (public.setting_as_of('late_fee.amount_usd', v_row.params_as_of) #>> '{}')::bigint;
    v_period_days := (public.setting_as_of('late_fee.period_days', v_row.params_as_of) #>> '{}')::int;
    v_cap := (public.setting_value('late_fee.cap_usd') #>> '{}')::bigint;
    if v_amount is null or v_period_days is null or v_period_days <= 0 then
      continue;
    end if;
    -- périodes = ⌈jours de retard commencés / période⌉ (lib/rules/late-fees.ts).
    v_periods := ceil(ceil(extract(epoch from now() - v_row.due_at) / 86400) / v_period_days)::int;
    for p in 1..v_periods loop
      v_fee := v_amount;
      if v_cap is not null then
        v_fee := least(v_amount, v_cap - (p - 1) * v_amount);
      end if;
      exit when v_fee <= 0;
      insert into public.adjustments (
        dossier_id, client_id, kind, label, amount_cents, status, late_fee_target, late_fee_period, created_by
      ) values (
        v_row.dossier_id, v_row.client_id, 'late_fee',
        'Frais de retard — ' || case when v_row.target = 'payment1' then 'paiement 1' else 'solde' end
          || ', période ' || p || ' (échéance du ' || public.format_datetime_fr(v_row.due_at) || ')',
        v_fee, 'proposed', v_row.target, p, null
      ) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_count := v_count + v_inserted;
      if v_inserted > 0 then
        perform public.add_dossier_event(
          v_row.dossier_id, 'adjustment',
          'Frais de retard de ' || public.format_usd_fr(v_fee) || ' proposés (à valider par la comptabilité)', false
        );
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- US-3.9 : frais supplémentaires (R7) et remises ; décisions sur les lignes D
-- ---------------------------------------------------------------------------
create function public.add_extra_cost(
  p_dossier_id uuid, p_section text, p_label text, p_amount_cents bigint, p_proof_document_id uuid,
  p_urgent boolean default false, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_quote public.financial_documents%rowtype;
  v_threshold bigint;
  v_percent numeric;
  v_forfait bigint;
  v_needs_approval boolean;
  v_status text;
  v_id uuid;
begin
  if not public.is_finance_writer() then
    raise exception 'Ajout réservé à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if not found or v_dossier.status = 'cancelled' then
    raise exception 'Dossier introuvable ou annulé.' using errcode = '22023';
  end if;
  select * into v_quote from public.financial_documents
    where dossier_id = p_dossier_id and doc_type = 'quote' and status = 'accepted';
  if not found then
    raise exception 'Les frais supplémentaires s’ajoutent après l’acceptation du devis.' using errcode = '22023';
  end if;
  if p_section not in ('A', 'B') then
    raise exception 'Indiquez le forfait concerné (A ou B).' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Saisissez un montant positif.' using errcode = '22023';
  end if;
  if p_proof_document_id is null or not exists (
    select 1 from public.documents doc where doc.id = p_proof_document_id and doc.dossier_id = p_dossier_id
  ) then
    raise exception 'Joignez le justificatif des frais (document du dossier).' using errcode = '22023';
  end if;
  if p_urgent and coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Urgence : indiquez le motif (stockage, port, transporteur…).' using errcode = '22023';
  end if;

  -- R7 : au-delà du seuil en dollars ou du pourcentage du forfait concerné → accord du client, sauf urgence motivée.
  v_threshold := (public.setting_as_of('extra_costs.approval_threshold_usd', v_dossier.params_as_of) #>> '{}')::bigint;
  v_percent := (public.setting_as_of('extra_costs.approval_threshold_percent', v_dossier.params_as_of) #>> '{}')::numeric;
  v_forfait := case when p_section = 'A' then v_quote.forfait_a_cents else v_quote.forfait_b_cents end;
  v_needs_approval := (v_threshold is not null and p_amount_cents > v_threshold)
    or (v_percent is not null and p_amount_cents * 100 > v_forfait * v_percent);
  v_status := case when v_needs_approval and not coalesce(p_urgent, false) then 'pending_client_approval' else 'approved' end;

  insert into public.adjustments (
    dossier_id, client_id, kind, label, section, amount_cents, status, urgent, reason, proof_document_id,
    decided_at, decided_by
  ) values (
    p_dossier_id, v_dossier.client_id, 'extra_cost', trim(p_label), p_section, p_amount_cents, v_status,
    coalesce(p_urgent, false), nullif(trim(p_reason), ''), p_proof_document_id,
    case when v_status = 'approved' then now() end, case when v_status = 'approved' then auth.uid() end
  ) returning id into v_id;

  perform public.add_dossier_event(
    p_dossier_id, 'adjustment',
    'Frais supplémentaires (' || trim(p_label) || ') : ' || public.format_usd_fr(p_amount_cents)
      || case
           when v_status = 'pending_client_approval' then ' — accord du client requis'
           when p_urgent then ' — ajoutés en urgence : ' || trim(p_reason)
           else ' — ajoutés au solde' end,
    true
  );
  return v_id;
end;
$$;

create function public.add_discount(p_dossier_id uuid, p_label text, p_amount_cents bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_id uuid;
begin
  if not public.is_finance_writer() then
    raise exception 'Remise réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id;
  if not found or not exists (select 1 from public.financial_documents
                              where dossier_id = p_dossier_id and doc_type = 'quote' and status = 'accepted') then
    raise exception 'Une remise s’accorde après l’acceptation du devis.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Saisissez le montant de la remise.' using errcode = '22023';
  end if;
  insert into public.adjustments (dossier_id, client_id, kind, label, amount_cents, status, decided_at, decided_by)
  values (p_dossier_id, v_dossier.client_id, 'discount', trim(p_label), -p_amount_cents, 'approved', now(), auth.uid())
  returning id into v_id;
  perform public.add_dossier_event(
    p_dossier_id, 'adjustment', 'Remise accordée (' || trim(p_label) || ') : ' || public.format_usd_fr(p_amount_cents), true
  );
  return v_id;
end;
$$;

-- Frais de retard proposés : la comptabilité les valide ou les écarte (C5).
create function public.decide_late_fee(p_adjustment_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_adjustment public.adjustments%rowtype;
begin
  if not public.is_finance_writer() then
    raise exception 'Décision réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_adjustment from public.adjustments a where a.id = p_adjustment_id for update;
  if not found or v_adjustment.kind <> 'late_fee' or v_adjustment.status <> 'proposed' then
    raise exception 'Frais de retard introuvables ou déjà traités.' using errcode = '22023';
  end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) < 5 then
    raise exception 'Indiquez pourquoi ces frais sont écartés (5 caractères au moins).' using errcode = '22023';
  end if;
  perform set_config('app.adjustment', 'on', true);
  update public.adjustments
    set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid(),
        decision_note = nullif(trim(p_note), '')
    where id = p_adjustment_id;
  perform set_config('app.adjustment', 'off', true);
  perform public.add_dossier_event(
    v_adjustment.dossier_id, 'adjustment',
    case when p_approve
      then 'Frais de retard de ' || public.format_usd_fr(v_adjustment.amount_cents) || ' ajoutés au solde'
      else 'Frais de retard de ' || public.format_usd_fr(v_adjustment.amount_cents) || ' écartés' end,
    p_approve
  );
  perform public.refresh_invoice_statuses(v_adjustment.dossier_id);
end;
$$;

-- Annulation d'une ligne D (erreur de saisie) tant qu'elle n'est pas reprise sur une facture de solde.
create function public.cancel_adjustment(p_adjustment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_adjustment public.adjustments%rowtype;
begin
  if not public.is_finance_writer() then
    raise exception 'Annulation réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_adjustment from public.adjustments a where a.id = p_adjustment_id for update;
  if not found or v_adjustment.status not in ('approved', 'pending_client_approval') then
    raise exception 'Ligne introuvable ou déjà close.' using errcode = '22023';
  end if;
  if v_adjustment.financial_document_id is not null and exists (
    select 1 from public.financial_documents f where f.id = v_adjustment.financial_document_id and f.status <> 'cancelled'
  ) then
    raise exception 'Cette ligne figure sur la facture de solde : annulez d’abord la facture.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’annulation (5 caractères au moins).' using errcode = '22023';
  end if;
  perform set_config('app.adjustment', 'on', true);
  update public.adjustments
    set status = 'cancelled', decided_at = now(), decided_by = auth.uid(), decision_note = trim(p_reason)
    where id = p_adjustment_id;
  perform set_config('app.adjustment', 'off', true);
  perform public.add_dossier_event(
    v_adjustment.dossier_id, 'adjustment',
    'Ligne D annulée (' || v_adjustment.label || ') : ' || trim(p_reason), true
  );
  perform public.refresh_invoice_statuses(v_adjustment.dossier_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- US-3.12 : validation (administrateur) et exécution des remboursements ; note RB (C7)
-- ---------------------------------------------------------------------------
create function public.decide_refund(p_refund_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_refund public.refunds%rowtype;
begin
  if public.current_role_app() is distinct from 'admin' then
    raise exception 'Validation réservée à l’administrateur (décision C9).' using errcode = '42501';
  end if;
  select * into v_refund from public.refunds r where r.id = p_refund_id for update;
  if not found or v_refund.status <> 'requested' then
    raise exception 'Demande introuvable ou déjà traitée.' using errcode = '22023';
  end if;
  if not p_approve and coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif du refus (5 caractères au moins).' using errcode = '22023';
  end if;
  perform set_config('app.refund', 'on', true);
  update public.refunds
    set status = case when p_approve then 'approved' else 'rejected' end,
        approved_by = case when p_approve then auth.uid() end, approved_at = case when p_approve then now() end,
        rejection_reason = case when p_approve then null else trim(p_reason) end
    where id = p_refund_id;
  perform set_config('app.refund', 'off', true);
  perform public.add_dossier_event(
    v_refund.dossier_id, 'refund',
    case when p_approve then 'Remboursement de ' || public.format_usd_fr(v_refund.amount_cents) || ' validé'
      else 'Demande de remboursement de ' || public.format_usd_fr(v_refund.amount_cents) || ' refusée : ' || trim(p_reason) end,
    false
  );
end;
$$;

create function public.execute_refund(
  p_refund_id uuid, p_paid_at timestamptz, p_reference text, p_proof_document_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_refund public.refunds%rowtype;
  v_balance record;
  v_floor bigint;
  v_rate record;
  v_note uuid;
begin
  if not public.is_finance_writer() then
    raise exception 'Exécution réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_refund from public.refunds r where r.id = p_refund_id for update;
  if not found or v_refund.status <> 'approved' then
    raise exception 'Le remboursement doit d’abord être validé par un administrateur.' using errcode = '22023';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '5 minutes' then
    raise exception 'La date du remboursement ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reference)), 0) < 2 then
    raise exception 'Saisissez la référence du remboursement.' using errcode = '22023';
  end if;
  if p_proof_document_id is null or not exists (
    select 1 from public.documents doc
    where doc.id = p_proof_document_id and doc.dossier_id = v_refund.dossier_id and doc.kind = 'payment_proof'
  ) then
    raise exception 'Joignez le justificatif du remboursement (document « preuve de paiement » du dossier).'
      using errcode = '22023';
  end if;

  -- R6 : un remboursement ne dépasse jamais l'excédent constaté.
  select * into v_balance from public.dossier_balance(v_refund.dossier_id);
  v_floor := case v_refund.reason
    when 'overpayment' then v_balance.total_due_cents
    when 'deposit_excess' then v_balance.a_total_cents
    else 0 end;
  if v_refund.amount_cents > v_balance.net_paid_cents - v_floor then
    raise exception 'Le montant dépasse l’excédent constaté (% au plus) : refusez la demande et recalculez.',
      public.format_usd_fr(greatest(v_balance.net_paid_cents - v_floor, 0)) using errcode = '22023';
  end if;

  select * into v_rate from public.fx_rate_as_of(p_paid_at);
  if v_rate.id is null then
    select * into v_rate from public.fx_rate_as_of(now());
  end if;
  if v_rate.id is null then
    raise exception 'Aucun taux de change enregistré : relevez le taux du jour (Finances).' using errcode = '22023';
  end if;

  perform set_config('app.refund', 'on', true);
  update public.refunds
    set status = 'paid', paid_at = p_paid_at, payment_reference = trim(p_reference),
        proof_document_id = p_proof_document_id, fx_rate = v_rate.rate
    where id = p_refund_id;
  insert into public.financial_documents (
    dossier_id, client_id, doc_type, number, refund_id, total_cents, amount_due_cents,
    fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, issued_by
  ) values (
    v_refund.dossier_id, v_refund.client_id, 'refund_note', public.next_number('refund_note'), p_refund_id,
    v_refund.amount_cents, 0, v_rate.id, v_rate.rate, v_rate.source, v_rate.captured_at, v_rate.rate,
    v_rate.captured_at, auth.uid()
  ) returning id into v_note;
  update public.refunds set refund_note_id = v_note where id = p_refund_id;
  perform set_config('app.refund', 'off', true);

  perform public.refresh_invoice_statuses(v_refund.dossier_id);
  perform public.add_dossier_event(
    v_refund.dossier_id, 'refund',
    'Remboursement de ' || public.format_usd_fr(v_refund.amount_cents) || ' effectué le '
      || public.format_datetime_fr(p_paid_at),
    true
  );
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- Annulation des documents (remplace la version du lot 3b) : facture de solde ; reçus et notes non annulables
-- ---------------------------------------------------------------------------
create or replace function public.cancel_financial_document(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.financial_documents%rowtype;
  v_label text;
begin
  select * into v_doc from public.financial_documents f where f.id = p_id for update;
  if not found then
    raise exception 'Document introuvable.' using errcode = '22023';
  end if;
  if v_doc.doc_type in ('cash_receipt', 'refund_note') then
    raise exception 'Un reçu ou une note de remboursement suit son paiement : annulez le paiement.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’annulation (5 caractères au moins).' using errcode = '22023';
  end if;
  if v_doc.status in ('cancelled', 'expired', 'refused', 'paid') then
    raise exception 'Ce document est clos : il ne peut plus être annulé.' using errcode = '22023';
  end if;
  if v_doc.doc_type = 'quote' and v_doc.status = 'issued' then
    if not public.is_quote_writer() then
      raise exception 'Annulation réservée à l’administrateur, aux agents opérations et à la comptabilité.'
        using errcode = '42501';
    end if;
  elsif not public.is_finance_writer() then
    raise exception 'Annulation réservée à l’administrateur et à la comptabilité.' using errcode = '42501';
  end if;
  if v_doc.doc_type = 'quote' and exists (
    select 1 from public.financial_documents f where f.quote_id = v_doc.id and f.status <> 'cancelled'
  ) then
    raise exception 'Annulez d’abord les factures émises à partir de ce devis.' using errcode = '22023';
  end if;
  if v_doc.doc_type = 'deposit_invoice' and exists (
    select 1 from public.payments p
    where p.dossier_id = v_doc.dossier_id and p.purpose <> 'deposit' and p.cancelled_at is null
  ) then
    raise exception 'Des paiements sont imputés sur cette facture : annulez-les d’abord.' using errcode = '22023';
  end if;

  perform set_config('app.financial_document', 'on', true);
  update public.financial_documents
    set status = 'cancelled', cancelled_reason = trim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_id;
  perform set_config('app.financial_document', 'off', true);

  if v_doc.doc_type = 'quote' then
    update public.dossiers set status = 'won' where id = v_doc.dossier_id and status in ('quote_issued', 'quote_accepted');
    v_label := 'Devis ';
  elsif v_doc.doc_type = 'deposit_invoice' then
    update public.dossiers set status = 'quote_accepted' where id = v_doc.dossier_id and status = 'payment1_pending';
    v_label := 'Facture d’acompte ';
  else
    -- Les lignes D reprises redeviennent disponibles pour la prochaine facture de solde.
    perform set_config('app.adjustment', 'on', true);
    update public.adjustments set financial_document_id = null where financial_document_id = p_id;
    perform set_config('app.adjustment', 'off', true);
    v_label := 'Facture de solde ';
  end if;
  perform public.add_dossier_event(
    v_doc.dossier_id, 'financial_document', v_label || v_doc.number || ' annulé(e) : ' || trim(p_reason), true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Accord du client sur des frais supplémentaires (R7, R15) : branche « extra_cost » des acceptations
-- ---------------------------------------------------------------------------
create function public.acceptances_extra_cost_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_adjustment public.adjustments%rowtype;
  v_sha text;
begin
  if new.subject <> 'extra_cost' then
    return new;
  end if;
  select * into v_adjustment from public.adjustments a where a.id = new.subject_id for update;
  if not found or v_adjustment.kind <> 'extra_cost' then
    raise exception 'Frais supplémentaires introuvables.' using errcode = '22023';
  end if;
  if v_adjustment.status <> 'pending_client_approval' then
    raise exception 'Ces frais n’attendent pas l’accord du client.' using errcode = '22023';
  end if;
  if new.proof_document_id is not null and not exists (
    select 1 from public.documents doc
    where doc.id = new.proof_document_id and doc.dossier_id = v_adjustment.dossier_id and doc.kind = 'acceptance_proof'
  ) then
    raise exception 'La preuve doit être un document « preuve d’acceptation » du même dossier.' using errcode = '22023';
  end if;
  select doc.sha256 into v_sha from public.documents doc where doc.id = v_adjustment.proof_document_id;
  new.dossier_id := v_adjustment.dossier_id;
  new.document_id := v_adjustment.proof_document_id;     -- l'accord porte sur le justificatif présenté
  new.document_sha256 := v_sha;
  new.insurance_choice := null;
  return new;
end;
$$;

-- S'exécute après le trigger générique (ordre alphabétique : « acceptances_before_insert » puis celui-ci).
create trigger acceptances_extra_cost_before_insert
  before insert on public.acceptances
  for each row execute function public.acceptances_extra_cost_before_insert();

create function public.acceptances_extra_cost_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.subject <> 'extra_cost' then
    return null;
  end if;
  perform set_config('app.adjustment', 'on', true);
  update public.adjustments
    set status = case when new.decision = 'accepted' then 'approved' else 'rejected' end,
        decided_at = new.decided_at, decided_by = auth.uid()
    where id = new.subject_id;
  perform set_config('app.adjustment', 'off', true);
  perform public.add_dossier_event(
    new.dossier_id, 'acceptance_recorded',
    case when new.decision = 'accepted' then 'Frais supplémentaires acceptés par le client'
      else 'Frais supplémentaires refusés par le client' end,
    true
  );
  perform public.refresh_invoice_statuses(new.dossier_id);
  return null;
end;
$$;

create trigger acceptances_extra_cost_after_insert
  after insert on public.acceptances
  for each row execute function public.acceptances_extra_cost_after_insert();

drop policy acceptances_insert on public.acceptances;
create policy acceptances_insert on public.acceptances for insert to authenticated
  with check (
    method in ('scanned_paper', 'whatsapp')
    and (
      (select public.is_operations_writer())
      or (subject = 'quote' and (select public.is_quote_writer()))
      or (subject = 'extra_cost' and (select public.is_finance_writer()))
    )
  );

-- ---------------------------------------------------------------------------
-- Tâches programmées (pg_cron) : frais de retard chaque matin (06:00, Dakar = UTC)
-- ---------------------------------------------------------------------------
select cron.schedule('usa-cars-propose-late-fees', '0 6 * * *', $$select public.propose_late_fees()$$);

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
create trigger adjustments_audit after insert or update on public.adjustments
  for each row execute function public.audit_row('id');
create trigger refunds_audit after insert or update on public.refunds
  for each row execute function public.audit_row('id');

alter table public.adjustments enable row level security;
alter table public.refunds enable row level security;

-- Internes L ; le client voit ses lignes D décidées ou soumises à son accord (pas les frais de retard proposés),
-- et ses remboursements. Aucune écriture directe : fonctions métier.
create policy adjustments_select on public.adjustments for select to authenticated
  using (
    (select public.is_internal())
    or (client_id = (select public.current_client_id()) and status in ('approved', 'pending_client_approval'))
  );
create policy refunds_select on public.refunds for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));

revoke all on public.adjustments, public.refunds from anon;
revoke insert, update, delete, truncate on public.adjustments, public.refunds from authenticated;

revoke execute on function public.adjustments_before_update() from public, anon, authenticated;
revoke execute on function public.refunds_before_update() from public, anon, authenticated;
revoke execute on function public.financial_documents_after_insert() from public, anon, authenticated;
revoke execute on function public.dossiers_after_auction_lost() from public, anon, authenticated;
revoke execute on function public.containers_after_eta_advance() from public, anon, authenticated;
revoke execute on function public.acceptances_extra_cost_before_insert() from public, anon, authenticated;
revoke execute on function public.acceptances_extra_cost_after_insert() from public, anon, authenticated;
revoke execute on function public.refresh_invoice_statuses(uuid) from public, anon, authenticated;
revoke execute on function public.request_refund(uuid, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.request_overpayment_refund(uuid, text) from public, anon, authenticated;
revoke execute on function public.add_business_days(timestamptz, int) from public, anon;
revoke execute on function public.dossier_balance(uuid) from public, anon;
revoke execute on function public.record_payment(uuid, text, bigint, bigint, text, uuid, text, timestamptz, uuid, text)
  from public, anon;
revoke execute on function public.issue_balance_invoice(uuid) from public, anon;
revoke execute on function public.propose_late_fees() from public, anon;
revoke execute on function public.add_extra_cost(uuid, text, text, bigint, uuid, boolean, text) from public, anon;
revoke execute on function public.add_discount(uuid, text, bigint) from public, anon;
revoke execute on function public.decide_late_fee(uuid, boolean, text) from public, anon;
revoke execute on function public.cancel_adjustment(uuid, text) from public, anon;
revoke execute on function public.decide_refund(uuid, boolean, text) from public, anon;
revoke execute on function public.execute_refund(uuid, timestamptz, text, uuid) from public, anon;

grant execute on function public.add_business_days(timestamptz, int) to authenticated;
grant execute on function public.dossier_balance(uuid) to authenticated;
grant execute on function public.record_payment(uuid, text, bigint, bigint, text, uuid, text, timestamptz, uuid, text)
  to authenticated;
grant execute on function public.issue_balance_invoice(uuid) to authenticated;
grant execute on function public.propose_late_fees() to authenticated;
grant execute on function public.add_extra_cost(uuid, text, text, bigint, uuid, boolean, text) to authenticated;
grant execute on function public.add_discount(uuid, text, bigint) to authenticated;
grant execute on function public.decide_late_fee(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_adjustment(uuid, text) to authenticated;
grant execute on function public.decide_refund(uuid, boolean, text) to authenticated;
grant execute on function public.execute_refund(uuid, timestamptz, text, uuid) to authenticated;
