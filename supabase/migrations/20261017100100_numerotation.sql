-- Phase 1 — numérotation continue, par type et par année, sans trou (règle R3, décision B3).
-- Le numéro est attribué dans la même transaction que l’émission du document : si l’émission échoue,
-- l’incrément est annulé avec elle. Le verrou de ligne posé par l’upsert sérialise les émissions concurrentes.

create table public.number_sequences (
  doc_type text not null,            -- dossier, quote, deposit_invoice, balance_invoice, cash_receipt, refund_note
  year int not null check (year between 2000 and 2999),
  last_value int not null default 0 check (last_value >= 0),
  primary key (doc_type, year)
);

comment on table public.number_sequences is 'Compteurs de numérotation (UC/DV/FA/FS/RC/RB-AAAA-####), remis à zéro chaque année.';

alter table public.number_sequences enable row level security;
-- Aucune politique : table inaccessible par l’API ; seule la fonction next_number y écrit.
revoke all on public.number_sequences from anon, authenticated;

-- Format « UC-{YYYY}-{####} » → « UC-2026-0001 » (au-delà de 9999 : 5 chiffres, sans troncature).
create function public.format_document_number(p_pattern text, p_year int, p_value int) returns text
language sql immutable set search_path = '' as $$
  select replace(
    replace(p_pattern, '{YYYY}', p_year::text),
    '{####}',
    lpad(p_value::text, greatest(4, length(p_value::text)), '0')
  );
$$;

create function public.next_number(p_doc_type text, p_year int default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_year int := coalesce(p_year, extract(year from (now() at time zone 'Africa/Dakar'))::int);
  v_pattern text;
  v_value int;
begin
  if auth.uid() is not null and not public.is_internal() then
    raise exception 'Numérotation réservée aux utilisateurs internes.' using errcode = '42501';
  end if;

  v_pattern := public.setting_value('numbering.' || p_doc_type) #>> '{}';
  if v_pattern is null then
    raise exception 'Format de numérotation inconnu pour « % ».', p_doc_type using errcode = '22023';
  end if;

  insert into public.number_sequences as ns (doc_type, year, last_value)
  values (p_doc_type, v_year, 1)
  on conflict (doc_type, year) do update set last_value = ns.last_value + 1
  returning ns.last_value into v_value;

  return public.format_document_number(v_pattern, v_year, v_value);
end;
$$;

revoke execute on function public.next_number(text, int) from public, anon;
grant execute on function public.next_number(text, int) to authenticated;
