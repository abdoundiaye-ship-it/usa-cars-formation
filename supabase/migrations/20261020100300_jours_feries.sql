-- Décision du 20/10/2026 : les délais en jours ouvrés (remboursements C9, remise des documents R9) excluent les
-- week-ends ET les jours fériés au Sénégal. Calendrier tenu par l'administrateur : les fêtes religieuses à date
-- lunaire (Tamkharit, Maouloud, Korité, Tabaski, Grand Magal de Touba) sont saisies chaque année à leur annonce.

create table public.public_holidays (
  day date primary key,
  label text not null check (length(trim(label)) > 1),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.public_holidays is
  'Jours fériés au Sénégal (jours ouvrés : remboursements, remise des documents) ; tenus par l’administrateur.';

-- Fêtes à date fixe et fêtes liées à Pâques (calculables) pour 2026 et 2027.
insert into public.public_holidays (day, label) values
  ('2026-01-01', 'Jour de l’An'),
  ('2026-04-04', 'Fête de l’Indépendance'),
  ('2026-04-06', 'Lundi de Pâques'),
  ('2026-05-01', 'Fête du Travail'),
  ('2026-05-14', 'Ascension'),
  ('2026-05-25', 'Lundi de Pentecôte'),
  ('2026-08-15', 'Assomption'),
  ('2026-11-01', 'Toussaint'),
  ('2026-12-25', 'Noël'),
  ('2027-01-01', 'Jour de l’An'),
  ('2027-03-29', 'Lundi de Pâques'),
  ('2027-04-04', 'Fête de l’Indépendance'),
  ('2027-05-01', 'Fête du Travail'),
  ('2027-05-06', 'Ascension'),
  ('2027-05-17', 'Lundi de Pentecôte'),
  ('2027-08-15', 'Assomption'),
  ('2027-11-01', 'Toussaint'),
  ('2027-12-25', 'Noël')
on conflict (day) do nothing;

-- Jours ouvrés : du lundi au vendredi, hors jours fériés (Africa/Dakar = UTC). Remplace la version du lot 3c.
create or replace function public.add_business_days(p_from timestamptz, p_days int) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  v_at timestamptz := p_from;
  v_left int := greatest(p_days, 0);
  v_day date;
begin
  while v_left > 0 loop
    v_at := v_at + interval '1 day';
    v_day := (v_at at time zone 'Africa/Dakar')::date;
    if extract(isodow from v_day) < 6
       and not exists (select 1 from public.public_holidays h where h.day = v_day) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_at;
end;
$$;

create trigger public_holidays_audit after insert or delete on public.public_holidays
  for each row execute function public.audit_row('day');

alter table public.public_holidays enable row level security;

-- Internes L ; administrateur E (ajout, suppression d'une date saisie par erreur).
create policy public_holidays_select on public.public_holidays for select to authenticated
  using ((select public.is_internal()));
create policy public_holidays_insert on public.public_holidays for insert to authenticated
  with check ((select public.current_role_app()) = 'admin');
create policy public_holidays_delete on public.public_holidays for delete to authenticated
  using ((select public.current_role_app()) = 'admin');

revoke all on public.public_holidays from anon;
revoke update, truncate on public.public_holidays from authenticated;
