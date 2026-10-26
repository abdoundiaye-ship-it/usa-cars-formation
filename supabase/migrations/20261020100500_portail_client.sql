-- Phase 4, lot 4a — portail client (US-4.1 à US-4.4, R15, R16, décisions I3-a, P4-1).
-- CLAUDE.md règles 2 (aucun coût interne côté client), 3 (isolation client), 5 (audit), 9 (service_role côté serveur).

-- ---------------------------------------------------------------------------
-- Liens de connexion à usage unique (I3-a) : envoyés par e-mail et par WhatsApp, valables
-- {client_auth.link_ttl_minutes} minutes. Seule l'empreinte SHA-256 du jeton est conservée. Table réservée au
-- serveur (clé service_role) : aucune politique, aucun accès par l'API.
-- ---------------------------------------------------------------------------
create table public.client_login_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel text not null check (channel in ('email', 'whatsapp', 'invitation')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);

comment on table public.client_login_tokens is
  'Liens de connexion des clients (usage unique, expiration courte) ; empreinte du jeton uniquement.';

create index client_login_tokens_user_idx on public.client_login_tokens (user_id, created_at desc);

alter table public.client_login_tokens enable row level security;
revoke all on public.client_login_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accès au portail : un compte de connexion (auth.users, créé par le serveur) rattaché à un client.
-- L'agent (ou l'administrateur) l'ouvre depuis la fiche client ; profil « client » créé ici, journalisé.
-- ---------------------------------------------------------------------------
create function public.register_client_portal_access(p_user_id uuid, p_client_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients%rowtype;
begin
  if not public.is_operations_writer() then
    raise exception 'Accès au portail ouvert par l’administrateur ou un agent opérations.' using errcode = '42501';
  end if;
  select * into v_client from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'Client introuvable.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Compte de connexion introuvable.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Ce compte est déjà rattaché.' using errcode = '22023';
  end if;
  insert into public.profiles (id, email, full_name, role, client_id)
  values (p_user_id, p_email, v_client.name, 'client', p_client_id);
  perform public.log_audit('client_portal_access', 'clients', p_client_id::text, null,
    jsonb_build_object('user_id', p_user_id, 'email', p_email));
end;
$$;

-- Comptes du portail d'un client (fiche client) : internes uniquement ; dernière connexion comprise.
create function public.client_portal_accounts(p_client_id uuid)
returns table (user_id uuid, email text, active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.email, p.active, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.client_id = p_client_id and p.role = 'client' and public.is_internal()
  order by p.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Téléchargement par le client de ses documents visibles (US-4.3) : lien signé, bucket privé.
-- ---------------------------------------------------------------------------
create policy documents_bucket_select_client on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = name and d.visible_client and d.client_id = (select public.current_client_id())
    )
  );

-- Taux en vigueur (montants FCFA indicatifs du portail) : valeur, source, date du relevé — rien d'autre.
create function public.portal_fx_rate() returns table (rate numeric, source text, captured_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.rate, r.source, r.captured_at
  from public.fx_rates r
  where public.current_role_app() is not null
  order by r.captured_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Acceptation dans le portail (R15, US-4.2, US-4.4) : case de consentement + bouton, horodatage, session,
-- adresse IP et version exacte du document affiché (empreinte). Devis : choix d'assurance obligatoire (X1).
-- ---------------------------------------------------------------------------
create function public.accept_in_portal(
  p_subject text, p_subject_id uuid, p_decision text, p_document_sha256 text, p_session text, p_ip inet,
  p_insurance_choice text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.current_client_id();
  v_dossier uuid;
  v_sha text;
  v_id uuid;
begin
  if v_client is null then
    raise exception 'Action réservée au client connecté.' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'refused') then
    raise exception 'Décision inconnue.' using errcode = '22023';
  end if;
  if p_subject = 'quote' then
    select f.dossier_id, f.document_sha256 into v_dossier, v_sha
      from public.financial_documents f
      where f.id = p_subject_id and f.doc_type = 'quote' and f.client_id = v_client;
  elsif p_subject = 'extra_cost' then
    select a.dossier_id, doc.sha256 into v_dossier, v_sha
      from public.adjustments a join public.documents doc on doc.id = a.proof_document_id
      where a.id = p_subject_id and a.kind = 'extra_cost' and a.client_id = v_client;
  else
    raise exception 'Document inconnu.' using errcode = '22023';
  end if;
  if v_dossier is null then
    raise exception 'Document introuvable.' using errcode = '42501';
  end if;
  if v_sha is distinct from p_document_sha256 then
    raise exception 'Le document a changé depuis son affichage : rechargez la page avant de décider.'
      using errcode = '22023';
  end if;
  if coalesce(length(trim(p_session)), 0) < 8 then
    raise exception 'Session invalide.' using errcode = '22023';
  end if;

  -- Les contrôles métier (validité du devis, statut, choix d'assurance) sont ceux des acceptations (triggers).
  insert into public.acceptances (
    dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, portal_ip,
    portal_session, insurance_choice
  )
  select v_dossier, p_subject, p_subject_id, doc.id, v_sha, 'portal', p_decision, now(), p_ip, p_session,
         case when p_subject = 'quote' then p_insurance_choice end
  from public.documents doc where doc.sha256 = v_sha and doc.dossier_id = v_dossier
  order by doc.uploaded_at desc limit 1
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.register_client_portal_access(uuid, uuid, text) from public, anon;
revoke execute on function public.portal_fx_rate() from public, anon;
revoke execute on function public.client_portal_accounts(uuid) from public, anon;
revoke execute on function public.accept_in_portal(text, uuid, text, text, text, inet, text) from public, anon;
grant execute on function public.register_client_portal_access(uuid, uuid, text) to authenticated;
grant execute on function public.portal_fx_rate() to authenticated;
grant execute on function public.client_portal_accounts(uuid) to authenticated;
grant execute on function public.accept_in_portal(text, uuid, text, text, text, inet, text) to authenticated;
