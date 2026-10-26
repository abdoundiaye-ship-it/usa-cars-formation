-- Sauvegardes (G3-a) : nombre exact de lignes par table, en JSON (« schéma.table » → nombre). Lecture seule.
-- Tables métier (public) et comptes (auth : utilisateurs, identités, facteurs de double authentification) ; les
-- autres tables d'auth sont gérées par Supabase et diffèrent d'un projet à l'autre.
select coalesce(json_object_agg(t.name, t.n order by t.name), '{}'::json)
from (
  select format('%s.%s', table_schema, table_name) as name,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', table_schema, table_name),
      false, true, '')))[1]::text::bigint as n
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities', 'mfa_factors')))
) t;
