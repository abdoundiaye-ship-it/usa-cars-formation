-- Phase 2, lot 2b — US-2.3 (ordre d'achat), US-2.4 (résultat d'enchère), US-2.5 (étapes et statuts),
-- hypothèse P1 (confirmations manuelles), RLS par rôle et isolation entre clients.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, email) values
  ('b1111111-1111-1111-1111-111111111111', 'pgtap3.admin@exemple.test'),
  ('b2222222-2222-2222-2222-222222222222', 'pgtap3.ops@exemple.test'),
  ('b3333333-3333-3333-3333-333333333333', 'pgtap3.compta@exemple.test'),
  ('b4444444-4444-4444-4444-444444444444', 'pgtap3.direction@exemple.test'),
  ('b5555555-5555-5555-5555-555555555555', 'pgtap3.client.a@exemple.test'),
  ('b6666666-6666-6666-6666-666666666666', 'pgtap3.client.b@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('b1111111-1111-1111-1111-111111111111', 'pgtap3.admin@exemple.test', 'Admin Test', 'admin'),
  ('b2222222-2222-2222-2222-222222222222', 'pgtap3.ops@exemple.test', 'Agent Test', 'ops'),
  ('b3333333-3333-3333-3333-333333333333', 'pgtap3.compta@exemple.test', 'Compta Test', 'accounting'),
  ('b4444444-4444-4444-4444-444444444444', 'pgtap3.direction@exemple.test', 'Direction Test', 'management'),
  ('b5555555-5555-5555-5555-555555555555', 'pgtap3.client.a@exemple.test', 'Client A', 'client'),
  ('b6666666-6666-6666-6666-666666666666', 'pgtap3.client.b@exemple.test', 'Client B', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;

-- Contexte (agent) : client complet, dossier d'un véhicule de 2010 (trop âgé : limite 10 ans), contrat accepté.
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
with x as (
  insert into public.clients (kind, name, id_document_type, id_document_number, address, notify_phone)
  values ('person', 'Client A (test)', 'passport', 'TEST-A', 'Dakar', '+221770000201') returning id
) insert into t select 'client_a', id from x;
with x as (
  insert into public.clients (kind, name, notify_phone) values ('person', 'Client B (test)', '+221770000202') returning id
) insert into t select 'client_b', id from x;
with x as (
  insert into public.dossiers (client_id, platform, lot_number, vin, make, model, model_year, vehicle_category)
  values ((select id from t where name = 'client_a'), 'copart', 'LOT-1', '1TESTXX0000000001', 'Toyota', 'Hilux', 2010, 'passenger')
  returning id
) insert into t select 'dossier', id from x;
insert into t values ('contract', public.register_contract_document((select id from t where name = 'dossier'),
  'test/b/contrat.docx', 'contrat.docx', 100, repeat('a', 64), 'v'));
with x as (
  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
  values ((select id from t where name = 'dossier'), (select id from t where name = 'client_a'), 'acceptance_proof',
          'test/b/preuve1.pdf', 'preuve.pdf', 'application/pdf', 10, repeat('b', 64)) returning id
) insert into t select 'proof', id from x;
insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, proof_document_id)
values ((select id from t where name = 'dossier'), 'contract', (select id from t where name = 'contract'),
        (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(), (select id from t where name = 'proof'));

-- US-2.3 : ordre d'achat
with x as (
  insert into public.purchase_orders (dossier_id, max_bid_cents, deposit_cents)
  values ((select id from t where name = 'dossier'), 500000, 150000) returning id
) insert into t select 'po', id from x;

select is((select status from public.vehicle_age_check((select id from t where name = 'dossier'))), 'too_old',
  'Véhicule de 2010 (tourisme) : trop âgé pour la limite de 10 ans');
select throws_ok(
  $$ select public.register_purchase_order_document((select id from t where name = 'dossier'), 'test/b/oa.docx', 'oa.docx', 100, repeat('c', 64), 'v') $$,
  '22023', null, 'Alerte bloquante : ordre d’achat impossible pour un véhicule trop âgé'
);
select throws_ok(
  $$ update public.purchase_orders set age_override_reason = 'Client diplomate exonéré' where id = (select id from t where name = 'po') $$,
  '42501', null, 'Accès refusé : un agent ne peut pas déroger au contrôle de l’âge'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.purchase_orders set age_override_reason = 'Client diplomate exonéré (justificatif au dossier)'
  where id = (select id from t where name = 'po');
reset role;
select is((select age_override_by from public.purchase_orders where id = (select id from t where name = 'po')),
  'b1111111-1111-1111-1111-111111111111'::uuid, 'Dérogation de l’administrateur enregistrée avec son auteur');

select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.register_purchase_order_document((select id from t where name = 'dossier'), 'test/b/oa.docx', 'oa.docx', 100, repeat('c', 64), 'v') $$,
  'Après dérogation, l’ordre d’achat est généré'
);
select is((select status || '|' || vin from public.purchase_orders where id = (select id from t where name = 'po')),
  'pending|1TESTXX0000000001', 'Ordre en attente de signature, véhicule figé dans l’ordre');

update public.purchase_orders set max_bid_cents = 550000 where id = (select id from t where name = 'po');
select is((select status from public.purchase_orders where id = (select id from t where name = 'po')), 'draft',
  'Modifier l’enchère maximale impose de régénérer le document');
select public.register_purchase_order_document((select id from t where name = 'dossier'), 'test/b/oa2.docx', 'oa2.docx', 100, repeat('d', 64), 'v');

select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, proof_document_id, acknowledgements)
     values ((select id from t where name = 'dossier'), 'purchase_order', (select id from t where name = 'po'),
             (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
             (select id from t where name = 'proof'), '{"vehicle_info":true,"import_age":true,"binding_win":true}') $$,
  '22023', null, 'Signature refusée si une des 4 confirmations manque'
);
insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, proof_document_id, acknowledgements)
values ((select id from t where name = 'dossier'), 'purchase_order', (select id from t where name = 'po'),
        (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
        (select id from t where name = 'proof'), '{"vehicle_info":true,"import_age":true,"binding_win":true,"duties_excluded":true}');
select is((select status || '|' || document_sha256 from public.purchase_orders where id = (select id from t where name = 'po')),
  'accepted|' || repeat('d', 64), 'Ordre signé : la version acceptée est la dernière générée');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'purchase_order_signed',
  'Statut du dossier : « Ordre d’achat signé »');
