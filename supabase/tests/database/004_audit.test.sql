-- US-1.2 (changement de rôle journalisé), US-1.4 et CLAUDE.md règle 5 : journal d'audit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test'),
  ('44444444-4444-4444-4444-444444444444', 'pgtap.direction@exemple.test'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test', 'Admin Démo', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test', 'Agent Opérations', 'ops'),
  ('44444444-4444-4444-4444-444444444444', 'pgtap.direction@exemple.test', 'Direction Démo', 'management'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test', 'Client Démo', 'client');

-- Changement de rôle par l'administrateur
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.profiles set role = 'accounting' where id = '22222222-2222-2222-2222-222222222222';
insert into public.settings (key, value, value_type, status, reason)
  values ('late_fee.period_days', '14', 'integer', 'confirme', 'Confirmation');
select is((select count(*) from public.audit_log where object_type = 'profiles' and object_id in (select id::text from public.profiles where email like 'pgtap.%@exemple.test')), 5::bigint,
  'Admin avec MFA : lit le journal (4 créations + 1 modification)');
select throws_ok(
  $$ insert into public.audit_log (action, object_type, object_id) values ('faux', 'x', '1') $$,
  '42501', null, 'Accès refusé : aucune écriture directe dans le journal'
);
reset role;

select is(
  (select actor_id from public.audit_log where object_type = 'profiles' and action = 'update'
     and object_id = '22222222-2222-2222-2222-222222222222' order by id desc limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Changement de rôle : auteur enregistré');
select is(
  (select actor_role from public.audit_log where object_type = 'profiles' and action = 'update' order by id desc limit 1),
  'admin'::public.app_role, 'Changement de rôle : rôle de l’auteur enregistré');
select is(
  (select before ->> 'role' from public.audit_log where object_type = 'profiles' and action = 'update' order by id desc limit 1),
  'ops', 'Changement de rôle : valeur avant');
select is(
  (select after ->> 'role' from public.audit_log where object_type = 'profiles' and action = 'update' order by id desc limit 1),
  'accounting', 'Changement de rôle : valeur après');
select is(
  (select before ? 'email' from public.audit_log where object_type = 'profiles' and action = 'update' order by id desc limit 1),
  false, 'Seuls les champs modifiés sont journalisés');
select is(
  (select count(*) from public.audit_log where object_type = 'settings' and object_id = 'late_fee.period_days'
     and actor_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint, 'Nouvelle version de paramètre journalisée');

-- Journal intangible
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null, 'Le journal ne peut pas être modifié');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'Le journal ne peut pas être supprimé');

-- Lecture : direction oui ; agent, client et admin sans MFA non
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok((select count(*) from public.audit_log) > 0, 'Direction : lit le journal');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*) from public.audit_log), 0::bigint, 'Accès refusé : la comptabilité ne lit pas le journal');
select lives_ok($$ select public.log_audit('test_action', 'dossiers', 'DEMO-1', null, null, 'motif', 'faux-script') $$,
  'Un utilisateur interne journalise une action métier');
reset role;
select is(
  (select actor_label from public.audit_log where action = 'test_action'), null,
  'Un utilisateur connecté ne peut pas usurper un libellé de script');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.audit_log), 0::bigint, 'Accès refusé : le client ne lit pas le journal');
select throws_ok($$ select public.log_audit('faux', 'dossiers', 'DEMO-1') $$, '42501', null,
  'Accès refusé : un client ne peut pas journaliser');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.audit_log), 0::bigint, 'Accès refusé : administrateur sans MFA');
reset role;

select * from finish();
rollback;
