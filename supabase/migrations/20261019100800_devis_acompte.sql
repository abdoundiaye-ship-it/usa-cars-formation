-- Phase 3, lot 3b — devis DV (US-3.3, R2, R3, décisions X1 et X2), dépôt (US-3.4, I2) et facture d'acompte FA (R4).
-- CLAUDE.md règles 1 (centimes entiers), 2 (aucun coût interne côté client), 4 (paramètres), 5 (audit).
--
-- Documents financiers : émis par des fonctions métier uniquement (numéro attribué dans la même transaction,
-- sans trou — R3), jamais modifiés ni supprimés ; une correction = annulation motivée + nouveau document.
-- Le fichier Word est généré ensuite par la fonction Supabase generate-document et rattaché une seule fois.

-- ---------------------------------------------------------------------------
-- Types de documents et d'événements
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'contract', 'signed_contract', 'acceptance_proof', 'purchase_order', 'auction_invoice', 'pickup_proof', 'title',
  'bill_of_lading', 'payment_proof', 'power_of_attorney', 'release_receipt', 'photos', 'cost_receipt', 'other',
  'quote', 'deposit_invoice', 'balance_invoice', 'cash_receipt', 'refund_note'
));

alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note',
  'container_assigned', 'container_changed', 'eta_changed', 'tracking_event',
  'financial_document', 'payment_recorded'
));

