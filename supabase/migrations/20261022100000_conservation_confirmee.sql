-- Décision G2-a confirmée le 22/10/2026 par USA CARS : 10 ans (pièces comptables) et 5 ans (autres données) après la
-- clôture, reportés dans l'article 33 du contrat. Nouvelles versions datées au statut « confirmé » (les versions
-- précédentes restent dans l'historique ; règle X7, CLAUDE.md règle 4).
insert into public.settings (key, value, value_type, status, source, reason, effective_from) values
  ('data.retention_years', '5'::jsonb, 'integer', 'confirme', 'Décision G2-a confirmée le 22/10/2026',
   'Données hors pièces comptables conservées 5 ans après la clôture (contrat art. 33).', '2026-10-22T00:00:00Z'),
  ('data.retention_years_accounting', '10'::jsonb, 'integer', 'confirme', 'Décision G2-a confirmée le 22/10/2026',
   'Pièces comptables conservées 10 ans après la clôture (contrat art. 33).', '2026-10-22T00:00:00Z')
on conflict (key, effective_from) do nothing;
