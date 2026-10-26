-- Phase 3, lot 3d — remise des documents et transfert de propriété (US-3.11, R9), conditions de passage
-- automatiques (fin de P1), vue d'ensemble financière. Sur le dossier de démonstration DEMO-2026-0005 (seed).
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email) values
  ('a9222222-2222-2222-2222-222222222222', 'pgtap9.ops@exemple.test'),
  ('a9333333-3333-3333-3333-333333333333', 'pgtap9.compta@exemple.test'),
  ('a9555555-5555-5555-5555-555555555555', 'pgtap9.client@exemple.test');
insert into public.profiles (id, email, full_name, role, client_id) values
  ('a9222222-2222-2222-2222-222222222222', 'pgtap9.ops@exemple.test', 'Agent Test', 'ops', null),
  ('a9333333-3333-3333-3333-333333333333', 'pgtap9.compta@exemple.test', 'Compta Test', 'accounting', null),
  ('a9555555-5555-5555-5555-555555555555', 'pgtap9.client@exemple.test', 'Client Test', 'client',
   'c0000000-0000-4000-8000-000000000002');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('dossier', 'e0000000-0000-4000-8000-000000000005');
insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
select (select id from t where name = 'dossier'), 'c0000000-0000-4000-8000-000000000002', k.kind,
       'dossiers/test-3d/' || k.kind || '.pdf', k.kind || '.pdf', 'application/pdf', 10, repeat(k.c, 64)
from (values ('payment_proof', 'a'), ('release_receipt', 'b'), ('other', 'c')) as k(kind, c);
create function pg_temp.doc(p_kind text) returns uuid language sql as $$
  select id from public.documents where storage_path = 'dossiers/test-3d/' || p_kind || '.pdf';
$$;
grant execute on function pg_temp.doc(text) to authenticated;

-- Facture de solde émise (3 200 $US), pas encore réglée
select set_config('request.jwt.claims', '{"sub":"a9333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.issue_balance_invoice((select id from t where name = 'dossier'));
reset role;
select set_config('request.jwt.claims', '{"sub":"a9222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'client', 'Client démo', 'passport',
       'P-1', pg_temp.doc('release_receipt')) $$,
  '22023', 'Le solde du dossier n’est pas réglé : les documents ne peuvent pas être remis.',
  'R9 : remise impossible tant que le solde n’est pas réglé');
select is((select ownership_transferred_at from public.dossiers where id = (select id from t where name = 'dossier')),
  null, 'Propriété non transférée avant le paiement intégral');
reset role;

-- Paiement intégral du solde → transfert de propriété (R9)
select set_config('request.jwt.claims', '{"sub":"a9333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.record_payment((select id from t where name = 'dossier'), 'USD', 320000, null, 'bank_transfer',
  'a0000000-0000-4000-8000-000000000001', 'VIR-3D-1', now(), pg_temp.doc('payment_proof'));
select ok((select ownership_transferred_at is not null from public.dossiers where id = (select id from t where name = 'dossier')),
  'Paiement intégral : propriété transférée (date du paiement)');
select is(
  (select status from public.financial_documents
     where dossier_id = (select id from t where name = 'dossier') and doc_type = 'balance_invoice'),
  'paid', 'Facture de solde réglée');
select throws_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'client', 'Client démo', 'passport',
       'P-1', pg_temp.doc('release_receipt')) $$,
  '42501', null, 'Accès refusé : la comptabilité n’enregistre pas la remise (L seulement)');
reset role;

select set_config('request.jwt.claims', '{"sub":"a9222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ update public.dossiers set ownership_transferred_at = now() - interval '1 year'
     where id = (select id from t where name = 'dossier') $$,
  '42501', null, 'La date de transfert de propriété n’est pas modifiable à la main');
select throws_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'representative', 'Mandataire démo',
       'national_id', 'CNI-1', pg_temp.doc('release_receipt')) $$,
  '22023', 'Mandataire : joignez la procuration signée du client.', 'Mandataire : procuration obligatoire');
select throws_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'client', 'Client démo', 'passport',
       'P-1', pg_temp.doc('other')) $$,
  '22023', 'Joignez la décharge signée par le bénéficiaire.', 'Décharge signée obligatoire');
select lives_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'client', 'Client démo', 'passport',
       'P-1', pg_temp.doc('release_receipt')) $$,
  'L’agent enregistre la remise au client (pièce vérifiée, décharge signée)');
select throws_ok(
  $$ select public.record_document_release((select id from t where name = 'dossier'), 'client', 'Client démo', 'passport',
       'P-1', pg_temp.doc('release_receipt')) $$,
  '22023', null, 'Une seule remise par dossier');
reset role;

-- Fin de P1 : conditions de passage vérifiées automatiquement
select set_config('app.stage_transition', 'on', true);
update public.dossiers set stage = 'purchase', status = 'confirmed' where id = (select id from t where name = 'dossier');
select set_config('app.stage_transition', 'off', true);
select set_config('request.jwt.claims', '{"sub":"a9222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(
  (select string_agg(code, ',' order by code) from public.stage_conditions((select id from t where name = 'dossier'))
     where met and code in ('quote_accepted', 'payment1_received')),
  'payment1_received,quote_accepted', 'Devis accepté et paiement 1 reçu constatés automatiquement');
select is(
  (select met from public.stage_conditions('e0000000-0000-4000-8000-000000000004') where code = 'quote_accepted'),
  false, 'Sans devis accepté, la condition n’est pas remplie');
reset role;
select set_config('app.stage_transition', 'on', true);
update public.dossiers set stage = 'dakar', status = 'documents_released' where id = (select id from t where name = 'dossier');
select set_config('app.stage_transition', 'off', true);
set local role authenticated;
select is(
  (select string_agg(code, ',' order by code) from public.stage_conditions((select id from t where name = 'dossier')) where met),
  'balance_paid,release_receipt', 'À Dakar : solde réglé et documents remis constatés automatiquement');
reset role;

-- Vue d'ensemble financière : internes uniquement
select set_config('request.jwt.claims', '{"sub":"a9333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select balance_remaining_cents || '|' || documents_released || '|' || balance_invoice_issued
     from public.finance_overview() where dossier_id = (select id from t where name = 'dossier')),
  '0|true|true', 'Vue d’ensemble : solde nul, facture de solde émise, documents remis');
select is(
  (select has_accepted_quote || '|' || total_due_cents from public.finance_overview() where reference = 'DEMO-2026-0004'),
  'false|0', 'Vue d’ensemble : rien n’est dû tant que le devis n’est pas accepté');
reset role;
select set_config('request.jwt.claims', '{"sub":"a9555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.finance_overview()), 0::bigint, 'Accès refusé : la vue d’ensemble est interne');
select is((select count(*) from public.document_releases), 1::bigint, 'Client : voit la remise de ses documents');
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.document_releases), 0::bigint, 'Accès refusé : remise des documents d’un autre client');
reset role;
select is((select count(*) from public.audit_log where object_type = 'document_releases'), 1::bigint,
  'Audit : la remise est journalisée');

select * from finish();
rollback;
