-- Phase 2, lot 2a — US-2.1 (clients), US-2.2 (contrat par véhicule, acceptations), RLS par rôle,
-- isolation entre deux clients, numérotation, chronologie et audit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- Jeu d'essai fictif (@exemple.test), isolé du seed de démonstration.
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'pgtap2.admin@exemple.test'),
  ('a2222222-2222-2222-2222-222222222222', 'pgtap2.ops@exemple.test'),
  ('a3333333-3333-3333-3333-333333333333', 'pgtap2.compta@exemple.test'),
  ('a4444444-4444-4444-4444-444444444444', 'pgtap2.direction@exemple.test'),
  ('a5555555-5555-5555-5555-555555555555', 'pgtap2.client.a@exemple.test'),
  ('a6666666-6666-6666-6666-666666666666', 'pgtap2.client.b@exemple.test');

insert into public.profiles (id, email, full_name, role) values
  ('a1111111-1111-1111-1111-111111111111', 'pgtap2.admin@exemple.test', 'Admin Test', 'admin'),
  ('a2222222-2222-2222-2222-222222222222', 'pgtap2.ops@exemple.test', 'Agent Test', 'ops'),
  ('a3333333-3333-3333-3333-333333333333', 'pgtap2.compta@exemple.test', 'Compta Test', 'accounting'),
  ('a4444444-4444-4444-4444-444444444444', 'pgtap2.direction@exemple.test', 'Direction Test', 'management'),
  ('a5555555-5555-5555-5555-555555555555', 'pgtap2.client.a@exemple.test', 'Client A', 'client'),
  ('a6666666-6666-6666-6666-666666666666', 'pgtap2.client.b@exemple.test', 'Client B', 'client');

-- Les comptages ne portent que sur les lignes du test (le seed de démonstration est ignoré).
create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;

-- ---------------------------------------------------------------------------
-- Agent opérations : crée deux clients et un dossier ; référence attribuée par la base.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

with x as (
  insert into public.clients (kind, name, id_document_type, id_document_number, notify_phone)
  values ('person', 'Client A (test)', 'passport', 'TEST-A', '+221770000101') returning id
) insert into t select 'client_a', id from x;
with x as (
  insert into public.clients (kind, name, ninea, notify_phone)
  values ('company', 'Société B (test)', 'TEST-B', '+221770000102') returning id
) insert into t select 'client_b', id from x;
select pass('Agent : crée des fiches client');

select throws_ok(
  $$ insert into public.clients (kind, name, notify_phone) values ('person', 'Mauvais numéro', '77 000 00 00') $$,
  '23514', null, 'Téléphone de notification refusé hors format international (+221…)'
);

with x as (
  insert into public.dossiers (client_id, reference, platform)
  values ((select id from t where name = 'client_a'), 'CHOISIE-PAR-AGENT', 'copart') returning id
) insert into t select 'dossier_a', id from x;
select matches(
  (select reference from public.dossiers where id = (select id from t where name = 'dossier_a')),
  '^UC-[0-9]{4}-[0-9]{4,}$',
  'La référence UC-AAAA-#### est attribuée par la base (jamais choisie par l’utilisateur)'
);
select is(
  (select stage::text || '/' || status from public.dossiers where id = (select id from t where name = 'dossier_a')),
  'opening/new', 'Un dossier ouvert commence à l’étape Ouverture, statut Nouveau'
);
select is(
  (select count(*) from public.dossier_events where dossier_id = (select id from t where name = 'dossier_a') and kind = 'opened'),
  1::bigint, 'L’ouverture du dossier est inscrite dans la chronologie'
);

with x as (
  insert into public.dossiers (client_id, platform) values ((select id from t where name = 'client_b'), 'iaa') returning id
) insert into t select 'dossier_b', id from x;

select throws_ok(
  $$ update public.dossiers set client_id = (select id from t where name = 'client_b') where id = (select id from t where name = 'dossier_a') $$,
  '42501', null, 'Le client d’un dossier ne peut pas être changé'
);
select throws_ok(
  $$ update public.dossiers set stage = 'purchase', status = 'bidding' where id = (select id from t where name = 'dossier_a') $$,
  '42501', null, 'Le changement d’étape direct est refusé (passage d’étape contrôlé)'
);
select throws_ok(
  $$ update public.dossiers set vin = 'TROPCOURT' where id = (select id from t where name = 'dossier_a') $$,
  '23514', null, 'VIN refusé s’il ne fait pas 17 caractères valides'
);

