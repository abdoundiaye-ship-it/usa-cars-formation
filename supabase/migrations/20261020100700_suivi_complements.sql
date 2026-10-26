-- Phase 5, lot 5a — compléments du suivi (US-5.1, US-5.2, R10, R12) et décision U1.

-- ---------------------------------------------------------------------------
-- Transporteurs : état de l'accès API (cahier des charges §5.1 ; décision F2-a : liens seulement pour l'instant).
-- ---------------------------------------------------------------------------
alter table public.carriers
  add column api_status text not null default 'non_etudie'
    check (api_status in ('non_etudie', 'non_verifie', 'demande', 'obtenu', 'refuse'));

comment on column public.carriers.api_status is
  'État de l’accès API du transporteur : non étudié, non vérifié, demandé, obtenu, refusé (aucun connecteur sans accès, F2-a).';

-- ---------------------------------------------------------------------------
-- Événements de suivi saisis par un agent : source « saisie manuelle » ou « lien du transporteur » (R12) ;
-- la source « api » est réservée aux futurs connecteurs (US-5.4).
-- ---------------------------------------------------------------------------
drop policy tracking_events_insert on public.tracking_events;
create policy tracking_events_insert on public.tracking_events for insert to authenticated
  with check (
    (select public.is_operations_writer())
    and kind in ('transshipment', 'delay', 'note')
    and source in ('manual', 'carrier_link')
    and created_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Information du client sur l'arrivée (contrat art. 17, `arrival.notify_within_hours`) : si le message
-- automatique n'est pas parti (WhatsApp simulé, aucun canal, échec), l'agent enregistre l'information donnée
-- autrement (téléphone, en personne…) ; l'alerte du tableau de bord disparaît alors.
-- ---------------------------------------------------------------------------
alter table public.dossier_events drop constraint dossier_events_kind_check;
alter table public.dossier_events add constraint dossier_events_kind_check check (kind in (
  'opened', 'status_changed', 'stage_changed', 'contract_generated', 'purchase_order_generated',
  'acceptance_recorded', 'auction_result', 'confirmation', 'stage_exception', 'cancelled', 'document_added', 'note',
  'container_assigned', 'container_changed', 'eta_changed', 'tracking_event',
  'financial_document', 'payment_recorded', 'adjustment', 'refund', 'arrival_notified'
));

create function public.record_arrival_notice(p_dossier_id uuid, p_channel text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_channel_label text;
begin
  if not public.is_operations_writer() then
    raise exception 'Réservé à l’administrateur et aux agents opérations.' using errcode = '42501';
  end if;
  v_channel_label := case p_channel
    when 'phone' then 'par téléphone'
    when 'whatsapp' then 'par WhatsApp'
    when 'email' then 'par e-mail'
    when 'in_person' then 'en personne'
    else null
  end;
  if v_channel_label is null then
    raise exception 'Moyen d’information inconnu.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.dossier_containers dc
    join public.containers c on c.id = dc.container_id
    where dc.dossier_id = p_dossier_id and dc.removed_at is null and c.ata is not null
  ) then
    raise exception 'Le conteneur de ce dossier n’est pas encore arrivé (ATA non saisie).' using errcode = '22023';
  end if;
  perform public.add_dossier_event(
    p_dossier_id, 'arrival_notified',
    'Client informé de l’arrivée ' || v_channel_label
      || coalesce(' : ' || nullif(trim(p_note), ''), ''),
    false
  );
end;
$$;

revoke execute on function public.record_arrival_notice(uuid, text, text) from public, anon;
grant execute on function public.record_arrival_notice(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Décision U1 du 20/10/2026 : délais de la procédure « véhicule non réclamé » confirmés (contrat art. 21–22).
-- Nouvelles versions datées (les versions initiales restent dans l'historique ; règle X7, CLAUDE.md règle 4).
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, value_type, status, source, reason, effective_from) values
  ('unclaimed.reminder_days_after_arrival', '30'::jsonb, 'integer', 'confirme', 'Décision U1 du 20/10/2026',
   'Relance écrite au plus tard 30 jours après l’arrivée (contrat art. 22).', '2026-10-20T00:00:00Z'),
  ('unclaimed.formal_notice_days_after_arrival', '60'::jsonb, 'integer', 'confirme', 'Décision U1 du 20/10/2026',
   'Mise en demeure au plus tard 60 jours après l’arrivée (contrat art. 22).', '2026-10-20T00:00:00Z'),
  ('unclaimed.formal_notice_min_cure_days', '15'::jsonb, 'integer', 'confirme', 'Décision U1 du 20/10/2026',
   'Délai de régularisation d’au moins 15 jours (contrat art. 21).', '2026-10-20T00:00:00Z')
on conflict (key, effective_from) do nothing;
