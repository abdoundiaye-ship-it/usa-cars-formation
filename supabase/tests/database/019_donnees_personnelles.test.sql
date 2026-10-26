-- Phase 6, lot 6b : données personnelles — durées de conservation après la clôture (G2-a), rapport réservé à
-- l'administrateur et à la direction, page « Confidentialité » du portail (G1-a) sans accès aux paramètres.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- Paramètres (G2-a) : valeurs par défaut à confirmer, jamais en dur.
select is(public.setting_value('data.retention_years'), '5'::jsonb, 'Autres données : 5 ans (G2-a)');
select is(public.setting_value('data.retention_years_accounting'), '10'::jsonb, 'Pièces comptables : 10 ans (G2-a)');
select is(
  (select string_agg(status, '|' order by key) from public.settings_current
    where key in ('data.retention_years', 'data.retention_years_accounting')),
  'confirme|confirme', 'Durées confirmées le 22/10/2026 (G2-b)');
select is(public.setting_value('data.privacy_notice_validated'), 'false'::jsonb, 'Page Confidentialité : PROJET (G1-a)');

-- Date de clôture renseignée par la base.
select ok((select closed_at is not null from public.dossiers where reference = 'DEMO-2026-0008'),
  'Dossier terminé : date de clôture renseignée');
select ok((select closed_at is null from public.dossiers where reference = 'DEMO-2026-0007'),
  'Dossier en cours : pas de date de clôture');
update public.dossiers set closed_at = '2020-01-01' where reference = 'DEMO-2026-0008';
select ok((select closed_at > '2026-01-01' from public.dossiers where reference = 'DEMO-2026-0008'),
  'La date de clôture ne se modifie pas directement');
-- Direction (double authentification validée) : rapport à différentes dates de situation.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*) from public.report_retention() where reference = 'DEMO-2026-0008'), 0::bigint,
  'Aujourd’hui : aucune durée atteinte');
select is(
  (select scope || '|' || other_data_until::text || '|' || accounting_until::text from public.report_retention(
     (current_date + interval '5 years')::date) where reference = 'DEMO-2026-0008'),
  'other_data|' || (current_date + interval '5 years')::date || '|' || (current_date + interval '10 years')::date,
  'Dans 5 ans : autres données à purger, pièces comptables conservées');
select is(
  (select scope from public.report_retention((current_date + interval '10 years')::date) where reference = 'DEMO-2026-0008'),
  'all', 'Dans 10 ans : toutes les données');
select ok(
  (select client_dossiers_kept from public.report_retention((current_date + interval '10 years')::date)
    where reference = 'DEMO-2026-0008') > 0,
  'Le client a d’autres dossiers conservés : son identité reste');
select is((select count(*) from public.report_retention((current_date + interval '10 years')::date)
  where reference = 'DEMO-2026-0007'), 0::bigint, 'Dossier en cours : jamais dans le rapport');
select lives_ok($$ select public.log_report_export('retention', '{"situation": "2036-10-21"}') $$,
  'Export du rapport journalisé');
reset role;

-- Accès refusé : opérations, comptabilité, client.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_retention() $$, '42501', null, 'Accès refusé : agent opérations');
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_retention() $$, '42501', null, 'Accès refusé : comptabilité');
reset role;

-- Client : page Confidentialité (coordonnées et durées seulement), aucun accès aux paramètres ni au rapport.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_retention() $$, '42501', null, 'Accès refusé : client (rapport)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.privacy_notice()) k),
  array['email', 'office_address', 'phone', 'retention_years', 'retention_years_accounting', 'validated'],
  'Confidentialité : uniquement les coordonnées officielles et les durées');
select is(public.privacy_notice() ->> 'retention_years_accounting', '10', 'Confidentialité : durées lues dans les paramètres');
select is((select count(*) from public.settings_current), 0::bigint, 'Client : aucun paramètre lisible directement');
reset role;

-- Cycle de vie (date de clôture d'il y a 3 ans posée hors déclencheur pour la distinguer de maintenant).
alter table public.dossiers disable trigger dossiers_set_closed_at;
update public.dossiers set closed_at = '2023-10-21' where reference = 'DEMO-2026-0008';
alter table public.dossiers enable trigger dossiers_set_closed_at;
update public.dossiers set status = 'archived' where reference = 'DEMO-2026-0008';
select is((select closed_at from public.dossiers where reference = 'DEMO-2026-0008'), '2023-10-21'::timestamptz,
  'Terminé → Archivé : même date de clôture');
update public.dossiers set status = 'claim' where reference = 'DEMO-2026-0008';
select ok((select closed_at is null from public.dossiers where reference = 'DEMO-2026-0008'),
  'Réclamation : le dossier n’est plus clôturé, le délai de conservation ne court plus');
update public.dossiers set status = 'completed' where reference = 'DEMO-2026-0008';
select is((select closed_at from public.dossiers where reference = 'DEMO-2026-0008'), now(),
  'Nouvelle clôture : nouvelle date');

-- Durée vide : jamais atteinte (G2-a, aucune valeur en dur).
insert into public.settings (key, value, value_type, status, source, effective_from)
values ('data.retention_years', 'null'::jsonb, 'integer', 'a_confirmer', 'Test', now());
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select scope || '|' || coalesce(other_data_until::text, 'aucune') from public.report_retention(
     (current_date + interval '20 years')::date) where reference = 'DEMO-2026-0008'),
  'accounting|aucune', 'Durée « autres données » vide : jamais atteinte');
reset role;

select * from finish();
rollback;
