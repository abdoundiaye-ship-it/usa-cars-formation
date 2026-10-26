-- Décision A4-bis (19/10/2026) : la direction peut approuver un compte de paiement officiel (Q1) ; elle est donc
-- soumise, comme l'administrateur et la comptabilité, à la double authentification.
-- Nouvelle version datée du paramètre (la version initiale reste dans l'historique ; règle X7, CLAUDE.md règle 4).
insert into public.settings (key, value, value_type, status, source, reason, effective_from) values (
  'auth.mfa_required_roles',
  '["admin", "accounting", "management"]'::jsonb,
  'string[]',
  'confirme',
  'Décision A4-bis du 19/10/2026',
  'La direction approuve les comptes de paiement officiels (Q1) : double authentification exigée.',
  '2026-10-19T12:00:00Z'
)
on conflict (key, effective_from) do nothing;
