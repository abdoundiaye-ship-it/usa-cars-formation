-- Phase 4, lot 4a — portail client : ouverture de l'accès, isolation entre clients, acceptation dans le portail
-- (R15 : session, IP, version), téléchargement des documents visibles, jetons de connexion inaccessibles.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('ab222222-2222-2222-2222-222222222222', 'pgtap11.ops@exemple.test'),
  ('ab333333-3333-3333-3333-333333333333', 'pgtap11.compta@exemple.test'),
  ('ab555555-5555-5555-5555-555555555555', 'pgtap11.client@exemple.test'),
  ('ab666666-6666-6666-6666-666666666666', 'pgtap11.client2@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('ab222222-2222-2222-2222-222222222222', 'pgtap11.ops@exemple.test', 'Agent Test', 'ops'),
  ('ab333333-3333-3333-3333-333333333333', 'pgtap11.compta@exemple.test', 'Compta Test', 'accounting');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('client2', gen_random_uuid()), ('dossier', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone, notify_email) values
  ((select id from t where name = 'client'), 'person', 'Client portail (test)', '+221770000901', 'pgtap11.client@exemple.test'),
  ((select id from t where name = 'client2'), 'person', 'Autre client (test)', '+221770000902', null);
insert into public.dossiers (id, reference, client_id, stage, status, auction_result, hammer_price_cents,
                             lot_won_notified_at, payment1_due_at)
values ((select id from t where name = 'dossier'), 'TEST-4A-1', (select id from t where name = 'client'), 'purchase',
        'won', 'won', 800000, now() - interval '1 hour', now() + interval '23 hours');
insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents)
  values ((select id from t where name = 'dossier'), 1000000, 300000, 20000);
insert into public.fx_rates (rate, source, captured_at) values (600.0000, 'XE.com — test 4a', now() - interval '1 second');
insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client)
values
  ((select id from t where name = 'dossier'), (select id from t where name = 'client'), 'other',
   'dossiers/test-4a/frais.pdf', 'frais.pdf', 'application/pdf', 10, repeat('c', 64), true),
  ((select id from t where name = 'dossier'), (select id from t where name = 'client'), 'other',
   'dossiers/test-4a/interne.pdf', 'interne.pdf', 'application/pdf', 10, repeat('e', 64), false);
insert into storage.objects (bucket_id, name) values
  ('documents', 'dossiers/test-4a/frais.pdf'), ('documents', 'dossiers/test-4a/interne.pdf');

-- US-4.1 : ouverture de l'accès au portail
select set_config('request.jwt.claims', '{"sub":"ab333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.register_client_portal_access('ab555555-5555-5555-5555-555555555555', (select id from t where name = 'client'),
       'pgtap11.client@exemple.test') $$,
  '42501', null, 'Accès refusé : la comptabilité n’ouvre pas d’accès au portail');
reset role;
select set_config('request.jwt.claims', '{"sub":"ab222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.register_client_portal_access('ab555555-5555-5555-5555-555555555555', (select id from t where name = 'client'),
       'pgtap11.client@exemple.test') $$,
  'L’agent ouvre l’accès au portail du client');
select public.register_client_portal_access('ab666666-6666-6666-6666-666666666666', (select id from t where name = 'client2'),
  'client-test@clients.usacars.invalid');
select throws_ok(
  $$ select public.register_client_portal_access('ab555555-5555-5555-5555-555555555555', (select id from t where name = 'client'),
       'pgtap11.client@exemple.test') $$,
  '22023', null, 'Un compte n’est rattaché qu’une fois');
-- Devis émis avec son fichier (lot 3b)
insert into t values ('quote', public.issue_quote((select id from t where name = 'dossier')));
select public.register_financial_document_file((select id from t where name = 'quote'),
  'dossiers/' || (select id from t where name = 'dossier') || '/quote/devis.docx', 'Devis.docx', 1000, repeat('d', 64), 'test');
reset role;
select is((select role::text || '|' || client_id::text from public.profiles where id = 'ab555555-5555-5555-5555-555555555555'),
  'client|' || (select id::text from t where name = 'client'), 'Profil client rattaché à sa fiche');
select ok(exists (select 1 from public.audit_log where action = 'client_portal_access'
                  and object_id = (select id::text from t where name = 'client')), 'Audit : ouverture de l’accès journalisée');

-- US-4.2 : acceptation du devis dans le portail (R15)
select set_config('request.jwt.claims', '{"sub":"ab666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.accept_in_portal('quote', (select id from t where name = 'quote'), 'accepted', repeat('d', 64),
       'session-test-2', '10.0.0.2', 'accepted') $$,
  '42501', null, 'Accès refusé : un autre client ne peut pas accepter ce devis');
select is((select count(*) from public.financial_documents), 0::bigint, 'Isolation : aucun devis d’un autre client');
reset role;
select set_config('request.jwt.claims', '{"sub":"ab555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.portal_fx_rate()), 1::bigint, 'Taux en vigueur lisible pour les montants FCFA');
select throws_ok(
  $$ select public.accept_in_portal('quote', (select id from t where name = 'quote'), 'accepted', repeat('0', 64),
       'session-test-1', '10.0.0.1', 'accepted') $$,
  '22023', 'Le document a changé depuis son affichage : rechargez la page avant de décider.',
  'R15 : la décision porte sur la version affichée (empreinte)');
select throws_ok(
  $$ select public.accept_in_portal('quote', (select id from t where name = 'quote'), 'accepted', repeat('d', 64),
       'session-test-1', '10.0.0.1') $$,
  '22023', null, 'X1 : choix d’assurance obligatoire dans l’acceptation');
select lives_ok(
  $$ select public.accept_in_portal('quote', (select id from t where name = 'quote'), 'accepted', repeat('d', 64),
       'session-test-1', '10.0.0.1', 'refused') $$,
  'Le client accepte son devis dans le portail (assurance refusée)');
select is(
  (select method || '|' || host(portal_ip) || '|' || portal_session || '|' || insurance_choice || '|' || recorded_by::text
     from public.acceptances where subject_id = (select id from t where name = 'quote')),
  'portal|10.0.0.1|session-test-1|refused|ab555555-5555-5555-5555-555555555555',
  'Preuve enregistrée : portail, IP, session, choix d’assurance, auteur');
reset role;
select is((select status || '|' || insurance_choice from public.financial_documents where id = (select id from t where name = 'quote')),
  'accepted|refused', 'Devis accepté, assurance refusée');

-- US-4.4 : frais supplémentaires approuvés par le client dans le portail
select set_config('request.jwt.claims', '{"sub":"ab333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('extra', public.add_extra_cost((select id from t where name = 'dossier'), 'B', 'Réparation (test)', 90000,
  (select id from public.documents where storage_path = 'dossiers/test-4a/frais.pdf')));
reset role;
select set_config('request.jwt.claims', '{"sub":"ab555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.accept_in_portal('extra_cost', (select id from t where name = 'extra'), 'accepted', repeat('c', 64),
  'session-test-1', '10.0.0.1');
select is((select status from public.adjustments where id = (select id from t where name = 'extra')), 'approved',
  'Frais supplémentaires approuvés par le client dans le portail');

-- US-4.3 : téléchargement des seuls documents visibles ; jetons de connexion inaccessibles
select is((select count(*) from storage.objects where name like 'dossiers/test-4a/%'), 1::bigint,
  'Le client accède au fichier visible, pas au fichier interne');
select throws_ok($$ select count(*) from public.client_login_tokens $$, '42501', null,
  'Les jetons de connexion ne sont jamais lisibles par l’API');
reset role;

select * from finish();
rollback;
