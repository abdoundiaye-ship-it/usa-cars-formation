-- Phase 3, lot 3b — devis DV (US-3.3, R2, R3, X1, X2), dépôt (US-3.4, I2), facture d'acompte FA (R4),
-- isolation client et absence de tout coût interne dans les documents financiers (CLAUDE.md règle 2).
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

insert into auth.users (id, email) values
  ('a7111111-1111-1111-1111-111111111111', 'pgtap7.admin@exemple.test'),
  ('a7222222-2222-2222-2222-222222222222', 'pgtap7.ops@exemple.test'),
  ('a7333333-3333-3333-3333-333333333333', 'pgtap7.compta@exemple.test'),
  ('a7444444-4444-4444-4444-444444444444', 'pgtap7.direction@exemple.test'),
  ('a7555555-5555-5555-5555-555555555555', 'pgtap7.client@exemple.test'),
  ('a7666666-6666-6666-6666-666666666666', 'pgtap7.client2@exemple.test');
insert into public.profiles (id, email, full_name, role) values
  ('a7111111-1111-1111-1111-111111111111', 'pgtap7.admin@exemple.test', 'Admin Test', 'admin'),
  ('a7222222-2222-2222-2222-222222222222', 'pgtap7.ops@exemple.test', 'Agent Test', 'ops'),
  ('a7333333-3333-3333-3333-333333333333', 'pgtap7.compta@exemple.test', 'Compta Test', 'accounting'),
  ('a7444444-4444-4444-4444-444444444444', 'pgtap7.direction@exemple.test', 'Direction Test', 'management'),
  ('a7555555-5555-5555-5555-555555555555', 'pgtap7.client@exemple.test', 'Client Test', 'client'),
  ('a7666666-6666-6666-6666-666666666666', 'pgtap7.client2@exemple.test', 'Client 2 Test', 'client');