-- Contrat : génération enregistrée (document + contrat) ; un seul contrat par dossier.
insert into t values ('contract_a', public.register_contract_document(
  (select id from t where name = 'dossier_a'), 'test/dossier_a/contrat-v1.docx', 'contrat.docx', 1000,
  repeat('a', 64), 'test-v1'
));
select is(
  (select reference from public.contracts where id = (select id from t where name = 'contract_a')),
  (select reference from public.dossiers where id = (select id from t where name = 'dossier_a')),
  'Le contrat porte la référence de son dossier'
);
select is(
  public.register_contract_document(
    (select id from t where name = 'dossier_a'), 'test/dossier_a/contrat-v2.docx', 'contrat.docx', 1100,
    repeat('b', 64), 'test-v1'
  ),
  (select id from t where name = 'contract_a'),
  'Régénérer le contrat d’un dossier met à jour le même contrat (un contrat par dossier)'
);
select is(
  (select d.version from public.contracts c join public.documents d on d.id = c.document_id where c.id = (select id from t where name = 'contract_a')),
  2, 'La régénération crée la version 2 du document du contrat'
);
select throws_ok(
  $$ insert into public.contracts (dossier_id, client_id, reference, template_version, document_id, document_sha256)
     select (select id from t where name = 'dossier_a'), (select id from t where name = 'client_a'), 'AUTRE-REF', 'x',
            c.document_id, repeat('c', 64) from public.contracts c where c.id = (select id from t where name = 'contract_a') $$,
  '23505', null, 'Impossible de créer un second contrat pour le même dossier'
);
select throws_ok(
  $$ update public.contracts set dossier_id = (select id from t where name = 'dossier_b') where id = (select id from t where name = 'contract_a') $$,
  '42501', null, 'Impossible de rattacher un contrat à un autre dossier'
);

-- Acceptation par scan : preuve obligatoire, version figée, statut du dossier mis à jour.
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at)
     select c.dossier_id, 'contract', c.id, c.document_id, c.document_sha256, 'scanned_paper', 'accepted', now()
     from public.contracts c where c.id = (select id from t where name = 'contract_a') $$,
  '23514', null, 'Acceptation par scan refusée sans preuve téléversée'
);
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, portal_session)
     select c.dossier_id, 'contract', c.id, c.document_id, c.document_sha256, 'portal', 'accepted', now(), 'session'
     from public.contracts c where c.id = (select id from t where name = 'contract_a') $$,
  '42501', null, 'Accès refusé : un agent ne peut pas enregistrer une acceptation « portail »'
);

with x as (
  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
  values ((select id from t where name = 'dossier_a'), (select id from t where name = 'client_a'), 'acceptance_proof',
          'test/dossier_a/preuve.pdf', 'preuve.pdf', 'application/pdf', 2000, repeat('d', 64)) returning id
) insert into t select 'proof_a', id from x;

insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, proof_document_id)
select c.dossier_id, 'contract', c.id, (select id from t where name = 'proof_a'), repeat('0', 64), 'scanned_paper', 'accepted',
       now() - interval '1 hour', (select id from t where name = 'proof_a')
from public.contracts c where c.id = (select id from t where name = 'contract_a');

select is(
  (select a.document_sha256 from public.acceptances a where a.subject_id = (select id from t where name = 'contract_a')),
  repeat('b', 64), 'L’acceptation porte sur la version en vigueur du contrat (empreinte imposée par la base)'
);
select is(
  (select status from public.contracts where id = (select id from t where name = 'contract_a')),
  'accepted', 'Le contrat passe à « accepté »'
);
select is(
  (select status from public.dossiers where id = (select id from t where name = 'dossier_a')),
  'contract_signed', 'Le dossier passe au statut « Contrat signé »'
);
select is(
  (select count(*) from public.dossier_events where dossier_id = (select id from t where name = 'dossier_a') and kind = 'acceptance_recorded'),
  1::bigint, 'L’acceptation est inscrite dans la chronologie'
);
select throws_ok(
  $$ select public.register_contract_document((select id from t where name = 'dossier_a'), 'test/dossier_a/contrat-v3.docx',
       'contrat.docx', 1200, repeat('e', 64), 'test-v1') $$,
  '22023', null, 'Un contrat accepté ne peut plus être régénéré'
);
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision, decided_at, proof_document_id)
     select c.dossier_id, 'contract', c.id, c.document_id, c.document_sha256, 'scanned_paper', 'refused', now(), (select id from t where name = 'proof_a')
     from public.contracts c where c.id = (select id from t where name = 'contract_a') $$,
  '22023', null, 'Une seconde décision sur le même contrat est refusée'
);
reset role;

-- Les acceptations et la chronologie sont intangibles, même pour le propriétaire des tables.
select throws_ok(
  $$ update public.acceptances set decision = 'refused' where subject_id = (select id from t where name = 'contract_a') $$,
  '42501', null, 'Une acceptation enregistrée ne peut pas être modifiée'
);
select throws_ok(
  $$ delete from public.dossier_events where dossier_id = (select id from t where name = 'dossier_a') $$,
  '42501', null, 'La chronologie ne peut pas être supprimée'
);

-- Un document est figé, sauf sa visibilité client.
select throws_ok(
  $$ update public.documents set storage_path = 'autre' where id = (select id from t where name = 'proof_a') $$,
  '42501', null, 'Un document enregistré ne peut pas être modifié'
);

