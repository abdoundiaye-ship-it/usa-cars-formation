-- Phase 5, lot 5b : procédure « véhicule non réclamé » (US-5.3, contrat art. 21–22, R11, décisions U1 à U4).
-- Dossier du seed DEMO-2026-0007 (client 1, arrivé il y a 65 jours, solde de 3 000 $US non réglé, non enlevé).
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Second client (accès croisé) : dossier d'un autre client.
insert into auth.users (id, email) values ('ab555555-5555-5555-5555-555555555555', 'pgtap17.client2@exemple.test');
insert into public.profiles (id, email, full_name, role, client_id) values
  ('ab555555-5555-5555-5555-555555555555', 'pgtap17.client2@exemple.test', 'Client 2 Test', 'client',
   'c0000000-0000-4000-8000-000000000002');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;

-- Compte à rebours (R11) : seuils du contrat, étape suivante « relance ».
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(
  (select days_since_arrival || '|' || amount_due_cents || '|' || applies || '|' || next_step
          || '|' || (reminder_due_on - arrival_date) || '|' || (formal_notice_due_on - arrival_date) || '|' || min_cure_days
     from public.unclaimed_overview('e0000000-0000-4000-8000-000000000007')),
  '65|300000|true|reminder|30|60|15',
  'Situation : J+65, 3 000 $US dus, relance à J+30, mise en demeure à J+60, délai minimal 15 jours');
select is(
  (select procedure_possible_on from public.unclaimed_overview('e0000000-0000-4000-8000-000000000007')),
  ((current_date - 65) + interval '4 months')::date, 'Procédure possible 4 mois après l’arrivée');
-- U3 : un agent opérations consulte mais n'émet pas de courrier.
select throws_ok(
  $$ select public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'reminder') $$,
  '42501', null, 'Accès refusé : un agent opérations n’émet pas de courrier');
select throws_ok(
  $$ select public.open_unclaimed_procedure('e0000000-0000-4000-8000-000000000007', 'Délai expiré, client injoignable') $$,
  '42501', null, 'Accès refusé : un agent opérations n’ouvre pas la procédure');
reset role;

-- Comptabilité : relance, puis mise en demeure seulement après l'envoi de la relance.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'formal_notice') $$,
  '22023', 'Envoyez d’abord la lettre de relance (contrat art. 22).', 'Mise en demeure refusée avant l’envoi de la relance');
insert into t select 'reminder', public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'reminder');
select throws_ok(
  $$ select public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'reminder') $$,
  '22023', null, 'Une seule relance en cours par dossier');
select throws_ok(
  $$ select public.record_letter_sent((select id from t where name = 'reminder'), current_date, 'hand', null,
       'dossiers/e0000000-0000-4000-8000-000000000007/letter_sending_proof/x-preuve.pdf', 'preuve.pdf',
       'application/pdf', 1000, repeat('a', 64)) $$,
  '22023', 'Générez d’abord le fichier du courrier.', 'Envoi refusé tant que le fichier n’est pas généré');
select throws_ok(
  $$ select public.register_unclaimed_letter_file((select id from t where name = 'reminder'),
       'dossiers/e0000000-0000-4000-8000-000000000004/unclaimed_letter/x.docx', 'x.docx', 1000, repeat('b', 64), 'v1') $$,
  '22023', 'Emplacement du fichier invalide.', 'Fichier d’un autre dossier refusé');
select lives_ok(
  $$ select public.register_unclaimed_letter_file((select id from t where name = 'reminder'),
       'dossiers/e0000000-0000-4000-8000-000000000007/unclaimed_letter/x-Relance.docx', 'Relance.docx', 1000,
       repeat('b', 64), 'courrier-test') $$,
  'Fichier Word de la relance enregistré');
reset role;

select is(
  (select number ~ '^LR-\d{4}-\d{4}$' and status = 'issued' and amount_due_cents = 300000 and late_fees_cents = 0
          and reason = 'unpaid_not_collected' and fx_rate > 0
     from public.unclaimed_letters where id = (select id from t where name = 'reminder')),
  true, 'Relance LR-AAAA-NNNN : sommes dues, motif et taux figés à l’émission');
select is(
  (select d.visible_client from public.documents d join public.unclaimed_letters l on l.document_id = d.id
    where l.id = (select id from t where name = 'reminder')),
  false, 'Courrier non visible du client avant son envoi');

-- Le client ne voit pas un courrier non envoyé.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.unclaimed_letters), 0::bigint, 'Client : aucun courrier avant l’envoi');
reset role;

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.record_letter_sent((select id from t where name = 'reminder'), current_date + 1, 'hand', null,
       'dossiers/e0000000-0000-4000-8000-000000000007/letter_sending_proof/x-preuve.pdf', 'preuve.pdf',
       'application/pdf', 1000, repeat('a', 64)) $$,
  '22023', null, 'Date d’envoi dans le futur refusée');
select lives_ok(
  $$ select public.record_letter_sent((select id from t where name = 'reminder'), current_date, 'hand', 'Remise au bureau',
       'dossiers/e0000000-0000-4000-8000-000000000007/letter_sending_proof/x-preuve.pdf', 'preuve.pdf',
       'application/pdf', 1000, repeat('a', 64)) $$,
  'Envoi de la relance enregistré avec sa preuve');
