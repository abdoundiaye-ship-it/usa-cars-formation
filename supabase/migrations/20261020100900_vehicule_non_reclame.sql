-- Phase 5, lot 5b — procédure « véhicule non réclamé » (US-5.3, contrat art. 21–22, R11 ; décisions U1 à U4).
-- À partir de l'ATA, tant que le solde n'est pas réglé ou que le véhicule n'est pas enlevé : lettre de relance
-- (J+`unclaimed.reminder_days_after_arrival`), mise en demeure (J+`unclaimed.formal_notice_days_after_arrival`,
-- délai de régularisation ≥ `unclaimed.formal_notice_min_cure_days` jours), procédure possible à
-- `unclaimed.procedure_months_after_arrival` mois. Le système produit les courriers et les alertes ; il ne change
-- JAMAIS la propriété du véhicule et ne déclenche aucune vente (R11) : toute action est manuelle et journalisée.

-- ---------------------------------------------------------------------------
-- Types de documents, d'événements et de notifications
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'contract', 'signed_contract', 'acceptance_proof', 'purchase_order', 'auction_invoice', 'pickup_proof', 'title',
  'bill_of_lading', 'payment_proof', 'power_of_attorney', 'release_receipt', 'photos', 'cost_receipt', 'other',
  'quote', 'deposit_invoice', 'balance_invoice', 'cash_receipt', 'refund_note',
  'reminder_letter', 'formal_notice', 'letter_sending_proof'
));

alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note',
  'container_assigned', 'container_changed', 'eta_changed', 'tracking_event',
  'financial_document', 'payment_recorded', 'adjustment', 'refund', 'arrival_notified',
  'unclaimed_letter', 'unclaimed_procedure'
));

alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications add constraint notifications_template_check check (template in (
  'login_link', 'lot_won', 'quote_issued', 'payment_due_reminder', 'vessel_departed', 'eta_changed', 'arrived',
  'documents_ready', 'payment_overdue', 'test_message', 'unclaimed_reminder', 'formal_notice'
));

-- ---------------------------------------------------------------------------
-- Droits (U3) : courriers par l'administrateur, la direction et la comptabilité ; ouverture et clôture de la
-- procédure par l'administrateur et la direction. Les agents opérations consultent.
-- ---------------------------------------------------------------------------
create function public.is_recovery_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'management', 'accounting'), false);
$$;

create function public.is_procedure_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_app() in ('admin', 'management'), false);
$$;

revoke execute on function public.is_recovery_writer() from public, anon;
grant execute on function public.is_recovery_writer() to authenticated;
revoke execute on function public.is_procedure_writer() from public, anon;
grant execute on function public.is_procedure_writer() to authenticated;

-- La direction dépose dans le bucket privé uniquement les courriers et leurs preuves d'envoi (les autres
-- écrivains ont déjà le droit général) ; l'enregistrement en base passe par les fonctions ci-dessous.
create policy documents_bucket_insert_letters on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.current_role_app()) = 'management'
    and (name like 'dossiers/%/unclaimed_letter/%' or name like 'dossiers/%/letter_sending_proof/%')
  );