create temporary table t (name text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('client', gen_random_uuid()), ('client2', gen_random_uuid()),
  ('dossier', gen_random_uuid()), ('dossier2', gen_random_uuid()), ('account', gen_random_uuid());
insert into public.clients (id, kind, name, notify_phone) values
  ((select id from t where name = 'client'), 'person', 'Client (test)', '+221770000701'),
  ((select id from t where name = 'client2'), 'person', 'Client 2 (test)', '+221770000702');
update public.profiles set client_id = (select id from t where name = 'client') where id = 'a7555555-5555-5555-5555-555555555555';
update public.profiles set client_id = (select id from t where name = 'client2') where id = 'a7666666-6666-6666-6666-666666666666';

-- Dossier au lot remporté : paiement 1 dû dans 20 h (avant la fin des 48 h de validité du devis → X2).
insert into public.dossiers (id, reference, client_id, stage, status, auction_result, hammer_price_cents,
                             lot_won_notified_at, payment1_due_at)
values ((select id from t where name = 'dossier'), 'TEST-3B-1', (select id from t where name = 'client'), 'purchase',
        'won', 'won', 900000, now() - interval '4 hours', now() + interval '20 hours'),
       ((select id from t where name = 'dossier2'), 'TEST-3B-2', (select id from t where name = 'client2'), 'purchase',
        'quote_issued', 'won', 500000, now() - interval '3 days', now() - interval '2 days');
insert into public.purchase_orders (dossier_id, max_bid_cents, deposit_cents)
  values ((select id from t where name = 'dossier'), 1000000, 250000);
insert into public.fx_rates (rate, source, captured_at) values (600.0000, 'XE.com — test 3b', now() - interval '1 second');
insert into public.official_accounts (id, kind, label, holder_name, bank_name, account_number, status, created_by,
                                      approved_by, approved_at)
values ((select id from t where name = 'account'), 'bank', 'Banque test 3b', 'USA CARS (test)', 'Banque test',
        'TEST-3B-0001', 'active', 'a7111111-1111-1111-1111-111111111111', 'a7444444-4444-4444-4444-444444444444', now());
insert into public.documents (id, dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
values (gen_random_uuid(), (select id from t where name = 'dossier'), (select id from t where name = 'client'),
        'acceptance_proof', 'dossiers/test-3b/preuve.pdf', 'preuve.pdf', 'application/pdf', 10, repeat('a', 64)),
       (gen_random_uuid(), (select id from t where name = 'dossier2'), (select id from t where name = 'client2'),
        'acceptance_proof', 'dossiers/test-3b/preuve2.pdf', 'preuve2.pdf', 'application/pdf', 10, repeat('b', 64)),
       (gen_random_uuid(), (select id from t where name = 'dossier2'), (select id from t where name = 'client2'),
        'quote', 'dossiers/test-3b/devis2.docx', 'devis2.docx', 'application/pdf', 10, repeat('c', 64));
insert into t values
  ('proof', (select id from public.documents where storage_path = 'dossiers/test-3b/preuve.pdf')),
  ('proof2', (select id from public.documents where storage_path = 'dossiers/test-3b/preuve2.pdf'));

-- US-3.3 : émission du devis
select set_config('request.jwt.claims', '{"sub":"a7444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$ select public.issue_quote((select id from t where name = 'dossier')) $$,
  '42501', null, 'Accès refusé : la direction n’émet pas de devis');
reset role;
select set_config('request.jwt.claims', '{"sub":"a7222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select public.issue_quote((select id from t where name = 'dossier')) $$,
  '22023', 'Saisissez les forfaits A et B avant d’émettre le devis.', 'Devis impossible sans forfaits A et B');
insert into public.dossier_forfaits (dossier_id, forfait_a_cents, forfait_b_cents)
  values ((select id from t where name = 'dossier'), 1000000, 350000);
select throws_ok($$ select public.issue_quote((select id from t where name = 'dossier')) $$,
  '22023', null, 'Devis impossible sans la prime d’assurance (X1 : choix à l’acceptation)');
update public.dossier_forfaits set insurance_cents = 25000 where dossier_id = (select id from t where name = 'dossier');
insert into t values ('quote', public.issue_quote((select id from t where name = 'dossier')));
select matches((select number from public.financial_documents where id = (select id from t where name = 'quote')),
  '^DV-[0-9]{4}-[0-9]{4,}$', 'Numéro DV-AAAA-#### attribué à l’émission (R3)');
select is((select valid_until from public.financial_documents where id = (select id from t where name = 'quote')),
  (select payment1_due_at from public.dossiers where id = (select id from t where name = 'dossier')),
  'X2 : le devis expire avec le délai du paiement 1 (avant la fin des 48 h)');
select is((select fx_rate from public.financial_documents where id = (select id from t where name = 'quote')),
  600.0000::numeric, 'R1 : taux du jour figé sur le devis');
select is((select total_cents || '|' || insurance_premium_cents || '|' || insurance_choice
             from public.financial_documents where id = (select id from t where name = 'quote')),
  '1350000|25000|pending', 'Total A + B (TVA 0 %), option C proposée, choix en attente');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'quote_issued',
  'Dossier : statut « Devis émis »');
select throws_ok($$ select public.issue_quote((select id from t where name = 'dossier')) $$,
  '22023', null, 'Un seul devis en cours par dossier');
select throws_ok(
  $$ update public.financial_documents set forfait_a_cents = 1 where id = (select id from t where name = 'quote') $$,
  '42501', null, 'Aucune écriture directe dans les documents financiers');
reset role;
select throws_ok(
  $$ update public.financial_documents set total_cents = 1 where id = (select id from t where name = 'quote') $$,
  '42501', null, 'Montants d’un document émis figés (même pour le propriétaire des tables)');

-- R15 / X1 : acceptation du devis avec le choix d'assurance
select set_config('request.jwt.claims', '{"sub":"a7333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                     decided_at, proof_document_id, insurance_choice)
     values ((select id from t where name = 'dossier'), 'quote', (select id from t where name = 'quote'),
             (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
             (select id from t where name = 'proof'), 'accepted') $$,
  '22023', 'Générez le fichier du devis avant d’enregistrer la décision du client.',
  'Acceptation impossible tant que le fichier du devis n’est pas généré');
insert into t values ('quote_file', public.register_financial_document_file((select id from t where name = 'quote'),
  'dossiers/' || (select id from t where name = 'dossier') || '/quote/devis.docx', 'Devis.docx', 1000, repeat('d', 64), 'test'));
select is((select kind || '|' || visible_client from public.documents where id = (select id from t where name = 'quote_file')),
  'quote|true', 'Fichier du devis enregistré, visible du client');
select throws_ok(
  $$ select public.register_financial_document_file((select id from t where name = 'quote'),
       'dossiers/' || (select id from t where name = 'dossier') || '/quote/autre.docx', 'Autre.docx', 1000, repeat('e', 64), 'test') $$,
  '22023', null, 'Le fichier d’un document émis n’est rattaché qu’une fois (version figée)');
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                     decided_at, proof_document_id)
     values ((select id from t where name = 'dossier'), 'quote', (select id from t where name = 'quote'),
             (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
             (select id from t where name = 'proof')) $$,
  '22023', 'Indiquez le choix du client pour l’assurance transport (option C).',
  'X1 : le choix d’assurance figure dans l’acceptation du devis');
insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                decided_at, proof_document_id, insurance_choice)
values ((select id from t where name = 'dossier'), 'quote', (select id from t where name = 'quote'),
        (select id from t where name = 'proof'), repeat('0', 64), 'scanned_paper', 'accepted', now(),
        (select id from t where name = 'proof'), 'accepted');
