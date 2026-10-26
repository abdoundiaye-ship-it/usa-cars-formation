-- Phase 6, lot 6a : rapports (US-6.1) — droits par rôle EN BASE (docs/12), marge réservée à l'administrateur et à la
-- direction (Q2, CLAUDE.md règle 2), calculs, date d'enlèvement, journal des exports.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Direction (double authentification validée) : tous les rapports.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select revenue_cents || '|' || costs_cents || '|' || cost_lines || '|' || costs_final || '|' || margin_cents || '|' || margin_percent
     from public.report_margins(current_date - 365, current_date) where reference = 'DEMO-2026-0007'),
  '1300000|1055000|3|false|245000|18.8',
  'Marge : forfaits A + B (13 000 $US) − coûts saisis (10 550 $US) = 2 450 $US, 18,8 % ; coûts pas tous définitifs');
select is(
  (select margin_cents from public.report_margins(current_date - 365, current_date) where reference = 'DEMO-2026-0005'),
  null::bigint, 'Sans coût interne saisi : marge non calculable (jamais 100 %)');
select is(
  (select count(*) from public.report_margins(current_date - 1, current_date)), 0::bigint,
  'Marge : seuls les devis acceptés dans la période');
select is(
  (select total_cents || '|' || not_due_cents from public.report_receivables() where client_name = 'Mamadou Diallo (démo)'),
  '300000|300000', 'Créances : reste dû du client, non échu sans facture de solde');
select is(
  (select days_at_sea || '|' || days_won_to_arrival from public.report_transit_times(current_date - 365, current_date)
    where reference = 'DEMO-2026-0007'),
  '30|55', 'Délais : 30 jours en mer, 55 jours du lot remporté à l’arrivée');
select ok(
  exists (select 1 from public.report_delays() where reference = 'DEMO-2026-0003' and kind = 'payment1_overdue'),
  'Retards : paiement 1 en retard avant le devis (comme le tableau de bord)');
select ok(
  exists (select 1 from public.report_delays() where reference = 'DEMO-2026-0007' and kind = 'unclaimed'),
  'Retards : véhicule non réclamé');
select is((select count(*) from public.report_active_dossiers() where stage = 'closing'), 0::bigint,
  'Dossiers actifs : aucun dossier clôturé');
reset role;

-- Créances par ancienneté : facture de solde échue depuis 45 jours (simulation).
insert into public.financial_documents (
  dossier_id, client_id, doc_type, number, status, quote_id, forfait_b_cents, total_cents, amount_due_cents,
  fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate, edition_fx_captured_at, issued_at, due_at, reference_eta,
  issued_by
)
select 'e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'balance_invoice', 'TEST-FS-0007',
       'issued', 'b0000000-0000-4000-8000-000000000007', 300000, 300000, 300000, r.id, r.rate, r.source, r.captured_at,
       r.rate, r.captured_at, now() - interval '60 days', now() - interval '45 days', current_date - 66,
       'd0000000-0000-4000-8000-000000000003'
from public.fx_rates r where r.rate = 586.52;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select not_due_cents || '|' || overdue_1_30_cents || '|' || overdue_31_60_cents || '|' || overdue_over_60_cents
     from public.report_receivables() where client_name = 'Mamadou Diallo (démo)'),
  '0|0|300000|0', 'Créances : solde échu depuis 45 jours classé « 31 à 60 jours » (comptabilité)');
select ok(exists (select 1 from public.report_delays()), 'Comptabilité : lit les retards');
select throws_ok($$ select * from public.report_margins(current_date - 365, current_date) $$, '42501', null,
  'Accès refusé : la comptabilité ne voit pas la marge (Q2)');
select throws_ok($$ select * from public.report_active_dossiers() $$, '42501', null,
  'Accès refusé : rapports opérationnels hors comptabilité (docs/12)');
reset role;

-- Agent opérations : rapports opérationnels seulement.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok((select count(*) from public.report_active_dossiers()) > 0, 'Opérations : dossiers actifs');
select ok((select count(*) from public.report_transit_times(current_date - 365, current_date)) > 0, 'Opérations : délais');
select throws_ok($$ select * from public.report_margins(current_date - 365, current_date) $$, '42501', null,
  'Accès refusé : marge interdite à l’agent opérations');
select throws_ok($$ select * from public.report_receivables() $$, '42501', null,
  'Accès refusé : créances interdites à l’agent opérations');
-- Enlèvement : date fixée par la base au passage au statut « Enlevé ».
update public.dossiers set status = 'collected' where id = 'e0000000-0000-4000-8000-000000000007';
reset role;
select ok((select collected_at is not null from public.dossiers where id = 'e0000000-0000-4000-8000-000000000007'),
  'Date d’enlèvement renseignée au passage au statut « Enlevé »');
update public.dossiers set collected_at = '2020-01-01' where id = 'e0000000-0000-4000-8000-000000000007';
select ok((select collected_at > '2026-01-01' from public.dossiers where id = 'e0000000-0000-4000-8000-000000000007'),
  'La date d’enlèvement ne se modifie pas directement');

-- Direction sans double authentification validée : aucun rapport financier.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_margins(current_date - 365, current_date) $$, '42501', null,
  'Accès refusé : direction sans double authentification (A4-bis)');
reset role;

-- Client : aucun rapport, aucun export.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select * from public.report_delays() $$, '42501', null, 'Accès refusé : client (retards)');
select throws_ok($$ select * from public.report_margins(current_date - 365, current_date) $$, '42501', null,
  'Accès refusé : client (marge)');
select throws_ok($$ select public.log_report_export('delays', '{}') $$, '42501', null, 'Accès refusé : client (export)');
reset role;

-- Journal des exports.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.log_report_export('margins', '{"du": "2026-01-01", "au": "2026-10-21"}');
select throws_ok($$ select public.log_report_export('salaires', '{}') $$, '22023', null, 'Rapport inconnu refusé');
reset role;
select is(
  (select actor_id || '|' || action || '|' || object_id || '|' || (after ->> 'du') from public.audit_log
    where object_type = 'report' order by id desc limit 1),
  'd0000000-0000-4000-8000-000000000004|export_report|margins|2026-01-01', 'Export journalisé : auteur, rapport, période');

select * from finish();
rollback;
