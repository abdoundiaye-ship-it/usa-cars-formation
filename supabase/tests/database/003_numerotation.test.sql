-- Règle R3 et décision B3 : numérotation continue, annuelle, sans trou.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'pgtap.admin@exemple.test', 'Admin Démo', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap.ops@exemple.test', 'Agent Opérations', 'ops'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap.client@exemple.test', 'Client Démo', 'client');

-- Isolation : compteurs remis à zéro le temps du test (transaction annulée à la fin), quel que soit
-- le nombre de documents déjà numérotés dans la base locale (seed, parcours Playwright).
delete from public.number_sequences;

select is(public.format_document_number('UC-{YYYY}-{####}', 2026, 12345), 'UC-2026-12345',
  'Au-delà de 9999, le numéro n’est pas tronqué');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.next_number('dossier', 2026), 'UC-2026-0001', 'Premier dossier de l’année : UC-2026-0001');
select is(public.next_number('dossier', 2026), 'UC-2026-0002', 'Numéro suivant sans trou');
select is(public.next_number('dossier', 2027), 'UC-2027-0001', 'Remise à zéro annuelle');
select is(public.next_number('quote', 2026), 'DV-2026-0001', 'Compteur distinct par type (devis)');
select is(public.next_number('deposit_invoice', 2026), 'FA-2026-0001', 'Facture d’acompte : FA');
select ok(public.next_number('balance_invoice') like 'FS-' || extract(year from now() at time zone 'Africa/Dakar')::int || '-0001',
  'Année courante (Africa/Dakar) par défaut');
select throws_ok($$ select public.next_number('inconnu', 2026) $$, '22023', null, 'Type de document inconnu refusé');
select throws_ok($$ select * from public.number_sequences $$, '42501', null, 'Accès refusé : compteurs non lisibles par l’API');
reset role;

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select public.next_number('dossier', 2026) $$, '42501', null,
  'Accès refusé : un client ne peut pas obtenir de numéro');
reset role;

select * from finish();
rollback;