select is((select status || '|' || insurance_choice from public.financial_documents where id = (select id from t where name = 'quote')),
  'accepted|accepted', 'Devis accepté, assurance acceptée');
select is((select document_sha256 from public.acceptances where subject_id = (select id from t where name = 'quote')),
  repeat('d', 64), 'R15 : l’acceptation porte sur l’empreinte du fichier émis');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'quote_accepted',
  'Dossier : statut « Devis validé »');
reset role;

-- US-3.4 : dépôt (I2)
select set_config('request.jwt.claims', '{"sub":"a7222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_deposit((select id from t where name = 'dossier'), 'USD', 100000, null, 'bank_transfer',
       (select id from t where name = 'account'), 'VIR-TEST', now()) $$,
  '42501', null, 'Accès refusé : un agent n’enregistre pas de paiement');
reset role;
select set_config('request.jwt.claims', '{"sub":"a7333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_deposit((select id from t where name = 'dossier'), 'USD', 100000, null, 'wave',
       (select id from t where name = 'account'), 'WAVE-TEST', now()) $$,
  '22023', null, 'Le compte officiel doit correspondre au mode de paiement');
insert into t values ('deposit_usd', public.record_deposit((select id from t where name = 'dossier'), 'USD', 200000, null,
  'bank_transfer', (select id from t where name = 'account'), 'VIR-TEST-1', now() - interval '1 minute'));
insert into t values ('deposit_xof', public.record_deposit((select id from t where name = 'dossier'), 'XOF', null, 300000,
  'cash', null, 'ESP-TEST-1', now()));
select is((select amount_cents || '|' || fx_rate_same_day from public.payments where id = (select id from t where name = 'deposit_xof')),
  '50000|true', 'R1 : 300 000 FCFA au taux du jour 600 = 500 $US imputés');
select throws_ok(
  $$ update public.payments set amount_cents = 1 where id = (select id from t where name = 'deposit_usd') $$,
  '42501', null, 'Aucune écriture directe dans les paiements');

-- R4 : facture d'acompte
reset role;
select set_config('request.jwt.claims', '{"sub":"a7222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$ select public.issue_deposit_invoice((select id from t where name = 'dossier')) $$,
  '42501', null, 'Accès refusé : un agent n’émet pas de facture');
