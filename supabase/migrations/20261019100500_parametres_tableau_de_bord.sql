-- Phase 2, lot 2d — seuils de la liste « À traiter » du tableau de bord.
-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase2d ») :
-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.

insert into public.settings (key, value, value_type, status, source, effective_from) values
  ('dashboard.stale_dossier_days', '7'::jsonb, 'integer', 'confirme', 'Cahier des écrans — tableau de bord : « dossier sans mise à jour > 7 j » (docs/14)', '2026-10-19T00:00:00Z'::timestamptz),
  ('dashboard.recent_eta_change_days', '3'::jsonb, 'integer', 'a_confirmer', 'Hypothèse de Claude Code (lot 2d) : une ETA modifiée reste signalée pendant ce nombre de jours', '2026-10-19T00:00:00Z'::timestamptz)
on conflict (key, effective_from) do nothing;
