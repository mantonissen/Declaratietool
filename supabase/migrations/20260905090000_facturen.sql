-- Echte facturen uit de tool (keuze E2 van a naar c), voorbereid op een
-- koppeling met een boekhoudpakket (E2b).
--
-- Tot nu toe was een factuur een referentie op regels. Vanaf hier is het een
-- eigen document: een factuur met factuurregels, elk met btw-code en
-- grootboekrekening, zodat de boekhouding ze straks zonder handwerk kan
-- inlezen. De referentie op uren, ritten en termijnen blijft bestaan als
-- het factuurnummer; daarnaast komt een echte verwijzing (factuur_id).
--
-- Levensloop: concept (regels bewerkbaar, nog geen nummer) -> definitief
-- (nummer uit de reeks, totalen vast, regels op slot) -> betaald, of
-- gecrediteerd (een creditfactuur met omgekeerde regels).

-- ------------------------------------------------------------------ btw ----

create table btw_tarief (
  code         text primary key,
  omschrijving text not null,
  percentage   numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  sortering    smallint not null default 0,
  actief       boolean not null default true
);

insert into btw_tarief (code, omschrijving, percentage, sortering) values
  ('hoog',        'Hoog tarief',            21.00, 1),
  ('laag',        'Laag tarief',             9.00, 2),
  ('nul',         'Nultarief',               0.00, 3),
  ('verlegd',     'Btw verlegd',             0.00, 4),
  ('vrijgesteld', 'Vrijgesteld van btw',     0.00, 5);

alter table klant
  add column btw_code text not null default 'hoog' references btw_tarief (code);

comment on column klant.btw_code is
  'Btw-code voor facturen aan deze klant; per regel te overschrijven.';

-- ------------------------------------------------------------ grootboek ----

create type grootboek_soort as enum ('omzet', 'kosten', 'balans');

create table grootboekrekening (
  id       uuid primary key default gen_random_uuid(),
  nummer   text not null unique,
  naam     text not null check (length(btrim(naam)) > 0),
  soort    grootboek_soort not null default 'omzet',
  actief   boolean not null default true
);

comment on table grootboekrekening is
  'Grootboekrekeningen zoals het boekhoudpakket ze kent; elke factuurregel wijst er een aan.';

insert into grootboekrekening (nummer, naam) values
  ('8000', 'Omzet advies (uren)'),
  ('8010', 'Omzet reiskosten'),
  ('8020', 'Omzet vaste prijs'),
  ('8030', 'Omzet abonnementen'),
  ('8090', 'Overige omzet');

-- Standaardrekening per soort regel; per project te overschrijven voor de
-- hoofdomzet (uren, termijnen). Reiskosten houden hun eigen rekening.
alter table instellingen
  add column grootboek_uren       uuid references grootboekrekening (id),
  add column grootboek_reiskosten uuid references grootboekrekening (id),
  add column grootboek_termijn    uuid references grootboekrekening (id),
  add column grootboek_abonnement uuid references grootboekrekening (id),
  add column grootboek_overig     uuid references grootboekrekening (id),
  add column betaaltermijn_dagen  integer not null default 30 check (betaaltermijn_dagen between 0 and 365),
  add column factuur_voettekst    text;

update instellingen set
  grootboek_uren       = (select id from grootboekrekening where nummer = '8000'),
  grootboek_reiskosten = (select id from grootboekrekening where nummer = '8010'),
  grootboek_termijn    = (select id from grootboekrekening where nummer = '8020'),
  grootboek_abonnement = (select id from grootboekrekening where nummer = '8030'),
  grootboek_overig     = (select id from grootboekrekening where nummer = '8090')
where id;

alter table project
  add column grootboek_id uuid references grootboekrekening (id);

comment on column project.grootboek_id is
  'Overschrijft de standaardrekening voor de hoofdomzet van dit project.';

-- -------------------------------------------------------------- factuur ----

create type factuur_status as enum ('concept', 'definitief', 'betaald', 'gecrediteerd');
create type factuurregel_bron as enum ('uren', 'ritten', 'termijn', 'handmatig', 'credit');

