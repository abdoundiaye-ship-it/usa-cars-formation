-- Seed de DÉMONSTRATION — Supabase LOCAL uniquement (pnpm db:reset).
-- Interdit sur le projet de production (CLAUDE.md §2).
--
-- Toute donnée est fictive et identifiable (CLAUDE.md règle 8) :
--   références de dossiers  DEMO-…
--   conteneurs              DEMU…  (ex. DEMU1234565)
--   e-mails                 …@exemple.test
--
-- Comptes de démonstration (mot de passe local commun : DemoUsaCars2026) :
--   admin@exemple.test       Administrateur (MFA à configurer à la première connexion)
--   ops@exemple.test         Agent opérations
--   compta@exemple.test      Comptabilité (MFA à configurer à la première connexion)
--   direction@exemple.test   Direction (MFA déjà configurée : secret de démonstration ci-dessous, décision A4-bis)
--   client@exemple.test      Client (portail en phase 4)

select set_config('app.actor_label', 'seed:demo', false);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('DemoUsaCars2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name), now(), now(),
  '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'admin@exemple.test', 'Awa Admin (démo)'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'ops@exemple.test', 'Ousmane Opérations (démo)'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'compta@exemple.test', 'Coumba Comptabilité (démo)'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'direction@exemple.test', 'Daouda Direction (démo)'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, 'client@exemple.test', 'Client Démo')
) as u (id, email, full_name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@exemple.test';

insert into public.profiles (id, email, full_name, role) values
  ('d0000000-0000-4000-8000-000000000001', 'admin@exemple.test', 'Awa Admin (démo)', 'admin'),
  ('d0000000-0000-4000-8000-000000000002', 'ops@exemple.test', 'Ousmane Opérations (démo)', 'ops'),
  ('d0000000-0000-4000-8000-000000000003', 'compta@exemple.test', 'Coumba Comptabilité (démo)', 'accounting'),
  ('d0000000-0000-4000-8000-000000000004', 'direction@exemple.test', 'Daouda Direction (démo)', 'management'),
  ('d0000000-0000-4000-8000-000000000005', 'client@exemple.test', 'Client Démo', 'client');

-- ---------------------------------------------------------------------------
-- Phase 2 — clients et dossiers fictifs (DEMO-, @exemple.test, numéros +22177000000x)
-- ---------------------------------------------------------------------------
insert into public.clients (id, kind, name, id_document_type, id_document_number, address, notify_phone, notify_email, created_by) values
  ('c0000000-0000-4000-8000-000000000001', 'person', 'Mamadou Diallo (démo)', 'national_id', 'DEMO-CNI-0001',
   'Dakar, adresse fictive', '+221770000001', 'client@exemple.test', 'd0000000-0000-4000-8000-000000000002');
insert into public.clients (id, kind, name, ninea, rccm, representative_name, representative_title, address, notify_phone, notify_email, created_by) values
  ('c0000000-0000-4000-8000-000000000002', 'company', 'Société Démo Auto SARL (démo)', 'DEMO-NINEA-0002', 'DEMO-RCCM-0002',
   'Fatou Ndiaye (démo)', 'Gérante', 'Thiès, adresse fictive', '+221770000002', 'societe@exemple.test',
   'd0000000-0000-4000-8000-000000000002');

-- Le compte client@exemple.test accède au portail du premier client (phase 4).
update public.profiles set client_id = 'c0000000-0000-4000-8000-000000000001'
where id = 'd0000000-0000-4000-8000-000000000005';

insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, status, platform, lot_number, vin, make, model, model_year, mileage,
  vehicle_category, title_status, purchase_location, departure_port
) values
  ('e0000000-0000-4000-8000-000000000001', 'DEMO-2026-0001', 'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'new', 'copart', 'DEMO-LOT-1001',
   '1DEMXXX0000000001', 'Toyota', 'Corolla', 2019, 48000, 'passenger', 'Clean title (démo)', 'Houston, TX (démo)',
   'Houston'),
  ('e0000000-0000-4000-8000-000000000002', 'DEMO-2026-0002', 'c0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'info_missing', 'iaa', null,
   null, 'Ford', 'Transit', 2020, null, 'light_utility', null, null, null);

