-- Phase 4, lot 4b — notifications au client par e-mail et WhatsApp (US-4.5, R16, décisions E1–E3, E3-a, E5-a).
-- File d'attente et journal : chaque message (un par canal) est créé ici, puis envoyé par la fonction Supabase
-- send-notifications (adaptateurs Brevo et Twilio ; envoi simulé sans identifiants, CLAUDE.md règle 10).
-- Aucune coordonnée de paiement dans les messages (règle 7) : textes fixes de docs/19, variables limitées.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id),
  dossier_id uuid references public.dossiers (id),
  template text not null check (template in (
    'login_link', 'lot_won', 'quote_issued', 'payment_due_reminder', 'vessel_departed', 'eta_changed', 'arrived',
    'documents_ready', 'payment_overdue', 'test_message'
  )),
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient text not null,
  variables jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'simulated', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  provider_message_id text,
  redirected_to text,                                    -- mode test : destinataire de remplacement
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table public.notifications is
  'Notifications e-mail et WhatsApp (file d’attente et journal) ; jamais de coordonnées de paiement.';

create index notifications_queue_idx on public.notifications (created_at) where status = 'queued';
create index notifications_dossier_idx on public.notifications (dossier_id, created_at desc);
create index notifications_client_idx on public.notifications (client_id, created_at desc);
-- Un rappel ou une relance n'est créé qu'une fois par échéance et par canal.
create unique index notifications_dedupe_idx on public.notifications (dedupe_key, channel) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- Mise en file : un message par canal renseigné sur la fiche client (R16), selon notifications.channels.
-- Un client sans e-mail réel (adresse technique, P4-1) ne reçoit que WhatsApp.
-- ---------------------------------------------------------------------------
create function public.enqueue_notification(
  p_client_id uuid, p_dossier_id uuid, p_template text, p_variables jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients%rowtype;
  v_channels jsonb := coalesce(public.setting_value('notifications.channels'), '["email", "whatsapp"]'::jsonb);
  v_count int := 0;
  v_rows int;
  v_vars jsonb;
begin
  if auth.uid() is not null and not public.is_internal() then
    raise exception 'Notifications réservées aux utilisateurs internes.' using errcode = '42501';
  end if;
  select * into v_client from public.clients c where c.id = p_client_id;
  if not found then
    return 0;
  end if;
  v_vars := jsonb_build_object('nom', v_client.name) || coalesce(p_variables, '{}'::jsonb);
  if v_channels ? 'email' and v_client.notify_email is not null
     and v_client.notify_email not like '%@clients.usacars.invalid' then
    insert into public.notifications (client_id, dossier_id, template, channel, recipient, variables, dedupe_key)
    values (p_client_id, p_dossier_id, p_template, 'email', v_client.notify_email, v_vars, p_dedupe_key)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end if;
  if v_channels ? 'whatsapp' and v_client.notify_phone is not null then
    insert into public.notifications (client_id, dossier_id, template, channel, recipient, variables, dedupe_key)
    values (p_client_id, p_dossier_id, p_template, 'whatsapp', v_client.notify_phone, v_vars, p_dedupe_key)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end if;
  return v_count;
end;
$$;

-- Variables communes d'un dossier : référence et véhicule.
create function public.notification_dossier_vars(p_dossier_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reference', d.reference,
    'vehicule', coalesce(nullif(trim(concat_ws(' ', d.make, d.model, d.model_year::text)), ''), 'votre véhicule')
  )
  from public.dossiers d where d.id = p_dossier_id;
$$;

-- ---------------------------------------------------------------------------
-- Déclencheurs (docs/19) : lot remporté, devis émis, départ, ETA modifiée, arrivée, documents prêts
-- ---------------------------------------------------------------------------
create function public.notify_dossier_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auction_result = 'won' and old.auction_result is distinct from 'won' then
    perform public.enqueue_notification(new.client_id, new.id, 'lot_won',
      public.notification_dossier_vars(new.id)
        || jsonb_build_object('echeance', public.format_datetime_fr(new.payment1_due_at)),
      'lot_won:' || new.id);
  end if;
  if new.ownership_transferred_at is not null and old.ownership_transferred_at is null then
    perform public.enqueue_notification(new.client_id, new.id, 'documents_ready',
      public.notification_dossier_vars(new.id), 'documents_ready:' || new.id);
  end if;
  return null;
end;
$$;

create trigger dossiers_notify
  after update of auction_result, ownership_transferred_at on public.dossiers
  for each row execute function public.notify_dossier_changes();

-- Devis : notifié quand son fichier est prêt (le client peut alors le consulter et l'accepter).
create function public.notify_quote_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.doc_type = 'quote' and new.document_id is not null and old.document_id is null and new.status = 'issued' then
    perform public.enqueue_notification(new.client_id, new.dossier_id, 'quote_issued',
      public.notification_dossier_vars(new.dossier_id) || jsonb_build_object(
        'numero', new.number,
        'total', public.format_usd_fr(new.total_cents),
        'validite', public.format_datetime_fr(new.valid_until)
      ),
      'quote_issued:' || new.id);
  end if;
  return null;
end;
$$;

create trigger financial_documents_notify
  after update of document_id on public.financial_documents
  for each row execute function public.notify_quote_ready();

-- Conteneur : départ, ETA modifiée (tant que l'ATA n'est pas saisie), arrivée — pour chaque dossier affecté.
create function public.notify_container_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier record;
begin
  for v_dossier in
    select d.id, d.client_id from public.dossier_containers dc join public.dossiers d on d.id = dc.dossier_id
    where dc.container_id = new.id and dc.removed_at is null and d.status <> 'cancelled'
  loop
    if new.departed_on is not null and old.departed_on is null then
      perform public.enqueue_notification(v_dossier.client_id, v_dossier.id, 'vessel_departed',
        public.notification_dossier_vars(v_dossier.id) || jsonb_build_object(
          'conteneur', new.number, 'eta', coalesce(public.format_date_fr(new.eta), 'à confirmer')),
        'vessel_departed:' || v_dossier.id || ':' || new.id);
    end if;
    if new.ata is null and old.eta is not null and new.eta is distinct from old.eta then
      perform public.enqueue_notification(v_dossier.client_id, v_dossier.id, 'eta_changed',
        public.notification_dossier_vars(v_dossier.id) || jsonb_build_object(
          'ancienne_eta', public.format_date_fr(old.eta), 'nouvelle_eta', public.format_date_fr(new.eta)),
        null);
    end if;
    if new.ata is not null and old.ata is null then
      perform public.enqueue_notification(v_dossier.client_id, v_dossier.id, 'arrived',
        public.notification_dossier_vars(v_dossier.id) || jsonb_build_object('date', public.format_date_fr(new.ata)),
        'arrived:' || v_dossier.id || ':' || new.id);
    end if;
  end loop;
  return null;
end;
$$;

create trigger containers_notify
  after update of departed_on, eta, ata on public.containers
  for each row execute function public.notify_container_changes();

-- ---------------------------------------------------------------------------
-- Rappels d'échéance (J-{balance.reminder_days_before_due}) et relances (échéance dépassée), chaque matin.
-- ---------------------------------------------------------------------------
create function public.queue_payment_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_days jsonb := coalesce(public.setting_value('balance.reminder_days_before_due'), '[7, 3, 2]'::jsonb);
  v_count int := 0;
  v_left int;
begin
  if auth.uid() is not null and not public.is_internal() then
    raise exception 'Action réservée aux utilisateurs internes.' using errcode = '42501';
  end if;
  for v_row in
    select f.id, f.client_id, f.dossier_id, f.doc_type, f.due_at,
           case f.doc_type when 'deposit_invoice' then b.payment1_remaining_cents else b.balance_remaining_cents end
             as remaining
    from public.financial_documents f
    join public.dossiers d on d.id = f.dossier_id
    cross join lateral public.dossier_balance(f.dossier_id) b
    where f.doc_type in ('deposit_invoice', 'balance_invoice') and f.status = 'issued' and f.due_at is not null
      and d.status <> 'cancelled'
  loop
    continue when v_row.remaining <= 0;
    v_left := ((v_row.due_at at time zone 'Africa/Dakar')::date - (now() at time zone 'Africa/Dakar')::date);
    if v_left < 0 then
      v_count := v_count + public.enqueue_notification(v_row.client_id, v_row.dossier_id, 'payment_overdue',
        public.notification_dossier_vars(v_row.dossier_id) || jsonb_build_object(
          'echeance', case when v_row.doc_type = 'deposit_invoice' then 'paiement 1' else 'solde' end,
          'montant', public.format_usd_fr(v_row.remaining)),
        'payment_overdue:' || v_row.id);
    elsif v_days @> to_jsonb(v_left) then
      v_count := v_count + public.enqueue_notification(v_row.client_id, v_row.dossier_id, 'payment_due_reminder',
        public.notification_dossier_vars(v_row.dossier_id) || jsonb_build_object(
          'echeance', case when v_row.doc_type = 'deposit_invoice' then 'paiement 1' else 'solde' end,
          'montant', public.format_usd_fr(v_row.remaining),
          'date', public.format_datetime_fr(v_row.due_at)),
        'payment_due_reminder:' || v_row.id || ':J-' || v_left);
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Renvoi d'une notification en échec (journal) ; envoi effectif par la fonction send-notifications.
-- ---------------------------------------------------------------------------
create function public.retry_notification(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role_app() is distinct from 'admin' and public.current_role_app() is distinct from 'ops'
     and public.current_role_app() is distinct from 'accounting' then
    raise exception 'Renvoi réservé à l’administrateur, aux agents opérations et à la comptabilité.' using errcode = '42501';
  end if;
  update public.notifications set status = 'queued', last_error = null where id = p_id and status = 'failed';
  if not found then
    raise exception 'Seule une notification en échec peut être renvoyée.' using errcode = '22023';
  end if;
  perform public.log_audit('notification_retry', 'notifications', p_id::text);
end;
$$;

-- Message de test (administrateur) : e-mail à l'administrateur connecté, WhatsApp au numéro de test configuré
-- au déploiement (simulé tant que WhatsApp n'est pas configuré) ; en mode test, tout va aux destinataires de test.
create function public.queue_test_notification() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if public.current_role_app() is distinct from 'admin' then
    raise exception 'Message de test réservé à l’administrateur.' using errcode = '42501';
  end if;
  select p.email into v_email from public.profiles p where p.id = auth.uid();
  insert into public.notifications (template, channel, recipient, variables)
  values ('test_message', 'email', coalesce(v_email, 'test'), '{"nom": "Test USA CARS"}'::jsonb),
         ('test_message', 'whatsapp', 'test', '{"nom": "Test USA CARS"}'::jsonb);
  perform public.log_audit('notification_test', 'notifications', 'test');
  return 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fonction d'envoi (clé service_role uniquement) : réserve des messages en file, puis enregistre le résultat.
-- Le lien de connexion (login_link) est effacé du journal une fois traité : il donne accès à l'espace du client.
-- ---------------------------------------------------------------------------
create function public.claim_notifications(p_limit int default 25)
returns setof public.notifications
language sql security definer set search_path = '' as $$
  update public.notifications n set status = 'sending', attempts = n.attempts + 1
  where n.id in (
    select q.id from public.notifications q where q.status = 'queued' order by q.created_at
    limit greatest(p_limit, 1) for update skip locked
  )
  returning n.*;
$$;

create function public.complete_notification(
  p_id uuid, p_status text, p_error text default null, p_provider_message_id text default null,
  p_redirected_to text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent', 'simulated', 'failed') then
    raise exception 'Statut inconnu.' using errcode = '22023';
  end if;
  update public.notifications
    set status = p_status, last_error = left(p_error, 500), provider_message_id = p_provider_message_id,
        redirected_to = p_redirected_to, sent_at = case when p_status in ('sent', 'simulated') then now() end,
        variables = case when template = 'login_link' then variables - 'lien' || '{"lien": "[lien masqué]"}'::jsonb
                         else variables end
    where id = p_id and status = 'sending';
end;
$$;

revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.complete_notification(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.complete_notification(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Envoi programmé : chaque minute, la base appelle la fonction send-notifications (pg_net) si son adresse et sa
-- clé ont été enregistrées au déploiement dans le coffre Supabase (Vault) :
--   select vault.create_secret('https://<projet>.supabase.co/functions/v1/send-notifications', 'notifications_dispatch_url');
--   select vault.create_secret('<clé service_role>', 'notifications_dispatch_key');
-- Sans ces secrets (développement local), rien n'est appelé : l'application déclenche l'envoi elle-même.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create function public.dispatch_notifications() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.notifications where status = 'queued') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notifications_dispatch_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notifications_dispatch_key';
  if v_url is null or v_key is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

select cron.schedule('usa-cars-dispatch-notifications', '* * * * *', $$select public.dispatch_notifications()$$);
select cron.schedule('usa-cars-payment-notifications', '0 8 * * *', $$select public.queue_payment_notifications()$$);

-- ---------------------------------------------------------------------------
-- Audit et RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

-- Internes L (journal) ; un client lit les notifications qui lui ont été envoyées. Écriture : fonctions et
-- fonction d'envoi (clé service_role).
create policy notifications_select on public.notifications for select to authenticated
  using ((select public.is_internal()) or client_id = (select public.current_client_id()));

revoke all on public.notifications from anon;
revoke insert, update, delete, truncate on public.notifications from authenticated;

revoke execute on function public.enqueue_notification(uuid, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.notification_dossier_vars(uuid) from public, anon, authenticated;
revoke execute on function public.notify_dossier_changes() from public, anon, authenticated;
revoke execute on function public.notify_quote_ready() from public, anon, authenticated;
revoke execute on function public.notify_container_changes() from public, anon, authenticated;
revoke execute on function public.queue_payment_notifications() from public, anon;
revoke execute on function public.retry_notification(uuid) from public, anon;
revoke execute on function public.queue_test_notification() from public, anon;
revoke execute on function public.dispatch_notifications() from public, anon, authenticated;
grant execute on function public.enqueue_notification(uuid, uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.queue_payment_notifications() to authenticated;
grant execute on function public.retry_notification(uuid) to authenticated;
grant execute on function public.queue_test_notification() to authenticated;