create table factuur (
  id               uuid primary key default gen_random_uuid(),
  nummer           text unique,                     -- pas bij definitief
  status           factuur_status not null default 'concept',
  klant_id         uuid not null references klant (id) on delete restrict,
  project_id       uuid references project (id) on delete set null,
  datum            date,
  vervaldatum      date,
  referentie_klant text,
  opmerking        text,
  periode_van      date,
  periode_tot      date,
  subtotaal        numeric(12,2) not null default 0,
  btw_bedrag       numeric(12,2) not null default 0,
  totaal           numeric(12,2) not null default 0,
  betaald_op       date,
  credit_van_id    uuid references factuur (id),
  automatisch      boolean not null default false,
  verwerkt_op      timestamptz,                     -- overgenomen in de boekhouding
  geexporteerd_op  timestamptz,
  export_kenmerk   text,
  aangemaakt_door  uuid references medewerker (id) on delete set null,
  aangemaakt_op    timestamptz not null default now(),
  definitief_op    timestamptz,
  constraint factuur_nummer_bij_definitief
    check (status = 'concept' or nummer is not null),
  constraint factuur_periode_ok
    check (periode_tot is null or periode_van is null or periode_tot >= periode_van)
);

create index factuur_klant_idx on factuur (klant_id, datum);
create index factuur_project_idx on factuur (project_id);
create index factuur_status_idx on factuur (status);

comment on table factuur is
  'Factuurdocument. Concept is bewerkbaar en zonder nummer; definitief ligt vast.';

create table factuurregel (
  id               uuid primary key default gen_random_uuid(),
  factuur_id       uuid not null references factuur (id) on delete cascade,
  volgorde         smallint not null default 1,
  omschrijving     text not null check (length(btrim(omschrijving)) > 0),
  aantal           numeric(12,4) not null default 1,
  eenheid          text not null default 'stuk',
  prijs            numeric(12,4) not null default 0,
  bedrag           numeric(12,2) not null default 0,        -- excl. btw
  btw_code         text not null references btw_tarief (code),
  btw_percentage   numeric(5,2) not null,                    -- vastgezet bij aanmaken
  grootboek_id     uuid references grootboekrekening (id),
  grootboek_nummer text,                                     -- vastgezet bij aanmaken
  bron             factuurregel_bron not null default 'handmatig',
  onderdeel_id     uuid references projectonderdeel (id) on delete set null,
  termijn_id       uuid references termijn (id) on delete set null
);

create index factuurregel_factuur_idx on factuurregel (factuur_id, volgorde);

alter table urenregel add column factuur_id uuid references factuur (id) on delete set null;
alter table rit       add column factuur_id uuid references factuur (id) on delete set null;
alter table termijn   add column factuur_id uuid references factuur (id) on delete set null;
create index urenregel_factuur_id_idx on urenregel (factuur_id) where factuur_id is not null;
create index rit_factuur_id_idx       on rit (factuur_id) where factuur_id is not null;
create index termijn_factuur_id_idx   on termijn (factuur_id) where factuur_id is not null;

-- --------------------------------------------------------------- sloten ----

-- Een definitieve factuur wijzigt niet meer; alleen de status mag door
-- (betaald, gecrediteerd) en de boekhoudvelden mogen worden ingevuld.
create or replace function blokkeer_definitieve_factuur()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'concept'
     and (new.nummer      is distinct from old.nummer
       or new.klant_id    is distinct from old.klant_id
       or new.project_id  is distinct from old.project_id
       or new.datum       is distinct from old.datum
       or new.vervaldatum is distinct from old.vervaldatum
       or new.subtotaal   is distinct from old.subtotaal
       or new.btw_bedrag  is distinct from old.btw_bedrag
       or new.totaal      is distinct from old.totaal
       or new.periode_van is distinct from old.periode_van
       or new.periode_tot is distinct from old.periode_tot)
  then
    raise exception 'Factuur % is definitief en kan niet meer gewijzigd worden.', old.nummer
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger factuur_slot before update on factuur
  for each row execute function blokkeer_definitieve_factuur();

