-- US-1.1, US-1.2 et décision A4 : rôles, MFA, comptes désactivés, gestion des utilisateurs.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- Jeu d'essai fictif (@exemple.test)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test'),
  ('33333333-3333-3333-3333-333333333333', 'pgtap.compta@exemple.test'),
  ('44444444-4444-4444-4444-444444444444', 'pgtap.direction@exemple.test'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test'),
  ('66666666-6666-6666-6666-666666666666', 'pgtap.ops.inactif@exemple.test'),
  ('77777777-7777-7777-7777-777777777777', 'pgtap.nouveau@exemple.test');

insert into public.profiles (id, email, full_name, role, active) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test', 'Admin Démo', 'admin', true),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test', 'Agent Opérations', 'ops', true),
  ('33333333-3333-3333-3333-333333333333', 'pgtap.compta@exemple.test', 'Comptable Démo', 'accounting', true),
  ('44444444-4444-4444-4444-444444444444', 'pgtap.direction@exemple.test', 'Direction Démo', 'management', true),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test', 'Client Démo', 'client', true),
  ('66666666-6666-6666-6666-666666666666', 'pgtap.ops.inactif@exemple.test', 'Agent Inactif', 'ops', false);

-- Isolation vis-à-vis du seed de démonstration (identifiants d0000000-…) : ses comptes sont désactivés
-- le temps du test, et les comptages ne portent que sur les profils du test.
update public.profiles set active = false where id::text like 'd0000000%';

-- Administrateur sans second facteur (aal1) : aucun accès
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_role_app(), null::public.app_role, 'Admin sans MFA (aal1) : aucun rôle effectif');
select is((select count(*) from public.profiles), 1::bigint, 'Admin sans MFA : ne lit que son propre profil');
select is((select mfa_required from public.my_access()), true, 'my_access indique que la MFA est exigée pour un admin');
select is((select role from public.my_access()), 'admin'::public.app_role, 'my_access renvoie le rôle même avant la MFA');
reset role;

-- Administrateur avec second facteur (aal2)
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.current_role_app(), 'admin'::public.app_role, 'Admin avec MFA : rôle admin');
select is((select count(*) from public.profiles where email like 'pgtap.%@exemple.test'), 6::bigint, 'Admin : lit tous les profils');
reset role;

-- Comptabilité : MFA exigée (A4)
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_role_app(), null::public.app_role, 'Comptabilité sans MFA : aucun rôle effectif');
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.current_role_app(), 'accounting'::public.app_role, 'Comptabilité avec MFA : rôle accounting');
reset role;

-- Direction : MFA exigée (décision A4-bis du 19/10/2026)
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_role_app(), null::public.app_role, 'Direction sans MFA : aucun rôle effectif (A4-bis)');
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.current_role_app(), 'management'::public.app_role, 'Direction avec MFA : rôle management');
select is((select count(*) from public.profiles where email like 'pgtap.%@exemple.test'), 6::bigint, 'Direction : lit tous les profils');
reset role;

-- Agent opérations : MFA non imposée, ne lit que son profil
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_role_app(), 'ops'::public.app_role, 'Agent sans MFA : rôle ops');
select is((select count(*) from public.profiles), 1::bigint, 'Agent : ne lit que son propre profil');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$ insert into public.profiles (id, email, full_name, role) values ('77777777-7777-7777-7777-777777777777', 'pgtap.nouveau@exemple.test', 'Nouveau', 'ops') $$,
  '42501', null, 'Accès refusé : un agent ne peut pas créer d’utilisateur'
);
reset role;
select is((select role from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'ops'::public.app_role,
  'Accès refusé : un agent ne peut pas modifier son propre rôle');

-- Client : ne lit que son profil, n'est pas interne
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_role_app(), 'client'::public.app_role, 'Client : rôle client');
select is(public.is_internal(), false, 'Client : n’est pas un utilisateur interne');
select is((select count(*) from public.profiles), 1::bigint, 'Client : ne lit que son propre profil');
reset role;

-- Compte désactivé : aucun accès
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.current_role_app(), null::public.app_role, 'Compte désactivé : aucun rôle effectif');
select is(public.is_internal(), false, 'Compte désactivé : pas d’accès interne');
reset role;

-- Direction : lecture seule
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.profiles set full_name = 'Modifié' where id = '22222222-2222-2222-2222-222222222222';
reset role;
select is((select full_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'Agent Opérations',
  'Accès refusé : la direction ne modifie pas les utilisateurs');

-- Administrateur : création, changement de rôle, désactivation
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ insert into public.profiles (id, email, full_name, role) values ('77777777-7777-7777-7777-777777777777', 'pgtap.nouveau@exemple.test', 'Nouveau', 'ops') $$,
  'L’administrateur crée un utilisateur'
);
select lives_ok(
  $$ update public.profiles set role = 'accounting' where id = '77777777-7777-7777-7777-777777777777' $$,
  'L’administrateur change un rôle'
);
select lives_ok(
  $$ update public.profiles set active = false where id = '77777777-7777-7777-7777-777777777777' $$,
  'L’administrateur désactive un compte'
);
select throws_ok(
  $$ update public.profiles set active = false where id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'Impossible de désactiver le dernier administrateur actif'
);
select throws_ok(
  $$ delete from public.profiles where id = '77777777-7777-7777-7777-777777777777' $$,
  '42501', null, 'Aucune suppression de profil par l’API (désactivation uniquement)'
);
reset role;

-- Anonyme : rien
set local role anon;
select is((select count(*) from public.profiles), 0::bigint, 'Anonyme : aucun profil visible');
reset role;

select * from finish();
rollback;