select throws_ok(
  $$ update public.dossiers set vin = '1TESTXX0000000009' where id = (select id from t where name = 'dossier') $$,
  '42501', null, 'Ordre signé : le VIN du véhicule ne peut plus changer'
);
select throws_ok(
  $$ update public.purchase_orders set max_bid_cents = 900000 where id = (select id from t where name = 'po') $$,
  '42501', null, 'Ordre signé : ses conditions sont figées'
);

-- US-2.5 : conditions de passage Ouverture → Achat
select is((select count(*) from public.stage_conditions((select id from t where name = 'dossier')) where not met), 0::bigint,
  'Ouverture : toutes les conditions sont remplies');
select is(public.advance_stage((select id from t where name = 'dossier')), 'purchase'::public.dossier_stage,
  'L’agent passe le dossier à l’étape Achat');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'bidding',
  'Étape Achat, statut « Enchère en cours »');

-- US-2.4 : résultat d'enchère
select throws_ok(
  $$ update public.dossiers set auction_result = 'won' where id = (select id from t where name = 'dossier') $$,
  '42501', null, 'Le résultat d’enchère ne s’écrit que par l’action dédiée'
);
select throws_ok(
  $$ select public.record_auction_result((select id from t where name = 'dossier'), 'won', 600000, now() - interval '1 hour', 'motif') $$,
  '42501', null, 'Prix supérieur à l’enchère maximale : refusé à l’agent (validation administrateur obligatoire)'
);
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier')) $$,
  '22023', null, 'Achat → Transport USA refusé tant que les conditions manquent'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.record_auction_result((select id from t where name = 'dossier'), 'won', 600000,
       '2026-10-19 10:00:00+00', 'Dépassement accepté par le client par téléphone') $$,
  'L’administrateur valide un prix supérieur à l’enchère maximale, avec motif'
);
reset role;
select is(
  (select payment1_due_at from public.dossiers where id = (select id from t where name = 'dossier')),
  '2026-10-20 10:00:00+00'::timestamptz,
  'Échéance du paiement 1 = notification + 24 h (paramètre payment1.due_hours_after_win, R4)'
);
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'won', 'Statut « Gagné »');
select is((select count(*) from public.audit_log where action = 'auction_price_override'
            and object_id = (select id::text from t where name = 'dossier')), 1::bigint,
  'Audit : la validation du dépassement est journalisée avec son motif');