-- « 12 450 $US » / « 12 450,50 $US » pour les libellés de la chronologie (même format que lib/format.ts).
create function public.format_usd_fr(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_cents % 100 = 0
    then replace(to_char(p_cents / 100, 'FM999G999G999G990'), ',', ' ')
    else replace(replace(replace(to_char(p_cents / 100.0, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', ' ')
  end || ' $US';
$$;

-- « 21/10/2026 à 14h30 » (Africa/Dakar = UTC+0).
create function public.format_datetime_fr(p_at timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'Africa/Dakar', 'DD/MM/YYYY "à" HH24"h"MI');
$$;

-- ---------------------------------------------------------------------------
-- Documents financiers (R3) : DV, FA ; FS, RC et RB arrivent au lot 3c
-- ---------------------------------------------------------------------------
create table public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  doc_type text not null check (doc_type in ('quote', 'deposit_invoice', 'balance_invoice', 'cash_receipt', 'refund_note')),
  number text not null unique,
  status text not null default 'issued'
    check (status in ('issued', 'accepted', 'refused', 'expired', 'paid', 'cancelled')),
  quote_id uuid references public.financial_documents (id),        -- facture : devis d'origine
  -- Lignes visibles du client (R2) : forfaits A et B, option C, TVA. JAMAIS de coût interne ni de marge.
  forfait_a_cents bigint check (forfait_a_cents is null or forfait_a_cents > 0),
  forfait_b_cents bigint check (forfait_b_cents is null or forfait_b_cents > 0),
  insurance_premium_cents bigint not null default 0 check (insurance_premium_cents >= 0),
  insurance_choice text not null default 'pending' check (insurance_choice in ('pending', 'accepted', 'refused')),
  vat_rate_percent numeric(5, 2) not null default 0 check (vat_rate_percent >= 0),
  vat_cents bigint not null default 0 check (vat_cents >= 0),                  -- TVA des lignes facturées
  insurance_vat_cents bigint not null default 0 check (insurance_vat_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),                         -- devis : hors option C
  deposit_applied_cents bigint not null default 0 check (deposit_applied_cents >= 0),
  deposit_excess_cents bigint not null default 0 check (deposit_excess_cents >= 0),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  -- Taux de référence figé à l'émission du devis, repris sur les factures (R1) ; copie des valeurs pour que le
  -- client les lise sans accès à l'historique des taux.
  fx_rate_id uuid not null references public.fx_rates (id),
  fx_rate numeric(12, 4) not null check (fx_rate > 0),
  fx_source text not null,
  fx_captured_at timestamptz not null,
  -- Taux du jour d'édition : montant FCFA indicatif du reste à payer (docs/16).
  edition_fx_rate numeric(12, 4) not null check (edition_fx_rate > 0),
  edition_fx_captured_at timestamptz not null,
  issued_at timestamptz not null default now(),
  valid_until timestamptz,                    -- devis (X2)
  due_at timestamptz,                         -- factures (R4)
  decided_at timestamptz,                     -- devis : décision du client
  document_id uuid references public.documents (id),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  template_version text,
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  issued_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check (doc_type <> 'quote' or (forfait_a_cents is not null and forfait_b_cents is not null and valid_until is not null)),
  check (doc_type <> 'deposit_invoice' or (forfait_a_cents is not null and quote_id is not null and due_at is not null)),
  check (status <> 'cancelled' or (cancelled_reason is not null and cancelled_at is not null))
);

comment on table public.financial_documents is
  'Devis et factures émis (R3) : numéro continu, valeurs figées, lignes A/B/C/D/TVA seulement — jamais de coût interne.';

create index financial_documents_dossier_idx on public.financial_documents (dossier_id, doc_type, issued_at desc);
-- Un seul devis en cours (émis ou accepté) et une seule facture d'acompte non annulée par dossier.
create unique index financial_documents_one_open_quote on public.financial_documents (dossier_id)
  where doc_type = 'quote' and status in ('issued', 'accepted');
create unique index financial_documents_one_deposit_invoice on public.financial_documents (dossier_id)
  where doc_type = 'deposit_invoice' and status <> 'cancelled';

-- Valeurs figées : seuls le statut, la décision, le choix d'assurance (à l'acceptation), l'annulation et le
-- rattachement — une seule fois — du fichier généré évoluent, et seulement par les fonctions métier.
create function public.financial_documents_before_update() returns trigger
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

create trigger financial_documents_before_update
  before update on public.financial_documents
  for each row execute function public.financial_documents_before_update();

create trigger financial_documents_no_delete
  before delete on public.financial_documents
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Paiements (R6) : le lot 3b enregistre le dépôt ; paiement 1 et solde arrivent au lot 3c
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  purpose text not null check (purpose in ('deposit', 'payment1', 'balance')),
  amount_cents bigint not null check (amount_cents > 0),              -- montant imputé, en USD (fait foi)
  paid_currency text not null check (paid_currency in ('USD', 'XOF')),
  amount_xof bigint check (amount_xof is null or amount_xof > 0),    -- montant reçu en FCFA, le cas échéant
  fx_rate_id uuid references public.fx_rates (id),                   -- taux réactualisé du jour du paiement (R1)
  fx_rate numeric(12, 4),
  fx_captured_at timestamptz,
  fx_rate_same_day boolean not null default false,                   -- faux : alerte « aucun taux du jour »
  mode text not null check (mode in ('bank_transfer', 'wave', 'orange_money', 'cash')),
  official_account_id uuid references public.official_accounts (id),
  reference text not null check (length(trim(reference)) > 1),
  credited_at timestamptz not null,
  proof_document_id uuid references public.documents (id),
  notes text,
  recorded_by uuid references public.profiles (id) default auth.uid(),
  recorded_at timestamptz not null default now(),
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  check (paid_currency <> 'XOF' or (amount_xof is not null and fx_rate is not null)),
  check (mode = 'cash' or official_account_id is not null),
  check (cancelled_at is null or cancelled_reason is not null)
);

comment on table public.payments is
  'Paiements reçus (dépôt, paiement 1, solde) : montant USD imputé, taux du jour du paiement, compte officiel.';

create index payments_dossier_idx on public.payments (dossier_id, credited_at);

-- Un paiement enregistré ne change plus ; seule son annulation motivée (erreur de saisie) est possible.
create function public.payments_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mutable text[] := array['cancelled_reason', 'cancelled_at', 'cancelled_by'];
begin
  if coalesce(current_setting('app.payment', true), '') <> 'on'
     or (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or old.cancelled_at is not null then
    raise exception 'Un paiement enregistré ne se modifie pas : annulez-le (motif) puis saisissez-le à nouveau.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger payments_before_update
  before update on public.payments
  for each row execute function public.payments_before_update();

create trigger payments_no_delete
  before delete on public.payments
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Acceptation du devis avec le choix d'assurance (X1, R15)
-- ---------------------------------------------------------------------------
alter table public.acceptances
  add column insurance_choice text check (insurance_choice in ('accepted', 'refused')),
  add constraint acceptances_quote_insurance check (
    subject <> 'quote' or decision <> 'accepted' or insurance_choice is not null
  );

comment on column public.acceptances.insurance_choice is
  'Devis : choix de l’option C (assurance transport) exprimé dans la même acceptation (X1, R15).';

-- ---------------------------------------------------------------------------
-- Fonctions métier
-- ---------------------------------------------------------------------------
create function public.is_finance_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'accounting'), false);
$$;

create function public.is_quote_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'ops', 'accounting'), false);
$$;