-- ---------------------------------------------------------------------------
-- Phase 2, lot 2c — transporteurs et conteneurs fictifs (P4 : les vrais transporteurs sont saisis par
-- l'administrateur en production). Numéros DEMU… conformes à ISO 6346 (chiffre de contrôle valide).
-- ---------------------------------------------------------------------------
insert into public.carriers (id, code, name, tracking_url, url_template, link_type, note, created_by) values
  ('f0000000-0000-4000-8000-000000000001', 'demo-maritime', 'Transporteur Démo (fictif)', 'https://exemple.test/suivi',
   'https://exemple.test/suivi/{container}', 'officiel', 'Transporteur fictif du seed local.',
   'd0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002', 'demo-tiers', 'Suivi tiers Démo (fictif)', 'https://exemple.test/suivi-tiers',
   null, 'tiers', 'Service tiers fictif : référence à saisir sur la page de suivi.',
   'd0000000-0000-4000-8000-000000000001');

insert into public.containers (id, number, carrier_id, bl_number, vessel, voyage, port_of_loading, etd, eta, created_by) values
  ('f1000000-0000-4000-8000-000000000001', 'DEMU1234560', 'f0000000-0000-4000-8000-000000000001', 'DEMO-BL-0001',
   'Navire Démo', 'DEMO-001', 'Houston', '2026-11-02', '2026-11-20', 'd0000000-0000-4000-8000-000000000002'),
  ('f1000000-0000-4000-8000-000000000002', 'DEMU7654322', 'f0000000-0000-4000-8000-000000000002', null,
   null, null, 'Baltimore', null, null, 'd0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Phase 2, lot 2d — de quoi alimenter le tableau de bord (dates relatives au moment du chargement) :
-- un paiement 1 en retard, un dossier sans mise à jour récente, un conteneur en mer jamais vérifié.
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, auction_result, hammer_price_cents, lot_won_notified_at, payment1_due_at, created_at, updated_at
) values (
  'e0000000-0000-4000-8000-000000000003', 'DEMO-2026-0003', 'c0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'purchase', 'payment1_pending',
  'copart', 'DEMO-LOT-1003', '1DEMXXX0000000003', 'Honda', 'CR-V', 2021, 'passenger', 'won', 950000,
  now() - interval '3 days', now() - interval '2 days', now() - interval '12 days', now() - interval '9 days'
);

update public.containers
  set status = 'at_sea', departed_on = current_date - 10, eta = current_date + 12
  where id = 'f1000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Phase 3, lot 3a — taux, comptes officiels FICTIFS (décision C8), forfaits et coûts internes de démonstration.
-- Comptes activés selon la double validation (Q1) : créés par l'administrateur, approuvés par la direction.
-- ---------------------------------------------------------------------------
insert into public.fx_rates (rate, source, captured_at, created_by) values
  (586.52, 'XE.com — taux moyen du marché (valeur de démonstration)', now() - interval '1 day', 'd0000000-0000-4000-8000-000000000003'),
  (587.10, 'XE.com — taux moyen du marché (valeur de démonstration)', now() - interval '5 minutes', 'd0000000-0000-4000-8000-000000000003');

insert into public.official_accounts (id, kind, label, holder_name, bank_name, account_number, iban, phone, instructions,
                                      status, created_by, approved_by, approved_at) values
  ('a0000000-0000-4000-8000-000000000001', 'bank', 'Compte bancaire Démo (fictif)', 'USA CARS (démo)', 'Banque Démo',
   'DEMO-0000-0001', 'SN00 DEMO 0000 0000 0000 0001', null, 'Indiquez la référence du dossier en libellé.', 'active',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', now()),
  ('a0000000-0000-4000-8000-000000000002', 'wave', 'Wave Démo (fictif)', 'USA CARS (démo)', null, null, null,
   '+221770000900', 'Envoyez une capture du transfert au WhatsApp officiel.', 'active',
   'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', now());

insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents, updated_by) values
  ('e0000000-0000-4000-8000-000000000003', 1150000, 320000, 25000, 'd0000000-0000-4000-8000-000000000002');

insert into public.internal_costs (dossier_id, section, category, label, amount_cents, status, created_by) values
  ('e0000000-0000-4000-8000-000000000003', 'A', 'hammer_price', 'Prix d’adjudication', 950000, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003', 'A', 'auction_fees', 'Frais COPART', 95000, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003', 'B', 'inland_transport', 'Transport vers Houston', 45000, 'estimated', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003', 'B', 'ocean_freight', 'Fret maritime (quote-part)', 180000, 'estimated', 'd0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Phase 3, lot 3b — dossier au lot remporté, prêt pour le devis (paiement 1 dû dans 22 h), avec un dépôt reçu.
-- Ordre d'achat sans fichier (brouillon du seed) ; coûts internes aux montants distinctifs, pour vérifier qu'ils
-- n'apparaissent jamais dans le devis ni la facture générés (CLAUDE.md règle 2).
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at
) values (
  'e0000000-0000-4000-8000-000000000004', 'DEMO-2026-0004', 'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'purchase', 'won', 'iaa',
  'DEMO-LOT-1004', '1DEMXXX0000000004', 'Toyota', 'RAV4', 2020, 'passenger', 'Dallas, TX (démo)', 'Houston', 'won',
  943700, now() - interval '2 hours', now() + interval '22 hours'
);

insert into public.purchase_orders (dossier_id, auction_at, max_bid_cents, deposit_cents, created_by) values
  ('e0000000-0000-4000-8000-000000000004', now() - interval '3 hours', 1000000, 250000, 'd0000000-0000-4000-8000-000000000002');

insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents, updated_by) values
  ('e0000000-0000-4000-8000-000000000004', 1180000, 330000, 26000, 'd0000000-0000-4000-8000-000000000002');