-- P1 : plus de confirmations manuelles depuis le lot 3d (contrôles financiers automatiques) ; celles de la phase 2
-- restent prises en compte.
select set_config('request.jwt.claims', '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.dossier_confirmations (dossier_id, code) values ((select id from t where name = 'dossier'), 'payment1_received') $$,
  '42501', null, 'Lot 3d : plus de confirmation manuelle, les conditions financières sont vérifiées automatiquement'
);
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier')) $$,
  '42501', null, 'Accès refusé : la comptabilité ne change pas l’étape d’un dossier'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"b4444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.dossier_confirmations (dossier_id, code) values ((select id from t where name = 'dossier'), 'quote_accepted') $$,
  '42501', null, 'Accès refusé : la direction ne confirme rien'
);
select is((select count(*) from public.stage_conditions((select id from t where name = 'dossier'))), 5::bigint,
  'La direction consulte les conditions de passage');
reset role;
-- Confirmations enregistrées en phase 2 (données existantes) : toujours prises en compte.
insert into public.dossier_confirmations (dossier_id, code) values
  ((select id from t where name = 'dossier'), 'payment1_received'),
  ((select id from t where name = 'dossier'), 'quote_accepted');
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(
  (select string_agg(code, ',') from public.stage_conditions((select id from t where name = 'dossier')) where not met),
  'auction_invoice', 'Seule la facture d’enchère manque encore'
);
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier'), 'Motif saisi par un agent') $$,
  '22023', null, 'Un agent ne peut pas forcer le passage, même avec un motif'
);
reset role;
select throws_ok(
  $$ delete from public.dossier_confirmations where dossier_id = (select id from t where name = 'dossier') $$,
  '42501', null, 'Une confirmation manuelle ne peut pas être supprimée'
);

-- R13 : exception de l'administrateur, motif journalisé
select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier')) $$,
  '22023', null, 'Sans motif, même l’administrateur ne force pas le passage'
);
select is(public.advance_stage((select id from t where name = 'dossier'), 'Facture d’enchère reçue par e-mail, archivage demain'),
  'us_transport'::public.dossier_stage, 'L’administrateur passe l’étape par exception, avec motif');
reset role;
select is(
  (select reason from public.audit_log where action = 'stage_exception' and object_id = (select id::text from t where name = 'dossier')),
  'Facture d’enchère reçue par e-mail, archivage demain', 'Audit : exception journalisée avec son motif'
);
select is((select count(*) from public.dossier_events where dossier_id = (select id from t where name = 'dossier') and kind = 'stage_exception'),
  1::bigint, 'Chronologie : l’exception apparaît (événement interne)');

select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.cancel_dossier((select id from t where name = 'dossier'), 'Le client renonce') $$,
  '22023', null, 'Un dossier en transport ne peut plus être annulé'
);

-- Second dossier : annulation à l'ouverture, motif obligatoire
with x as (
  insert into public.dossiers (client_id, platform) values ((select id from t where name = 'client_b'), 'iaa') returning id
) insert into t select 'dossier_b', id from x;
select throws_ok(
  $$ select public.cancel_dossier((select id from t where name = 'dossier_b'), '') $$,
  '22023', null, 'Annulation refusée sans motif'
);
select public.cancel_dossier((select id from t where name = 'dossier_b'), 'Le client renonce à l’achat');
select is((select stage::text || '/' || status || '|' || cancelled_reason from public.dossiers where id = (select id from t where name = 'dossier_b')),
  'closing/cancelled|Le client renonce à l’achat', 'Dossier annulé : étape Clôture, statut « Annulé », motif conservé');
reset role;

-- Isolation entre clients
update public.profiles set client_id = (select id from t where name = 'client_a') where id = 'b5555555-5555-5555-5555-555555555555';
update public.profiles set client_id = (select id from t where name = 'client_b') where id = 'b6666666-6666-6666-6666-666666666666';

select set_config('request.jwt.claims', '{"sub":"b5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.purchase_orders), 1::bigint, 'Client A : lit son ordre d’achat');
select is((select count(*) from public.dossier_confirmations), 0::bigint, 'Client A : ne lit pas les confirmations internes');
select is((select count(*) from public.stage_conditions((select id from t where name = 'dossier'))), 0::bigint,
  'Client A : les conditions internes de passage ne lui sont pas exposées');
select throws_ok(
  $$ select public.advance_stage((select id from t where name = 'dossier')) $$,
  '42501', null, 'Accès refusé : un client ne change pas l’étape'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"b6666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.purchase_orders), 0::bigint, 'Client B : aucun accès à l’ordre d’achat du client A');
reset role;

select * from finish();
rollback;