-- Devis arrivés en fin de validité → « expiré » ; le dossier revient à « Gagné » (un nouveau devis est à émettre).
-- Appelé toutes les 15 minutes (pg_cron) et avant chaque émission ; idempotent.
create function public.expire_due_quotes(p_dossier_id uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_quote record;
  v_count int := 0;
begin
  if auth.uid() is not null and not public.is_internal() then
    raise exception 'Action réservée aux utilisateurs internes.' using errcode = '42501';
  end if;
  perform set_config('app.financial_document', 'on', true);
  for v_quote in
    update public.financial_documents
      set status = 'expired'
      where doc_type = 'quote' and status = 'issued' and valid_until <= now()
        and (p_dossier_id is null or dossier_id = p_dossier_id)
      returning id, dossier_id, number, valid_until
  loop
    v_count := v_count + 1;
    update public.dossiers set status = 'won' where id = v_quote.dossier_id and status = 'quote_issued';
    perform public.add_dossier_event(
      v_quote.dossier_id, 'financial_document',
      'Devis ' || v_quote.number || ' expiré le ' || public.format_datetime_fr(v_quote.valid_until)
        || ' : un nouveau devis est à émettre',
      true
    );
  end loop;
  perform set_config('app.financial_document', 'off', true);
  return v_count;
end;
$$;

-- US-3.3 : émission du devis DV — forfaits saisis (I4), taux du jour figé (R1), validité alignée sur le
-- paiement 1 (X2), TVA selon le paramètre. Renvoie l'identifiant ; le fichier est généré ensuite.
create function public.issue_quote(p_dossier_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_forfaits public.dossier_forfaits%rowtype;
  v_open record;
  v_rate record;
  v_validity_hours int;
  v_vat numeric;
  v_valid_until timestamptz;
  v_subtotal bigint;
  v_vat_cents bigint;
  v_number text;
  v_id uuid;
begin
  if not public.is_quote_writer() then
    raise exception 'Émission réservée à l’administrateur, aux agents opérations et à la comptabilité.'
      using errcode = '42501';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_dossier.status = 'cancelled' then
    raise exception 'Le dossier est annulé.' using errcode = '22023';
  end if;
  if v_dossier.auction_result is distinct from 'won' then
    raise exception 'Le devis s’émet après l’adjudication : enregistrez d’abord le lot remporté.' using errcode = '22023';
  end if;

  perform public.expire_due_quotes(p_dossier_id);
  select number, status into v_open from public.financial_documents
    where dossier_id = p_dossier_id and doc_type = 'quote' and status in ('issued', 'accepted');
  if found then
    raise exception '%', case when v_open.status = 'accepted'
      then 'Le devis ' || v_open.number || ' a déjà été accepté par le client.'
      else 'Le devis ' || v_open.number || ' est en cours de validité : annulez-le avant d’en émettre un nouveau.' end
      using errcode = '22023';
  end if;

  select * into v_forfaits from public.dossier_forfaits f where f.dossier_id = p_dossier_id;
  if v_forfaits.forfait_a_cents is null or v_forfaits.forfait_b_cents is null then
    raise exception 'Saisissez les forfaits A et B avant d’émettre le devis.' using errcode = '22023';
  end if;
  if v_forfaits.insurance_cents is null then
    raise exception 'Saisissez la prime de l’assurance transport (option C) : le client la choisit à l’acceptation du devis.'
      using errcode = '22023';
  end if;

  if not public.fx_rate_exists_on((now() at time zone 'Africa/Dakar')::date) then
    raise exception 'Aucun taux de change relevé aujourd’hui : relevez le taux du jour (Finances) avant d’émettre le devis.'
      using errcode = '22023';
  end if;
  select * into v_rate from public.fx_rate_as_of(now());

  v_validity_hours := (public.setting_as_of('quote.validity_hours', v_dossier.params_as_of) #>> '{}')::int;
  v_vat := coalesce((public.setting_as_of('vat.rate_percent', v_dossier.params_as_of) #>> '{}')::numeric, 0);
  if v_validity_hours is null or v_validity_hours <= 0 then
    raise exception 'Paramètre quote.validity_hours manquant.' using errcode = '22023';
  end if;
  -- X2 : le devis expire au plus tard à l'échéance du paiement 1 (si elle n'est pas déjà passée).
  v_valid_until := now() + make_interval(hours => v_validity_hours);
  if v_dossier.payment1_due_at > now() and v_dossier.payment1_due_at < v_valid_until then
    v_valid_until := v_dossier.payment1_due_at;
  end if;

  v_subtotal := v_forfaits.forfait_a_cents + v_forfaits.forfait_b_cents;
  v_vat_cents := round(v_subtotal * v_vat / 100)::bigint;
  v_number := public.next_number('quote');

  insert into public.financial_documents (
    dossier_id, client_id, doc_type, number, forfait_a_cents, forfait_b_cents, insurance_premium_cents,
    vat_rate_percent, vat_cents, insurance_vat_cents, total_cents, amount_due_cents,
    fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, valid_until, issued_by
  ) values (
    p_dossier_id, v_dossier.client_id, 'quote', v_number, v_forfaits.forfait_a_cents, v_forfaits.forfait_b_cents,
    v_forfaits.insurance_cents, v_vat, v_vat_cents, round(v_forfaits.insurance_cents * v_vat / 100)::bigint,
    v_subtotal + v_vat_cents, v_subtotal + v_vat_cents,
    v_rate.id, v_rate.rate, v_rate.source, v_rate.captured_at, v_rate.rate, v_rate.captured_at, v_valid_until, auth.uid()
  ) returning id into v_id;

  update public.dossiers set status = 'quote_issued' where id = p_dossier_id and status = 'won';
  perform public.add_dossier_event(
    p_dossier_id, 'financial_document',
    'Devis ' || v_number || ' émis : ' || public.format_usd_fr(v_subtotal + v_vat_cents)
      || ' (hors assurance), valable jusqu’au ' || public.format_datetime_fr(v_valid_until),
    true
  );
  return v_id;
end;
$$;

-- US-3.4 : facture d'acompte FA = totalité du forfait A (+ TVA), dépôts imputés, échéance du paiement 1 (R4),
-- taux de référence du devis accepté (R1). Un dépôt supérieur au montant dû laisse un excédent à restituer (R6).
create function public.issue_deposit_invoice(p_dossier_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_quote public.financial_documents%rowtype;
  v_rate record;
  v_deposits bigint;
  v_vat_cents bigint;
  v_total bigint;
  v_applied bigint;
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
    raise exception 'La facture d’acompte suit l’acceptation du devis par le client.' using errcode = '22023';
  end if;
  if exists (select 1 from public.financial_documents
             where dossier_id = p_dossier_id and doc_type = 'deposit_invoice' and status <> 'cancelled') then
    raise exception 'Une facture d’acompte est déjà émise pour ce dossier.' using errcode = '22023';
  end if;
  if v_dossier.payment1_due_at is null then
    raise exception 'Échéance du paiement 1 inconnue : enregistrez la notification du lot remporté.' using errcode = '22023';
  end if;

  select * into v_rate from public.fx_rate_as_of(now());
  select coalesce(sum(p.amount_cents), 0) into v_deposits
    from public.payments p where p.dossier_id = p_dossier_id and p.purpose = 'deposit' and p.cancelled_at is null;
  v_vat_cents := round(v_quote.forfait_a_cents * v_quote.vat_rate_percent / 100)::bigint;
  v_total := v_quote.forfait_a_cents + v_vat_cents;
  v_applied := least(v_deposits, v_total);
  v_number := public.next_number('deposit_invoice');

  insert into public.financial_documents (
    dossier_id, client_id, doc_type, number, quote_id, forfait_a_cents, insurance_premium_cents, insurance_choice,
    vat_rate_percent, vat_cents, total_cents, deposit_applied_cents, deposit_excess_cents, amount_due_cents,
    fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, due_at, issued_by
  ) values (
    p_dossier_id, v_dossier.client_id, 'deposit_invoice', v_number, v_quote.id, v_quote.forfait_a_cents,
    v_quote.insurance_premium_cents, v_quote.insurance_choice, v_quote.vat_rate_percent, v_vat_cents, v_total,
    v_applied, v_deposits - v_applied, v_total - v_applied,
    v_quote.fx_rate_id, v_quote.fx_rate, v_quote.fx_source, v_quote.fx_captured_at,
    coalesce(v_rate.rate, v_quote.fx_rate), coalesce(v_rate.captured_at, v_quote.fx_captured_at),
    v_dossier.payment1_due_at, auth.uid()
  ) returning id into v_id;

  update public.dossiers set status = 'payment1_pending' where id = p_dossier_id and status = 'quote_accepted';
  perform public.add_dossier_event(
    p_dossier_id, 'financial_document',
    'Facture d’acompte ' || v_number || ' émise : ' || public.format_usd_fr(v_total - v_applied)
      || ' à régler avant le ' || public.format_datetime_fr(v_dossier.payment1_due_at),
    true
  );
  if v_deposits > v_applied then
    perform public.add_dossier_event(
      p_dossier_id, 'financial_document',
      'Excédent de dépôt de ' || public.format_usd_fr(v_deposits - v_applied) || ' à restituer au client',
      false
    );
  end if;
  return v_id;
end;
$$;

-- Annulation motivée (R3) : le numéro reste attribué ; le dossier revient à l'étape précédente du parcours.
create function public.cancel_financial_document(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.financial_documents%rowtype;
  v_label text;
begin
  select * into v_doc from public.financial_documents f where f.id = p_id for update;
  if not found then
    raise exception 'Document introuvable.' using errcode = '22023';
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
    select 1 from public.financial_documents f
    where f.quote_id = v_doc.id and f.status <> 'cancelled'
  ) then
    raise exception 'Annulez d’abord la facture émise à partir de ce devis.' using errcode = '22023';
  end if;

  perform set_config('app.financial_document', 'on', true);
  update public.financial_documents
    set status = 'cancelled', cancelled_reason = trim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_id;
  perform set_config('app.financial_document', 'off', true);

  if v_doc.doc_type = 'quote' then
    update public.dossiers set status = 'won' where id = v_doc.dossier_id and status in ('quote_issued', 'quote_accepted');
    v_label := 'Devis ';
  else
    update public.dossiers set status = 'quote_accepted' where id = v_doc.dossier_id and status = 'payment1_pending';
    v_label := 'Facture d’acompte ';
  end if;
  perform public.add_dossier_event(
    v_doc.dossier_id, 'financial_document', v_label || v_doc.number || ' annulé(e) : ' || trim(p_reason), true
  );
end;
$$;

-- Rattache le fichier Word généré (une seule fois) ; appelé par la fonction generate-document au nom de l'utilisateur.
create function public.register_financial_document_file(
  p_financial_document_id uuid, p_storage_path text, p_file_name text, p_size_bytes bigint, p_sha256 text,
  p_template_version text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.financial_documents%rowtype;
  v_document_id uuid;
begin
  if not public.is_quote_writer() then
    raise exception 'Action réservée à l’administrateur, aux agents opérations et à la comptabilité.'
      using errcode = '42501';
  end if;
  select * into v_doc from public.financial_documents f where f.id = p_financial_document_id for update;
  if not found then
    raise exception 'Document introuvable.' using errcode = '22023';
  end if;
  if v_doc.document_id is not null then
    raise exception 'Le fichier de ce document est déjà généré.' using errcode = '22023';
  end if;
  if v_doc.status = 'cancelled' then
    raise exception 'Ce document est annulé.' using errcode = '22023';
  end if;
  if p_storage_path not like 'dossiers/' || v_doc.dossier_id || '/%' then
    raise exception 'Emplacement du fichier invalide.' using errcode = '22023';
  end if;

  insert into public.documents (
    dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client
  ) values (
    v_doc.dossier_id, v_doc.client_id, v_doc.doc_type, p_storage_path, p_file_name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', p_size_bytes, p_sha256, true
  ) returning id into v_document_id;

  perform set_config('app.financial_document', 'on', true);
  update public.financial_documents
    set document_id = v_document_id, document_sha256 = p_sha256, template_version = p_template_version
    where id = p_financial_document_id;
  perform set_config('app.financial_document', 'off', true);
  return v_document_id;
end;
$$;

-- US-3.4 : dépôt reçu avant l'enchère (I2). Montant en USD, ou en FCFA converti au taux du jour du paiement :
-- usd_cents = arrondi(fcfa / taux × 100) (R1). Compte officiel actif du même moyen de paiement (annexe D).
create function public.record_deposit(
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
  v_id uuid;
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
  if not exists (select 1 from public.purchase_orders po where po.dossier_id = p_dossier_id) then
    raise exception 'Le dépôt accompagne l’ordre d’achat : saisissez d’abord l’ordre d’achat.' using errcode = '22023';
  end if;
  if exists (select 1 from public.financial_documents
             where dossier_id = p_dossier_id and doc_type = 'deposit_invoice' and status <> 'cancelled') then
    raise exception 'La facture d’acompte est émise : ce versement est un paiement 1, pas un dépôt.' using errcode = '22023';
  end if;
  if p_credited_at is null or p_credited_at > now() + interval '5 minutes' then
    raise exception 'La date de crédit ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  if p_mode not in ('bank_transfer', 'wave', 'orange_money', 'cash') then
    raise exception 'Mode de paiement inconnu.' using errcode = '22023';
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
  if p_proof_document_id is not null and not exists (
    select 1 from public.documents doc
    where doc.id = p_proof_document_id and doc.dossier_id = p_dossier_id and doc.kind = 'payment_proof'
  ) then
    raise exception 'Le justificatif doit être un document « preuve de paiement » du même dossier.' using errcode = '22023';
  end if;

  insert into public.payments (
    dossier_id, client_id, purpose, amount_cents, paid_currency, amount_xof, fx_rate_id, fx_rate, fx_captured_at,
    fx_rate_same_day, mode, official_account_id, reference, credited_at, proof_document_id, notes
  ) values (
    p_dossier_id, v_dossier.client_id, 'deposit', v_cents, p_paid_currency,
    case when p_paid_currency = 'XOF' then p_amount_xof end, v_rate.id, v_rate.rate, v_rate.captured_at,
    v_same_day, p_mode, p_official_account_id, trim(p_reference), p_credited_at, p_proof_document_id,
    nullif(trim(p_notes), '')
  ) returning id into v_id;

  perform public.add_dossier_event(
    p_dossier_id, 'payment_recorded', 'Dépôt reçu : ' || public.format_usd_fr(v_cents), true
  );
  return v_id;
end;
$$;

create function public.cancel_payment(p_payment_id uuid, p_reason text) returns void
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
  perform set_config('app.payment', 'on', true);
  update public.payments
    set cancelled_reason = trim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_payment_id;
  perform set_config('app.payment', 'off', true);
  perform public.add_dossier_event(
    v_payment.dossier_id, 'payment_recorded',
    'Paiement de ' || public.format_usd_fr(v_payment.amount_cents) || ' annulé (erreur de saisie) : ' || trim(p_reason),
    false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptations : branche « devis » (X1 : choix d'assurance dans la même acceptation)
-- ---------------------------------------------------------------------------
create or replace function public.acceptances_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contract public.contracts%rowtype;
  v_po public.purchase_orders%rowtype;
  v_quote public.financial_documents%rowtype;
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
  elsif new.subject = 'quote' then
    select * into v_quote from public.financial_documents f
      where f.id = new.subject_id and f.doc_type = 'quote' for update;
    if not found then
      raise exception 'Devis introuvable.' using errcode = '22023';
    end if;
    if v_quote.status = 'cancelled' then
      raise exception 'Ce devis est annulé.' using errcode = '22023';
    end if;
    if v_quote.status not in ('issued', 'expired') then
      raise exception 'Une décision a déjà été enregistrée pour ce devis.' using errcode = '22023';
    end if;
    if v_quote.document_id is null then
      raise exception 'Générez le fichier du devis avant d’enregistrer la décision du client.' using errcode = '22023';
    end if;
    -- Une acceptation donnée pendant la validité reste recevable, même enregistrée après l'expiration.
    if new.decided_at > v_quote.valid_until then
      raise exception 'Le devis a expiré le % : la décision du client est postérieure. Émettez un nouveau devis.',
        public.format_datetime_fr(v_quote.valid_until) using errcode = '22023';
    end if;
    if v_quote.status = 'expired' and exists (
      select 1 from public.financial_documents f
      where f.dossier_id = v_quote.dossier_id and f.doc_type = 'quote' and f.status in ('issued', 'accepted')
    ) then
      raise exception 'Un autre devis a été émis depuis : enregistrez la décision sur celui-ci.' using errcode = '22023';
    end if;
    if new.decision = 'accepted' and new.insurance_choice is null then
      raise exception 'Indiquez le choix du client pour l’assurance transport (option C).' using errcode = '22023';
    end if;
    if new.decision = 'refused' then
      new.insurance_choice := null;
    end if;
    new.dossier_id := v_quote.dossier_id;
    new.document_id := v_quote.document_id;
    new.document_sha256 := v_quote.document_sha256;
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
  v_number text;
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
  elsif new.subject = 'quote' then
    perform set_config('app.financial_document', 'on', true);
    update public.financial_documents
      set status = new.decision, decided_at = new.decided_at,
          insurance_choice = coalesce(new.insurance_choice, 'pending')
      where id = new.subject_id
      returning number into v_number;
    perform set_config('app.financial_document', 'off', true);
    update public.dossiers
      set status = case when new.decision = 'accepted' then 'quote_accepted' else 'won' end
      where id = new.dossier_id and status in ('won', 'quote_issued');
    perform public.add_dossier_event(
      new.dossier_id, 'acceptance_recorded',
      case when new.decision = 'accepted'
        then 'Devis ' || v_number || ' accepté, assurance transport '
          || case when new.insurance_choice = 'accepted' then 'acceptée' else 'refusée' end
        else 'Devis ' || v_number || ' refusé' end || ' (' || v_method || ')',
      true
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiration automatique des devis (pg_cron, toutes les 15 minutes)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('usa-cars-expire-quotes', '*/15 * * * *', $$select public.expire_due_quotes(null)$$);

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
create trigger financial_documents_audit after insert or update on public.financial_documents
  for each row execute function public.audit_row('id');
create trigger payments_audit after insert or update on public.payments
  for each row execute function public.audit_row('id');

alter table public.financial_documents enable row level security;
alter table public.payments enable row level security;

-- Internes L ; un client lit ses devis, factures et paiements. Aucune écriture directe : fonctions métier.
create policy financial_documents_select on public.financial_documents for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));
create policy payments_select on public.payments for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));

revoke all on public.financial_documents, public.payments from anon;
revoke insert, update, delete, truncate on public.financial_documents, public.payments from authenticated;

-- Acceptation du devis : la comptabilité l'enregistre aussi (matrice des droits : « Forfaits et devis »).
drop policy acceptances_insert on public.acceptances;
create policy acceptances_insert on public.acceptances for insert to authenticated
  with check (
    method in ('scanned_paper', 'whatsapp')
    and ((select public.is_operations_writer()) or (subject = 'quote' and (select public.is_quote_writer())))
  );

revoke execute on function public.format_usd_fr(bigint) from public, anon;
revoke execute on function public.format_datetime_fr(timestamptz) from public, anon;
revoke execute on function public.financial_documents_before_update() from public, anon, authenticated;
revoke execute on function public.payments_before_update() from public, anon, authenticated;
revoke execute on function public.is_finance_writer() from public, anon;
revoke execute on function public.is_quote_writer() from public, anon;
revoke execute on function public.expire_due_quotes(uuid) from public, anon;
revoke execute on function public.issue_quote(uuid) from public, anon;
revoke execute on function public.issue_deposit_invoice(uuid) from public, anon;
revoke execute on function public.cancel_financial_document(uuid, text) from public, anon;
revoke execute on function public.register_financial_document_file(uuid, text, text, bigint, text, text) from public, anon;
revoke execute on function public.record_deposit(uuid, text, bigint, bigint, text, uuid, text, timestamptz, uuid, text)
  from public, anon;
revoke execute on function public.cancel_payment(uuid, text) from public, anon;

grant execute on function public.is_finance_writer() to authenticated;
grant execute on function public.is_quote_writer() to authenticated;
grant execute on function public.expire_due_quotes(uuid) to authenticated;
grant execute on function public.issue_quote(uuid) to authenticated;
grant execute on function public.issue_deposit_invoice(uuid) to authenticated;
grant execute on function public.cancel_financial_document(uuid, text) to authenticated;
grant execute on function public.register_financial_document_file(uuid, text, text, bigint, text, text) to authenticated;
grant execute on function public.record_deposit(uuid, text, bigint, bigint, text, uuid, text, timestamptz, uuid, text)
  to authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
