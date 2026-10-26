-- US-1.3 et décision X7 : paramètres contractuels versionnés.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test', 'Admin Démo', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test', 'Agent Opérations', 'ops'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test', 'Client Démo', 'client');

-- Chargement initial (specs/parametres_contractuels.json)
select ok((select count(*) from public.settings_current) >= 50, 'Les paramètres initiaux sont chargés');
select is(public.setting_value('quote.validity_hours'), '48'::jsonb, 'Validité du devis : 48 h');
select is(public.setting_value('late_fee.amount_usd'), '10000'::jsonb, 'Montants stockés en centimes (100 $US = 10000)');
select is(public.setting_value('auth.mfa_required_roles'), '["admin","accounting","management"]'::jsonb, 'Rôles soumis à la MFA (A4, A4-bis)');
select is((select status from public.settings_current where key = 'quote.validity_hours'), 'a_confirmer',
  'Le statut « à confirmer » est conservé');

-- Lecture : internes oui, client non
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok((select count(*) from public.settings_current) >= 50, 'Agent : lit les paramètres');
select throws_ok(
  $$ insert into public.settings (key, value, value_type, status) values ('quote.validity_hours', '24', 'integer', 'confirme') $$,
  '42501', null, 'Accès refusé : un agent ne modifie pas les paramètres'
);
select throws_ok($$ select public.setting_value('quote.validity_hours') $$, '42501', null,
  'Accès refusé : setting_value n’est pas appelable par l’API');
reset role;

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.settings), 0::bigint, 'Accès refusé : le client ne lit aucun paramètre');
reset role;

-- Administrateur sans MFA : refusé
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.settings (key, value, value_type, status) values ('quote.validity_hours', '24', 'integer', 'confirme') $$,
  '42501', null, 'Accès refusé : administrateur sans MFA'
);
reset role;

-- Administrateur avec MFA : nouvelle version datée
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ insert into public.settings (key, value, value_type, status, source, reason)
     values ('quote.validity_hours', '24', 'integer', 'confirme', 'Test', 'Alignement sur le paiement 1') $$,
  'L’administrateur crée une nouvelle version'
);
select throws_ok(
  $$ insert into public.settings (key, value, value_type, status, effective_from)
     values ('quote.validity_hours', '12', 'integer', 'confirme', '2020-01-01') $$,
  '22023', null, 'Une version ne peut pas être antidatée'
);
reset role;

select is(public.setting_value('quote.validity_hours'), '24'::jsonb, 'La nouvelle version est en vigueur');
select is(public.setting_as_of('quote.validity_hours', now() - interval '1 second'), '48'::jsonb,
  'L’ancienne valeur reste consultable à sa date (X7)');
select is(
  (select created_by from public.settings where key = 'quote.validity_hours' order by effective_from desc limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'L’auteur de la version est enregistré'
);

-- Historique intangible, même pour le propriétaire des tables
select throws_ok($$ update public.settings set value = '1' where key = 'quote.validity_hours' $$, '42501', null,
  'Une version de paramètre ne peut pas être modifiée');
select throws_ok($$ delete from public.settings where key = 'quote.validity_hours' $$, '42501', null,
  'Une version de paramètre ne peut pas être supprimée');

select * from finish();
rollback;