insert into public.internal_costs (dossier_id, section, category, label, amount_cents, status, created_by) values
  ('e0000000-0000-4000-8000-000000000004', 'A', 'hammer_price', 'Prix d’adjudication IAA (démo)', 943700, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000004', 'A', 'auction_fees', 'Frais IAA (démo)', 87300, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000004', 'B', 'ocean_freight', 'Fret maritime (démo)', 178100, 'estimated', 'd0000000-0000-4000-8000-000000000002');

insert into public.payments (dossier_id, client_id, purpose, amount_cents, paid_currency, fx_rate_id, fx_rate, fx_captured_at,
                             fx_rate_same_day, mode, official_account_id, reference, credited_at, recorded_by)
select 'e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'deposit', 250000, 'USD',
       r.id, r.rate, r.captured_at, true, 'bank_transfer', 'a0000000-0000-4000-8000-000000000001', 'DEMO-VIR-0001',
       r.captured_at + interval '1 minute', 'd0000000-0000-4000-8000-000000000003'
from public.fx_rates r where r.rate = 586.52;

-- ---------------------------------------------------------------------------
-- Phase 3, lot 3c — dossier en mer, prêt pour la facture de solde : devis DEMO accepté (assurance acceptée),
-- paiement 1 réglé, conteneur avec B/L et ETA. Numéros « DEMO-… » (hors séquences réelles, CLAUDE.md règle 8).
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at, created_at
) values (
  'e0000000-0000-4000-8000-000000000005', 'DEMO-2026-0005', 'c0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'ocean', 'at_sea', 'copart',
  'DEMO-LOT-1005', '1DEMXXX0000000005', 'Hyundai', 'Tucson', 2021, 'passenger', 'Savannah, GA (démo)', 'Houston',
  'won', 900000, now() - interval '20 days', now() - interval '19 days', now() - interval '25 days'
);

insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents, updated_by) values
  ('e0000000-0000-4000-8000-000000000005', 1050000, 300000, 20000, 'd0000000-0000-4000-8000-000000000002');

insert into public.financial_documents (
  id, dossier_id, client_id, doc_type, number, status, forfait_a_cents, forfait_b_cents, insurance_premium_cents,
  insurance_choice, total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate,
  edition_fx_captured_at, issued_at, valid_until, decided_at, issued_by
)
select 'b0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000005',
       'c0000000-0000-4000-8000-000000000002', 'quote', 'DEMO-DV-0005', 'accepted', 1050000, 300000, 20000, 'accepted',
       1350000, 1350000, r.id, r.rate, r.source, r.captured_at, r.rate, r.captured_at, now() - interval '20 days',
       now() - interval '19 days', now() - interval '20 days', 'd0000000-0000-4000-8000-000000000002'
from public.fx_rates r where r.rate = 586.52;

insert into public.financial_documents (
  id, dossier_id, client_id, doc_type, number, status, quote_id, forfait_a_cents, insurance_premium_cents,
  insurance_choice, total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate,
  edition_fx_captured_at, issued_at, due_at, issued_by
)
select 'b0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000005',
       'c0000000-0000-4000-8000-000000000002', 'deposit_invoice', 'DEMO-FA-0005', 'paid',
       'b0000000-0000-4000-8000-000000000005', 1050000, 20000, 'accepted', 1050000, 1050000, r.id, r.rate, r.source,
       r.captured_at, r.rate, r.captured_at, now() - interval '20 days', now() - interval '19 days',
       'd0000000-0000-4000-8000-000000000003'