create or replace function blokkeer_regel_van_definitieve_factuur()
returns trigger
language plpgsql
as $$
declare s factuur_status;
begin
  select status into s from factuur where id = coalesce(new.factuur_id, old.factuur_id);
  if s is distinct from 'concept' then
    raise exception 'De regels van een definitieve factuur liggen vast.'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger factuurregel_slot before insert or update or delete on factuurregel
  for each row execute function blokkeer_regel_van_definitieve_factuur();

-- Een concept mag verdwijnen; een definitieve factuur nooit.
create or replace function blokkeer_verwijderen_factuur()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'concept' then
    raise exception 'Factuur % is definitief en kan niet verwijderd worden.', old.nummer
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger factuur_verwijderslot before delete on factuur
  for each row execute function blokkeer_verwijderen_factuur();

-- ------------------------------------------------------------- rechten -----

alter table btw_tarief        enable row level security;
alter table grootboekrekening enable row level security;
alter table factuur           enable row level security;
alter table factuurregel      enable row level security;

create policy btw_lezen on btw_tarief for select to authenticated using (true);
create policy btw_beheren on btw_tarief for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());
create policy grootboek_lezen on grootboekrekening for select to authenticated using (true);
create policy grootboek_beheren on grootboekrekening for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());

-- Facturen: bedragen zijn verkoop, dus leesbaar vanaf projectleider; maken
-- en wijzigen doet de eigenaar.
create policy factuur_lezen on factuur for select to authenticated
  using (minstens('projectleider'));
create policy factuur_beheren on factuur for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());
create policy factuurregel_lezen on factuurregel for select to authenticated
  using (minstens('projectleider'));
create policy factuurregel_beheren on factuurregel for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());

grant select, insert, update, delete on btw_tarief, grootboekrekening, factuur, factuurregel
  to authenticated;

-- ------------------------------------------------------------ opbouwen -----

-- Welke rekening hoort bij een regel: de projectoverschrijving voor de
-- hoofdomzet, anders de standaard per soort.
create or replace function grootboek_voor(p_project uuid, p_bron factuurregel_bron)
returns uuid
language sql
stable
set search_path = public
as $$
  select case
    when p_bron in ('uren', 'termijn') and p.grootboek_id is not null then p.grootboek_id
    when p_bron = 'uren' then i.grootboek_uren
    when p_bron = 'ritten' then i.grootboek_reiskosten
    when p_bron = 'termijn' and p.facturatiemodel::text = 'abonnement' then i.grootboek_abonnement
    when p_bron = 'termijn' then i.grootboek_termijn
    else i.grootboek_overig
  end
  from instellingen i
  left join project p on p.id = p_project;
$$;

-- Totalen opnieuw uitrekenen uit de regels. Btw per regel afgerond, zoals
-- de meeste pakketten het doen.
create or replace function herbereken_factuur(p_factuur uuid)
returns void
language sql
set search_path = public
as $$
  update factuur f set
    subtotaal  = coalesce((select sum(bedrag) from factuurregel where factuur_id = f.id), 0),
    btw_bedrag = coalesce((select sum(round(bedrag * btw_percentage / 100, 2))
                             from factuurregel where factuur_id = f.id), 0),
    totaal     = coalesce((select sum(bedrag) + sum(round(bedrag * btw_percentage / 100, 2))
                             from factuurregel where factuur_id = f.id), 0)
  where f.id = p_factuur;
$$;

