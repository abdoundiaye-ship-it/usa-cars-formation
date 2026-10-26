-- Phase 0 — initialisation.
-- Le schéma métier (profils, rôles, paramètres, audit, RLS) arrive en phase 1, à partir de
-- specs/schema_initial.sql revu. Migrations additives ou réversibles uniquement (CLAUDE.md §2).

create extension if not exists pgcrypto with schema extensions;

-- Par défaut, rien n’est exposé à anon/authenticated sans politique RLS explicite :
-- toute nouvelle table du schéma public doit activer la RLS (vérifié par supabase/tests/database).
