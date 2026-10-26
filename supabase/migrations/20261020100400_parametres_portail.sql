-- Phase 4, lot 4a — connexion des clients au portail (lien à usage unique, R16).
-- GÉNÉRÉ par `pnpm settings:generate` depuis specs/parametres_contractuels.json (lot « phase4a ») :
-- ne pas modifier à la main. Valeurs modifiables ensuite dans l’écran Paramètres.

insert into public.settings (key, value, value_type, status, source, effective_from) values
  ('client_auth.link_ttl_minutes', '15'::jsonb, 'integer', 'confirme', 'R16 et US-4.1 : lien ou code à usage unique, expiration 15 minutes', '2026-10-20T00:00:00Z'::timestamptz),
  ('client_auth.max_links_per_hour', '5'::jsonb, 'integer', 'a_confirmer', 'Hypothèse phase 4 : limite anti-abus des demandes de lien de connexion par compte client', '2026-10-20T00:00:00Z'::timestamptz)
on conflict (key, effective_from) do nothing;
