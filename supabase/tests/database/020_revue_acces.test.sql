-- Phase 6, lot 6c : revue des accès (US-6.2) — réservée à l'administrateur et à la direction (docs/12),
-- comptes internes seulement, double authentification et dernière connexion, export journalisé.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Direction (double authentification validée) : la revue des accès.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok((select count(*) from public.report_access_review()) >= 4, 'Revue des accès : au moins les 4 comptes internes');
select is((select count(*) from public.report_access_review() where role = 'client'), 0::bigint,
  'Revue des accès : aucun compte client (revus sur la fiche client)');
select is(
  (select mfa_required || '|' || mfa_configured from public.report_access_review() where role = 'accounting' limit 1),
  'true|true', 'Comptabilité : 2FA requise et configurée');
select is(
  (select mfa_required || '|' || mfa_configured from public.report_access_review() where role = 'admin' limit 1),
  'true|false', 'Administrateur : 2FA requise mais pas encore configurée (signalée)');
select ok(
  exists (select 1 from public.report_access_review() where role = 'ops' and mfa_required = false),
  'Agent opérations : 2FA non requise (A4)');
reset role;

-- Accès refusé : comptabilité, opérations, client.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_access_review() $$, '42501', null, 'Accès refusé : comptabilité');
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_access_review() $$, '42501', null, 'Accès refusé : agent opérations');
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_access_review() $$, '42501', null, 'Accès refusé : client');
select throws_ok($$ select public.log_report_export('access_review', '{}') $$, '42501', null,
  'Accès refusé : client (export)');
reset role;

-- Direction sans double authentification validée : aucun rapport.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_access_review() $$, '42501', null,
  'Accès refusé : direction sans double authentification (A4-bis)');
reset role;

-- Export journalisé.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$ select public.log_report_export('access_review', '{}') $$, 'Export de la revue des accès journalisé');
reset role;
select is((select action || '|' || object_id from public.audit_log where object_type = 'report' order by id desc limit 1),
  'export_report|access_review', 'Export journalisé : auteur, rapport');

select * from finish();
rollback;
