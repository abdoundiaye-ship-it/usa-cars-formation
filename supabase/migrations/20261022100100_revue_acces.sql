-- Phase 6, lot 6c — revue des accès (US-6.2, production) : liste des comptes internes, leur rôle, leur état, la
-- configuration de la double authentification et leur dernière connexion. Réservée à l'administrateur et à la
-- direction (docs/12) ; vérifiée EN BASE comme les autres rapports (require_report_role). Lecture seule.

create function public.report_access_review()
returns table (
  user_id uuid, full_name text, email text, role public.app_role, active boolean,
  mfa_required boolean, mfa_configured boolean, last_sign_in_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_report_role('admin', 'management');
  return query
  select p.id, p.full_name, p.email, p.role, p.active,
    public.role_requires_mfa(p.role),
    exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp'),
    u.last_sign_in_at, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'client'       -- comptes internes ; les accès des clients se revoient sur chaque fiche client
  order by p.active desc, p.role, p.full_name;
end;
$$;

-- Journal des exports : rapport « access_review » ajouté (lots 6a/6b : log_report_export).
create or replace function public.log_report_export(p_report text, p_filters jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_internal() then
    raise exception 'Réservé aux utilisateurs internes.' using errcode = '42501';
  end if;
  if p_report not in ('active_dossiers', 'delays', 'receivables', 'transit_times', 'margins', 'retention', 'access_review') then
    raise exception 'Rapport inconnu.' using errcode = '22023';
  end if;
  perform public.log_audit('export_report', 'report', p_report, null, coalesce(p_filters, '{}'::jsonb));
end;
$$;

revoke execute on function public.report_access_review() from public, anon;
grant execute on function public.report_access_review() to authenticated;
