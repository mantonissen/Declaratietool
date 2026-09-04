-- Abonnementen: repeterende facturen per maand, kwartaal of jaar (keuze B5c).
--
-- Een abonnementsproject genereert per periode automatisch een termijn. Staat
-- automatisch factureren aan, dan krijgt die termijn meteen een nummer uit de
-- factuurreeks en is hij gefactureerd; anders verschijnt hij als open termijn
-- in het factuurvoorstel. De uren op zo'n project gedragen zich als bij een
-- vaste prijs: geen omzet, wel kosten, en ze gaan als verantwoording mee.
--
-- verwerk_periodieke_facturen() is idempotent: per project en periode komt er
-- hooguit één termijn. Hij mag dus zo vaak draaien als je wilt — dagelijks
-- via cron, en daarnaast telkens als de eigenaar het factuurscherm opent.

alter type facturatiemodel add value if not exists 'abonnement';
create type herhaal_interval as enum ('maand', 'kwartaal', 'jaar');

alter table project
  add column herhaal_interval       herhaal_interval,
  add column herhaal_bedrag         numeric(12,2) check (herhaal_bedrag >= 0),
  add column herhaal_omschrijving   text,
  add column herhaal_start          date,
  add column herhaal_einde          date,
  add column herhaal_volgende       date,
  add column automatisch_factureren boolean not null default true,
  add constraint project_herhaal_periode_ok
    check (herhaal_einde is null or herhaal_start is null or herhaal_einde >= herhaal_start);

comment on column project.herhaal_volgende is
  'Eerste dag van de eerstvolgende periode waarvoor nog geen termijn is aangemaakt.';

alter table termijn
  add column periode_start date,
  add column periode_einde date,
  add column automatisch   boolean not null default false,
  add column verwerkt_op   timestamptz;

comment on column termijn.verwerkt_op is
  'Wanneer de eigenaar een automatische factuur in de boekhouding heeft overgenomen.';

-- Per project en periode hooguit één gegenereerde termijn.
create unique index termijn_periode_uniek on termijn (project_id, periode_start)
  where periode_start is not null;

-- ------------------------------------------------------- factuurnummers ----

alter table instellingen
  add column factuur_prefix     text not null default '',
  add column factuur_jaar       integer,
  add column factuur_volgnummer integer not null default 0;

-- JJJJ-NNN, per jaar opnieuw vanaf 001. Handmatig ingevoerde nummers in
-- dezelfde vorm schuiven de teller mee (zie noteer_factuurnummer), zodat
-- automatische facturen nooit een gebruikt nummer krijgen.
create or replace function volgend_factuurnummer()
returns text
language plpgsql
set search_path = public
as $$
declare
  j   integer := extract(year from current_date);
  n   integer;
  pf  text;
  ref text;
begin
  -- Nummers die al in gebruik zijn worden overgeslagen, ook als ze buiten
  -- de teller om zijn gezet (import, SQL, een oud systeem).
  loop
    update instellingen
    set factuur_jaar = j,
        factuur_volgnummer = case when factuur_jaar is distinct from j then 1
                                  else factuur_volgnummer + 1 end
    where id
    returning factuur_volgnummer, factuur_prefix into n, pf;
    ref := pf || j || '-' || lpad(n::text, 3, '0');
    exit when not exists (select 1 from urenregel where factuur_referentie = ref)
         and not exists (select 1 from rit where factuur_referentie = ref)
         and not exists (select 1 from termijn where factuur_referentie = ref);
  end loop;
  return ref;
end;
$$;

create or replace function noteer_factuurnummer(p_referentie text)
returns void
language plpgsql
set search_path = public
as $$
declare
  pf text;
  m  text[];
begin
  select factuur_prefix into pf from instellingen where id;
  m := regexp_match(p_referentie, '^' || regexp_replace(pf, '([^a-zA-Z0-9])', '\\\1', 'g')
                                     || '(\d{4})-(\d+)$');
  if m is null then return; end if;
  update instellingen
  set factuur_jaar = m[1]::integer,
      factuur_volgnummer = case when factuur_jaar is distinct from m[1]::integer
                                then m[2]::integer
                                else greatest(factuur_volgnummer, m[2]::integer) end
  where id;
end;
$$;

-- --------------------------------------------------------------- periodes --

create or replace function herhaal_stap(p herhaal_interval)
returns interval
language sql
immutable
as $$
  select case p when 'maand' then interval '1 month'
                when 'kwartaal' then interval '3 months'
                else interval '1 year' end;
$$;

create or replace function periode_label(p herhaal_interval, d date)
returns text
language sql
immutable
as $$
  select case p
    when 'maand' then
      (array['januari','februari','maart','april','mei','juni','juli','augustus',
             'september','oktober','november','december'])[extract(month from d)::int]
      || ' ' || extract(year from d)::int
    when 'kwartaal' then
      'Q' || extract(quarter from d)::int || ' ' || extract(year from d)::int
    else extract(year from d)::int::text
  end;
