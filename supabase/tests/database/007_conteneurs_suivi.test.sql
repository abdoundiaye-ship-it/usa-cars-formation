-- Phase 2, lot 2c — US-2.6 (conteneurs), US-2.7 (ETA, événements, départ, ATA), décision B4 (changement de
-- conteneur avec historique), propagation des statuts, conditions des étapes Conteneur / Maritime / Dakar, RLS.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, email) values
  ('c1111111-1111-1111-1111-111111111111', 'pgtap4.admin@exemple.test'),
  ('c2222222-2222-2222-2222-222222222222', 'pgtap4.ops@exemple.test'),
  ('c3333333-3333-3333-3333-333333333333', 'pgtap4.compta@exemple.test'),
  ('c5555555-5555-5555-5555-555555555555', 'pgtap4.client.a@exemple.test'),
  ('c6666666-6666-6666-6666-666666666666', 'pgtap4.client.b@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('c1111111-1111-1111-1111-111111111111', 'pgtap4.admin@exemple.test', 'Admin Test', 'admin'),
  ('c2222222-2222-2222-2222-222222222222', 'pgtap4.ops@exemple.test', 'Agent Test', 'ops'),
  ('c3333333-3333-3333-3333-333333333333', 'pgtap4.compta@exemple.test', 'Compta Test', 'accounting'),
  ('c5555555-5555-5555-5555-555555555555', 'pgtap4.client.a@exemple.test', 'Client A', 'client'),
  ('c6666666-6666-6666-6666-666666666666', 'pgtap4.client.b@exemple.test', 'Client B', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;

-- ISO 6346
select ok(public.iso6346_valid('CSQU3054383'), 'ISO 6346 : exemple de la norme accepté');
select ok(not public.iso6346_valid('CSQU3054384'), 'ISO 6346 : chiffre de contrôle erroné refusé');

-- Données de départ (propriétaire des tables) : deux clients, un dossier à l'étape Conteneur pour le client A.
insert into t values ('client_a', gen_random_uuid()), ('client_b', gen_random_uuid()), ('dossier', gen_random_uuid()),
  ('dossier_b', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone) values
  ((select id from t where name = 'client_a'), 'person', 'Client A (test)', '+221770000301'),
  ((select id from t where name = 'client_b'), 'person', 'Client B (test)', '+221770000302');
insert into public.dossiers (id, reference, client_id, stage, status, vin) values
  ((select id from t where name = 'dossier'), 'TEST-2C-1', (select id from t where name = 'client_a'), 'container', 'loading_planned', '1TESTXX0000000301'),
  ((select id from t where name = 'dossier_b'), 'TEST-2C-2', (select id from t where name = 'client_b'), 'opening', 'new', null);
update public.profiles set client_id = (select id from t where name = 'client_a') where id = 'c5555555-5555-5555-5555-555555555555';
update public.profiles set client_id = (select id from t where name = 'client_b') where id = 'c6666666-6666-6666-6666-666666666666';

-- Transporteurs : réservés à l'administrateur
select set_config('request.jwt.claims', '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.carriers (code, name, tracking_url) values ('interdit', 'Interdit', 'https://exemple.test') $$,
  '42501', null, 'Accès refusé : un agent ne crée pas de transporteur'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
with x as (
  insert into public.carriers (code, name, tracking_url, url_template)
  values ('test-direct', 'Transporteur direct (test)', 'https://exemple.test/suivi', 'https://exemple.test/suivi/{container}')
  returning id
) insert into t select 'carrier', id from x;
select throws_ok(
  $$ insert into public.carriers (code, name, tracking_url, url_template) values ('test-mauvais', 'Mauvais', 'https://exemple.test', 'https://exemple.test/sans-reference') $$,
  '23514', null, 'Lien direct refusé s’il ne contient pas {container} ou {bl}'
);
reset role;

-- US-2.6 : conteneurs (agent)
select set_config('request.jwt.claims', '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.containers (number, carrier_id) values ('TEST1234567', (select id from t where name = 'carrier')) $$,
  '23514', null, 'Numéro de conteneur invalide refusé (ISO 6346)'
);
with x as (
  insert into public.containers (number, carrier_id, bl_number, vessel, voyage, etd, eta)
  values ('TSTU0000014', (select id from t where name = 'carrier'), 'TEST-BL-1', 'Navire Test', 'V-1', '2026-11-01', '2026-11-20')
  returning id
) insert into t select 'container', id from x;
with x as (
  insert into public.containers (number, carrier_id) values ('TSTU0000020', (select id from t where name = 'carrier')) returning id
) insert into t select 'container_2', id from x;
select is((select count(*) from public.eta_history where container_id = (select id from t where name = 'container')), 1::bigint,
  'L’ETA initiale est historisée');

select throws_ok(
  $$ select public.assign_container((select id from t where name = 'dossier_b'), (select id from t where name = 'container')) $$,
  '22023', null, 'Un dossier à l’ouverture ne peut pas être mis en conteneur'
);
select public.assign_container((select id from t where name = 'dossier'), (select id from t where name = 'container_2'));
select throws_ok(
  $$ select public.assign_container((select id from t where name = 'dossier'), (select id from t where name = 'container')) $$,
  '22023', null, 'B4 : changer de conteneur exige un motif'
);
select public.assign_container((select id from t where name = 'dossier'), (select id from t where name = 'container'),
  'Conteneur initial complet');
select is((select count(*) from public.dossier_containers where dossier_id = (select id from t where name = 'dossier')), 2::bigint,
  'B4 : l’historique garde les deux affectations');
select is(public.active_container_id((select id from t where name = 'dossier')), (select id from t where name = 'container'),
  'B4 : le nouveau conteneur est le conteneur en cours');
select is((select removal_reason from public.dossier_containers where container_id = (select id from t where name = 'container_2')),
  'Conteneur initial complet', 'B4 : le motif du changement est conservé');
select ok(exists (select 1 from public.dossier_events where dossier_id = (select id from t where name = 'dossier') and kind = 'container_changed'),
  'Chronologie : le changement de conteneur apparaît');
select throws_ok(
  $$ insert into public.dossier_containers (dossier_id, container_id) values ((select id from t where name = 'dossier'), (select id from t where name = 'container_2')) $$,
  '42501', null, 'Les affectations ne s’écrivent que par l’action dédiée'
);

-- Conditions Conteneur → Maritime : seule la facture de solde manque (P1)
select is(
  (select string_agg(code, ',') from public.stage_conditions((select id from t where name = 'dossier')) where not met),
  'balance_invoice_issued', 'Conteneur : seule la facture de solde (confirmation manuelle) manque'
);

-- US-2.7 : ETA (historique, source, chronologie), vérification, départ, ATA
select public.update_container_eta((select id from t where name = 'container'), '2026-11-25', 'carrier_site', 'Retard annoncé');
select is((select count(*) from public.eta_history where container_id = (select id from t where name = 'container')), 2::bigint,
  'ETA modifiée : historique conservé');
select is((select source || '|' || previous_eta::text from public.eta_history where container_id = (select id from t where name = 'container') order by id desc limit 1),
  'carrier_site|2026-11-20', 'ETA : la source et l’ancienne valeur sont enregistrées');
select ok(exists (select 1 from public.dossier_events where dossier_id = (select id from t where name = 'dossier') and kind = 'eta_changed'
  and label like 'ETA indicative modifiée : 20/11/2026 → 25/11/2026%'), 'Chronologie du dossier : « ETA indicative modifiée »');
select public.mark_container_checked((select id from t where name = 'container'));
select is((select last_checked_by from public.containers where id = (select id from t where name = 'container')),
  'c2222222-2222-2222-2222-222222222222'::uuid, '« Vérifié aujourd’hui » enregistre l’agent');
select throws_ok(
  $$ insert into public.tracking_events (container_id, occurred_at, kind, label) values ((select id from t where name = 'container'), now(), 'arrival', 'Faux') $$,
  '42501', null, 'L’arrivée ne se saisit que par l’action dédiée (ATA)'
);
-- Confirmation enregistrée en phase 2 (donnée existante) : toujours prise en compte (lot 3d).
reset role;
insert into public.dossier_confirmations (dossier_id, code) values ((select id from t where name = 'dossier'), 'balance_invoice_issued');
set local role authenticated;
select is(public.advance_stage((select id from t where name = 'dossier')), 'ocean'::public.dossier_stage,
  'Conteneur → Maritime quand les conditions sont remplies');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'booking_confirmed',
  'À l’entrée en Maritime, le dossier reprend le statut du conteneur');

select public.record_container_departure((select id from t where name = 'container'), '2026-10-15');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'at_sea',
  'Départ du navire : le statut « En transit » se propage au dossier');
insert into public.tracking_events (container_id, occurred_at, kind, label, location)
values ((select id from t where name = 'container'), now(), 'transshipment', 'Transbordement à Algeciras', 'Algeciras');
select ok(exists (select 1 from public.dossier_events where dossier_id = (select id from t where name = 'dossier') and label = 'Transbordement à Algeciras'),
  'Un événement de suivi apparaît dans la chronologie du dossier');
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier')) $$,
  '22023', null, 'Maritime → Dakar refusé sans ATA'
);
select throws_ok(
  $$ select public.record_container_arrival((select id from t where name = 'container'), '2026-10-10') $$,
  '22023', null, 'ATA antérieure au départ refusée'
);
select public.record_container_arrival((select id from t where name = 'container'), '2026-10-18');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'arrived',
  'ATA saisie : le statut « Arrivé » se propage au dossier');