-- ---------------------------------------------------------------------------
-- Courriers : lettre de relance (LR) et mise en demeure (MD), montants figés à l'émission
-- ---------------------------------------------------------------------------
create table public.unclaimed_letters (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id),
  client_id uuid not null references public.clients (id),
  kind text not null check (kind in ('reminder', 'formal_notice')),
  number text not null unique,
  status text not null default 'issued' check (status in ('issued', 'sent', 'cancelled')),
  arrival_date date not null,                                       -- ATA du conteneur
  reason text not null check (reason in ('unpaid', 'not_collected', 'unpaid_not_collected')),
  -- Art. 21 : sommes dues et frais accumulés à la date d'émission (centimes USD) ; jamais de coût interne.
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  late_fees_cents bigint not null default 0 check (late_fees_cents >= 0),
  fx_rate numeric(12, 4) not null check (fx_rate > 0),               -- taux du jour d'émission (équivalent FCFA)
  fx_captured_at timestamptz not null,
  cure_days int check (cure_days is null or cure_days > 0),          -- mise en demeure : délai de régularisation
  cure_deadline date,                                                -- fixé à l'envoi : date d'envoi + cure_days
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id) default auth.uid(),
  document_id uuid references public.documents (id),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  template_version text,
  sent_at timestamptz,
  sent_channel text check (sent_channel in ('hand', 'email', 'whatsapp', 'courier')),
  sent_note text,
  sent_proof_document_id uuid references public.documents (id),
  sent_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_reason text,
  check ((kind = 'formal_notice') = (cure_days is not null)),
  check (status <> 'sent' or (
    sent_at is not null and sent_channel is not null and sent_proof_document_id is not null and document_id is not null
    and (kind = 'reminder' or cure_deadline is not null)
  )),
  check (status <> 'cancelled' or (cancelled_at is not null and length(trim(coalesce(cancelled_reason, ''))) >= 5))
);

comment on table public.unclaimed_letters is
  'Courriers de la procédure « véhicule non réclamé » (art. 21–22) : relance et mise en demeure, montants figés.';

create index unclaimed_letters_dossier_idx on public.unclaimed_letters (dossier_id, issued_at);
-- Un seul courrier en cours par type et par dossier (annuler pour en émettre un nouveau).
create unique index unclaimed_letters_active_idx on public.unclaimed_letters (dossier_id, kind)
  where status <> 'cancelled';

-- Les valeurs émises sont figées ; seuls le fichier, l'envoi et l'annulation changent (par les fonctions).
create function public.unclaimed_letters_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.unclaimed_letter', true), '') <> 'on' then
    raise exception 'Les courriers se modifient uniquement par les actions dédiées.' using errcode = '42501';
  end if;
  if (new.dossier_id, new.client_id, new.kind, new.number, new.arrival_date, new.reason, new.amount_due_cents,
      new.late_fees_cents, new.fx_rate, new.fx_captured_at, new.cure_days, new.issued_at, new.issued_by)
     is distinct from
     (old.dossier_id, old.client_id, old.kind, old.number, old.arrival_date, old.reason, old.amount_due_cents,
      old.late_fees_cents, old.fx_rate, old.fx_captured_at, old.cure_days, old.issued_at, old.issued_by) then
    raise exception 'Le contenu d’un courrier émis ne peut pas être modifié : annulez-le et émettez-en un nouveau.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.unclaimed_letters_before_update() from public, anon, authenticated;

create trigger unclaimed_letters_before_update
  before update on public.unclaimed_letters
  for each row execute function public.unclaimed_letters_before_update();

create trigger unclaimed_letters_no_delete
  before delete on public.unclaimed_letters
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Procédure ouverte à l'échéance (statut « Non réclamé (procédure en cours) »), clôturée manuellement
-- ---------------------------------------------------------------------------
create table public.unclaimed_procedures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null unique references public.dossiers (id),
  opened_at timestamptz not null default now(),
  opened_by uuid references public.profiles (id) default auth.uid(),
  open_reason text not null check (length(trim(open_reason)) >= 5),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  outcome text,
  closing_status text check (closing_status in ('completed', 'archived', 'claim', 'dispute', 'suspended')),
  check ((closed_at is null) = (outcome is null) and (closed_at is null) = (closing_status is null)),
  check (outcome is null or length(trim(outcome)) >= 5)
);

comment on table public.unclaimed_procedures is
  'Procédure « véhicule non réclamé » ouverte par l’administrateur ou la direction ; aucune action automatique (R11).';

create trigger unclaimed_procedures_no_delete
  before delete on public.unclaimed_procedures
  for each row execute function public.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Situation d'un dossier arrivé : compte à rebours et étape suivante (R11). Lue par l'écran du dossier et le