select throws_ok(
  $$ select public.cancel_unclaimed_letter((select id from t where name = 'reminder'), 'Erreur de saisie') $$,
  '22023', 'Seul un courrier non envoyé peut être annulé.', 'Un courrier envoyé ne s’annule pas');
reset role;

select is(
  (select d.visible_client from public.documents d join public.unclaimed_letters l on l.document_id = d.id
    where l.id = (select id from t where name = 'reminder')),
  true, 'Après l’envoi, le courrier est visible dans l’espace client (U4)');
select ok(
  (select count(*) from public.notifications
    where dossier_id = 'e0000000-0000-4000-8000-000000000007' and template = 'unclaimed_reminder') >= 1,
  'Notification « courrier adressé » mise en file pour le client');
select is(
  (select count(*) from public.notifications
    where template = 'unclaimed_reminder' and variables::text ~* '(iban|compte|wave|orange)'),
  0::bigint, 'Aucune coordonnée de paiement dans la notification (règle 7)');

-- Isolation : le client 1 lit son courrier envoyé ; le client 2 ne le voit pas.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.unclaimed_letters), 1::bigint, 'Client 1 : lit sa lettre de relance envoyée');
select is((select count(*) from public.unclaimed_procedures), 0::bigint, 'Client 1 : la procédure reste interne');
reset role;
select set_config('request.jwt.claims', '{"sub":"ab555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.unclaimed_letters), 0::bigint, 'Accès refusé : le client 2 ne voit pas le courrier');
reset role;

-- Direction : mise en demeure (délai ≥ 15 jours), puis procédure à l'échéance seulement.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'formal_notice', 10) $$,
  '22023', 'Le délai de régularisation ne peut pas être inférieur à 15 jours (contrat art. 21).',
  'Délai de régularisation inférieur à 15 jours refusé');
insert into t select 'notice', public.issue_unclaimed_letter('e0000000-0000-4000-8000-000000000007', 'formal_notice', 20);
select throws_ok(
  $$ select public.open_unclaimed_procedure('e0000000-0000-4000-8000-000000000007', 'Délai expiré, client injoignable') $$,
  '22023', null, 'Procédure refusée avant 4 mois et sans mise en demeure expirée');
reset role;

select is((select number ~ '^MD-' and cure_days = 20 and cure_deadline is null from public.unclaimed_letters
            where id = (select id from t where name = 'notice')),
  true, 'Mise en demeure MD : délai de 20 jours, date limite fixée à l’envoi');
select throws_ok(
  $$ update public.unclaimed_letters set amount_due_cents = 1 where id = (select id from t where name = 'notice') $$,
  '42501', null, 'Montants d’un courrier émis non modifiables');

-- Échéance atteinte (simulation : arrivée il y a 5 mois, mise en demeure envoyée et délai expiré).
alter table public.containers disable trigger containers_before_update; -- ATA figée : simulation seulement
update public.containers set departed_on = current_date - 180, ata = current_date - 150
  where id = 'f1000000-0000-4000-8000-000000000003';
alter table public.containers enable trigger containers_before_update;
select set_config('app.unclaimed_letter', 'on', true);
update public.unclaimed_letters
  set status = 'sent', document_id = (select document_id from public.unclaimed_letters where id = (select id from t where name = 'reminder')),
      sent_at = now() - interval '30 days', sent_channel = 'courier', cure_deadline = current_date - 10,
      sent_proof_document_id = (select sent_proof_document_id from public.unclaimed_letters where id = (select id from t where name = 'reminder'))
  where id = (select id from t where name = 'notice');
select set_config('app.unclaimed_letter', 'off', true);

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.open_unclaimed_procedure('e0000000-0000-4000-8000-000000000007', 'Délai expiré, client injoignable') $$,
  '42501', null, 'Accès refusé : la comptabilité n’ouvre pas la procédure (U3)');
reset role;

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.open_unclaimed_procedure('e0000000-0000-4000-8000-000000000007', 'Délai expiré, client injoignable') $$,
  'La direction ouvre la procédure à l’échéance');
reset role;
select is(
  (select stage || '|' || status || '|' || (ownership_transferred_at is null) from public.dossiers
    where id = 'e0000000-0000-4000-8000-000000000007'),
  'closing|unclaimed|true',
  'Dossier « Non réclamé (procédure en cours) » ; propriété inchangée (aucune action automatique, R11)');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.close_unclaimed_procedure('e0000000-0000-4000-8000-000000000007',
       'Client a réglé et enlevé le véhicule', 'completed') $$,
  'Clôture de la procédure avec son issue');
reset role;
select is(
  (select status from public.dossiers where id = 'e0000000-0000-4000-8000-000000000007'),
  'completed', 'Dossier « Terminé » après la clôture');
select ok(
  (select count(*) from public.audit_log where object_type in ('unclaimed_letters', 'unclaimed_procedures')) >= 5,
  'Audit : émissions, envois, ouverture et clôture journalisés');

select * from finish();
rollback;
