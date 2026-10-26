-- Phase 3, lot 3c — paiements et reçu RC (US-3.6, R6), facture de solde (US-3.7, R4), frais de retard
-- (US-3.8, R5, C5), frais supplémentaires (US-3.9, R7), remboursements et note RB (US-3.12, C6, C9).
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

insert into auth.users (id, email) values
  ('a8111111-1111-1111-1111-111111111111', 'pgtap8.admin@exemple.test'),
  ('a8222222-2222-2222-2222-222222222222', 'pgtap8.ops@exemple.test'),
  ('a8333333-3333-3333-3333-333333333333', 'pgtap8.compta@exemple.test'),
  ('a8555555-5555-5555-5555-555555555555', 'pgtap8.client@exemple.test'),
  ('a8666666-6666-6666-6666-666666666666', 'pgtap8.client2@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('a8111111-1111-1111-1111-111111111111', 'pgtap8.admin@exemple.test', 'Admin Test', 'admin'),
  ('a8222222-2222-2222-2222-222222222222', 'pgtap8.ops@exemple.test', 'Agent Test', 'ops'),
  ('a8333333-3333-3333-3333-333333333333', 'pgtap8.compta@exemple.test', 'Compta Test', 'accounting'),
  ('a8555555-5555-5555-5555-555555555555', 'pgtap8.client@exemple.test', 'Client Test', 'client'),
  ('a8666666-6666-6666-6666-666666666666', 'pgtap8.client2@exemple.test', 'Client 2 Test', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('client2', gen_random_uuid()), ('account', gen_random_uuid()),
  ('d1', gen_random_uuid()), ('d2', gen_random_uuid()), ('d3', gen_random_uuid()), ('d4', gen_random_uuid()),
  ('container', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone) values
  ((select id from t where name = 'client'), 'person', 'Client 3c (test)', '+221770000801'),
  ((select id from t where name = 'client2'), 'person', 'Client 3c bis (test)', '+221770000802');
update public.profiles set client_id = (select id from t where name = 'client') where id = 'a8555555-5555-5555-5555-555555555555';
update public.profiles set client_id = (select id from t where name = 'client2') where id = 'a8666666-6666-6666-6666-666666666666';

-- d1 : parcours complet ; d2 : paiement 1 en retard (frais) ; d3 : excédent de dépôt ; d4 : lot non remporté.
insert into public.dossiers (id, reference, client_id, stage, status, auction_result, hammer_price_cents,
                             lot_won_notified_at, payment1_due_at)
select t.id, 'TEST-3C-' || t.name, (select id from t where name = 'client'), 'purchase', 'won', 'won', 800000,
       now() - interval '16 days', case when t.name = 'd2' then now() - interval '15 days' else now() + interval '20 hours' end
from t where t.name in ('d1', 'd2', 'd3');
insert into public.dossiers (id, reference, client_id, stage, status)
  values ((select id from t where name = 'd4'), 'TEST-3C-d4', (select id from t where name = 'client'), 'purchase', 'bidding');
insert into public.purchase_orders (dossier_id, max_bid_cents, deposit_cents)
  select t.id, 1000000, 250000 from t where t.name in ('d1', 'd2', 'd3', 'd4');
insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents, insurance_cents)
  select t.id, 1000000, 350000, 25000 from t where t.name in ('d1', 'd2', 'd3');
insert into public.fx_rates (rate, source, captured_at) values (600.0000, 'XE.com — test 3c', now() - interval '1 second');
insert into public.official_accounts (id, kind, label, holder_name, bank_name, account_number, status, created_by,
                                      approved_by, approved_at)
values ((select id from t where name = 'account'), 'bank', 'Banque test 3c', 'USA CARS (test)', 'Banque test',
        'TEST-3C-0001', 'active', 'a8111111-1111-1111-1111-111111111111', 'a8333333-3333-3333-3333-333333333333', now());
-- Pièces : preuves d'acceptation, justificatifs de paiement et de frais
insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
select t.id, (select id from t where name = 'client'), k.kind, 'dossiers/test-3c/' || t.name || '/' || k.kind || '.pdf',
       k.kind || '.pdf', 'application/pdf', 10, repeat(k.c, 64)
from t cross join (values ('acceptance_proof', 'a'), ('payment_proof', 'b'), ('other', 'c')) as k(kind, c)
where t.name in ('d1', 'd2', 'd3');
create function pg_temp.doc(p_dossier text, p_kind text) returns uuid language sql as $$
  select id from public.documents where storage_path = 'dossiers/test-3c/' || p_dossier || '/' || p_kind || '.pdf';
$$;
grant execute on function pg_temp.doc(text, text) to authenticated;

-- Devis émis, fichier rattaché et accepté (assurance acceptée) pour d1, d2, d3 (lot 3b)
select set_config('request.jwt.claims', '{"sub":"a8222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
insert into t select 'q_' || t.name, public.issue_quote(t.id) from t where t.name in ('d1', 'd2', 'd3');
select public.register_financial_document_file(q.id, 'dossiers/' || d.id || '/quote/devis.docx', 'Devis.docx', 1000,
         repeat('d', 64), 'test')
from t q join t d on q.name = 'q_' || d.name;
insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                decided_at, proof_document_id, insurance_choice)
select d.id, 'quote', q.id, pg_temp.doc(d.name, 'acceptance_proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
       pg_temp.doc(d.name, 'acceptance_proof'), 'accepted'
from t q join t d on q.name = 'q_' || d.name;
reset role;

-- US-3.6 : paiements
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_payment((select id from t where name = 'd1'), 'USD', 400000, null, 'bank_transfer',
       (select id from t where name = 'account'), 'VIR-3C-1', now(), pg_temp.doc('d1', 'payment_proof')) $$,
  '22023', null, 'Paiement 1 impossible avant la facture d’acompte (un versement est alors un dépôt)');
-- d3 : dépôt de 12 000 $US supérieur au forfait A (10 000 $US), avant la facture d'acompte
select public.record_deposit((select id from t where name = 'd3'), 'USD', 1200000, null, 'bank_transfer',
         (select id from t where name = 'account'), 'VIR-3C-DEP', now());
insert into t select 'fa_' || t.name, public.issue_deposit_invoice(t.id) from t where t.name in ('d1', 'd2', 'd3');
select throws_ok(
  $$ select public.record_payment((select id from t where name = 'd1'), 'USD', 400000, null, 'bank_transfer',
       (select id from t where name = 'account'), 'VIR-3C-1', now()) $$,
  '22023', null, 'R6 : justificatif obligatoire (sauf espèces)');
insert into t values ('p1', public.record_payment((select id from t where name = 'd1'), 'USD', 400000, null,
  'bank_transfer', (select id from t where name = 'account'), 'VIR-3C-1', now(), pg_temp.doc('d1', 'payment_proof')));
select is((select purpose from public.payments where id = (select id from t where name = 'p1')), 'payment1',
  'R6 : imputation d’abord sur le paiement 1');
select is((select payment1_remaining_cents from public.dossier_balance((select id from t where name = 'd1'))),
  600000::bigint, 'Paiement partiel : reste 6 000 $US sur le paiement 1');
-- Espèces en FCFA : 3 600 000 FCFA au taux 600 = 6 000 $US ; reçu RC généré
insert into t values ('p2', public.record_payment((select id from t where name = 'd1'), 'XOF', null, 3600000, 'cash',
  null, 'ESP-3C-1', now()));
select matches(
  (select f.number from public.financial_documents f join public.payments p on p.receipt_id = f.id
     where p.id = (select id from t where name = 'p2')),
  '^RC-[0-9]{4}-[0-9]{4,}$', 'C7 : reçu espèces RC-AAAA-#### numéroté');
select is((select status from public.financial_documents where id = (select id from t where name = 'fa_d1')), 'paid',
  'Paiement 1 soldé : facture d’acompte « payée »');
select is(
  (select total_due_cents || '|' || balance_remaining_cents from public.dossier_balance((select id from t where name = 'd1'))),
  '1375000|375000', 'Solde : A + B + assurance acceptée (13 750 $US), reste 3 750 $US');
reset role;
select set_config('request.jwt.claims', '{"sub":"a8222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_payment((select id from t where name = 'd1'), 'USD', 100, null, 'cash', null, 'X', now()) $$,
  '42501', null, 'Accès refusé : un agent n’enregistre pas de paiement');
reset role;

-- US-3.9 / R7 : frais supplémentaires (seuils 250 $US et 10 % du forfait B = 3 500 $US)
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.add_extra_cost((select id from t where name = 'd1'), 'B', 'Stockage', 10000, null) $$,
  '22023', null, 'R7 : justificatif obligatoire');