-- tableau de bord (un appel pour tous les dossiers) ; internes uniquement.
-- ---------------------------------------------------------------------------
create function public.unclaimed_overview(p_dossier_id uuid default null)
returns table (
  dossier_id uuid, reference text, arrival_date date, days_since_arrival int,
  amount_due_cents bigint, collected boolean, applies boolean,
  reminder_due_on date, formal_notice_due_on date, procedure_possible_on date, min_cure_days int,
  reminder_status text, reminder_sent_at timestamptz,
  formal_notice_status text, formal_notice_sent_at timestamptz, cure_deadline date,
  procedure_opened_at timestamptz, procedure_closed_at timestamptz,
  next_step text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Dakar')::date;
begin
  if not public.is_internal() then
    raise exception 'Réservé aux utilisateurs internes.' using errcode = '42501';
  end if;
  return query
  with arrived as (
    select d.id, d.reference, d.stage, d.status, d.params_as_of, c.ata
    from public.dossiers d
    join public.dossier_containers dc on dc.dossier_id = d.id and dc.removed_at is null
    join public.containers c on c.id = dc.container_id
    where c.ata is not null
      and (p_dossier_id is null or d.id = p_dossier_id)
      and (d.stage = 'dakar' or (d.stage = 'closing' and d.status = 'unclaimed')
           or exists (select 1 from public.unclaimed_procedures p where p.dossier_id = d.id))
  ),
  situation as (
    select a.*,
      greatest(coalesce((select b.balance_remaining_cents from public.dossier_balance(a.id) b
                          where b.has_accepted_quote), 0), 0)::bigint as due,
      a.status = 'collected' as is_collected,
      (public.setting_as_of('unclaimed.reminder_days_after_arrival', a.params_as_of) #>> '{}')::int as reminder_days,
      (public.setting_as_of('unclaimed.formal_notice_days_after_arrival', a.params_as_of) #>> '{}')::int as notice_days,
      (public.setting_as_of('unclaimed.formal_notice_min_cure_days', a.params_as_of) #>> '{}')::int as cure_days,
      (public.setting_as_of('unclaimed.procedure_months_after_arrival', a.params_as_of) #>> '{}')::int as months,
      r.status as r_status, r.sent_at as r_sent,
      f.status as f_status, f.sent_at as f_sent, f.cure_deadline as f_deadline,
      p.opened_at as p_opened, p.closed_at as p_closed
    from arrived a
    left join public.unclaimed_letters r on r.dossier_id = a.id and r.kind = 'reminder' and r.status <> 'cancelled'
    left join public.unclaimed_letters f on f.dossier_id = a.id and f.kind = 'formal_notice' and f.status <> 'cancelled'
    left join public.unclaimed_procedures p on p.dossier_id = a.id
  )
  select s.id, s.reference, s.ata, (v_today - s.ata)::int, s.due, s.is_collected,
    (s.due > 0 or not s.is_collected),
    s.ata + s.reminder_days, s.ata + s.notice_days, (s.ata + make_interval(months => s.months))::date, s.cure_days,
    s.r_status, s.r_sent, s.f_status, s.f_sent, s.f_deadline, s.p_opened, s.p_closed,
    case
      when s.p_closed is not null then 'closed'
      when s.p_opened is not null then 'procedure_open'
      when not (s.due > 0 or not s.is_collected) then 'none'
      when s.r_status is distinct from 'sent' then 'reminder'
      when s.f_status is distinct from 'sent' then 'formal_notice'
      else 'procedure'
    end
  from situation s;
end;
$$;

revoke execute on function public.unclaimed_overview(uuid) from public, anon;
grant execute on function public.unclaimed_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Émission d'un courrier : numéro, sommes dues et frais figés, taux du jour (équivalent FCFA indicatif)
-- ---------------------------------------------------------------------------
create function public.issue_unclaimed_letter(p_dossier_id uuid, p_kind text, p_cure_days int default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_situation record;
  v_rate record;
  v_late_fees bigint;
  v_id uuid;
  v_number text;
  v_cure int;
begin
  if not public.is_recovery_writer() then
    raise exception 'Action réservée à l’administrateur, à la direction et à la comptabilité.' using errcode = '42501';
  end if;
  if p_kind not in ('reminder', 'formal_notice') then
    raise exception 'Type de courrier inconnu.' using errcode = '22023';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = '22023';
  end if;
  if v_dossier.stage <> 'dakar' then
    raise exception 'Les courriers concernent un dossier à l’étape Dakar.' using errcode = '22023';
  end if;
  select * into v_situation from public.unclaimed_overview(p_dossier_id);
  if v_situation.dossier_id is null then
    raise exception 'Le conteneur de ce dossier n’est pas encore arrivé (ATA non saisie).' using errcode = '22023';
  end if;
  if not v_situation.applies then
    raise exception 'Solde réglé et véhicule enlevé : aucun courrier à adresser.' using errcode = '22023';
  end if;
  if exists (select 1 from public.unclaimed_letters l
             where l.dossier_id = p_dossier_id and l.kind = p_kind and l.status <> 'cancelled') then
    raise exception 'Un courrier de ce type est déjà émis pour ce dossier (annulez-le pour en émettre un nouveau).'
      using errcode = '22023';
  end if;
  if p_kind = 'formal_notice' then
    if v_situation.reminder_status is distinct from 'sent' then
      raise exception 'Envoyez d’abord la lettre de relance (contrat art. 22).' using errcode = '22023';
    end if;
    v_cure := coalesce(p_cure_days, v_situation.min_cure_days);
    if v_cure is null or v_cure < v_situation.min_cure_days then
      raise exception 'Le délai de régularisation ne peut pas être inférieur à % jours (contrat art. 21).',
        v_situation.min_cure_days using errcode = '22023';
    end if;
  elsif p_cure_days is not null then
    raise exception 'Le délai de régularisation concerne la mise en demeure.' using errcode = '22023';
  end if;
  select * into v_rate from public.fx_rate_as_of(now());
  if v_rate.id is null then
    raise exception 'Saisissez d’abord le taux de change du jour (écran Finances).' using errcode = '22023';
  end if;
  select coalesce(sum(a.amount_cents), 0) into v_late_fees
    from public.adjustments a where a.dossier_id = p_dossier_id and a.kind = 'late_fee' and a.status = 'approved';

  v_number := public.next_number(case p_kind when 'reminder' then 'reminder_letter' else 'formal_notice' end);
  insert into public.unclaimed_letters (
    dossier_id, client_id, kind, number, arrival_date, reason, amount_due_cents, late_fees_cents,
    fx_rate, fx_captured_at, cure_days
  ) values (
    p_dossier_id, v_dossier.client_id, p_kind, v_number, v_situation.arrival_date,
    case
      when v_situation.amount_due_cents > 0 and not v_situation.collected then 'unpaid_not_collected'
      when v_situation.amount_due_cents > 0 then 'unpaid'
      else 'not_collected'
    end,
    v_situation.amount_due_cents, v_late_fees, v_rate.rate, v_rate.captured_at, v_cure
  ) returning id into v_id;

  perform public.add_dossier_event(p_dossier_id, 'unclaimed_letter',
    case p_kind when 'reminder' then 'Lettre de relance ' else 'Mise en demeure ' end || v_number || ' émise', false);
  return v_id;
end;
$$;

revoke execute on function public.issue_unclaimed_letter(uuid, text, int) from public, anon;
grant execute on function public.issue_unclaimed_letter(uuid, text, int) to authenticated;

-- Fichier Word du courrier, généré une seule fois par la fonction generate-document (au nom de l'utilisateur).
create function public.register_unclaimed_letter_file(
  p_letter_id uuid, p_storage_path text, p_file_name text, p_size_bytes bigint, p_sha256 text,
  p_template_version text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_letter public.unclaimed_letters%rowtype;
  v_document_id uuid;
begin
  if not public.is_recovery_writer() then
    raise exception 'Action réservée à l’administrateur, à la direction et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_letter from public.unclaimed_letters l where l.id = p_letter_id for update;
  if not found then
    raise exception 'Courrier introuvable.' using errcode = '22023';
  end if;
  if v_letter.document_id is not null then
    raise exception 'Le fichier de ce courrier est déjà généré.' using errcode = '22023';
  end if;
  if v_letter.status = 'cancelled' then
    raise exception 'Ce courrier est annulé.' using errcode = '22023';
  end if;
  if p_storage_path not like 'dossiers/' || v_letter.dossier_id || '/unclaimed_letter/%' then
    raise exception 'Emplacement du fichier invalide.' using errcode = '22023';
  end if;
  -- Visible du client seulement une fois le courrier envoyé (U4).
  insert into public.documents (
    dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client
  ) values (
    v_letter.dossier_id, v_letter.client_id,
    case v_letter.kind when 'reminder' then 'reminder_letter' else 'formal_notice' end,
    p_storage_path, p_file_name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', p_size_bytes, p_sha256, false
  ) returning id into v_document_id;

  perform set_config('app.unclaimed_letter', 'on', true);
  update public.unclaimed_letters
    set document_id = v_document_id, document_sha256 = p_sha256, template_version = p_template_version
    where id = p_letter_id;
  perform set_config('app.unclaimed_letter', 'off', true);
  return v_document_id;
end;
$$;

revoke execute on function public.register_unclaimed_letter_file(uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_unclaimed_letter_file(uuid, text, text, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoi enregistré par l'agent (U4) : date, canal, preuve. Le courrier devient visible dans l'espace client et
-- le client reçoit une notification (sans pièce jointe ni coordonnées de paiement, règle 7).
-- ---------------------------------------------------------------------------
create function public.record_letter_sent(
  p_letter_id uuid, p_sent_on date, p_channel text, p_note text,
  p_proof_storage_path text, p_proof_file_name text, p_proof_mime_type text, p_proof_size_bytes bigint,
  p_proof_sha256 text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_letter public.unclaimed_letters%rowtype;
  v_proof_id uuid;
  v_deadline date;
  v_label text;
begin
  if not public.is_recovery_writer() then
    raise exception 'Action réservée à l’administrateur, à la direction et à la comptabilité.' using errcode = '42501';
  end if;
  select * into v_letter from public.unclaimed_letters l where l.id = p_letter_id for update;
  if not found then
    raise exception 'Courrier introuvable.' using errcode = '22023';
  end if;
  if v_letter.status <> 'issued' then
    raise exception 'Ce courrier est déjà envoyé ou annulé.' using errcode = '22023';
  end if;
  if v_letter.document_id is null then
    raise exception 'Générez d’abord le fichier du courrier.' using errcode = '22023';
  end if;
  if p_channel not in ('hand', 'email', 'whatsapp', 'courier') then
    raise exception 'Canal d’envoi inconnu.' using errcode = '22023';
  end if;
  if p_sent_on is null or p_sent_on > (now() at time zone 'Africa/Dakar')::date
     or p_sent_on < (v_letter.issued_at at time zone 'Africa/Dakar')::date then
    raise exception 'Date d’envoi invalide (entre l’émission du courrier et aujourd’hui).' using errcode = '22023';
  end if;
  if p_proof_storage_path not like 'dossiers/' || v_letter.dossier_id || '/letter_sending_proof/%'
     or coalesce(p_proof_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Preuve d’envoi invalide.' using errcode = '22023';
  end if;

  insert into public.documents (
    dossier_id, client_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, visible_client
  ) values (
    v_letter.dossier_id, v_letter.client_id, 'letter_sending_proof', p_proof_storage_path,
    left(p_proof_file_name, 200), p_proof_mime_type, p_proof_size_bytes, p_proof_sha256, false
  ) returning id into v_proof_id;

  if v_letter.kind = 'formal_notice' then
    v_deadline := p_sent_on + v_letter.cure_days;
  end if;
  perform set_config('app.unclaimed_letter', 'on', true);
  update public.unclaimed_letters
    set status = 'sent', sent_at = p_sent_on::timestamp at time zone 'Africa/Dakar', sent_channel = p_channel,
        sent_note = nullif(trim(p_note), ''), sent_proof_document_id = v_proof_id, sent_by = auth.uid(),
        cure_deadline = v_deadline
    where id = p_letter_id;
  perform set_config('app.unclaimed_letter', 'off', true);
  update public.documents set visible_client = true where id = v_letter.document_id;

  v_label := case v_letter.kind
    when 'reminder' then 'Lettre de relance ' || v_letter.number || ' adressée le ' || public.format_date_fr(p_sent_on)
    else 'Mise en demeure ' || v_letter.number || ' adressée le ' || public.format_date_fr(p_sent_on)
      || ' : régularisation attendue au plus tard le ' || public.format_date_fr(v_deadline)
  end;
  perform public.add_dossier_event(v_letter.dossier_id, 'unclaimed_letter', v_label, true);
  perform public.enqueue_notification(
    v_letter.client_id, v_letter.dossier_id,
    case v_letter.kind when 'reminder' then 'unclaimed_reminder' else 'formal_notice' end,
    public.notification_dossier_vars(v_letter.dossier_id)
      || jsonb_build_object('numero', v_letter.number)
      || case when v_deadline is null then '{}'::jsonb
              else jsonb_build_object('date_limite', public.format_date_fr(v_deadline)) end,
    'unclaimed_letter:' || v_letter.id
  );
end;
$$;

revoke execute on function public.record_letter_sent(uuid, date, text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.record_letter_sent(uuid, date, text, text, text, text, text, bigint, text) to authenticated;

-- Annulation d'un courrier non envoyé (erreur de saisie), motif obligatoire ; le numéro reste consommé.
create function public.cancel_unclaimed_letter(p_letter_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_letter public.unclaimed_letters%rowtype;
begin
  if not public.is_recovery_writer() then
    raise exception 'Action réservée à l’administrateur, à la direction et à la comptabilité.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’annulation.' using errcode = '22023';
  end if;
  select * into v_letter from public.unclaimed_letters l where l.id = p_letter_id for update;
  if not found then
    raise exception 'Courrier introuvable.' using errcode = '22023';
  end if;
  if v_letter.status <> 'issued' then
    raise exception 'Seul un courrier non envoyé peut être annulé.' using errcode = '22023';
  end if;
  perform set_config('app.unclaimed_letter', 'on', true);
  update public.unclaimed_letters
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancelled_reason = trim(p_reason)
    where id = p_letter_id;
  perform set_config('app.unclaimed_letter', 'off', true);
  perform public.add_dossier_event(v_letter.dossier_id, 'unclaimed_letter',
    'Courrier ' || v_letter.number || ' annulé : ' || trim(p_reason), false);
end;
$$;

revoke execute on function public.cancel_unclaimed_letter(uuid, text) from public, anon;
grant execute on function public.cancel_unclaimed_letter(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Procédure (art. 22) : ouverte à l'échéance, après une mise en demeure envoyée dont le délai est expiré ;
-- le dossier passe à l'étape Clôture, statut « Non réclamé (procédure en cours) ». Clôture avec issue écrite.
-- ---------------------------------------------------------------------------
create function public.open_unclaimed_procedure(p_dossier_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dossier public.dossiers%rowtype;
  v_situation record;
  v_today date := (now() at time zone 'Africa/Dakar')::date;
begin
  if not public.is_procedure_writer() then
    raise exception 'Action réservée à l’administrateur et à la direction.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indiquez le motif de l’ouverture de la procédure.' using errcode = '22023';
  end if;
  select * into v_dossier from public.dossiers d where d.id = p_dossier_id for update;
  if not found or v_dossier.stage <> 'dakar' then
    raise exception 'La procédure concerne un dossier à l’étape Dakar.' using errcode = '22023';
  end if;
  select * into v_situation from public.unclaimed_overview(p_dossier_id);
  if v_situation.dossier_id is null or not v_situation.applies then
    raise exception 'Solde réglé et véhicule enlevé : aucune procédure possible.' using errcode = '22023';
  end if;
  if v_today < v_situation.procedure_possible_on then
    raise exception 'Procédure possible à partir du % (contrat art. 22).',
      public.format_date_fr(v_situation.procedure_possible_on) using errcode = '22023';
  end if;
  if v_situation.formal_notice_status is distinct from 'sent' or v_situation.cure_deadline >= v_today then
    raise exception 'Une mise en demeure envoyée, dont le délai de régularisation est expiré, est requise (art. 21).'
      using errcode = '22023';
  end if;
  insert into public.unclaimed_procedures (dossier_id, open_reason) values (p_dossier_id, trim(p_reason));
  perform set_config('app.stage_transition', 'on', true);
  update public.dossiers set stage = 'closing', status = 'unclaimed' where id = p_dossier_id;
  perform set_config('app.stage_transition', 'off', true);
  perform public.add_dossier_event(p_dossier_id, 'unclaimed_procedure',
    'Procédure « véhicule non réclamé » ouverte : ' || trim(p_reason)
      || '. Aucune appropriation automatique du véhicule (art. 22).', false);
end;
$$;

revoke execute on function public.open_unclaimed_procedure(uuid, text) from public, anon;
grant execute on function public.open_unclaimed_procedure(uuid, text) to authenticated;

create function public.close_unclaimed_procedure(p_dossier_id uuid, p_outcome text, p_closing_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_procedure public.unclaimed_procedures%rowtype;
begin
  if not public.is_procedure_writer() then
    raise exception 'Action réservée à l’administrateur et à la direction.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_outcome)), 0) < 5 then
    raise exception 'Décrivez l’issue de la procédure.' using errcode = '22023';
  end if;
  if p_closing_status not in ('completed', 'archived', 'claim', 'dispute', 'suspended') then
    raise exception 'Statut de clôture inconnu.' using errcode = '22023';
  end if;
  select * into v_procedure from public.unclaimed_procedures p where p.dossier_id = p_dossier_id for update;
  if not found or v_procedure.closed_at is not null then
    raise exception 'Aucune procédure en cours pour ce dossier.' using errcode = '22023';
  end if;
  update public.unclaimed_procedures
    set closed_at = now(), closed_by = auth.uid(), outcome = trim(p_outcome), closing_status = p_closing_status
    where id = v_procedure.id;
  update public.dossiers set status = p_closing_status where id = p_dossier_id and stage = 'closing';
  perform public.add_dossier_event(p_dossier_id, 'unclaimed_procedure',
    'Procédure « véhicule non réclamé » clôturée : ' || trim(p_outcome), false);
end;
$$;

revoke execute on function public.close_unclaimed_procedure(uuid, text, text) from public, anon;
grant execute on function public.close_unclaimed_procedure(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit et RLS : internes en lecture ; le client lit ses courriers une fois envoyés ; écritures par les fonctions.
-- ---------------------------------------------------------------------------
create trigger unclaimed_letters_audit after insert or update on public.unclaimed_letters
  for each row execute function public.audit_row('id');
create trigger unclaimed_procedures_audit after insert or update on public.unclaimed_procedures
  for each row execute function public.audit_row('id');

alter table public.unclaimed_letters enable row level security;
alter table public.unclaimed_procedures enable row level security;

create policy unclaimed_letters_select on public.unclaimed_letters for select to authenticated
  using (
    (select public.is_internal())
    or (status = 'sent' and client_id = (select public.current_client_id()))
  );
create policy unclaimed_procedures_select on public.unclaimed_procedures for select to authenticated
  using ((select public.is_internal()));

revoke all on public.unclaimed_letters, public.unclaimed_procedures from anon;
revoke insert, update, delete, truncate on public.unclaimed_letters, public.unclaimed_procedures from authenticated;