$$;

-- ------------------------------------------------------- verwerking --------

create or replace function verwerk_periodieke_facturen()
returns table (uit_project_id uuid, uit_termijn_id uuid, uit_periode_start date, uit_referentie text)
language plpgsql
set search_path = public
as $$
declare
  p     record;
  vlg   date;
  einde date;
  t_id  uuid;
  ref   text;
begin
  for p in
    select * from project
    where facturatiemodel::text = 'abonnement'
      and status = 'actief'
      and herhaal_interval is not null
      and herhaal_bedrag is not null
      and herhaal_volgende is not null
      and herhaal_volgende <= current_date
    order by herhaal_volgende
  loop
    vlg := p.herhaal_volgende;

    -- Inhalen tot vandaag: een project dat een tijd stil heeft gestaan
    -- krijgt alle gemiste periodes alsnog, elk apart.
    while vlg <= current_date
      and (p.herhaal_einde is null or vlg <= p.herhaal_einde)
    loop
      einde := (vlg + herhaal_stap(p.herhaal_interval) - interval '1 day')::date;
      t_id := null;

      insert into termijn
        (project_id, volgorde, omschrijving, bedrag, gepland_op,
         periode_start, periode_einde, automatisch)
      values
        (p.id,
         coalesce((select max(volgorde) + 1 from termijn where termijn.project_id = p.id), 1),
         coalesce(nullif(btrim(p.herhaal_omschrijving), ''), 'Abonnement')
           || ' · ' || periode_label(p.herhaal_interval, vlg),
         p.herhaal_bedrag, vlg, vlg, einde, true)
      on conflict (project_id, periode_start) where periode_start is not null do nothing
      returning id into t_id;

      if t_id is not null then
        ref := null;
        if p.automatisch_factureren then
          ref := volgend_factuurnummer();
          update termijn
          set factuur_referentie = ref, gefactureerd_op = now()
          where id = t_id;

          -- De goedgekeurde uren van vóór deze periode gaan als
          -- verantwoording mee op deze factuur en zijn dan op slot.
          update urenregel u
          set status = 'gefactureerd', factuur_referentie = ref
          from projectonderdeel o
          where o.id = u.onderdeel_id
            and o.project_id = p.id
            and u.datum < vlg
            and u.status = 'goedgekeurd'
            and u.factuur_referentie is null;
        end if;

        uit_project_id := p.id; uit_termijn_id := t_id;
        uit_periode_start := vlg; uit_referentie := ref;
        return next;
      end if;

      vlg := (vlg + herhaal_stap(p.herhaal_interval))::date;
    end loop;

    update project set herhaal_volgende = vlg where id = p.id;
  end loop;
end;
$$;

comment on function verwerk_periodieke_facturen() is
  'Maakt termijnen (en bij automatisch factureren facturen) aan voor alle abonnementen tot en met vandaag. Idempotent.';

-- ------------------------------------------------------------ v_urenregel --

-- Ook uren op een abonnement leveren zelf geen omzet op.
create or replace view v_urenregel with (security_invoker = true) as
select
  u.id,
  u.medewerker_id,
  m.naam            as medewerker,
  u.onderdeel_id,
  o.naam            as onderdeel,
  o.project_id,
  p.naam            as project,
  p.klant_id,
  k.naam            as klant,
  u.datum,
  extract(isoyear from u.datum)::smallint as jaar,
  extract(week    from u.datum)::smallint as week,
  u.minuten,
  round(u.minuten / 60.0, 4) as uren,
  u.omschrijving,
  (u.declarabel and o.declarabel) as declarabel,
  u.status,
  u.bevroren_op is not null as bevroren,
  bv.verkooptarief                                                as verkooptarief,
  bk.kostprijs                                                    as kostprijs,
  case when p.facturatiemodel::text in ('vaste_prijs', 'abonnement') then 0
       when u.declarabel and o.declarabel
       then round(u.minuten / 60.0 * bv.verkooptarief, 2)
       else 0
  end as omzet,
  round(u.minuten / 60.0 * bk.kostprijs, 2) as kosten,
  p.facturatiemodel::text as facturatiemodel
from urenregel u
join projectonderdeel o on o.id = u.onderdeel_id
join project          p on p.id = o.project_id
join klant            k on k.id = p.klant_id
join medewerker       m on m.id = u.medewerker_id
left join lateral (
  select coalesce(
    (select verkooptarief from bevroren_verkoop where urenregel_id = u.id),
    u.tarief_handmatig,
    tarief_voor(u.onderdeel_id, u.medewerker_id, u.datum)
  ) as verkooptarief
) bv on true
left join lateral (
  select coalesce(
    (select kostprijs from bevroren_kosten where urenregel_id = u.id),
    kostprijs_voor(u.medewerker_id, u.datum)
  ) as kostprijs
) bk on true
where u.status <> 'vervallen';

grant execute on all functions in schema public to authenticated;
