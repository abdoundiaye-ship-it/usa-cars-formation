-- Phase 3, lot 3a — taux de change (US-3.5, R1), comptes officiels (US-3.10, double validation, décision Q1),
-- coûts internes (US-3.1, jamais visibles du client) et forfaits (US-3.2, décision I4).
-- CLAUDE.md règles 1 (centimes entiers), 2 (coûts internes et marge jamais renvoyés au rôle client), 5 (audit), 7.

-- ---------------------------------------------------------------------------
-- Taux de change USD → FCFA (R1) : historique intangible
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  rate numeric(12, 4) not null check (rate > 0),        -- FCFA pour 1 USD
  source text not null check (length(trim(source)) > 1),
  captured_at timestamptz not null,                     -- date-heure du relevé (UTC = Dakar)
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.fx_rates is 'Taux USD → FCFA relevés (source, date-heure) ; jamais modifiés ni supprimés (R1).';

create index fx_rates_captured_idx on public.fx_rates (captured_at desc);

create trigger fx_rates_immutable
  before update or delete on public.fx_rates
  for each row execute function public.forbid_update_delete();

create function public.fx_rates_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.captured_at > now() + interval '5 minutes' then
    raise exception 'La date du relevé ne peut pas être dans le futur.' using errcode = '22023';
  end if;
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger fx_rates_before_insert
  before insert on public.fx_rates
  for each row execute function public.fx_rates_before_insert();

-- Dernier taux relevé à une date-heure donnée (le taux « du jour » d'un document ou d'un paiement).
create function public.fx_rate_as_of(p_at timestamptz)
returns table (id uuid, rate numeric, source text, captured_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.rate, r.source, r.captured_at
  from public.fx_rates r
  where r.captured_at <= p_at and public.is_internal()
  order by r.captured_at desc
  limit 1;
$$;

-- Un taux a-t-il été relevé ce jour-là (Africa/Dakar = UTC) ? Alerte si un paiement est saisi sans taux du jour.
create function public.fx_rate_exists_on(p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_internal() and exists (
    select 1 from public.fx_rates r where (r.captured_at at time zone 'Africa/Dakar')::date = p_day
  );
$$;

-- ---------------------------------------------------------------------------
-- Comptes officiels (US-3.10) : création par un administrateur, activation par une autre personne
-- (administrateur ou direction, décision Q1). Coordonnées figées : une modification = un nouveau compte
-- qui remplace l'ancien à son activation. Aucune écriture directe : uniquement par les fonctions ci-dessous.
-- ---------------------------------------------------------------------------
create table public.official_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bank', 'wave', 'orange_money', 'cash_office')),
  label text not null check (length(trim(label)) > 1),
  holder_name text not null check (length(trim(holder_name)) > 1),
  bank_name text,
  account_number text,
  iban text,
  swift text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  instructions text,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'inactive')),
  replaces_id uuid references public.official_accounts (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  deactivated_by uuid references public.profiles (id),
  deactivated_at timestamptz,
  deactivation_reason text,
  check (kind <> 'bank' or (bank_name is not null and (account_number is not null or iban is not null))),
  check (kind not in ('wave', 'orange_money') or phone is not null),
  check (status <> 'active' or (approved_by is not null and approved_by <> created_by))
);

comment on table public.official_accounts is
  'Comptes et canaux de paiement officiels (annexe D) ; activation par une seconde personne (Q1).';