reset role;
select set_config('request.jwt.claims', '{"sub":"a7333333-3333-3333-3333-333333333333","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into t values ('invoice', public.issue_deposit_invoice((select id from t where name = 'dossier')));
select matches((select number from public.financial_documents where id = (select id from t where name = 'invoice')),
  '^FA-[0-9]{4}-[0-9]{4,}$', 'Numéro FA-AAAA-####');
select is(
  (select total_cents || '|' || deposit_applied_cents || '|' || amount_due_cents || '|' || deposit_excess_cents
     from public.financial_documents where id = (select id from t where name = 'invoice')),
  '1000000|250000|750000|0', 'FA : totalité du forfait A, dépôts imputés (2 000 + 500 $US), reste 7 500 $US');
select is(
  (select (f.due_at = d.payment1_due_at) and f.fx_rate = 600.0000 and f.quote_id = (select id from t where name = 'quote')
     from public.financial_documents f join public.dossiers d on d.id = f.dossier_id
     where f.id = (select id from t where name = 'invoice')),
  true, 'R4 : échéance du paiement 1 ; taux de référence du devis repris (R1)');
select is((select status from public.dossiers where id = (select id from t where name = 'dossier')), 'payment1_pending',
  'Dossier : statut « Paiement 1 attendu »');
select throws_ok($$ select public.issue_deposit_invoice((select id from t where name = 'dossier')) $$,
  '22023', null, 'Une seule facture d’acompte active par dossier');
select throws_ok(
  $$ select public.record_deposit((select id from t where name = 'dossier'), 'USD', 100000, null, 'bank_transfer',
       (select id from t where name = 'account'), 'VIR-TEST-2', now()) $$,
  '22023', null, 'Après la facture d’acompte, un versement est un paiement 1, pas un dépôt');
select throws_ok(
  $$ select public.cancel_financial_document((select id from t where name = 'quote'), 'Erreur de forfait') $$,
  '22023', null, 'Un devis facturé ne s’annule qu’après sa facture');
select throws_ok(
  $$ select public.cancel_payment((select id from t where name = 'deposit_usd'), 'Erreur de saisie') $$,
  '22023', null, 'Un dépôt imputé ne s’annule qu’après la facture d’acompte');
reset role;

-- Expiration (US-3.3) : devis d'un autre dossier dont la validité est passée
insert into public.financial_documents (id, dossier_id, client_id, doc_type, number, forfait_a_cents, forfait_b_cents,
  insurance_premium_cents, total_cents, amount_due_cents, fx_rate_id, fx_rate, fx_source, fx_captured_at, edition_fx_rate,
  edition_fx_captured_at, issued_at, valid_until, document_id, document_sha256)
select gen_random_uuid(), (select id from t where name = 'dossier2'), (select id from t where name = 'client2'), 'quote',
  'DV-TEST-3B', 600000, 200000, 0, 800000, 800000, r.id, r.rate, r.source, r.captured_at, r.rate, r.captured_at,
  now() - interval '3 hours', now() - interval '1 hour',
  (select id from public.documents where storage_path = 'dossiers/test-3b/devis2.docx'), repeat('c', 64)
from public.fx_rates r where r.source = 'XE.com — test 3b';
insert into t values ('quote2', (select id from public.financial_documents where number = 'DV-TEST-3B'));
select is(public.expire_due_quotes((select id from t where name = 'dossier2')), 1, 'Le devis échu est expiré');
select is(
  (select f.status || '|' || d.status from public.financial_documents f join public.dossiers d on d.id = f.dossier_id
     where f.id = (select id from t where name = 'quote2')),
  'expired|won', 'Devis « expiré » ; le dossier revient à « Gagné » (nouveau devis à émettre)');
select ok(exists (select 1 from public.dossier_events where dossier_id = (select id from t where name = 'dossier2')
                  and kind = 'financial_document' and label like 'Devis DV-TEST-3B expiré%'), 'Alerte : expiration dans la chronologie');
select set_config('request.jwt.claims', '{"sub":"a7222222-2222-2222-2222-222222222222","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                     decided_at, proof_document_id, insurance_choice)
     values ((select id from t where name = 'dossier2'), 'quote', (select id from t where name = 'quote2'),
             (select id from t where name = 'proof2'), repeat('0', 64), 'scanned_paper', 'accepted', now() - interval '30 minutes',
             (select id from t where name = 'proof2'), 'refused') $$,
  '22023', null, 'Acceptation postérieure à la validité refusée');
select lives_ok(
  $$ insert into public.acceptances (dossier_id, subject, subject_id, document_id, document_sha256, method, decision,
                                     decided_at, proof_document_id, insurance_choice)
     values ((select id from t where name = 'dossier2'), 'quote', (select id from t where name = 'quote2'),
             (select id from t where name = 'proof2'), repeat('0', 64), 'scanned_paper', 'accepted', now() - interval '2 hours',
             (select id from t where name = 'proof2'), 'refused') $$,
  'Acceptation donnée pendant la validité, enregistrée après l’expiration : recevable');
reset role;

-- Isolation client et règle 2 : aucun coût interne dans les documents financiers
select set_config('request.jwt.claims', '{"sub":"a7555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.financial_documents), 2::bigint, 'Client : ses devis et factures');
select is((select count(*) from public.payments), 2::bigint, 'Client : ses paiements');
select is((select count(*) from public.financial_documents where dossier_id = (select id from t where name = 'dossier2')),
  0::bigint, 'Accès refusé : aucun document financier d’un autre client');
select throws_ok($$ select public.issue_quote((select id from t where name = 'dossier')) $$,
  '42501', null, 'Accès refusé : un client n’émet pas de devis');
reset role;
select ok(
  not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('financial_documents', 'payments')
                and (column_name like '%cost%' or column_name like '%margin%')),
  'Règle 2 : aucune colonne de coût interne ni de marge dans les documents financiers et paiements');
select ok(
  (select bool_and(data_type = 'bigint') from information_schema.columns
     where table_schema = 'public' and table_name in ('financial_documents', 'payments')
       and (column_name like '%cents' or column_name = 'amount_xof')),
  'Montants en centimes entiers (bigint)');
select is((select count(*) from public.audit_log where object_type = 'financial_documents'
             and object_id = (select id::text from t where name = 'quote')), 3::bigint,
  'Audit : émission, rattachement du fichier et acceptation du devis journalisés');
select ok(exists (select 1 from cron.job where jobname = 'usa-cars-expire-quotes'), 'Expiration programmée (pg_cron)');
select lives_ok(
  $$ insert into public.documents (dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256)
     values ((select id from t where name = 'dossier'), (select id from t where name = 'client'), 'cost_receipt',
             'dossiers/test-3b/cout.pdf', 'cout.pdf', 'application/pdf', 10, repeat('f', 64)) $$,
  'Les justificatifs de coût (lot 3a) restent acceptés');

select * from finish();
rollback;