select throws_ok(
  $$ select public.update_container_eta((select id from t where name = 'container'), '2026-12-01', 'manual') $$,
  '22023', null, 'ATA saisie : l’ETA n’est plus modifiable'
);
select is(public.advance_stage((select id from t where name = 'dossier')), 'dakar'::public.dossier_stage,
  'Maritime → Dakar une fois l’ATA saisie');
select is(
  (select string_agg(code, ',' order by code) from public.stage_conditions((select id from t where name = 'dossier')) where not met),
  'balance_paid,collected,release_receipt', 'Dakar : solde, décharge de remise et enlèvement attendus'
);
reset role;

-- Comptabilité : lecture seule
select set_config('request.jwt.claims', '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok((select count(*) from public.containers where id = (select id from t where name = 'container')) = 1,
  'Comptabilité : lit les conteneurs');
select throws_ok(
  $$ select public.mark_container_checked((select id from t where name = 'container')) $$,
  '42501', null, 'Accès refusé : la comptabilité ne modifie pas un conteneur'
);
reset role;

-- Client A : son conteneur et ses événements visibles ; pas l'historique interne de l'ETA
select set_config('request.jwt.claims', '{"sub":"c5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.containers), 1::bigint, 'Client A : lit uniquement le conteneur de son véhicule');
select ok((select count(*) from public.tracking_events) > 0, 'Client A : lit les événements visibles de son conteneur');
select is((select count(*) from public.eta_history), 0::bigint, 'Client A : l’historique interne de l’ETA ne lui est pas exposé');
select is((select count(*) from public.carriers), 1::bigint, 'Client A : lit le transporteur de son conteneur (lien de suivi)');
reset role;

-- Client B : rien du client A
select set_config('request.jwt.claims', '{"sub":"c6666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(
  (select count(*) from public.containers) + (select count(*) from public.tracking_events) + (select count(*) from public.dossier_containers),
  0::bigint, 'Client B : aucun conteneur, événement ni affectation du client A'
);
reset role;

select * from finish();
rollback;
