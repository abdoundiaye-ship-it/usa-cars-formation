-- Phase 6, lot 6a — rapports (US-6.1) : dossiers actifs, retards, créances par client, délais, marge par véhicule.
-- Chaque rapport est une fonction qui vérifie le rôle EN BASE (docs/12 : « Rapports et exports ») ; le rôle client
-- ne reçoit jamais rien ; la marge (coûts internes) est réservée à l'administrateur et à la direction (décision Q2,
-- CLAUDE.md règle 2). Les exports sont journalisés (log_report_export).

-- ---------------------------------------------------------------------------
-- Date d'enlèvement : fixée quand le statut passe à « Enlevé » (délais, réclamations du lot 6d) ; jamais saisie.
-- ---------------------------------------------------------------------------
alter table public.dossiers add column collected_at timestamptz;

comment on column public.dossiers.collected_at is
  'Enlèvement du véhicule : date du passage au statut « Enlevé », renseignée par la base.';

create function public.dossiers_set_collected_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'collected' and old.status is distinct from 'collected' then
    new.collected_at := coalesce(old.collected_at, now());
  else
    new.collected_at := old.collected_at;     -- jamais modifiée directement
  end if;
  return new;
end;
$$;

revoke execute on function public.dossiers_set_collected_at() from public, anon, authenticated;

-- Dossiers déjà enlevés (avant le déclencheur, qui empêche toute modification directe) : date du changement de statut d'après la chronologie.
update public.dossiers d set collected_at = coalesce((
    select min(e.occurred_at) from public.dossier_events e
    where e.dossier_id = d.id and e.kind = 'status_changed' and e.label like '%→ Enlevé'
  ), d.updated_at)
  where d.status = 'collected' or exists (
    select 1 from public.dossier_events e
    where e.dossier_id = d.id and e.kind = 'status_changed' and e.label like '%→ Enlevé'
  );

create trigger dossiers_set_collected_at
  before update on public.dossiers
  for each row execute function public.dossiers_set_collected_at();

-- ---------------------------------------------------------------------------
-- Droits de lecture des rapports (docs/12) : opérationnels (admin, direction, opérations), financiers (admin,
-- direction, comptabilité), retards (tous les internes), marge (admin, direction).
-- ---------------------------------------------------------------------------
create function public.require_report_role(variadic p_roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.current_role_app() = any (p_roles), false) then
    raise exception 'Rapport non accessible avec votre rôle.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.require_report_role(public.app_role[]) from public, anon;
