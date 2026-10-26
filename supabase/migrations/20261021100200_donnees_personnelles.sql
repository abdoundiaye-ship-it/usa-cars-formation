-- Phase 6, lot 6b — données personnelles (contrat art. 33, loi n° 2008-12) : page « Confidentialité » du portail
-- (G1-a) et durées de conservation après la clôture (G2-a : 10 ans pour les pièces comptables, 5 ans pour les autres
-- données, à confirmer). Rapport des dossiers dont la durée est atteinte ; la purge reste manuelle, hors application.

-- ---------------------------------------------------------------------------
-- Décision G2-a : « autres données » 5 ans (le paramètre data.retention_years était vide). Nouvelle version datée ;
-- la version initiale reste dans l'historique (règle X7, CLAUDE.md règle 4).
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, value_type, status, source, reason, effective_from) values
  ('data.retention_years', '5'::jsonb, 'integer', 'a_confirmer', 'Décision G2-a du 21/10/2026 (valeur par défaut)',
   'Données hors pièces comptables conservées 5 ans après la clôture ; à reporter dans l’article 33 du contrat.',
   '2026-10-21T00:00:00Z')
on conflict (key, effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- Date de clôture : point de départ des durées de conservation (art. 33 « après la clôture de l'Opération »).
-- Dossier clôturé = étape « Clôture » au statut Terminé, Archivé ou Annulé (réclamation, litige, suspension et
-- procédure « non réclamé » ne sont pas une fin d'opération). Renseignée par la base, jamais saisie.
-- ---------------------------------------------------------------------------
alter table public.dossiers add column closed_at timestamptz;

comment on column public.dossiers.closed_at is
  'Clôture de l''opération (Terminé, Archivé ou Annulé) : point de départ des durées de conservation ; renseignée par la base.';

create function public.dossier_is_closed(p_stage public.dossier_stage, p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage = 'closing' and p_status in ('completed', 'archived', 'cancelled');
$$;

create function public.dossiers_set_closed_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.dossier_is_closed(new.stage, new.status) then
    new.closed_at := null;                           -- réouverture (réclamation, litige…) : le délai repart
  elsif tg_op = 'INSERT' or not public.dossier_is_closed(old.stage, old.status) then
    new.closed_at := now();
  else
    new.closed_at := old.closed_at;                  -- Terminé → Archivé : même clôture ; jamais modifiée directement
  end if;
  return new;
end;
$$;

revoke execute on function public.dossiers_set_closed_at() from public, anon, authenticated;

-- Dossiers déjà clôturés (avant le déclencheur, qui empêche toute modification directe) : dernier changement
-- d'étape ou de statut d'après la chronologie.
update public.dossiers d set closed_at = coalesce((
    select max(e.occurred_at) from public.dossier_events e
    where e.dossier_id = d.id and e.kind in ('stage_changed', 'status_changed')
  ), d.updated_at)
  where public.dossier_is_closed(d.stage, d.status);

create trigger dossiers_set_closed_at
  before insert or update on public.dossiers
  for each row execute function public.dossiers_set_closed_at();

-- ---------------------------------------------------------------------------
-- Rapport « Conservation des données » (admin, direction) : dossiers clôturés dont une durée de conservation est
-- atteinte à la date choisie. « Autres données » : identité, pièces, suivi, notifications ; « pièces comptables » :
-- devis, factures, reçus, paiements. Une durée vide n'est jamais atteinte. Aucune suppression ici (G2-a).
-- ---------------------------------------------------------------------------
create function public.report_retention(p_as_of date default null)
returns table (
  dossier_id uuid, reference text, client_name text, status_label text, closed_on date,
  other_data_until date, accounting_until date, scope text, documents int, financial_documents int,
  client_dossiers_kept int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Africa/Dakar')::date);
  v_other int := (public.setting_value('data.retention_years') #>> '{}')::int;
  v_accounting int := (public.setting_value('data.retention_years_accounting') #>> '{}')::int;
begin
  perform public.require_report_role('admin', 'management');
  return query
  with closed as (
    select d.id, d.reference, d.client_id, c.name, public.status_label(d.stage, d.status) as status_label,
      (d.closed_at at time zone 'Africa/Dakar')::date as closed_on
    from public.dossiers d join public.clients c on c.id = d.client_id
    where d.closed_at is not null
  ),
  limits as (
    select k.*,
      (k.closed_on + make_interval(years => v_other))::date as other_until,
      (k.closed_on + make_interval(years => v_accounting))::date as accounting_until
    from closed k
  )
  select l.id, l.reference, l.name, l.status_label, l.closed_on, l.other_until, l.accounting_until,
    case
      when l.other_until <= v_as_of and l.accounting_until <= v_as_of then 'all'
      when l.other_until <= v_as_of then 'other_data'
      else 'accounting'
    end,
    (select count(*)::int from public.documents x where x.dossier_id = l.id),
    (select count(*)::int from public.financial_documents f where f.dossier_id = l.id),
    -- Autres dossiers du client encore conservés : son identité ne peut pas être purgée avec ce dossier.
    (select count(*)::int from public.dossiers o
      where o.client_id = l.client_id and o.id <> l.id
        and (o.closed_at is null or v_other is null
             or ((o.closed_at at time zone 'Africa/Dakar')::date + make_interval(years => v_other))::date > v_as_of))
  from limits l
  where l.other_until <= v_as_of or l.accounting_until <= v_as_of
  order by l.closed_on, l.reference;
end;
$$;

-- Journal des exports : rapport « retention » ajouté (lot 6a : log_report_export).
create or replace function public.log_report_export(p_report text, p_filters jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_internal() then
    raise exception 'Réservé aux utilisateurs internes.' using errcode = '42501';
  end if;
  if p_report not in ('active_dossiers', 'delays', 'receivables', 'transit_times', 'margins', 'retention') then
    raise exception 'Rapport inconnu.' using errcode = '22023';
  end if;
  perform public.log_audit('export_report', 'report', p_report, null, coalesce(p_filters, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Page « Confidentialité » (G1-a) : les seules valeurs utiles au client, lues sans accès à la table settings
-- (réservée aux internes). Coordonnées officielles de USA CARS et durées de conservation ; rien d'autre.
-- ---------------------------------------------------------------------------
create function public.privacy_notice() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'office_address', public.setting_value('company.office_address'),
    'email', public.setting_value('company.email'),
    'phone', public.setting_value('company.phone'),
    'retention_years', public.setting_value('data.retention_years'),
    'retention_years_accounting', public.setting_value('data.retention_years_accounting'),
    'validated', coalesce((public.setting_value('data.privacy_notice_validated') #>> '{}')::boolean, false)
  )
  where auth.uid() is not null;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['report_retention(date)', 'privacy_notice()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
