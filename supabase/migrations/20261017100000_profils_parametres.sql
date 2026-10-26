-- Phase 1 — rôles, profils, paramètres contractuels versionnés.
-- Sources : docs/12_roles_permissions.md, docs/15_user_stories.md (US-1.0 à US-1.3),
-- décisions A3, A4, X7 (docs/00_points_de_clarification.md).

-- ---------------------------------------------------------------------------
-- Rôles et profils
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'ops', 'accounting', 'management', 'client');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null check (length(trim(full_name)) > 0),
  role public.app_role not null,
  client_id uuid,                    -- clé étrangère vers clients ajoutée en phase 2 (rôle client uniquement)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Utilisateurs de l’application et leur rôle (créés par l’administrateur, décision A3).';

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Paramètres contractuels (CLAUDE.md règle 4) : versions datées, jamais modifiées ni supprimées.
-- ---------------------------------------------------------------------------
create table public.settings (
  key text not null check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  value jsonb not null,              -- peut valoir le JSON null (« non défini »)
  value_type text not null check (
    value_type ~ '^(string|number|integer|money|boolean|integer\[\]|string\[\]|enum:[a-z0-9_|]+)$'
  ),                                 -- money : centimes USD entiers
  status text not null check (status in ('confirme', 'a_confirmer')),
  source text,
  reason text,                       -- motif de la modification (saisi par l’administrateur)
  effective_from timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (key, effective_from)
);

comment on table public.settings is 'Paramètres contractuels versionnés (cahier des charges §6). Une modification = une nouvelle ligne.';
comment on column public.settings.effective_from is 'Date d’effet : un dossier applique les valeurs en vigueur à son ouverture (décision X7).';

-- Historique intangible : aucune modification ni suppression, même par le propriétaire des tables.
create function public.forbid_update_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Table % : modification et suppression interdites (historique conservé).', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger settings_immutable
  before update or delete on public.settings
  for each row execute function public.forbid_update_delete();

-- Pas d’antidatage par un utilisateur : une nouvelle version prend effet maintenant ou plus tard.
create function public.settings_check_effective_from() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and new.effective_from < now() - interval '1 minute' then
    raise exception 'La date d’effet d’un paramètre ne peut pas être antérieure à maintenant.'
      using errcode = '22023';
  end if;
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger settings_effective_from
  before insert on public.settings
  for each row execute function public.settings_check_effective_from();

-- Valeur d’un paramètre à une date donnée (X7) et valeur en vigueur.
create function public.setting_as_of(p_key text, p_at timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select s.value
  from public.settings s
  where s.key = p_key and s.effective_from <= p_at
  order by s.effective_from desc
  limit 1;
$$;

create function public.setting_value(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.setting_as_of(p_key, now());
$$;

create view public.settings_current with (security_invoker = true) as
  select distinct on (s.key)
    s.key, s.value, s.value_type, s.status, s.source, s.reason, s.effective_from, s.created_by, s.created_at
  from public.settings s
  where s.effective_from <= now()
  order by s.key, s.effective_from desc;

-- ---------------------------------------------------------------------------
-- Contrôle d’accès
-- ---------------------------------------------------------------------------

-- Le rôle exige-t-il la double authentification ? (paramètre auth.mfa_required_roles, décision A4)
create function public.role_requires_mfa(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.setting_value('auth.mfa_required_roles') ? p_role::text, false);
$$;

-- Rôle effectif de l’utilisateur connecté. NULL (aucun accès) si : pas de profil, compte désactivé,
-- ou MFA exigée pour ce rôle et session non validée par le second facteur (aal2).
-- La MFA est ainsi garantie par la base, pas seulement par l’interface.
create function public.current_role_app() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and (
      coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not public.role_requires_mfa(p.role)
    );
$$;

create function public.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'ops', 'accounting', 'management'), false);
$$;

create function public.current_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.client_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'client' and public.current_role_app() = 'client';
$$;

-- État d’accès de l’utilisateur connecté, lisible même avant la validation MFA,
-- pour que l’application sache s’il doit enrôler ou vérifier son second facteur.
create function public.my_access() returns table (
  role public.app_role,
  active boolean,
  full_name text,
  mfa_required boolean,
  aal text
)
language sql stable security definer set search_path = '' as $$
  select p.role, p.active, p.full_name, public.role_requires_mfa(p.role), coalesce(auth.jwt() ->> 'aal', 'aal1')
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Fonctions internes : pas d’appel direct par l’API (les politiques RLS les appellent en tant que propriétaire).
revoke execute on function public.setting_as_of(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.setting_value(text) from public, anon, authenticated;
revoke execute on function public.role_requires_mfa(public.app_role) from public, anon, authenticated;
revoke execute on function public.forbid_update_delete() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.settings_check_effective_from() from public, anon, authenticated;
revoke execute on function public.current_role_app() from public, anon;
revoke execute on function public.is_internal() from public, anon;
revoke execute on function public.current_client_id() from public, anon;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.current_role_app() to authenticated;
grant execute on function public.is_internal() to authenticated;
grant execute on function public.current_client_id() to authenticated;
grant execute on function public.my_access() to authenticated;

-- ---------------------------------------------------------------------------
-- Garde-fou : toujours au moins un administrateur actif.
-- ---------------------------------------------------------------------------
-- security definer : le contrôle doit voir tous les profils, quelle que soit la RLS de l’auteur.
create function public.ensure_active_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'Opération refusée : il doit rester au moins un administrateur actif.'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function public.ensure_active_admin() from public, anon, authenticated;

create trigger profiles_keep_one_admin
  after update or delete on public.profiles
  for each statement execute function public.ensure_active_admin();

-- ---------------------------------------------------------------------------
-- RLS (docs/12_roles_permissions.md)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;

-- Utilisateurs : admin L E ; direction L ; chacun lit son propre profil.
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_select_admin_management on public.profiles for select to authenticated
  using ((select public.current_role_app()) in ('admin', 'management'));
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check ((select public.current_role_app()) = 'admin');
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.current_role_app()) = 'admin')
  with check ((select public.current_role_app()) = 'admin');

revoke delete, truncate on public.profiles from anon, authenticated;

-- Paramètres : lecture par les rôles internes ; nouvelle version par l’administrateur uniquement.
create policy settings_select_internal on public.settings for select to authenticated
  using ((select public.is_internal()));
create policy settings_insert_admin on public.settings for insert to authenticated
  with check ((select public.current_role_app()) = 'admin');

revoke update, delete, truncate on public.settings from anon, authenticated;
revoke all on public.settings_current from anon;
