-- Phase 1 — journal d’audit (CLAUDE.md règle 5, US-1.4).
-- Alimenté uniquement par des triggers et par la fonction log_audit ; jamais modifié ni supprimé.

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,                     -- NULL : action système ou script (actor_label)
  actor_role public.app_role,
  actor_label text,                  -- ex. « script:create-admin »
  action text not null,              -- insert, update, delete ou action métier (ex. invite_user)
  object_type text not null,         -- nom de la table ou de l’objet
  object_id text not null,
  before jsonb,                      -- champs modifiés uniquement (update), ligne complète (delete)
  after jsonb,
  reason text
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_object_idx on public.audit_log (object_type, object_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

comment on table public.audit_log is 'Journal d’audit : qui, quel rôle, quelle action, sur quel objet, avant/après, quand.';

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.forbid_update_delete();

-- Rôle de l’auteur tel qu’enregistré dans son profil (indépendamment de l’état MFA de la session).
create function public.actor_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- Trigger générique. Argument 0 : colonne(s) identifiant l’objet, séparées par « , » (défaut : id).
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_id_cols text[] := string_to_array(coalesce(tg_argv[0], 'id'), ',');
  v_object_id text;
  v_before jsonb;
  v_after jsonb;
  v_key text;
begin
  select string_agg(v_row ->> c, '|') into v_object_id from unnest(v_id_cols) as c;

  if tg_op = 'UPDATE' then
    v_before := '{}'::jsonb;
    v_after := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;
    if v_after = '{}'::jsonb then
      return null;                   -- rien de pertinent n’a changé
    end if;
  else
    v_before := v_old;
    v_after := v_new;
  end if;

  insert into public.audit_log (actor_id, actor_role, actor_label, action, object_type, object_id, before, after)
  values (
    auth.uid(),
    public.actor_role(),
    nullif(current_setting('app.actor_label', true), ''),
    lower(tg_op),
    tg_table_name,
    coalesce(v_object_id, '?'),
    v_before,
    v_after
  );
  return null;
end;
$$;

-- Action métier sans modification de ligne (ex. invitation envoyée, exception de workflow).
-- Réservée aux utilisateurs internes ; l’auteur est toujours l’utilisateur connecté.
-- p_actor_label n’est retenu que sans utilisateur connecté (script serveur avec la clé service_role).
create function public.log_audit(
  p_action text,
  p_object_type text,
  p_object_id text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_actor_label text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if auth.uid() is not null and not public.is_internal() then
    raise exception 'Journalisation réservée aux utilisateurs internes.' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_role, actor_label, action, object_type, object_id, before, after, reason)
  values (
    auth.uid(),
    public.actor_role(),
    case when auth.uid() is null
      then coalesce(p_actor_label, nullif(current_setting('app.actor_label', true), ''))
    end,
    p_action, p_object_type, p_object_id, p_before, p_after, p_reason
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.actor_role() from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.log_audit(text, text, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.log_audit(text, text, text, jsonb, jsonb, text, text) to authenticated;

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row('id');

create trigger settings_audit
  after insert on public.settings
  for each row execute function public.audit_row('key');

-- RLS : lecture admin et direction ; aucune écriture directe.
alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.current_role_app()) in ('admin', 'management'));

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
