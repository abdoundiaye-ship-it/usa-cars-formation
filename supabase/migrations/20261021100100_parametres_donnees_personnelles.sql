-- Phase 6, lot 6b — données personnelles : conservation des pièces comptables (G2-a), page Confidentialité (G1-a).
-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase6 ») :
-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.

insert into public.settings (key, value, value_type, status, source, effective_from) values
  ('data.retention_years_accounting', '10'::jsonb, 'integer', 'a_confirmer', 'Décision G2-a du 21/10/2026 (valeur par défaut) : pièces comptables, contrat art. 33', '2026-10-21T00:00:00Z'::timestamptz),
  ('data.privacy_notice_validated', 'false'::jsonb, 'boolean', 'confirme', 'Décision G1-a du 21/10/2026 : page « Confidentialité » marquée PROJET tant que faux', '2026-10-21T00:00:00Z'::timestamptz)
on conflict (key, effective_from) do nothing;