create function public.create_official_account(
  p_kind text, p_label text, p_holder_name text, p_bank_name text default null, p_account_number text default null,
  p_iban text default null, p_swift text default null, p_phone text default null, p_instructions text default null,
  p_replaces_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if public.current_role_app() is distinct from 'admin' then
    raise exception 'Seul un administrateur crée ou modifie un compte officiel.' using errcode = '42501';
  end if;
  if p_replaces_id is not null and not exists (
    select 1 from public.official_accounts a where a.id = p_replaces_id and a.status = 'active'
  ) then
    raise exception 'Le compte à remplacer doit être un compte actif.' using errcode = '22023';
  end if;
  insert into public.official_accounts (kind, label, holder_name, bank_name, account_number, iban, swift, phone,
                                        instructions, replaces_id, created_by)
  values (p_kind, trim(p_label), trim(p_holder_name), nullif(trim(p_bank_name), ''), nullif(trim(p_account_number), ''),
          nullif(trim(p_iban), ''), nullif(trim(p_swift), ''), nullif(trim(p_phone), ''), nullif(trim(p_instructions), ''),
          p_replaces_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.approve_official_account(p_account_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.official_accounts%rowtype;
begin
  if public.current_role_app() not in ('admin', 'management') then
    raise exception 'L’activation d’un compte officiel est approuvée par un administrateur ou la direction.'
      using errcode = '42501';
  end if;
  select * into v_account from public.official_accounts a where a.id = p_account_id for update;
  if not found or v_account.status <> 'pending_approval' then
    raise exception 'Ce compte n’est pas en attente d’approbation.' using errcode = '22023';
  end if;
  if v_account.created_by = auth.uid() then
    raise exception 'Double validation : l’approbation doit venir d’une autre personne que le créateur.'
      using errcode = '42501';
  end if;
  update public.official_accounts set status = 'active', approved_by = auth.uid(), approved_at = now()
    where id = p_account_id;
  if v_account.replaces_id is not null then
    update public.official_accounts
      set status = 'inactive', deactivated_by = auth.uid(), deactivated_at = now(),
          deactivation_reason = 'Remplacé par un nouveau compte approuvé'
      where id = v_account.replaces_id and status = 'active';
  end if;
end;
$$;

create function public.deactivate_official_account(p_account_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_app() is distinct from 'admin' then
    raise exception 'Seul un administrateur désactive un compte officiel.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de la désactivation.' using errcode = '22023';
  end if;
  update public.official_accounts
    set status = 'inactive', deactivated_by = auth.uid(), deactivated_at = now(), deactivation_reason = trim(p_reason)
    where id = p_account_id and status in ('pending_approval', 'active');
  if not found then
    raise exception 'Ce compte est déjà inactif.' using errcode = '22023';
  end if;
end;
$$;

-- Les coordonnées d'un compte ne changent jamais (une modification = un nouveau compte) ; seuls le statut
-- et ses traces évoluent, par les fonctions ci-dessus.
create function public.official_accounts_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.kind, new.label, new.holder_name, new.bank_name, new.account_number, new.iban, new.swift, new.phone,
      new.instructions, new.replaces_id, new.created_by, new.created_at)
     is distinct from
     (old.kind, old.label, old.holder_name, old.bank_name, old.account_number, old.iban, old.swift, old.phone,
      old.instructions, old.replaces_id, old.created_by, old.created_at) then
    raise exception 'Les coordonnées d’un compte officiel ne se modifient pas : créez un nouveau compte qui le remplace.'
      using errcode = '42501';
  end if;
  if old.status = 'inactive' then
    raise exception 'Un compte désactivé ne peut pas être réactivé : créez un nouveau compte.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger official_accounts_before_update
  before update on public.official_accounts
  for each row execute function public.official_accounts_before_update();

create trigger official_accounts_no_delete
  before delete on public.official_accounts
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Coûts internes par poste (US-3.1) — JAMAIS visibles du client (CLAUDE.md règle 2)
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'contract', 'signed_contract', 'acceptance_proof', 'purchase_order', 'auction_invoice', 'pickup_proof', 'title',
  'bill_of_lading', 'payment_proof', 'power_of_attorney', 'release_receipt', 'photos', 'cost_receipt', 'other'
));

create table public.internal_costs (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  section text not null check (section in ('A', 'B')),
  category text not null,
  label text,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'estimated' check (status in ('estimated', 'final')),
  document_id uuid references public.documents (id),                  -- justificatif (facture fournisseur…)
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (section = 'A' and category in ('hammer_price', 'auction_fees', 'us_taxes', 'acquisition_other'))
    or (section = 'B' and category in ('inland_transport', 'loading', 'ocean_freight', 'port_fees', 'documentation',
                                       'logistics_other'))
  )
);

comment on table public.internal_costs is
  'Structure interne des coûts d’un dossier (US-3.1) : jamais renvoyée au rôle client (RLS), jamais dans un document.';

create index internal_costs_dossier_idx on public.internal_costs (dossier_id, section);

create trigger internal_costs_touch_updated_at
  before update on public.internal_costs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Forfaits A et B et prime d'assurance C (US-3.2, décision I4) — saisie manuelle en phase actuelle ;
