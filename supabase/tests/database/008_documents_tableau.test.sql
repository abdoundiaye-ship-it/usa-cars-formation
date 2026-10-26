-- Phase 2, lot 2d — US-2.8 (documents : visibilité client, droits par rôle), paramètres du tableau de bord.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e1111111-1111-1111-1111-111111111111', 'pgtap5.ops@exemple.test'),
  ('e3333333-3333-3333-3333-333333333333', 'pgtap5.compta@exemple.test'),
  ('e4444444-4444-4444-4444-444444444444', 'pgtap5.direction@exemple.test'),
  ('e5555555-5555-5555-5555-555555555555', 'pgtap5.client@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('e1111111-1111-1111-1111-111111111111', 'pgtap5.ops@exemple.test', 'Agent Test', 'ops'),
  ('e3333333-3333-3333-3333-333333333333', 'pgtap5.compta@exemple.test', 'Compta Test', 'accounting'),
  ('e4444444-4444-4444-4444-444444444444', 'pgtap5.direction@exemple.test', 'Direction Test', 'management'),
  ('e5555555-5555-5555-5555-555555555555', 'pgtap5.client@exemple.test', 'Client Test', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('dossier', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone) values ((select id from t where name = 'client'), 'person', 'Client (test)', '+221770000501');
insert into public.dossiers (id, reference, client_id) values ((select id from t where name = 'dossier'), 'TEST-2D-1', (select id from t where name = 'client'));
update public.profiles set client_id = (select id from t where name = 'client') where id = 'e5555555-5555-5555-5555-555555555555';

select ok((select count(*) from public.settings_current where key like 'dashboard.%') = 2,
  'Les seuils du tableau de bord sont des paramètres (CLAUDE.md règle 4)');

-- Comptabilité (MFA) : ajoute un document et le rend visible du client
select set_config('request.jwt.claims', '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
with x as (
  insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
  values ((select id from t where name = 'dossier'), (select id from t where name = 'client'), 'payment_proof',
          'test/2d/preuve-paiement.pdf', 'preuve.pdf', 'application/pdf', 10, repeat('a', 64)) returning id
) insert into t select 'doc', id from x;
select is((select visible_client from public.documents where id = (select id from t where name = 'doc')), false,
  'Un document téléversé est interne par défaut');
update public.documents set visible_client = true where id = (select id from t where name = 'doc');
select is((select visible_client from public.documents where id = (select id from t where name = 'doc')), true,
  'La comptabilité rend un document visible du client');
select throws_ok(
  $$ update public.documents set file_name = 'autre.pdf' where id = (select id from t where name = 'doc') $$,
  '42501', null, 'Seule la visibilité d’un document est modifiable'
);
reset role;

-- Direction : lecture seule
select set_config('request.jwt.claims', '{"sub":"e4444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.documents set visible_client = false where id = (select id from t where name = 'doc');
reset role;
select is((select visible_client from public.documents where id = (select id from t where name = 'doc')), true,
  'Accès refusé : la direction ne change pas la visibilité');

-- Client : lit le document visible, ne peut rien modifier
select set_config('request.jwt.claims', '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.documents where id = (select id from t where name = 'doc')), 1::bigint,
  'Client : lit son document devenu visible');
update public.documents set visible_client = false where id = (select id from t where name = 'doc');
reset role;
select is((select visible_client from public.documents where id = (select id from t where name = 'doc')), true,
  'Accès refusé : un client ne change pas la visibilité');

-- Agent : rend le document interne ; le client ne le voit plus ; l'audit garde la trace
select set_config('request.jwt.claims', '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
update public.documents set visible_client = false where id = (select id from t where name = 'doc');
reset role;
select set_config('request.jwt.claims', '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.documents where id = (select id from t where name = 'doc')), 0::bigint,
  'Client : un document redevenu interne ne lui est plus visible');
reset role;
select is(
  (select count(*) from public.audit_log where object_type = 'documents' and action = 'update'
     and object_id = (select id::text from t where name = 'doc')),
  2::bigint, 'Audit : chaque changement de visibilité est journalisé'
);

select * from finish();
rollback;