insert into t values ('x_small', public.add_extra_cost((select id from t where name = 'd1'), 'B', 'Manutention', 10000,
  pg_temp.doc('d1', 'other')));
insert into t values ('x_large', public.add_extra_cost((select id from t where name = 'd1'), 'B', 'Réparation', 50000,
  pg_temp.doc('d1', 'other')));
insert into t values ('x_urgent', public.add_extra_cost((select id from t where name = 'd1'), 'B', 'Stockage portuaire',
  50000, pg_temp.doc('d1', 'other'), true, 'Stockage imposé par le port'));
select is(
  (select string_agg(status, ',' order by amount_cents, urgent) from public.adjustments
     where id in (select id from t where name like 'x_%')),
  'approved,pending_client_approval,approved',
  'Sous le seuil : ajouté ; au-delà : accord du client ; urgence motivée : ajouté directement');
select throws_ok(
  $$ select public.add_extra_cost((select id from t where name = 'd1'), 'B', 'Urgence', 50000, pg_temp.doc('d1', 'other'),
       true, null) $$,
  '22023', null, 'Urgence : motif obligatoire');
insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                decided_at, proof_document_id)
values ((select id from t where name = 'd1'), 'extra_cost', (select id from t where name = 'x_large'),
        pg_temp.doc('d1', 'acceptance_proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
        pg_temp.doc('d1', 'acceptance_proof'));
select is((select status from public.adjustments where id = (select id from t where name = 'x_large')), 'approved',
  'Accord écrit du client enregistré : frais ajoutés');
select is((select document_sha256 from public.acceptances where subject_id = (select id from t where name = 'x_large')),
  repeat('c', 64), 'R15 : l’accord porte sur le justificatif présenté (empreinte)');
select throws_ok(
  $$ update public.adjustments set amount_cents = 1 where id = (select id from t where name = 'x_small') $$,
  '42501', null, 'Aucune écriture directe dans les lignes D');

-- US-3.7 : facture de solde (après embarquement, B/L et ETA)
select throws_ok($$ select public.issue_balance_invoice((select id from t where name = 'd1')) $$,
  '22023', null, 'Facture de solde impossible avant l’embarquement (conteneur, B/L, ETA)');
reset role;
insert into public.containers (id, number, carrier_id, bl_number, eta)
  values ((select id from t where name = 'container'), 'TSTU1234568',
          (select id from public.carriers order by created_at limit 1), 'BL-3C-0001', current_date + 20);
insert into public.dossier_containers (dossier_id, container_id)
  values ((select id from t where name = 'd1'), (select id from t where name = 'container'));
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('fs', public.issue_balance_invoice((select id from t where name = 'd1')));
select matches((select number from public.financial_documents where id = (select id from t where name = 'fs')),
  '^FS-[0-9]{4}-[0-9]{4,}$', 'Numéro FS-AAAA-####');
select is(
  (select forfait_b_cents || '|' || insurance_premium_cents || '|' || adjustments_cents || '|' || total_cents || '|'
          || deposit_applied_cents || '|' || amount_due_cents
     from public.financial_documents where id = (select id from t where name = 'fs')),
  '350000|25000|110000|485000|0|485000', 'FS = B + C acceptée + D approuvées (4 850 $US)');
select is(
  (select reference_eta = current_date + 20 and due_at = ((current_date + 20)::timestamp at time zone 'UTC') - interval '48 hours'
     from public.financial_documents where id = (select id from t where name = 'fs')),
  true, 'R4 : ETA de référence figée ; échéance 48 h avant l’ETA');
select is((select count(*) from public.adjustments
             where financial_document_id = (select id from t where name = 'fs')), 3::bigint,
  'Les lignes D approuvées sont reprises sur la facture de solde');
select throws_ok($$ select public.issue_balance_invoice((select id from t where name = 'd1')) $$,
  '22023', null, 'Une seule facture de solde active par dossier');
reset role;
-- R4 : ETA avancée → échéance avancée (préavis minimal) ; ETA retardée → inchangée
update public.containers set eta = current_date + 3 where id = (select id from t where name = 'container');
select ok(
  (select due_at between now() + interval '47 hours' and now() + interval '49 hours'
     from public.financial_documents where id = (select id from t where name = 'fs')),
  'ETA avancée : échéance = maintenant + 48 h de préavis (ETA − 48 h serait trop proche)');
create temporary table due_snapshot as select due_at from public.financial_documents where id = (select id from t where name = 'fs');
update public.containers set eta = current_date + 30 where id = (select id from t where name = 'container');
select is((select due_at from public.financial_documents where id = (select id from t where name = 'fs')),
  (select due_at from due_snapshot), 'ETA retardée : échéance inchangée');

-- US-3.12 : trop-perçu restitué (C6) — 6 000 $US versés pour 4 850 $US dus
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.record_payment((select id from t where name = 'd1'), 'USD', 600000, null, 'bank_transfer',
  (select id from t where name = 'account'), 'VIR-3C-2', now(), pg_temp.doc('d1', 'payment_proof'));
select is((select status from public.financial_documents where id = (select id from t where name = 'fs')), 'paid',
  'Solde réglé : facture de solde « payée »');
insert into t values ('refund', (select id from public.refunds where dossier_id = (select id from t where name = 'd1')));
select is(
  (select reason || '|' || amount_cents || '|' || mode || '|' || status from public.refunds
     where id = (select id from t where name = 'refund')),
  'overpayment|115000|bank_transfer|requested', 'Trop-perçu de 1 150 $US : demande de remboursement automatique');
select ok(
  (select due_by = public.add_business_days(requested_at, 5) from public.refunds where id = (select id from t where name = 'refund')),
  'C9 : échéance à 5 jours ouvrés');
select throws_ok($$ select public.decide_refund((select id from t where name = 'refund'), true) $$,
  '42501', null, 'C9 : seule l’administration valide un remboursement');
select throws_ok(
  $$ select public.execute_refund((select id from t where name = 'refund'), now(), 'VIR-RB-1', pg_temp.doc('d1', 'payment_proof')) $$,
  '22023', null, 'Exécution impossible avant la validation');
reset role;
select set_config('request.jwt.claims', '{"sub":"a8111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$ select public.decide_refund((select id from t where name = 'refund'), true) $$,
  'L’administrateur valide le remboursement');
reset role;
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('rb', public.execute_refund((select id from t where name = 'refund'), now(), 'VIR-RB-1',
  pg_temp.doc('d1', 'payment_proof')));
select matches((select number from public.financial_documents where id = (select id from t where name = 'rb')),
  '^RB-[0-9]{4}-[0-9]{4,}$', 'C7 : note de remboursement RB-AAAA-####');
select is((select balance_remaining_cents from public.dossier_balance((select id from t where name = 'd1'))), 0::bigint,
  'Après remboursement : solde nul, aucun avoir conservé (règle 12)');

-- d3 : excédent de dépôt (I2) → demande de remboursement à la facture d'acompte
select is(
  (select reason || '|' || amount_cents from public.refunds where dossier_id = (select id from t where name = 'd3')),
  'deposit_excess|200000', 'I2 : dépôt supérieur au forfait A, excédent de 2 000 $US à restituer');

-- US-3.8 / R5 : d2, paiement 1 échu depuis 15 jours → 2 périodes de 14 jours
select is(public.propose_late_fees(), 2, 'Deux périodes de retard proposées (15 jours, période de 14 jours)');
select is(
  (select string_agg(status || ':' || amount_cents, ',' order by late_fee_period) from public.adjustments
     where dossier_id = (select id from t where name = 'd2') and kind = 'late_fee'),
  'proposed:10000,proposed:10000', 'C5 : frais proposés (100 $US par période), jamais ajoutés d’office');
select public.decide_late_fee(
  (select id from public.adjustments where dossier_id = (select id from t where name = 'd2') and late_fee_period = 1), true);
select throws_ok(
  $$ select public.decide_late_fee((select id from public.adjustments
       where dossier_id = (select id from t where name = 'd2') and late_fee_period = 2), false) $$,
  '22023', null, 'Écarter un frais de retard exige un motif');
select public.decide_late_fee(
  (select id from public.adjustments where dossier_id = (select id from t where name = 'd2') and late_fee_period = 2),
  false, 'Geste commercial');
select is(public.propose_late_fees(), 0, 'Un frais écarté n’est jamais reproposé');
select is((select adjustments_cents from public.dossier_balance((select id from t where name = 'd2'))), 10000::bigint,
  'Seul le frais validé entre dans le solde');
reset role;

-- d4 : lot non remporté (I2) → dépôt intégralement restitué
select set_config('request.jwt.claims', '{"sub":"a8333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.record_deposit((select id from t where name = 'd4'), 'USD', 250000, null, 'bank_transfer',
  (select id from t where name = 'account'), 'VIR-3C-D4', now());
reset role;
select set_config('app.auction_result', 'on', true);
update public.dossiers set auction_result = 'lost' where id = (select id from t where name = 'd4');
select set_config('app.auction_result', 'off', true);
select is(
  (select reason || '|' || amount_cents from public.refunds where dossier_id = (select id from t where name = 'd4')),
  'lot_not_won|250000', 'Lot non remporté : remboursement du dépôt demandé');

-- Isolation client et RLS
select set_config('request.jwt.claims', '{"sub":"a8555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.adjustments where status in ('proposed', 'rejected')), 0::bigint,
  'Client : ne voit que les lignes D décidées ou soumises à son accord (pas le frais de retard écarté)');
select is((select count(*) from public.refunds), 3::bigint, 'Client : voit ses remboursements');
select is((select count(*) from public.financial_documents where doc_type in ('cash_receipt', 'refund_note')), 2::bigint,
  'Client : voit son reçu et sa note de remboursement');
select is((select balance_remaining_cents from public.dossier_balance((select id from t where name = 'd1'))), 0::bigint,
  'Client : consulte la situation de son dossier');
reset role;
select set_config('request.jwt.claims', '{"sub":"a8666666-6666-6666-6666-666666666666","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.refunds) + (select count(*) from public.adjustments)
          + (select count(*) from public.payments where dossier_id = (select id from t where name = 'd1')), 0::bigint,
  'Accès refusé : aucun remboursement, ajustement ou paiement d’un autre client');
select throws_ok($$ select * from public.dossier_balance((select id from t where name = 'd1')) $$,
  '42501', null, 'Accès refusé : situation financière d’un autre client');
reset role;

select ok(
  (select bool_and(data_type = 'bigint') from information_schema.columns
     where table_schema = 'public' and table_name in ('adjustments', 'refunds') and column_name like '%cents'),
  'Montants en centimes entiers (bigint)');
select ok((select count(*) from public.audit_log where object_type = 'refunds'
             and object_id = (select id::text from t where name = 'refund')) >= 3,
  'Audit : demande, validation et exécution du remboursement journalisées');
select ok(exists (select 1 from cron.job where jobname = 'usa-cars-propose-late-fees'), 'Frais de retard calculés chaque jour (pg_cron)');

select * from finish();
rollback;
