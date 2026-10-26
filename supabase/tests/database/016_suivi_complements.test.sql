-- Phase 5, lot 5a : accès API des transporteurs, source des événements (R12), information du client sur l'arrivée
-- (contrat art. 17) et délais confirmés de la procédure « véhicule non réclamé » (décision U1).
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Transporteurs : état de l'accès API, « non étudié » par défaut (F2-a), valeurs contrôlées.
select is((select api_status from public.carriers where code = 'demo-maritime'), 'non_etudie',
  'Accès API « non étudié » par défaut');
select throws_ok(
  $$ update public.carriers set api_status = 'actif' where code = 'demo-maritime' $$,
  '23514', null, 'État d’accès API inconnu refusé');

-- Agent opérations (seed) : événements de suivi avec leur source.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ insert into public.tracking_events (container_id, occurred_at, kind, label, source)
     values ('f1000000-0000-4000-8000-000000000001', now(), 'note', 'Escale vue sur le site', 'carrier_link') $$,
  'Un agent enregistre un événement lu sur le lien du transporteur');
select throws_ok(
  $$ insert into public.tracking_events (container_id, occurred_at, kind, label, source)
     values ('f1000000-0000-4000-8000-000000000001', now(), 'note', 'Faux événement API', 'api') $$,
  '42501', null, 'Accès refusé : la source « api » est réservée aux connecteurs');

-- Information du client sur l'arrivée : seulement après la saisie de l'ATA.
select throws_ok(
  $$ select public.record_arrival_notice('e0000000-0000-4000-8000-000000000005', 'phone', null) $$,
  '22023', null, 'Information de l’arrivée refusée tant que l’ATA n’est pas saisie');
select public.record_container_arrival('f1000000-0000-4000-8000-000000000001', (now() at time zone 'Africa/Dakar')::date);
select lives_ok(
  $$ select public.record_arrival_notice('e0000000-0000-4000-8000-000000000005', 'phone', 'Appel au client') $$,
  'Après l’ATA, l’agent enregistre l’information donnée au client');
select throws_ok(
  $$ select public.record_arrival_notice('e0000000-0000-4000-8000-000000000005', 'sms', null) $$,
  '22023', null, 'Moyen d’information inconnu refusé');
reset role;

select is(
  (select label from public.dossier_events
    where dossier_id = 'e0000000-0000-4000-8000-000000000005' and kind = 'arrival_notified'),
  'Client informé de l’arrivée par téléphone : Appel au client',
  'Chronologie : moyen et précision enregistrés');
select is(
  (select visible_client from public.dossier_events
    where dossier_id = 'e0000000-0000-4000-8000-000000000005' and kind = 'arrival_notified'),
  false, 'Événement interne (non visible du client)');
select is(
  (select actor_id from public.dossier_events
    where dossier_id = 'e0000000-0000-4000-8000-000000000005' and kind = 'arrival_notified'),
  'd0000000-0000-4000-8000-000000000002'::uuid, 'Auteur de l’information enregistré');

-- Accès refusé : la comptabilité n'enregistre pas l'information d'arrivée (R9-a : opérations).
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_arrival_notice('e0000000-0000-4000-8000-000000000005', 'phone', null) $$,
  '42501', null, 'Accès refusé : comptabilité');
reset role;

-- Le client ne voit pas les événements internes d'information.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.dossier_events where kind = 'arrival_notified'), 0::bigint,
  'Le client ne lit pas les événements internes');
reset role;

-- Décision U1 : délais 30 / 60 / 15 jours confirmés.
select is(
  (select count(*) from public.settings_current
    where key in ('unclaimed.reminder_days_after_arrival', 'unclaimed.formal_notice_days_after_arrival',
                  'unclaimed.formal_notice_min_cure_days')
      and status = 'confirme'),
  3::bigint, 'Délais de la procédure « véhicule non réclamé » confirmés (U1)');

select * from finish();
rollback;
