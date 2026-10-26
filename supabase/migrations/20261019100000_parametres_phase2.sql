-- Phase 2 — paramètres ajoutés (identité légale de USA CARS pour le contrat).
-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase2 ») :
-- ne pas modifier à la main. Valeurs saisies ensuite par l’administrateur dans l’écran Paramètres.

insert into public.settings (key, value, value_type, status, source, effective_from) values
  ('company.legal_form', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.rccm', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.ninea', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.office_address', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.phone', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.email', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.representative_name', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz),
  ('company.representative_title', '"À compléter"'::jsonb, 'string', 'a_confirmer', 'Contrat, en-tête « USA CARS » — à saisir par l’administrateur (phase 2)', '2026-10-19T00:00:00Z'::timestamptz)
on conflict (key, effective_from) do nothing;