-- Eén factuurregel toevoegen met de juiste btw en rekening.
create or replace function voeg_factuurregel_toe(
  p_factuur      uuid,
  p_omschrijving text,
  p_aantal       numeric,
  p_eenheid      text,
  p_prijs        numeric,
  p_bedrag       numeric,
  p_bron         factuurregel_bron,
  p_onderdeel    uuid default null,
  p_termijn      uuid default null,
  p_btw_code     text default null,
  p_grootboek    uuid default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  f      record;
  v_code text;
  v_gb   uuid;
  v_id   uuid;
begin
  select * into f from factuur where id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  v_code := coalesce(p_btw_code, (select k.btw_code from klant k where k.id = f.klant_id), 'hoog');
  v_gb   := coalesce(p_grootboek, grootboek_voor(f.project_id, p_bron));

  insert into factuurregel
    (factuur_id, volgorde, omschrijving, aantal, eenheid, prijs, bedrag,
     btw_code, btw_percentage, grootboek_id, grootboek_nummer, bron, onderdeel_id, termijn_id)
  values
    (p_factuur,
     coalesce((select max(fr.volgorde) + 1 from factuurregel fr where fr.factuur_id = p_factuur), 1),
     p_omschrijving, p_aantal, p_eenheid, p_prijs, round(p_bedrag, 2),
     v_code, (select b.percentage from btw_tarief b where b.code = v_code),
     v_gb, (select g.nummer from grootboekrekening g where g.id = v_gb),
     p_bron, p_onderdeel, p_termijn)
  returning id into v_id;

  perform herbereken_factuur(p_factuur);
  return v_id;
end;
$$;

-- Bouwt een conceptfactuur voor een project: uren en ritten uit de periode
-- (nacalculatie), de gekozen termijnen (vaste prijs, abonnement), en bij de
-- twee laatste de goedgekeurde uren uit de periode als verantwoording zonder
-- regel. Alles wat op de factuur komt krijgt factuur_id en telt daarna niet
-- meer mee als te factureren.
create or replace function maak_factuur(
  p_project    uuid,
  p_van        date,
  p_tot        date,
  p_termijnen  uuid[],
  p_reiskosten boolean,
  p_door       uuid default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  p     record;
  f_id  uuid;
  rij   record;
  n     integer := 0;
  lbl   text;
begin
  select pr.*, k.btw_code, k.factuur_referentie as klantref
    into p
  from project pr join klant k on k.id = pr.klant_id
  where pr.id = p_project;
  if p is null then raise exception 'Project niet gevonden.'; end if;

  insert into factuur (klant_id, project_id, periode_van, periode_tot,
                       referentie_klant, aangemaakt_door)
  values (p.klant_id, p.id, p_van, p_tot, p.klantref, p_door)
  returning id into f_id;

  lbl := to_char(p_van, 'DD-MM-YYYY') || ' t/m ' || to_char(p_tot, 'DD-MM-YYYY');

  -- Uren: alleen bij nacalculatie een regel per onderdeel en tarief.
  if p.facturatiemodel::text = 'nacalculatie' then
    for rij in
      select v.onderdeel_id, v.onderdeel, v.verkooptarief,
             sum(v.uren) as uren, sum(v.omzet) as omzet
      from v_urenregel v join urenregel u on u.id = v.id
      where v.project_id = p.id
        and v.datum between p_van and p_tot
        and v.status = 'goedgekeurd'
        and u.factuur_id is null
        and v.declarabel
      group by v.onderdeel_id, v.onderdeel, v.verkooptarief
      order by v.onderdeel
    loop
      perform voeg_factuurregel_toe(
        f_id, rij.onderdeel || ' (' || lbl || ')', rij.uren, 'uur',
        coalesce(rij.verkooptarief, 0), coalesce(rij.omzet, 0), 'uren', rij.onderdeel_id);
      n := n + 1;
    end loop;
  end if;

  -- Alle goedgekeurde uren uit de periode hangen aan deze factuur: als regel
  -- (nacalculatie) of als verantwoording (vaste prijs, abonnement).
  update urenregel u set factuur_id = f_id
  from projectonderdeel o
  where o.id = u.onderdeel_id and o.project_id = p.id
    and u.datum between p_van and p_tot
    and u.status = 'goedgekeurd' and u.factuur_id is null;

  -- Reiskosten: per kilometertarief één regel.
  if p_reiskosten then
    for rij in
      select v.km_tarief, sum(v.totaal_km) as km, sum(v.km_bedrag) as bedrag
      from v_rit v join rit r on r.id = v.id
      where v.project_id = p.id
        and v.datum between p_van and p_tot
        and v.status = 'goedgekeurd' and v.declarabel
        and r.factuur_id is null
      group by v.km_tarief
    loop
      perform voeg_factuurregel_toe(
        f_id, 'Reiskosten (' || lbl || ')', rij.km, 'km',
        coalesce(rij.km_tarief, 0), coalesce(rij.bedrag, 0), 'ritten');
      n := n + 1;
    end loop;
    update rit set factuur_id = f_id
    where project_id = p.id and datum between p_van and p_tot
      and status = 'goedgekeurd' and declarabel and factuur_id is null;
  end if;

  -- Termijnen.
  for rij in
    select t.* from termijn t
    where t.project_id = p.id and t.id = any(p_termijnen) and t.factuur_id is null
    order by t.volgorde
  loop
    perform voeg_factuurregel_toe(
      f_id, rij.omschrijving, 1, 'stuk', rij.bedrag, rij.bedrag, 'termijn', null, rij.id);
    update termijn set factuur_id = f_id where id = rij.id;
    n := n + 1;
  end loop;

  if n = 0 then
    delete from factuur where id = f_id;
    raise exception 'Er stond niets te factureren in deze selectie.';
  end if;

  return f_id;
end;
$$;

-- Definitief: nummer uit de reeks, datums, totalen vast, en alles wat
-- eraan hangt op gefactureerd.
create or replace function maak_definitief(p_factuur uuid, p_datum date default current_date)
returns text
language plpgsql
set search_path = public
as $$
declare
  f     record;
  nr    text;
  dagen integer;
begin
  select * into f from factuur where id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  if f.status <> 'concept' then raise exception 'Factuur % is al definitief.', f.nummer; end if;
  if not exists (select 1 from factuurregel where factuur_id = p_factuur) then
    raise exception 'Een factuur zonder regels kan niet definitief worden.';
  end if;

  perform herbereken_factuur(p_factuur);
  nr := volgend_factuurnummer();
  select betaaltermijn_dagen into dagen from instellingen where id;

  update factuur set
    nummer = nr, status = 'definitief', datum = p_datum,
    vervaldatum = p_datum + coalesce(dagen, 30), definitief_op = now()
  where id = p_factuur;

  update urenregel set status = 'gefactureerd', factuur_referentie = nr
  where factuur_id = p_factuur and status <> 'vervallen';
  update rit set status = 'gefactureerd', factuur_referentie = nr
  where factuur_id = p_factuur and status <> 'vervallen';
  update termijn set factuur_referentie = nr, gefactureerd_op = now()
  where factuur_id = p_factuur;

  return nr;
end;
$$;

-- Een concept weggooien geeft alles wat eraan hing weer vrij.
create or replace function verwijder_concept(p_factuur uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if (select status from factuur where id = p_factuur) <> 'concept' then
    raise exception 'Alleen een conceptfactuur kan worden verwijderd.';
  end if;
  update urenregel set factuur_id = null where factuur_id = p_factuur;
  update rit       set factuur_id = null where factuur_id = p_factuur;
  update termijn   set factuur_id = null where factuur_id = p_factuur;
  delete from factuurregel where factuur_id = p_factuur;
  delete from factuur where id = p_factuur;
end;
$$;

-- Creditfactuur: dezelfde regels met omgekeerd teken, meteen definitief.
-- De uren blijven gefactureerd; klopt het aantal uren niet, dan is de
-- correctieregel (tegenboeking) de weg.
create or replace function crediteer_factuur(p_factuur uuid, p_reden text, p_door uuid default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  f    record;
  c_id uuid;
  rij  record;
begin
  select * into f from factuur where id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  if f.status not in ('definitief', 'betaald') then
    raise exception 'Alleen een definitieve factuur kan worden gecrediteerd.';
  end if;

  insert into factuur (klant_id, project_id, periode_van, periode_tot, referentie_klant,
                       opmerking, credit_van_id, aangemaakt_door)
  values (f.klant_id, f.project_id, f.periode_van, f.periode_tot, f.referentie_klant,
          'Creditfactuur bij ' || f.nummer || coalesce(': ' || p_reden, ''), f.id, p_door)
  returning id into c_id;

  for rij in select * from factuurregel where factuur_id = p_factuur order by volgorde loop
    perform voeg_factuurregel_toe(
      c_id, rij.omschrijving, -rij.aantal, rij.eenheid, rij.prijs, -rij.bedrag,
      'credit', rij.onderdeel_id, null, rij.btw_code, rij.grootboek_id);
  end loop;

  perform maak_definitief(c_id);
  update factuur set status = 'gecrediteerd' where id = p_factuur;
  return c_id;
end;
$$;

-- ------------------------------------------- abonnementen: echte facturen ---

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
  f_id  uuid;
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
          -- De factuur: de termijn, plus de goedgekeurde uren van vóór deze
          -- periode als verantwoording. Meteen definitief.
          f_id := maak_factuur(p.id, date '1900-01-01', vlg - 1, array[t_id], false, null);
          ref  := maak_definitief(f_id, vlg);
          update factuur set automatisch = true where id = f_id;
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

-- ------------------------------------------------------------ v_factuur ----

-- De view leunt nu op de factuurtabel. Rechten volgen die tabel: vanaf
-- projectleider zichtbaar.
drop view v_factuur;

create view v_factuur with (security_invoker = true) as
select f.id, f.nummer, f.status, f.klant_id, k.naam as klant, f.project_id,
       p.naam as project, p.facturatiemodel::text as facturatiemodel,
       f.datum, f.vervaldatum, f.periode_van, f.periode_tot,
       f.subtotaal, f.btw_bedrag, f.totaal, f.betaald_op,
       case when f.status = 'definitief' then f.totaal else 0 end as openstaand,
       f.status = 'definitief' and f.vervaldatum < current_date as vervallen,
       f.credit_van_id, f.automatisch, f.verwerkt_op, f.geexporteerd_op,
       f.aangemaakt_op, f.definitief_op,
       coalesce((select sum(u.minuten) from urenregel u
                  where u.factuur_id = f.id and u.status <> 'vervallen'), 0) as minuten,
       coalesce((select sum(r.totaal_km) from rit r
                  where r.factuur_id = f.id and r.status <> 'vervallen'), 0) as km,
       (select count(*) from factuurregel fr where fr.factuur_id = f.id) as regels
from factuur f
join klant k on k.id = f.klant_id
left join project p on p.id = f.project_id;

grant select on v_factuur to authenticated;

-- Journaalregels voor de boekhouding: per factuurregel één rij met
-- grootboek en btw. Dit is wat een koppeling straks doorstuurt.
create view v_factuur_journaal with (security_invoker = true) as
select f.nummer, f.datum, f.vervaldatum, f.status,
       k.naam as klant, k.code as klantcode, k.email as klant_email,
       f.referentie_klant, p.code as projectcode, p.naam as project,
       fr.volgorde, fr.omschrijving, fr.aantal, fr.eenheid, fr.prijs, fr.bedrag,
       fr.btw_code, fr.btw_percentage,
       round(fr.bedrag * fr.btw_percentage / 100, 2) as btw_bedrag,
       fr.bedrag + round(fr.bedrag * fr.btw_percentage / 100, 2) as bedrag_incl,
       fr.grootboek_nummer,
       g.naam as grootboek_naam,
       fr.bron::text as bron,
       f.geexporteerd_op, f.export_kenmerk, f.id as factuur_id, fr.id as regel_id
from factuur f
join factuurregel fr on fr.factuur_id = f.id
join klant k on k.id = f.klant_id
left join project p on p.id = f.project_id
left join grootboekrekening g on g.id = fr.grootboek_id
where f.status <> 'concept';

grant select on v_factuur_journaal to authenticated;
grant execute on all functions in schema public to authenticated;