from public.fx_rates r where r.rate = 586.52;

insert into public.payments (dossier_id, client_id, purpose, amount_cents, paid_currency, fx_rate_id, fx_rate, fx_captured_at,
                             fx_rate_same_day, mode, official_account_id, reference, credited_at, recorded_by)
select 'e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 'payment1', 1050000, 'USD',
       r.id, r.rate, r.captured_at, false, 'bank_transfer', 'a0000000-0000-4000-8000-000000000001', 'DEMO-VIR-0005',
       now() - interval '19 days 2 hours', 'd0000000-0000-4000-8000-000000000003'
from public.fx_rates r where r.rate = 586.52;

insert into public.dossier_containers (dossier_id, container_id, assigned_by) values
  ('e0000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Phase 4, lot 4a — dossier du premier client (accès portail : client@exemple.test), lot remporté, prêt pour
-- un devis à accepter dans le portail.
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at
) values (
  'e0000000-0000-4000-8000-000000000006', 'DEMO-2026-0006', 'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'purchase', 'won', 'copart',
  'DEMO-LOT-1006', '1DEMXXX0000000006', 'Kia', 'Sportage', 2021, 'passenger', 'Atlanta, GA (démo)', 'Savannah',
  'won', 870000, now() - interval '1 hour', now() + interval '23 hours'
);

insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents, updated_by) values
  ('e0000000-0000-4000-8000-000000000006', 1020000, 310000, 22000, 'd0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Phase 5, lot 5b — dossier du premier client arrivé à Dakar il y a 65 jours, solde non réglé et véhicule non
-- enlevé : procédure « véhicule non réclamé » (lettre de relance due, mise en demeure à venir). Fictif (DEMO-, DEMU).
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at, created_at
) values (
  'e0000000-0000-4000-8000-000000000007', 'DEMO-2026-0007', 'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'dakar', 'balance_pending', 'copart',
  'DEMO-LOT-1007', '1DEMXXX0000000007', 'Nissan', 'Qashqai', 2020, 'passenger', 'Houston, TX (démo)', 'Houston',
  'won', 800000, now() - interval '120 days', now() - interval '119 days', now() - interval '125 days'
);

insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents, updated_by) values
  ('e0000000-0000-4000-8000-000000000007', 1000000, 300000, 20000, 'd0000000-0000-4000-8000-000000000002');

insert into public.financial_documents (
  id, dossier_id, client_id, doc_type, number, status, forfait_a_cents, forfait_b_cents, insurance_premium_cents,
  insurance_choice, total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate,
  edition_fx_captured_at, issued_at, valid_until, decided_at, issued_by
)
select 'b0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000007',
       'c0000000-0000-4000-8000-000000000001', 'quote', 'DEMO-DV-0007', 'accepted', 1000000, 300000, 20000, 'refused',
       1300000, 1300000, r.id, r.rate, r.source, r.captured_at, r.rate, r.captured_at, now() - interval '120 days',
       now() - interval '119 days', now() - interval '120 days', 'd0000000-0000-4000-8000-000000000002'
from public.fx_rates r where r.rate = 586.52;

insert into public.payments (dossier_id, client_id, purpose, amount_cents, paid_currency, fx_rate_id, fx_rate, fx_captured_at,
                             fx_rate_same_day, mode, official_account_id, reference, credited_at, recorded_by)
select 'e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'payment1', 1000000, 'USD',
       r.id, r.rate, r.captured_at, false, 'bank_transfer', 'a0000000-0000-4000-8000-000000000001', 'DEMO-VIR-0007',
       now() - interval '119 days 2 hours', 'd0000000-0000-4000-8000-000000000003'
from public.fx_rates r where r.rate = 586.52;

-- Coûts internes fictifs (marge par véhicule, phase 6) : jamais visibles du client (CLAUDE.md règle 2).
insert into public.internal_costs (dossier_id, section, category, label, amount_cents, status, created_by) values
  ('e0000000-0000-4000-8000-000000000007', 'A', 'hammer_price', 'Prix d’adjudication COPART (démo)', 800000, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000007', 'A', 'auction_fees', 'Frais COPART (démo)', 95000, 'final', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000007', 'B', 'ocean_freight', 'Fret maritime (démo)', 160000, 'estimated', 'd0000000-0000-4000-8000-000000000002');

