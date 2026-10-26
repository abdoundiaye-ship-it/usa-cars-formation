-- Phase 6, lot 6d : réclamations après l'enlèvement (contrat art. 19). Dépôt par l'agent ou le client propriétaire,
-- délai (hors délai au-delà), traitement par l'agent, isolation entre clients, écriture par fonctions seulement.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- DEMO-2026-0009 : véhicule du client 1 (Mamadou Diallo), enlevé → réclamation possible.
-- Agent (opérations) dépose une réclamation.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.file_claim((select id from public.dossiers where reference = 'DEMO-2026-0009'), 'Pare-chocs rayé') $$,
  'Agent : dépose une réclamation après l’enlèvement');
select is((select source || '|' || status || '|' || out_of_time from public.claims
  where dossier_id = (select id from public.dossiers where reference = 'DEMO-2026-0009') order by filed_at desc limit 1),
  'agent|open|false', 'Réclamation de l’agent : source agent, reçue, dans le délai');
-- Dossier non enlevé : refus.
select throws_ok(
  $$ select public.file_claim((select id from public.dossiers where reference = 'DEMO-2026-0001'), 'x') $$,
  '22023', null, 'Réclamation impossible avant l’enlèvement');
reset role;

-- Client propriétaire (Mamadou Diallo) dépose une réclamation sur son dossier.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.file_claim((select id from public.dossiers where reference = 'DEMO-2026-0009'), 'Rétroviseur cassé, voir photo') $$,
  'Client : dépose une réclamation sur son dossier');
select is((select source from public.claims where reserves like 'Rétroviseur%'), 'client', 'Réclamation du client : source client');
-- Client sur le dossier d'un autre : refusé (règle 3).
-- Le dossier d'un autre client est invisible (RLS) : réclamation refusée (dossier introuvable).
select throws_ok(
  $$ select public.file_claim((select id from public.dossiers where client_id = 'c0000000-0000-4000-8000-000000000002' limit 1), 'x') $$,
  '22023', null, 'Accès refusé : réclamation sur le dossier d’un autre client (invisible)');
-- Un client ne traite pas les réclamations.
select throws_ok(
  $$ select public.respond_to_claim((select id from public.claims limit 1), 'resolved', 'ok') $$,
  '42501', null, 'Accès refusé : le client ne traite pas les réclamations');
reset role;

-- Comptabilité : lit mais ne dépose pas et ne traite pas.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok((select count(*) from public.claims) >= 2, 'Comptabilité : lit toutes les réclamations');
select throws_ok(
  $$ select public.file_claim((select id from public.dossiers where reference = 'DEMO-2026-0009'), 'x') $$,
  '42501', null, 'Accès refusé : la comptabilité ne dépose pas de réclamation');
select throws_ok(
  $$ select public.respond_to_claim((select id from public.claims limit 1), 'resolved', 'ok') $$,
  '42501', null, 'Accès refusé : la comptabilité ne traite pas les réclamations');
reset role;

-- Agent traite une réclamation : statut + réponse + notification du client.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.respond_to_claim((select id from public.claims where source = 'agent' limit 1), 'forwarded', 'Transmis au transporteur.') $$,
  'Agent : met à jour le statut et répond');
select is((select status || '|' || (response is not null)::text from public.claims where source = 'agent' limit 1),
  'forwarded|true', 'Réclamation traitée : statut transmis, réponse enregistrée');
select ok(exists (select 1 from public.notifications where template = 'claim_update'),
  'Le client est informé de la réponse (notification claim_update)');
reset role;

-- Isolation : le client 2 ne voit pas les réclamations du client 1.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.claims), 0::bigint, 'Isolation : un client ne voit pas les réclamations d’un autre');
reset role;

-- Photo rattachée à une réclamation : l'agent l'enregistre (visible du client).
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.register_claim_photo((select id from public.claims where source = 'agent' limit 1),
       'dossiers/x/photos/p1.jpg', 'photo.jpg', 'image/jpeg', 12345, repeat('a', 64)) $$,
  'Agent : enregistre une photo de réclamation');
select is((select visible_client || '|' || kind from public.documents where claim_id is not null limit 1),
  'true|photos', 'Photo de réclamation : visible du client, type photos');
reset role;

-- Écriture directe interdite (fonctions seulement).
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.claims (dossier_id, client_id, source, reserves, collected_at, deadline_at, out_of_time)
     values ((select id from public.dossiers where reference='DEMO-2026-0009'),
             'c0000000-0000-4000-8000-000000000001', 'agent', 'x', now(), now(), false) $$,
  '42501', null, 'Écriture directe des réclamations interdite (fonctions seulement)');
reset role;

-- Hors délai : réclamation déposée après le délai (enlèvement ancien simulé).
alter table public.dossiers disable trigger dossiers_set_collected_at;
update public.dossiers set collected_at = now() - interval '30 days' where reference = 'DEMO-2026-0009';
alter table public.dossiers enable trigger dossiers_set_collected_at;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.file_claim((select id from public.dossiers where reference = 'DEMO-2026-0009'), 'Réclamation tardive');
select is((select out_of_time from public.claims where reserves = 'Réclamation tardive'), true,
  'Déposée après le délai de l’art. 19 : hors délai');
reset role;

-- Journal d'audit.
select ok(exists (select 1 from public.audit_log where object_type = 'claims' and action = 'insert'), 'Dépôt journalisé');
select ok(exists (select 1 from public.audit_log where object_type = 'claims' and action = 'update'), 'Traitement journalisé');

select * from finish();
rollback;