-- Audit : création du dossier et acceptation journalisées avec l'auteur et son rôle.
select is(
  (select actor_role::text from public.audit_log where object_type = 'dossiers' and action = 'insert'
     and object_id = (select id::text from t where name = 'dossier_a')),
  'ops', 'Audit : la création du dossier est journalisée avec le rôle de l’auteur'
);
select is(
  (select count(*) from public.audit_log where object_type = 'acceptances' and actor_id = 'a2222222-2222-2222-2222-222222222222'),
  1::bigint, 'Audit : l’acceptation est journalisée'
);

-- Le client A est rattaché à sa fiche ; le dossier B reçoit un document visible et un document interne.
update public.profiles set client_id = (select id from t where name = 'client_a') where id = 'a5555555-5555-5555-5555-555555555555';
update public.profiles set client_id = (select id from t where name = 'client_b') where id = 'a6666666-6666-6666-6666-666666666666';
insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client)
values ((select id from t where name = 'dossier_a'), (select id from t where name = 'client_a'), 'photos',
        'test/dossier_a/interne.jpg', 'interne.jpg', 'image/jpeg', 10, repeat('f', 64), false);

-- ---------------------------------------------------------------------------
-- Comptabilité (MFA) : lecture seule des dossiers et clients.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*) from public.dossiers where id in (select id from t)), 2::bigint, 'Comptabilité : lit les dossiers');
select throws_ok(
  $$ insert into public.clients (kind, name, notify_phone) values ('person', 'Interdit', '+221770000199') $$,
  '42501', null, 'Accès refusé : la comptabilité ne crée pas de client'
);
select throws_ok(
  $$ insert into public.dossiers (client_id) values ((select id from t where name = 'client_a')) $$,
  '42501', null, 'Accès refusé : la comptabilité n’ouvre pas de dossier'
);
reset role;

-- ---------------------------------------------------------------------------
-- Direction : lecture seule.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*) from public.clients where id in (select id from t)), 2::bigint, 'Direction : lit les clients');
update public.clients set name = 'Modifié' where id = (select id from t where name = 'client_a');
select throws_ok(
  $$ select public.duplicate_dossier((select id from t where name = 'dossier_a')) $$,
  '42501', null, 'Accès refusé : la direction ne duplique pas de dossier'
);
reset role;
select is((select name from public.clients where id = (select id from t where name = 'client_a')), 'Client A (test)',
  'Accès refusé : la direction ne modifie pas une fiche client');

-- ---------------------------------------------------------------------------
-- Client A : ne voit que ses propres données (isolation entre clients, CLAUDE.md règle 3).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.clients), 1::bigint, 'Client A : ne lit que sa propre fiche');
select is((select count(*) from public.dossiers), 1::bigint, 'Client A : ne lit que son dossier');
select is((select count(*) from public.dossiers where id = (select id from t where name = 'dossier_b')), 0::bigint,
  'Client A : aucun accès au dossier du client B');
select is((select count(*) from public.contracts), 1::bigint, 'Client A : lit son contrat');
select is(
  (select count(*) from public.documents),
  2::bigint, 'Client A : ne lit que ses documents visibles (2 versions du contrat, pas la photo interne ni la preuve)'
);
select is((select count(*) from public.acceptances), 1::bigint, 'Client A : lit son acceptation');
select ok(
  (select count(*) from public.dossier_events) > 0 and not exists (select 1 from public.dossier_events where not visible_client),
  'Client A : ne lit que les événements visibles de sa chronologie'
);
select throws_ok(
  $$ insert into public.dossiers (client_id) values ((select id from t where name = 'client_a')) $$,
  '42501', null, 'Accès refusé : un client n’ouvre pas de dossier'
);
reset role;

-- ---------------------------------------------------------------------------
-- Client B : aucune donnée du client A.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a6666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.clients where id = (select id from t where name = 'client_a')), 0::bigint,
  'Client B : aucun accès à la fiche du client A');
select is(
  (select count(*) from public.contracts) + (select count(*) from public.acceptances) + (select count(*) from public.documents),
  0::bigint, 'Client B : aucun contrat, acceptation ni document du client A'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin (MFA) : duplication d'un dossier (R14).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('copy_a', public.duplicate_dossier((select id from t where name = 'dossier_a')));
reset role;
select is(
  (select client_id::text || '|' || coalesce(platform::text, '') || '|' || coalesce(vin, '-') || '|' || status
     from public.dossiers where id = (select id from t where name = 'copy_a')),
  (select id::text from t where name = 'client_a') || '|copart|-|new',
  'Dupliquer copie le client et la plateforme, jamais le véhicule ni le statut'
);
select is((select count(*) from public.contracts where dossier_id = (select id from t where name = 'copy_a')), 0::bigint,
  'Dupliquer ne copie pas le contrat signé');

select * from finish();
rollback;