-- les colonnes du futur mode « proposé puis approuvé » existent sans être utilisées.
-- ---------------------------------------------------------------------------
create table public.dossier_forfaits (
  dossier_id uuid primary key references public.dossiers (id),
  forfait_a_cents bigint check (forfait_a_cents is null or forfait_a_cents > 0),
  forfait_b_cents bigint check (forfait_b_cents is null or forfait_b_cents > 0),
  insurance_cents bigint check (insurance_cents is null or insurance_cents >= 0),   -- prime de l'option C
  mode text not null default 'manual' check (mode in ('manual', 'proposed_with_approval')),
  proposed_a_cents bigint,
  proposed_b_cents bigint,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  updated_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dossier_forfaits is
  'Forfaits A (acquisition) et B (logistique + maritime) et prime d’assurance C, saisis par l’agent (I4).';

create function public.dossier_forfaits_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  if new.mode <> 'manual' then
    raise exception 'Le calcul assisté des forfaits n’est pas encore activé (décision C1).' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger dossier_forfaits_before_write
  before insert or update on public.dossier_forfaits
  for each row execute function public.dossier_forfaits_before_write();

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
create trigger fx_rates_audit after insert on public.fx_rates
  for each row execute function public.audit_row('id');
create trigger official_accounts_audit after insert or update on public.official_accounts
  for each row execute function public.audit_row('id');
create trigger internal_costs_audit after insert or update or delete on public.internal_costs
  for each row execute function public.audit_row('id');
create trigger dossier_forfaits_audit after insert or update on public.dossier_forfaits
  for each row execute function public.audit_row('dossier_id');

alter table public.fx_rates enable row level security;
alter table public.official_accounts enable row level security;
alter table public.internal_costs enable row level security;
alter table public.dossier_forfaits enable row level security;

-- Taux : internes L ; administrateur et comptabilité E.
create policy fx_rates_select on public.fx_rates for select to authenticated
  using ((select public.is_internal()));
create policy fx_rates_insert on public.fx_rates for insert to authenticated
  with check ((select public.current_role_app()) in ('admin', 'accounting'));

-- Comptes officiels : internes L ; un client lit les comptes actifs (instructions de paiement, phase 4).
create policy official_accounts_select on public.official_accounts for select to authenticated
  using ((select public.is_internal()) or (status = 'active' and (select public.current_role_app()) = 'client'));

-- Coûts internes : internes uniquement (admin, agent, comptabilité E ; direction L). Le client : RIEN.
create policy internal_costs_select on public.internal_costs for select to authenticated
  using ((select public.is_internal()));
create policy internal_costs_insert on public.internal_costs for insert to authenticated
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));
create policy internal_costs_update on public.internal_costs for update to authenticated
  using ((select public.current_role_app()) in ('admin', 'ops', 'accounting'))
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));
create policy internal_costs_delete on public.internal_costs for delete to authenticated
  using ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));

-- Forfaits : internes L ; admin, agent et comptabilité E. Le client verra les montants sur ses devis (lot 3b).
create policy dossier_forfaits_select on public.dossier_forfaits for select to authenticated
  using ((select public.is_internal()));
create policy dossier_forfaits_insert on public.dossier_forfaits for insert to authenticated
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));
create policy dossier_forfaits_update on public.dossier_forfaits for update to authenticated
  using ((select public.current_role_app()) in ('admin', 'ops', 'accounting'))
  with check ((select public.current_role_app()) in ('admin', 'ops', 'accounting'));

revoke all on public.fx_rates, public.official_accounts, public.internal_costs, public.dossier_forfaits from anon;
revoke update, delete, truncate on public.fx_rates from authenticated;
revoke insert, update, delete, truncate on public.official_accounts from authenticated;
revoke truncate on public.internal_costs, public.dossier_forfaits from authenticated;
revoke delete on public.dossier_forfaits from authenticated;

revoke execute on function public.fx_rates_before_insert() from public, anon, authenticated;
revoke execute on function public.official_accounts_before_update() from public, anon, authenticated;
revoke execute on function public.dossier_forfaits_before_write() from public, anon, authenticated;
revoke execute on function public.fx_rate_as_of(timestamptz) from public, anon;
revoke execute on function public.fx_rate_exists_on(date) from public, anon;
revoke execute on function public.create_official_account(text, text, text, text, text, text, text, text, text, uuid) from public, anon;
revoke execute on function public.approve_official_account(uuid) from public, anon;
revoke execute on function public.deactivate_official_account(uuid, text) from public, anon;
grant execute on function public.fx_rate_as_of(timestamptz) to authenticated;
grant execute on function public.fx_rate_exists_on(date) to authenticated;
grant execute on function public.create_official_account(text, text, text, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.approve_official_account(uuid) to authenticated;
grant execute on function public.deactivate_official_account(uuid, text) to authenticated;
