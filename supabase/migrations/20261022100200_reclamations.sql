-- Phase 6, lot 6d — réclamations après l'enlèvement (contrat art. 19, décision P6-3).
-- Après l'enlèvement du véhicule, l'agent OU le client dépose une réclamation (réserves, photos). Le délai est de
-- `claim.business_days_after_pickup` jours ouvrés à compter de l'enlèvement ; au-delà, la réclamation est « hors
-- délai ». USA CARS la traite (transmise aux tiers, résolue ou rejetée) et le client en suit l'avancement (docs/12).

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  source text not null check (source in ('agent', 'client')),
  reserves text not null check (length(trim(reserves)) > 0),
  filed_by uuid references public.profiles (id) default auth.uid(),
  filed_at timestamptz not null default now(),
  collected_at timestamptz not null,                 -- enlèvement de référence (délai de l'art. 19)
  deadline_at timestamptz not null,                  -- collected_at + N jours ouvrés
  out_of_time boolean not null,                      -- déposée après le délai (recours tiers compromis, art. 19)
  status text not null default 'open' check (status in ('open', 'forwarded', 'resolved', 'rejected')),
  response text,
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((response is null) = (responded_at is null))
);

comment on table public.claims is 'Réclamations après l''enlèvement (art. 19). Écriture par fonctions seulement.';

alter table public.documents add column claim_id uuid references public.claims (id);
comment on column public.documents.claim_id is 'Photo rattachée à une réclamation (lot 6d), le cas échéant.';

-- Audit (règle 5) : dépôt et traitement des réclamations, quel que soit l'auteur (agent ou client).
create trigger claims_audit after insert or update or delete on public.claims
  for each row execute function public.audit_row();

alter table public.claims enable row level security;

-- Lecture : internes ; un client lit les siennes (règle 3).
create policy claims_select on public.claims for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));

-- Écriture par fonctions seulement (comme les pièces financières) : aucune politique insert/update directe.
revoke insert, update, delete on public.claims from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Déposer une réclamation : agent (admin, opérations) ou client propriétaire du dossier, après l'enlèvement.
-- ---------------------------------------------------------------------------
create function public.file_claim(p_dossier_id uuid, p_reserves text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_client_id uuid := public.current_client_id();
  v_internal boolean := public.is_operations_writer();
  v_source text;
  v_days int := coalesce((public.setting_value('claim.business_days_after_pickup') #>> '{}')::int, 3);
  v_deadline timestamptz;
  v_id uuid;
begin
  select * into v_dossier from public.dossiers where id = p_dossier_id;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_internal then
    v_source := 'agent';
  elsif v_client_id is not null and v_dossier.client_id = v_client_id then
    v_source := 'client';
  else
    raise exception 'Réclamation non autorisée pour ce dossier.' using errcode = '42501';
  end if;
  if v_dossier.collected_at is null then
    raise exception 'Réclamation possible seulement après l''enlèvement du véhicule.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reserves, ''))) = 0 then
    raise exception 'Décrivez vos réserves.' using errcode = '22023';
  end if;

  v_deadline := public.add_business_days(v_dossier.collected_at, v_days);
  insert into public.claims (dossier_id, client_id, source, reserves, collected_at, deadline_at, out_of_time)
  values (p_dossier_id, v_dossier.client_id, v_source, trim(p_reserves), v_dossier.collected_at, v_deadline,
          now() > v_deadline)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Traiter une réclamation : admin et opérations. Le client est informé (notification claim_update).
-- ---------------------------------------------------------------------------
create function public.respond_to_claim(p_claim_id uuid, p_status text, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.claims%rowtype;
  v_reference text;
begin
  if not public.is_operations_writer() then
    raise exception 'Traitement réservé à l''administrateur et aux opérations.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'forwarded', 'resolved', 'rejected') then
    raise exception 'Statut de réclamation inconnu.' using errcode = '22023';
  end if;
  select * into v_claim from public.claims where id = p_claim_id;
  if not found then
    raise exception 'Réclamation introuvable.' using errcode = '22023';
  end if;

  update public.claims
    set status = p_status,
        response = nullif(trim(coalesce(p_response, '')), ''),
        responded_by = case when nullif(trim(coalesce(p_response, '')), '') is not null then auth.uid() else responded_by end,
        responded_at = case when nullif(trim(coalesce(p_response, '')), '') is not null then now() else responded_at end
    where id = p_claim_id;

  select reference into v_reference from public.dossiers where id = v_claim.dossier_id;
  -- Le client est informé qu'une réponse est disponible dans son espace (sans détail sensible).
  perform public.enqueue_notification(v_claim.client_id, v_claim.dossier_id, 'claim_update',
    jsonb_build_object('reference', v_reference), 'claim_' || p_claim_id::text || '_' || p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo d'une réclamation : enregistrement de la pièce (le fichier est déposé dans le bucket par l'appelant).
-- Agent (admin, opérations) ou client propriétaire. Visible du client (c'est sa réclamation).
-- ---------------------------------------------------------------------------
create function public.register_claim_photo(
  p_claim_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256 text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.claims%rowtype;
  v_client_id uuid := public.current_client_id();
  v_id uuid;
begin
  select * into v_claim from public.claims where id = p_claim_id;
  if not found then
    raise exception 'Réclamation introuvable.' using errcode = '22023';
  end if;
  if not (public.is_operations_writer() or v_claim.client_id = v_client_id) then
    raise exception 'Ajout de photo non autorisé.' using errcode = '42501';
  end if;
  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes,
                                sha256, visible_client, claim_id)
  values (v_claim.dossier_id, v_claim.client_id, 'photos', p_storage_path, left(p_file_name, 200), p_mime_type,
          p_size_bytes, p_sha256, true, p_claim_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Dépôt du fichier dans le bucket privé par un client, limité à ses propres dossiers (chemin dossiers/<id>/…).
create policy documents_bucket_insert_client on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'dossiers'
    and (storage.foldername(name))[2] in (
      select d.id::text from public.dossiers d where d.client_id = (select public.current_client_id())
    )
  );

-- ---------------------------------------------------------------------------
-- Vue de suivi : réclamations avec le libellé d'échéance et le nombre de photos. Lecture filtrée par la RLS des claims.
-- ---------------------------------------------------------------------------
create view public.claims_overview with (security_invoker = true) as
  select c.*, d.reference, cl.name as client_name,
    (select count(*) from public.documents p where p.claim_id = c.id) as photo_count
  from public.claims c
  join public.dossiers d on d.id = c.dossier_id
  join public.clients cl on cl.id = c.client_id;

do $$
declare
  f text;
begin
  foreach f in array array['file_claim(uuid, text)', 'respond_to_claim(uuid, text, text)',
    'register_claim_photo(uuid, text, text, text, bigint, text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- Notification « réponse à une réclamation » (docs/19, textes à valider) : nouvelle valeur du modèle.
alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications add constraint notifications_template_check check (template in (
  'login_link', 'lot_won', 'quote_issued', 'payment_due_reminder', 'vessel_departed', 'eta_changed', 'arrived',
  'documents_ready', 'payment_overdue', 'test_message', 'unclaimed_reminder', 'formal_notice', 'claim_update'
));