insert into public.containers (id, number, carrier_id, bl_number, vessel, voyage, port_of_loading, etd, eta, created_by) values
  ('f1000000-0000-4000-8000-000000000003', 'DEMU2468135', 'f0000000-0000-4000-8000-000000000001', 'DEMO-BL-0007',
   'Navire Démo', 'DEMO-007', 'Houston', current_date - 95, current_date - 66, 'd0000000-0000-4000-8000-000000000002');
update public.containers
  set status = 'arrived', departed_on = current_date - 95, ata = current_date - 65
  where id = 'f1000000-0000-4000-8000-000000000003';

insert into public.dossier_containers (dossier_id, container_id, assigned_by) values
  ('e0000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Phase 6, lot 6b — dossier du second client, terminé (clôturé aujourd'hui) : rapport « Conservation des données »
-- (durées atteintes dans 5 et 10 ans, G2-a). Fictif (DEMO-).
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at, created_at
) values (
  'e0000000-0000-4000-8000-000000000008', 'DEMO-2026-0008', 'c0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'closing', 'completed', 'iaa',
  'DEMO-LOT-1008', '1DEMXXX0000000008', 'Hyundai', 'Tucson', 2019, 'passenger', 'Newark, NJ (démo)', 'New York',
  'won', 650000, now() - interval '150 days', now() - interval '149 days', now() - interval '155 days'
);

-- ---------------------------------------------------------------------------
-- Phase 6, lot 6d — véhicule du premier client enlevé il y a 1 jour : réclamation possible dans le délai (art. 19).
-- Fictif (DEMO-). La date d'enlèvement est fixée par la base au passage au statut « Enlevé ».
-- ---------------------------------------------------------------------------
insert into public.dossiers (
  id, reference, client_id, owner_id, created_by, stage, status, platform, lot_number, vin, make, model, model_year,
  vehicle_category, purchase_location, departure_port, auction_result, hammer_price_cents, lot_won_notified_at,
  payment1_due_at, created_at
) values (
  'e0000000-0000-4000-8000-000000000009', 'DEMO-2026-0009', 'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'dakar', 'documents_released',
  'copart', 'DEMO-LOT-1009', '1DEMXXX0000000009', 'Ford', 'Escape', 2021, 'passenger', 'Dallas, TX (démo)', 'Houston',
  'won', 910000, now() - interval '70 days', now() - interval '69 days', now() - interval '75 days'
);
update public.dossiers set status = 'collected' where id = 'e0000000-0000-4000-8000-000000000009';

-- Réclamation de démonstration déjà déposée par le client et en cours de traitement (transmise aux tiers), pour
-- montrer les écrans de suivi (portail) et de traitement (interne). Fictive (DEMO-). Écrite directement comme les
-- autres pièces « écriture par fonctions », le seed s'exécutant en tant que superutilisateur. Dans le délai de
-- l'art. 19 (l'enlèvement est daté du jour par le déclencheur `dossiers_set_collected_at`).
insert into public.claims (
  dossier_id, client_id, source, reserves, filed_by, filed_at, collected_at, deadline_at, out_of_time,
  status, response, responded_by, responded_at
)
select
  d.id, d.client_id, 'client',
  'À la réception, le pare-chocs avant présente une rayure profonde et le phare avant droit est fêlé. Ces dommages '
    || 'n''étaient pas signalés au départ des États-Unis.',
  null, d.collected_at, d.collected_at,
  public.add_business_days(d.collected_at,
    coalesce((public.setting_value('claim.business_days_after_pickup') #>> '{}')::int, 3)),
  false, 'forwarded',
  'Nous avons bien reçu vos réserves et les avons transmises au transporteur ainsi qu''à l''assureur. Nous revenons '
    || 'vers vous dès leur retour.',
  'd0000000-0000-4000-8000-000000000002', d.collected_at
from public.dossiers d
where d.id = 'e0000000-0000-4000-8000-000000000009';

-- ---------------------------------------------------------------------------
-- Décisions A4 et A4-bis : la comptabilité et la direction sont soumises à la double authentification. Pour les
-- essais LOCAUX et les tests, leurs comptes de démonstration ont déjà un facteur TOTP vérifié, de secret connu (à
-- saisir dans une application d'authentification) : JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP. L'administrateur, lui,
-- configure sa double authentification à la première connexion (parcours testé).
-- ---------------------------------------------------------------------------
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'Démonstration', 'totp',
        'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
       ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'Démonstration', 'totp',
        'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
