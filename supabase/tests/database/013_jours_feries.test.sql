-- Décision du 20/10/2026 : jours ouvrés hors week-ends et jours fériés (remboursements C9, remise des documents R9).
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email) values
  ('aa111111-1111-1111-1111-111111111111', 'pgtap10.admin@exemple.test'),
  ('aa222222-2222-2222-2222-222222222222', 'pgtap10.ops@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('aa111111-1111-1111-1111-111111111111', 'pgtap10.admin@exemple.test', 'Admin Test', 'admin'),
  ('aa222222-2222-2222-2222-222222222222', 'pgtap10.ops@exemple.test', 'Agent Test', 'ops');

-- Vendredi 03/04/2026 + 1 jour ouvré : samedi 04/04 (Indépendance), dimanche, lundi 06/04 (Pâques) exclus.
select is(public.add_business_days('2026-04-03T10:00:00Z', 1), '2026-04-07T10:00:00Z'::timestamptz,
  'Week-end et lundi de Pâques exclus');
select is(public.add_business_days('2026-10-19T10:00:00Z', 5), '2026-10-26T10:00:00Z'::timestamptz,
  'Cinq jours ouvrés sans jour férié : une semaine (C9)');

select set_config('request.jwt.claims', '{"sub":"aa222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok((select count(*) from public.public_holidays where day between '2026-01-01' and '2026-12-31') >= 9,
  'Les internes consultent le calendrier (fêtes fixes et liées à Pâques pré-remplies)');
select throws_ok(
  $$ insert into public.public_holidays (day, label) values ('2026-03-20', 'Korité (test)') $$,
  '42501', null, 'Accès refusé : un agent ne modifie pas le calendrier');
reset role;

select set_config('request.jwt.claims', '{"sub":"aa111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into public.public_holidays (day, label) values ('2026-10-20', 'Fête religieuse (test)');
select is(public.add_business_days('2026-10-19T10:00:00Z', 1), '2026-10-21T10:00:00Z'::timestamptz,
  'Un jour férié saisi par l’administrateur est exclu des jours ouvrés');
reset role;
select is((select count(*) from public.audit_log where object_type = 'public_holidays' and object_id = '2026-10-20'),
  1::bigint, 'Audit : l’ajout d’un jour férié est journalisé');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.public_holidays), 0::bigint, 'Le client n’accède pas au calendrier interne');
reset role;

select * from finish();
rollback;
