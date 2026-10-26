-- Décisions C5, C7 et C9 du 19/10/2026 : les valeurs par défaut des paramètres concernés deviennent confirmées.
-- Nouvelles versions datées (les versions initiales restent dans l'historique ; règle X7, CLAUDE.md règle 4).
insert into public.settings (key, value, value_type, status, source, reason, effective_from) values
  ('late_fee.cap_usd', 'null'::jsonb, 'money', 'confirme', 'Décision C5 du 19/10/2026',
   'Frais de retard sans plafond.', '2026-10-20T00:00:00Z'),
  ('late_fee.auto_apply', 'false'::jsonb, 'boolean', 'confirme', 'Décision C5 du 19/10/2026',
   'Frais de retard ajoutés après validation de la comptabilité, jamais automatiquement.', '2026-10-20T00:00:00Z'),
  ('numbering.cash_receipt', '"RC-{YYYY}-{####}"'::jsonb, 'string', 'confirme', 'Décision C7 du 19/10/2026',
   'Numérotation des reçus espèces.', '2026-10-20T00:00:00Z'),
  ('numbering.refund_note', '"RB-{YYYY}-{####}"'::jsonb, 'string', 'confirme', 'Décision C7 du 19/10/2026',
   'Numérotation des notes de remboursement.', '2026-10-20T00:00:00Z'),
  ('refund.business_days', '5'::jsonb, 'integer', 'confirme', 'Décision C9 du 19/10/2026',
   'Remboursement sous 5 jours ouvrés, par le même moyen que le paiement d’origine, validé par un administrateur.',
   '2026-10-20T00:00:00Z'),
  ('deposit.refund_business_days', '5'::jsonb, 'integer', 'confirme', 'Décision C9 du 19/10/2026',
   'Restitution du dépôt sous 5 jours ouvrés (même règle que les remboursements).', '2026-10-20T00:00:00Z')
on conflict (key, effective_from) do nothing;
