-- Garde-fou permanent : la RLS doit être activée sur TOUTES les tables du schéma public
-- (CLAUDE.md §3 — « RLS sur toutes les tables exposées »).
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'La RLS est activée sur toutes les tables du schéma public'
);

select * from finish();
rollback;
