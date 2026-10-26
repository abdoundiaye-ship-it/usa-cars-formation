-- Phase 4, lot 4b — notifications (US-4.5, R16) : mise en file sur les deux canaux, déclencheurs, rappels et
-- relances sans doublon, renvoi, isolation client, aucune écriture directe.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values
  ('ac111111-1111-1111-1111-111111111111', 'pgtap12.admin@exemple.test'),
  ('ac222222-2222-2222-2222-222222222222', 'pgtap12.ops@exemple.test'),
  ('ac555555-5555-5555-5555-555555555555', 'pgtap12.client@exemple.test'),
  ('ac666666-6666-6666-6666-666666666666', 'pgtap12.client2@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('ac111111-1111-1111-1111-111111111111', 'pgtap12.admin@exemple.test', 'Admin Test', 'admin'),
  ('ac222222-2222-2222-2222-222222222222', 'pgtap12.ops@exemple.test', 'Agent Test', 'ops');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('client2', gen_random_uuid()), ('d1', gen_random_uuid()),
  ('d2', gen_random_uuid()), ('container', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone, notify_email) values
  ((select id from t where name = 'client'), 'person', 'Client notif (test)', '+221770001001', 'notif@exemple.test'),
  ((select id from t where name = 'client2'), 'person', 'Client sans e-mail (test)', '+221770001002', null);
insert into public.profiles (id, email, full_name, role, client_id) values
  ('ac555555-5555-5555-5555-555555555555', 'pgtap12.client@exemple.test', 'Client', 'client', (select id from t where name = 'client')),
  ('ac666666-6666-6666-6666-666666666666', 'pgtap12.client2@exemple.test', 'Client 2', 'client', (select id from t where name = 'client2'));
insert into public.dossiers (id, reference, client_id, stage, status, make, model, model_year) values
  ((select id from t where name = 'd1'), 'TEST-4B-1', (select id from t where name = 'client'), 'purchase', 'bidding', 'Toyota', 'RAV4', 2020),
  ((select id from t where name = 'd2'), 'TEST-4B-2', (select id from t where name = 'client2'), 'purchase', 'bidding', null, null, null);

-- Lot remporté → « lot_won » sur les deux canaux ; client sans e-mail : WhatsApp seulement (P4-1)
select set_config('app.auction_result', 'on', true);
update public.dossiers set auction_result = 'won', hammer_price_cents = 900000, lot_won_notified_at = now(),
  payment1_due_at = now() + interval '24 hours', status = 'won'
  where id in (select id from t where name in ('d1', 'd2'));
select set_config('app.auction_result', 'off', true);
select is(
  (select string_agg(channel || ':' || recipient, ',' order by channel) from public.notifications
     where dossier_id = (select id from t where name = 'd1') and template = 'lot_won'),
  'email:notif@exemple.test,whatsapp:+221770001001', 'Lot remporté : e-mail et WhatsApp (R16)');
select is(
  (select string_agg(channel, ',') from public.notifications
     where dossier_id = (select id from t where name = 'd2') and template = 'lot_won'),
  'whatsapp', 'Client sans e-mail : WhatsApp seulement');
select is(
  (select variables ->> 'reference' || '|' || (variables ->> 'vehicule') from public.notifications
     where dossier_id = (select id from t where name = 'd1') and template = 'lot_won' and channel = 'email'),
  'TEST-4B-1|Toyota RAV4 2020', 'Variables du message : référence et véhicule');
select ok(
  not exists (select 1 from public.notifications n, jsonb_each_text(n.variables) v
              where n.dossier_id = (select id from t where name = 'd1')
                and (v.value ~* 'iban|rib|wave|orange money' or v.key ~* 'compte|iban')),
  'Règle 7 : aucune coordonnée de paiement dans les variables');

-- Conteneur : départ, ETA modifiée, arrivée
insert into public.containers (id, number, carrier_id, bl_number, eta)
  values ((select id from t where name = 'container'), 'TSTU1234568', (select id from public.carriers order by created_at limit 1),
          'BL-4B', current_date + 20);
insert into public.dossier_containers (dossier_id, container_id)
  values ((select id from t where name = 'd1'), (select id from t where name = 'container'));
update public.containers set departed_on = current_date where id = (select id from t where name = 'container');
update public.containers set eta = current_date + 25 where id = (select id from t where name = 'container');
update public.containers set ata = current_date where id = (select id from t where name = 'container');
select is(
  (select string_agg(distinct template, ',' order by template) from public.notifications
     where dossier_id = (select id from t where name = 'd1') and template in ('vessel_departed', 'eta_changed', 'arrived')),
  'arrived,eta_changed,vessel_departed', 'Départ, ETA modifiée et arrivée notifiés');
select is((select count(*) from public.notifications where dossier_id = (select id from t where name = 'd1')
             and template = 'eta_changed'), 2::bigint, 'ETA modifiée : un message par canal (e-mail et WhatsApp)');

-- Documents prêts au paiement intégral (R9)
select set_config('app.ownership', 'on', true);
update public.dossiers set ownership_transferred_at = now() where id = (select id from t where name = 'd1');
select set_config('app.ownership', 'off', true);
select is((select count(*) from public.notifications where dossier_id = (select id from t where name = 'd1')
             and template = 'documents_ready'), 2::bigint, 'Documents prêts notifiés');

-- Rappels J-2 et relance, sans doublon
insert into public.fx_rates (rate, source, captured_at) values (600, 'XE.com — test 4b', now() - interval '1 second');
insert into public.financial_documents (dossier_id, client_id, doc_type, number, status, forfait_a_cents, forfait_b_cents,
  insurance_premium_cents, insurance_choice, total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at,
  edition_fx_rate, edition_fx_captured_at, valid_until)
select (select id from t where name = 'd2'), (select id from t where name = 'client2'), 'quote', 'DV-TEST-4B', 'accepted',
  1000000, 300000, 0, 'refused', 1300000, 1300000, r.id, r.rate, r.source, r.captured_at, r.rate, r.captured_at, now()
from public.fx_rates r where r.source = 'XE.com — test 4b';
insert into public.financial_documents (dossier_id, client_id, doc_type, number, status, quote_id, forfait_a_cents,
  total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, due_at)
select (select id from t where name = 'd2'), (select id from t where name = 'client2'), 'deposit_invoice', 'FA-TEST-4B', 'issued',
  (select id from public.financial_documents where number = 'DV-TEST-4B'), 1000000, 1000000, 1000000, r.id, r.rate, r.source,
  r.captured_at, r.rate, r.captured_at, ((current_date + 2)::timestamp at time zone 'UTC') + interval '10 hours'
from public.fx_rates r where r.source = 'XE.com — test 4b';
select ok(public.queue_payment_notifications() >= 1, 'Rappel J-2 avant l’échéance du paiement 1');
select is(public.queue_payment_notifications(), 0, 'Un rappel n’est créé qu’une fois par échéance');
select is((select variables ->> 'montant' from public.notifications where template = 'payment_due_reminder'
             and dossier_id = (select id from t where name = 'd2')), '10 000 $US', 'Montant restant dû en USD');

-- Renvoi, message de test, isolation, aucune écriture directe
update public.notifications set status = 'failed', last_error = 'test' where template = 'lot_won'
  and dossier_id = (select id from t where name = 'd2');
select set_config('request.jwt.claims', '{"sub":"ac222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.retry_notification((select id from public.notifications where template = 'lot_won'
       and dossier_id = (select id from t where name = 'd2'))) $$,
  'L’agent renvoie une notification en échec');
select throws_ok($$ select public.queue_test_notification() $$, '42501', null,
  'Accès refusé : seul l’administrateur envoie un message de test');
reset role;
select set_config('request.jwt.claims', '{"sub":"ac666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.notifications where dossier_id = (select id from t where name = 'd1')), 0::bigint,
  'Accès refusé : notifications d’un autre client');
select throws_ok(
  $$ insert into public.notifications (template, channel, recipient) values ('test_message', 'email', 'x@exemple.test') $$,
  '42501', null, 'Aucune écriture directe dans le journal');
reset role;

select * from finish();
rollback;