grant execute on function public.require_report_role(public.app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Dossiers actifs (hors clôture)
-- ---------------------------------------------------------------------------
create function public.report_active_dossiers()
returns table (
  dossier_id uuid, reference text, client_name text, stage public.dossier_stage, status_label text,
  owner_name text, opened_at timestamptz, updated_at timestamptz, days_since_update int,
  container_number text, eta date, ata date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_report_role('admin', 'management', 'ops');
  return query
  select d.id, d.reference, c.name, d.stage, public.status_label(d.stage, d.status), p.full_name,
    d.created_at, d.updated_at, extract(day from now() - d.updated_at)::int,
    k.number, case when k.ata is null then k.eta end, k.ata
  from public.dossiers d
  join public.clients c on c.id = d.client_id
  left join public.profiles p on p.id = d.owner_id
  left join lateral (
    select ct.number, ct.eta, ct.ata from public.dossier_containers dc
    join public.containers ct on ct.id = dc.container_id
    where dc.dossier_id = d.id and dc.removed_at is null
  ) k on true
  where d.stage <> 'closing'
  order by d.stage, d.reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retards : paiement 1, solde, dossier sans mise à jour, ETA repoussée, véhicule non réclamé (aucun montant)
-- ---------------------------------------------------------------------------
create function public.report_delays()
returns table (
  dossier_id uuid, reference text, client_name text, kind text, label text, since date, days_late int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Dakar')::date;
  v_stale int := coalesce((public.setting_value('dashboard.stale_dossier_days') #>> '{}')::int, 7);
begin
  perform public.require_report_role('admin', 'management', 'ops', 'accounting');
  return query
  with finance as (select * from public.finance_overview())
  select f.dossier_id, f.reference, f.client_name, 'payment1_overdue'::text, 'Paiement 1 en retard'::text,
    (f.payment1_due_at at time zone 'Africa/Dakar')::date,
    v_today - (f.payment1_due_at at time zone 'Africa/Dakar')::date
  from finance f
  where f.stage <> 'closing' and f.has_accepted_quote and f.payment1_remaining_cents > 0
    and f.payment1_due_at < now()
  union all
  -- Lot remporté sans devis accepté : échéance du paiement 1 fixée au dossier (comme le tableau de bord).
  select d.id, d.reference, c.name, 'payment1_overdue', 'Paiement 1 en retard',
    (d.payment1_due_at at time zone 'Africa/Dakar')::date,
    v_today - (d.payment1_due_at at time zone 'Africa/Dakar')::date
  from public.dossiers d join public.clients c on c.id = d.client_id
  where d.stage = 'purchase' and d.payment1_due_at < now()
    and not exists (select 1 from public.financial_documents q
                    where q.dossier_id = d.id and q.doc_type = 'quote' and q.status = 'accepted')
    and not exists (select 1 from public.dossier_confirmations k
                    where k.dossier_id = d.id and k.code = 'payment1_received')
  union all
  select f.dossier_id, f.reference, f.client_name, 'balance_overdue', 'Solde en retard',
    (f.balance_due_at at time zone 'Africa/Dakar')::date,
    v_today - (f.balance_due_at at time zone 'Africa/Dakar')::date
  from finance f
  where f.stage <> 'closing' and f.payment1_remaining_cents = 0 and f.balance_remaining_cents > 0
    and f.balance_due_at < now()
  union all
  select d.id, d.reference, c.name, 'stale', 'Dossier sans mise à jour',
    (d.updated_at at time zone 'Africa/Dakar')::date,
    v_today - (d.updated_at at time zone 'Africa/Dakar')::date
  from public.dossiers d join public.clients c on c.id = d.client_id
  where d.stage <> 'closing' and d.updated_at < now() - make_interval(days => v_stale)
  union all
  -- ETA repoussée : ETA en vigueur postérieure à la première ETA connue (conteneur pas encore arrivé).
  select d.id, d.reference, c.name, 'eta_postponed', 'ETA indicative repoussée',
    h.first_eta, (ct.eta - h.first_eta)::int
  from public.dossiers d
  join public.clients c on c.id = d.client_id
  join public.dossier_containers dc on dc.dossier_id = d.id and dc.removed_at is null
  join public.containers ct on ct.id = dc.container_id
  join lateral (
    select eh.eta as first_eta from public.eta_history eh where eh.container_id = ct.id order by eh.changed_at limit 1
  ) h on true
  where d.stage <> 'closing' and ct.ata is null and ct.eta > h.first_eta
  union all
  select u.dossier_id, u.reference, c.name, 'unclaimed', 'Véhicule non réclamé (J+' || u.days_since_arrival || ')',
    u.reminder_due_on, v_today - u.reminder_due_on
  from public.unclaimed_overview() u
  join public.dossiers d on d.id = u.dossier_id
  join public.clients c on c.id = d.client_id
  where u.applies and u.next_step in ('reminder', 'formal_notice', 'procedure') and v_today >= u.reminder_due_on
  order by 7 desc, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Créances par client à une date : reste dû (devis acceptés, F9), réparti par ancienneté de l'échéance.
-- Paiement 1 à son échéance ; reste (solde) à l'échéance de la facture de solde, « non échu » sans facture.
-- ---------------------------------------------------------------------------
create function public.report_receivables(p_as_of date default null)
returns table (
  client_id uuid, client_name text, dossiers int, total_cents bigint, not_due_cents bigint,
  overdue_1_30_cents bigint, overdue_31_60_cents bigint, overdue_over_60_cents bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Africa/Dakar')::date);
begin
  perform public.require_report_role('admin', 'management', 'accounting');
  return query
  with finance as (
    select f.*, d.client_id from public.finance_overview() f join public.dossiers d on d.id = f.dossier_id
    where f.has_accepted_quote and f.dossier_status <> 'cancelled'
  ),
  parts as (
    select f.client_id, f.client_name, f.dossier_id, f.payment1_remaining_cents as amount,
      v_as_of - (f.payment1_due_at at time zone 'Africa/Dakar')::date as overdue_days
    from finance f where f.payment1_remaining_cents > 0
    union all
    select f.client_id, f.client_name, f.dossier_id,
      greatest(f.balance_remaining_cents - f.payment1_remaining_cents, 0),
      v_as_of - (f.balance_due_at at time zone 'Africa/Dakar')::date
    from finance f where f.balance_remaining_cents - f.payment1_remaining_cents > 0
  )
  select p.client_id, p.client_name, count(distinct p.dossier_id)::int, sum(p.amount)::bigint,
    coalesce(sum(p.amount) filter (where p.overdue_days is null or p.overdue_days <= 0), 0)::bigint,
    coalesce(sum(p.amount) filter (where p.overdue_days between 1 and 30), 0)::bigint,
    coalesce(sum(p.amount) filter (where p.overdue_days between 31 and 60), 0)::bigint,
    coalesce(sum(p.amount) filter (where p.overdue_days > 60), 0)::bigint
  from parts p
  group by p.client_id, p.client_name
  order by 4 desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Délais : lot remporté → départ → arrivée à Dakar → remise des documents → enlèvement (arrivées de la période)
-- ---------------------------------------------------------------------------
create function public.report_transit_times(p_from date, p_to date)
returns table (
  dossier_id uuid, reference text, client_name text, carrier_name text, port_of_loading text,
  won_on date, departed_on date, arrived_on date, released_on date, collected_on date,
  days_won_to_departure int, days_at_sea int, days_won_to_arrival int, days_arrival_to_collection int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_report_role('admin', 'management', 'ops');
  return query
  select d.id, d.reference, c.name, k.carrier, k.port_of_loading,
    (d.lot_won_notified_at at time zone 'Africa/Dakar')::date, k.departed_on, k.ata,
    (r.released_at at time zone 'Africa/Dakar')::date, (d.collected_at at time zone 'Africa/Dakar')::date,
    k.departed_on - (d.lot_won_notified_at at time zone 'Africa/Dakar')::date,
    k.ata - k.departed_on,
    k.ata - (d.lot_won_notified_at at time zone 'Africa/Dakar')::date,
    (d.collected_at at time zone 'Africa/Dakar')::date - k.ata
  from public.dossiers d
  join public.clients c on c.id = d.client_id
  join lateral (
    select ct.ata, ct.departed_on, ct.port_of_loading, ca.name as carrier
    from public.dossier_containers dc
    join public.containers ct on ct.id = dc.container_id
    join public.carriers ca on ca.id = ct.carrier_id
    where dc.dossier_id = d.id and dc.removed_at is null
  ) k on true
  left join public.document_releases r on r.dossier_id = d.id
  where k.ata between p_from and p_to
  order by k.ata, d.reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- Marge par véhicule (admin, direction) : forfaits A + B + ajustements D approuvés (HT), moins les coûts internes
-- saisis. L'option C (assurance) est indiquée à part : aucun coût interne d'assurance n'est saisi (hypothèse).
-- Sans coût saisi, la marge n'est pas calculable (null), jamais « 100 % ». Devis acceptés dans la période.
-- ---------------------------------------------------------------------------
create function public.report_margins(p_from date, p_to date)
returns table (
  dossier_id uuid, reference text, client_name text, vehicle text, accepted_on date,
  revenue_cents bigint, insurance_cents bigint, costs_cents bigint, cost_lines int, costs_final boolean,
  margin_cents bigint, margin_percent numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_report_role('admin', 'management');
  return query
  select d.id, d.reference, c.name,
    nullif(trim(concat_ws(' ', d.make, d.model, d.model_year::text)), ''),
    (q.decided_at at time zone 'Africa/Dakar')::date,
    rev.amount, case when q.insurance_choice = 'accepted' then q.insurance_premium_cents else 0 end,
    coalesce(ic.amount, 0)::bigint, coalesce(ic.lines, 0)::int, coalesce(ic.lines > 0 and ic.all_final, false),
    case when coalesce(ic.lines, 0) > 0 then rev.amount - ic.amount end,
    case when coalesce(ic.lines, 0) > 0 and rev.amount > 0
      then round((rev.amount - ic.amount) * 100.0 / rev.amount, 1) end
  from public.financial_documents q
  join public.dossiers d on d.id = q.dossier_id
  join public.clients c on c.id = d.client_id
  cross join lateral (
    select (q.forfait_a_cents + q.forfait_b_cents + coalesce((
      select sum(a.amount_cents) from public.adjustments a where a.dossier_id = d.id and a.status = 'approved'
    ), 0))::bigint as amount
  ) rev
  left join lateral (
    select sum(i.amount_cents)::bigint as amount, count(*)::int as lines, bool_and(i.status = 'final') as all_final
    from public.internal_costs i where i.dossier_id = d.id
  ) ic on true
  where q.doc_type = 'quote' and q.status = 'accepted' and d.status <> 'cancelled'
    and (q.decided_at at time zone 'Africa/Dakar')::date between p_from and p_to
  order by q.decided_at, d.reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal des exports (règle 5 : accès aux données sensibles tracé)
-- ---------------------------------------------------------------------------
create function public.log_report_export(p_report text, p_filters jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_internal() then
    raise exception 'Réservé aux utilisateurs internes.' using errcode = '42501';
  end if;
  if p_report not in ('active_dossiers', 'delays', 'receivables', 'transit_times', 'margins') then
    raise exception 'Rapport inconnu.' using errcode = '22023';
  end if;
  perform public.log_audit('export_report', 'report', p_report, null, coalesce(p_filters, '{}'::jsonb));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'report_active_dossiers()', 'report_delays()', 'report_receivables(date)', 'report_transit_times(date, date)',
    'report_margins(date, date)', 'log_report_export(text, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
