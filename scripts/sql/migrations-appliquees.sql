-- Sauvegardes (G3-a) : versions des migrations appliquées (à marquer « applied » sur un projet restauré). Lecture seule.
select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations;
