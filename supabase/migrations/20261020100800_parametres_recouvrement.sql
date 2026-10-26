-- Phase 5, lot 5b — numérotation des courriers de la procédure « véhicule non réclamé » (art. 21–22).
-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase5 ») :
-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.

insert into public.settings (key, value, value_type, status, source, effective_from) values
  ('numbering.reminder_letter', '"LR-{YYYY}-{####}"'::jsonb, 'string', 'a_confirmer', 'Hypothèse phase 5 : numérotation des lettres de relance (contrat art. 22)', '2026-10-20T00:00:00Z'::timestamptz),
  ('numbering.formal_notice', '"MD-{YYYY}-{####}"'::jsonb, 'string', 'a_confirmer', 'Hypothèse phase 5 : numérotation des mises en demeure (contrat art. 21)', '2026-10-20T00:00:00Z'::timestamptz)
on conflict (key, effective_from) do nothing;
