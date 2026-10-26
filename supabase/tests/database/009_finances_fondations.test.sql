-- Phase 3, lot 3a — taux de change (R1), comptes officiels et double validation (US-3.10, Q1),
-- coûts internes jamais visibles du client (US-3.1, CLAUDE.md règle 2), forfaits (US-3.2, I4).
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, email) values
  ('f1111111-1111-1111-1111-111111111111', 'pgtap6.admin@exemple.test'),
  ('f1111111-1111-1111-1111-111111111112', 'pgtap6.admin2@exemple.test'),
  ('f2222222-2222-2222-2222-222222222222', 'pgtap6.ops@exemple.test'),
  ('f3333333-3333-3333-3333-333333333333', 'pgtap6.compta@exemple.test'),
  ('f4444444-4444-4444-4444-444444444444', 'pgtap6.direction@exemple.test'),
  ('f5555555-5555-5555-5555-555555555555', 'pgtap6.client@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('f1111111-1111-1111-1111-111111111111', 'pgtap6.admin@exemple.test', 'Admin Test', 'admin'),
  ('f1111111-1111-1111-1111-111111111112', 'pgtap6.admin2@exemple.test', 'Admin 2 Test', 'admin'),
  ('f2222222-2222-2222-2222-222222222222', 'pgtap6.ops@exemple.test', 'Agent Test', 'ops'),
  ('f3333333-3333-3333-3333-333333333333', 'pgtap6.compta@exemple.test', 'Compta Test', 'accounting'),
  ('f4444444-4444-4444-4444-444444444444', 'pgtap6.direction@exemple.test', 'Direction Test', 'management'),
  ('f5555555-5555-5555-5555-555555555555', 'pgtap6.client@exemple.test', 'Client Test', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('dossier', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone)
  values ((select id from t where name = 'client'), 'person', 'Client (test)', '+221770000601');
insert into public.dossiers (id, reference, client_id)
  values ((select id from t where name = 'dossier'), 'TEST-3A-1', (select id from t where name = 'client'));
update public.profiles set client_id = (select id from t where name = 'client') where id = 'f5555555-5555-5555-5555-555555555555';

-- R1 : taux de change
select set_config('request.jwt.claims', '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.fx_rates (rate, source, captured_at) values (590, 'XE.com', now()) $$,
  '42501', null, 'Accès refusé : un agent ne saisit pas de taux de change'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into public.fx_rates (rate, source, captured_at) values (591.2500, 'XE.com — test', now() - interval '1 minute');
select throws_ok(
  $$ insert into public.fx_rates (rate, source, captured_at) values (590, 'XE.com', now() + interval '1 day') $$,
  '22023', null, 'Un relevé de taux ne peut pas être daté dans le futur'
);
select is((select rate from public.fx_rate_as_of(now())), 591.2500::numeric, 'Le taux du jour est le dernier relevé');
select ok(public.fx_rate_exists_on((now() at time zone 'Africa/Dakar')::date), 'Un taux existe pour aujourd’hui');
select ok(not public.fx_rate_exists_on('2001-01-01'), 'Aucun taux pour un jour sans relevé (alerte paiement)');
reset role;
select throws_ok(
  $$ update public.fx_rates set rate = 1 where source = 'XE.com — test' $$,
  '42501', null, 'Un taux enregistré ne peut pas être modifié'
);

-- US-3.10 / Q1 : comptes officiels et double validation
select set_config('request.jwt.claims', '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.create_official_account('wave', 'Wave', 'USA CARS', p_phone => '+221770000999') $$,
  '42501', null, 'Accès refusé : la comptabilité ne crée pas de compte officiel'
);
select throws_ok(
  $$ insert into public.official_accounts (kind, label, holder_name, phone, created_by)
     values ('wave', 'X', 'Y', '+221770000998', 'f3333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'Aucune écriture directe dans les comptes officiels'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('account', public.create_official_account('bank', 'Compte test', 'USA CARS (test)', 'Banque test', 'TEST-0001'));
select is((select status from public.official_accounts where id = (select id from t where name = 'account')), 'pending_approval',
  'Un compte créé attend son approbation');
select throws_ok(
  $$ select public.approve_official_account((select id from t where name = 'account')) $$,
  '42501', null, 'Double validation : le créateur ne peut pas approuver son propre compte'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.approve_official_account((select id from t where name = 'account')) $$,
  '42501', null, 'Accès refusé : un agent n’approuve pas un compte officiel'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"f4444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.approve_official_account((select id from t where name = 'account')) $$,
  'Q1 : la direction approuve le compte créé par l’administrateur'
);
reset role;
select is((select status || '|' || approved_by::text from public.official_accounts where id = (select id from t where name = 'account')),
  'active|f4444444-4444-4444-4444-444444444444', 'Compte actif, approbateur enregistré');
select throws_ok(
  $$ update public.official_accounts set account_number = 'PIRATE' where id = (select id from t where name = 'account') $$,
  '42501', null, 'Les coordonnées d’un compte actif sont figées (même pour le propriétaire des tables)'
);

-- Remplacement : nouveau compte, ancien désactivé à l'approbation (second administrateur)
select set_config('request.jwt.claims', '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('account_v2', public.create_official_account('bank', 'Compte test v2', 'USA CARS (test)', 'Banque test',
  'TEST-0002', p_replaces_id => (select id from t where name = 'account')));
reset role;
select set_config('request.jwt.claims', '{"sub":"f1111111-1111-1111-1111-111111111112","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.approve_official_account((select id from t where name = 'account_v2'));
reset role;
select is(
  (select string_agg(status, ',' order by account_number) from public.official_accounts
     where id in (select id from t where name in ('account', 'account_v2'))),
  'inactive,active', 'Le nouveau compte approuvé remplace l’ancien, désactivé automatiquement'
);
select is((select count(*) from public.audit_log where object_type = 'official_accounts'
             and object_id in (select id::text from t where name in ('account', 'account_v2'))), 5::bigint,
  'Audit : créations, approbations et désactivation journalisées');

-- US-3.1 / US-3.2 : coûts internes et forfaits (agent)
select set_config('request.jwt.claims', '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
insert into public.internal_costs (dossier_id, section, category, amount_cents)
  values ((select id from t where name = 'dossier'), 'A', 'hammer_price', 800000);
select throws_ok(
  $$ insert into public.internal_costs (dossier_id, section, category, amount_cents)
     values ((select id from t where name = 'dossier'), 'A', 'ocean_freight', 1) $$,
  '23514', null, 'Un poste de coût doit appartenir à sa section (fret maritime : section B)'
);
insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents)
  values ((select id from t where name = 'dossier'), 950000, 300000);
select throws_ok(
  $$ update public.dossier_forfaits set mode = 'proposed_with_approval' where dossier_id = (select id from t where name = 'dossier') $$,
  '22023', null, 'Le calcul assisté des forfaits n’est pas activé (C1)'
);
reset role;
-- CLAUDE.md règle 1 : montants en centimes entiers (bigint), jamais de flottant.
select ok(
  (select bool_and(data_type = 'bigint') from information_schema.columns
     where table_schema = 'public' and table_name in ('dossier_forfaits', 'internal_costs') and column_name like '%cents'),
  'Montants des forfaits et coûts internes en centimes entiers (bigint)'
);
select is((select count(*) from public.audit_log where object_type = 'dossier_forfaits'
             and object_id = (select id::text from t where name = 'dossier')),
  1::bigint, 'Audit : la saisie des forfaits est journalisée');

-- CLAUDE.md règle 2 : le client ne voit RIEN des coûts internes ni des forfaits en saisie
select set_config('request.jwt.claims', '{"sub":"f5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.internal_costs), 0::bigint, 'Client : aucun coût interne (RLS)');
select is((select count(*) from public.dossier_forfaits), 0::bigint, 'Client : aucun forfait en saisie (il verra son devis émis)');
select is((select count(*) from public.fx_rates), 0::bigint, 'Client : pas d’accès à l’historique des taux');
select is((select count(*) from public.official_accounts where status <> 'active'), 0::bigint,
  'Client : ne voit que les comptes officiels actifs');
reset role;

select * from finish();
rollback;
