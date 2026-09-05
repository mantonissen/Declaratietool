-- Jaarwerk en loon voor een bv (besluit E2d, uitgebreid).
--
-- 1. Rubrieken op het rekeningschema, zodat balans en winst-en-verlies in de
--    indeling van de jaarrekening (en van het KvK-formulier) uitkomen.
-- 2. Vaste activa met maandelijkse afschrijving.
-- 3. Boekjaar: vennootschapsbelasting berekenen en reserveren, opmaken,
--    vaststellen, deponeren.
-- 4. Loonadministratie: dienstverbanden, loonparameters per jaar, loonruns
--    met loonstroken, boekingen en betalingen; de loonaangifte als overzicht
--    per rubriek.
--
-- Wat de app niet doet: elektronisch indienen (Digipoort/SBR). De cijfers
-- komen per rubriek klaar te staan voor Mijn Belastingdienst Zakelijk en de
-- KvK-dienst "Zelf deponeren". De loonparameters zijn vooraf ingevuld maar
-- moeten per jaar tegen de tabellen van de Belastingdienst gelegd worden;
-- daarvoor is `gecontroleerd`.

-- ------------------------------------------------------------ rubrieken ----

alter table grootboekrekening add column rubriek text;

alter table grootboekrekening add constraint grootboekrekening_rubriek_ok check (rubriek in (
  'vaste_activa', 'vorderingen', 'liquide_middelen',
  'eigen_vermogen', 'langlopende_schulden', 'kortlopende_schulden',
  'netto_omzet', 'personeelskosten', 'afschrijvingen', 'overige_bedrijfskosten',
  'financiele_baten_lasten', 'belastingen'));

comment on column grootboekrekening.rubriek is
  'Post in de jaarrekening waar deze rekening onder valt.';

-- Zonder opgave volgt de rubriek de soort.
create or replace function rubriek_standaard()
returns trigger language plpgsql as $$
begin
  if new.rubriek is null then
    new.rubriek := case new.soort
      when 'activa' then 'vorderingen'
      when 'passiva' then 'kortlopende_schulden'
      when 'eigen_vermogen' then 'eigen_vermogen'
      when 'omzet' then 'netto_omzet'
      else 'overige_bedrijfskosten' end;
  end if;
  return new;
end;
$$;

create trigger grootboekrekening_rubriek before insert or update on grootboekrekening
  for each row execute function rubriek_standaard();

-- Het schema van een bv: kapitaal en reserves in plaats van privé, vaste
-- activa met afschrijving, belastingen en loonschulden.
update grootboekrekening set naam = 'Geplaatst aandelenkapitaal' where nummer = '0500';
update grootboekrekening set naam = 'Rekening-courant directie', soort = 'passiva' where nummer = '0600';

insert into grootboekrekening (nummer, naam, soort, betaalmiddel, btw_code, rubriek) values
  ('0100', 'Inventaris en apparatuur',           'activa',         false, 'hoog', 'vaste_activa'),
  ('0150', 'Cumulatieve afschrijving inventaris', 'activa',        false, null,   'vaste_activa'),
  ('0510', 'Overige reserves',                   'eigen_vermogen', false, null,   'eigen_vermogen'),
  ('0700', 'Te betalen vennootschapsbelasting',  'passiva',        false, null,   'kortlopende_schulden'),
  ('0710', 'Te betalen dividendbelasting',       'passiva',        false, null,   'kortlopende_schulden'),
  ('1800', 'Netto lonen te betalen',             'passiva',        false, null,   'kortlopende_schulden'),
  ('1810', 'Loonheffing te betalen',             'passiva',        false, null,   'kortlopende_schulden'),
  ('1820', 'Pensioenpremie te betalen',          'passiva',        false, null,   'kortlopende_schulden'),
  ('1830', 'Reservering vakantiegeld',           'passiva',        false, null,   'kortlopende_schulden'),
  ('4710', 'Sociale lasten',                     'kosten',         false, null,   'personeelskosten'),
  ('4720', 'Pensioenlasten',                     'kosten',         false, null,   'personeelskosten'),
  ('4990', 'Afschrijvingen',                     'kosten',         false, null,   'afschrijvingen'),
  ('9000', 'Vennootschapsbelasting',             'kosten',         false, null,   'belastingen')
on conflict (nummer) do nothing;

update grootboekrekening set rubriek = case
  when nummer in ('0500', '0510') then 'eigen_vermogen'
  when nummer in ('0600', '1600', '1700', '1750') then 'kortlopende_schulden'
  when nummer in ('1000', '1100') then 'liquide_middelen'
  when nummer in ('1300', '1520') then 'vorderingen'
  when nummer = '4700' then 'personeelskosten'
  when nummer = '4950' then 'financiele_baten_lasten'
  when nummer like '4%' then 'overige_bedrijfskosten'
  when nummer like '8%' then 'netto_omzet'
  else rubriek end
where rubriek is null;

alter table instellingen
  add column rechtsvorm             text not null default 'bv' check (rechtsvorm in ('bv', 'eenmanszaak', 'vof')),
  add column loonheffingennummer    text,
  add column rekening_kapitaal      uuid references grootboekrekening (id),
  add column rekening_reserves      uuid references grootboekrekening (id),
  add column rekening_vpb_kosten    uuid references grootboekrekening (id),
  add column rekening_vpb_schuld    uuid references grootboekrekening (id),
  add column rekening_loon_bruto    uuid references grootboekrekening (id),
  add column rekening_sociale_lasten uuid references grootboekrekening (id),
  add column rekening_pensioenlasten uuid references grootboekrekening (id),
  add column rekening_netto_loon    uuid references grootboekrekening (id),
  add column rekening_loonheffing   uuid references grootboekrekening (id),
  add column rekening_pensioen_schuld uuid references grootboekrekening (id),
  add column rekening_vakantiegeld  uuid references grootboekrekening (id);

update instellingen set
  rekening_kapitaal        = (select id from grootboekrekening where nummer = '0500'),
  rekening_reserves        = (select id from grootboekrekening where nummer = '0510'),
  rekening_vpb_kosten      = (select id from grootboekrekening where nummer = '9000'),
  rekening_vpb_schuld      = (select id from grootboekrekening where nummer = '0700'),
  rekening_loon_bruto      = (select id from grootboekrekening where nummer = '4700'),
  rekening_sociale_lasten  = (select id from grootboekrekening where nummer = '4710'),
  rekening_pensioenlasten  = (select id from grootboekrekening where nummer = '4720'),
  rekening_netto_loon      = (select id from grootboekrekening where nummer = '1800'),
  rekening_loonheffing     = (select id from grootboekrekening where nummer = '1810'),
  rekening_pensioen_schuld = (select id from grootboekrekening where nummer = '1820'),
  rekening_vakantiegeld    = (select id from grootboekrekening where nummer = '1830')
where id;

-- Saldi per rekening, nu met rubriek. Het rapport zet belastingen apart
-- (resultaat vóór en na belasting).
drop function grootboek_saldi(date, date);
create function grootboek_saldi(p_van date, p_tot date)
returns table (grootboek_id uuid, nummer text, naam text, soort rekening_soort, rubriek text, actief boolean,
               debet numeric, credit numeric, saldo numeric)
language sql
stable
set search_path = public
as $$
  select g.id, g.nummer, g.naam, g.soort, g.rubriek, g.actief,
         coalesce(sum(m.debet), 0), coalesce(sum(m.credit), 0), coalesce(sum(m.debet - m.credit), 0)
  from grootboekrekening g
  left join (
    select r.grootboek_id, r.debet, r.credit
    from boekingsregel r join boeking b on b.id = r.boeking_id
    where b.datum between p_van and p_tot
  ) m on m.grootboek_id = g.id
  group by g.id
  order by g.nummer;
$$;

-- --------------------------------------------------------- vaste activa ----

create table activum (
  id                    uuid primary key default gen_random_uuid(),
  omschrijving          text not null check (length(btrim(omschrijving)) > 0),
  aanschafdatum         date not null,
  aanschafwaarde        numeric(12,2) not null check (aanschafwaarde > 0),
  restwaarde            numeric(12,2) not null default 0 check (restwaarde >= 0),
  afschrijvingsmaanden  integer not null default 60 check (afschrijvingsmaanden between 1 and 600),
  grootboek_activa      uuid not null references grootboekrekening (id),
  grootboek_afschrijving uuid not null references grootboekrekening (id),  -- cumulatieve afschrijving
  grootboek_kosten      uuid not null references grootboekrekening (id),
  inkoop_id             uuid references inkoopfactuur (id) on delete set null,
  afgeschreven_tot      date,                                             -- laatste maandeinde dat geboekt is
  buiten_gebruik_op     date,
  aangemaakt_op         timestamptz not null default now(),
  constraint activum_rest_kleiner check (restwaarde < aanschafwaarde)
);

alter table boeking add column activum_id uuid references activum (id) on delete restrict;

comment on table activum is
  'Vaste activa: lineair afgeschreven per maand vanaf de maand na aanschaf.';

-- Afschrijving per maand: (aanschaf - rest) / maanden, vanaf de maand na
-- aanschaf, tot het volledig is afgeschreven of buiten gebruik. Eén boeking
-- per activum per maand; idempotent via afgeschreven_tot.
create or replace function boek_afschrijvingen(p_tot date)
returns integer
language plpgsql
set search_path = public
as $$
declare
  a         record;
  maandeind date;
  begin_m   date;
  n         integer := 0;
  per_maand numeric;
  reeds     numeric;
  bedrag    numeric;
  b         uuid;
begin
  for a in select * from activum where buiten_gebruik_op is null or buiten_gebruik_op > coalesce(afgeschreven_tot, aanschafdatum) loop
    per_maand := round((a.aanschafwaarde - a.restwaarde) / a.afschrijvingsmaanden, 2);
    -- eerste maandeinde na de maand van aanschaf, of de maand na de laatste boeking
    begin_m := coalesce(a.afgeschreven_tot + 1, (date_trunc('month', a.aanschafdatum) + interval '1 month')::date);
    maandeind := (date_trunc('month', begin_m) + interval '1 month' - interval '1 day')::date;
    while maandeind <= p_tot loop
      exit when a.buiten_gebruik_op is not null and maandeind > a.buiten_gebruik_op;
      select coalesce(sum(r.credit - r.debet), 0) into reeds
      from boekingsregel r join boeking bk on bk.id = r.boeking_id
      where bk.activum_id = a.id and r.grootboek_id = a.grootboek_afschrijving;
      bedrag := least(per_maand, a.aanschafwaarde - a.restwaarde - reeds);
      exit when bedrag <= 0;
      insert into boeking (datum, soort, omschrijving, activum_id)
      values (maandeind, 'memoriaal', 'Afschrijving ' || a.omschrijving || ' · ' || to_char(maandeind, 'MM-YYYY'), a.id)
      returning id into b;
      perform boek_regel(b, a.grootboek_kosten, bedrag, a.omschrijving);
      perform boek_regel(b, a.grootboek_afschrijving, -bedrag, a.omschrijving);
      update activum set afgeschreven_tot = maandeind where id = a.id;
      n := n + 1;
      maandeind := (maandeind + interval '1 day' + interval '1 month' - interval '1 day')::date;
    end loop;
  end loop;
  return n;
end;
$$;

-- ------------------------------------------------------------- boekjaar ----

create table vpb_parameters (
  jaar         integer primary key,
  grens        numeric(12,2) not null,      -- tot dit bedrag het lage tarief
  tarief_laag  numeric(5,2) not null,
  tarief_hoog  numeric(5,2) not null,
  gecontroleerd boolean not null default false
);

insert into vpb_parameters (jaar, grens, tarief_laag, tarief_hoog) values
  (2024, 200000, 19.00, 25.80),
  (2025, 200000, 19.00, 25.80),
  (2026, 200000, 19.00, 25.80)
on conflict (jaar) do nothing;

create table boekjaar (
  jaar                      integer primary key,
  vpb_correcties            numeric(12,2) not null default 0,   -- niet-aftrekbare kosten e.d.
  vpb_verlies_verrekend     numeric(12,2) not null default 0,   -- verrekend verlies uit eerdere jaren
  vpb_bedrag                numeric(12,2),                      -- gereserveerd
  vpb_boeking_id            uuid references boeking (id) on delete set null,
  vpb_aangifte_ingediend_op date,
  vpb_betaald_op            date,
  gemiddeld_werknemers      numeric(5,1),
  opgemaakt_op              date,
  vastgesteld_op            date,
  gedeponeerd_op            date,
  toelichting               text,
  aangemaakt_op             timestamptz not null default now()
);

comment on table boekjaar is
  'Per boekjaar: de vennootschapsbelasting en de stappen van de jaarrekening.';

-- Resultaat vóór belasting over een kalenderjaar (omzet min kosten, zonder
-- de rekeningen in de rubriek belastingen).
create or replace function resultaat_voor_belasting(p_jaar integer)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(-sum(saldo), 0)
  from grootboek_saldi(make_date(p_jaar, 1, 1), make_date(p_jaar, 12, 31))
  where soort in ('omzet', 'kosten') and rubriek <> 'belastingen';
$$;

create or replace function vpb_berekening(p_jaar integer)
returns table (resultaat numeric, correcties numeric, verlies numeric, belastbaar numeric,
               grens numeric, tarief_laag numeric, tarief_hoog numeric,
               laag_bedrag numeric, hoog_bedrag numeric, vpb numeric)
language plpgsql
stable
set search_path = public
as $$
declare p record; bj record; belast numeric;
begin
  select * into p from vpb_parameters where jaar = p_jaar;
  if p is null then
    select * into p from vpb_parameters order by jaar desc limit 1;
  end if;
  select * into bj from boekjaar where jaar = p_jaar;
  resultaat  := resultaat_voor_belasting(p_jaar);
  correcties := coalesce(bj.vpb_correcties, 0);
  verlies    := coalesce(bj.vpb_verlies_verrekend, 0);
  belast     := greatest(0, floor(resultaat + correcties - verlies));
  belastbaar := belast;
  grens := p.grens; tarief_laag := p.tarief_laag; tarief_hoog := p.tarief_hoog;
  laag_bedrag := least(belast, p.grens);
  hoog_bedrag := greatest(0, belast - p.grens);
  vpb := floor(laag_bedrag * p.tarief_laag / 100 + hoog_bedrag * p.tarief_hoog / 100);
  return next;
end;
$$;

-- Reserveren: kosten vennootschapsbelasting tegenover te betalen, op 31-12.
-- Opnieuw reserveren vervangt de vorige boeking, zolang die niet in een
-- afgesloten periode ligt.
create or replace function reserveer_vpb(p_jaar integer)
returns numeric
language plpgsql
set search_path = public
as $$
declare i record; bj record; berekend numeric; b uuid;
begin
  insert into boekjaar (jaar) values (p_jaar) on conflict (jaar) do nothing;
  select * into bj from boekjaar where jaar = p_jaar;
  select * into i from instellingen where id;
  select vpb into berekend from vpb_berekening(p_jaar);
  if bj.vpb_boeking_id is not null then
    delete from boeking where id = bj.vpb_boeking_id;
  end if;
  b := null;
  if berekend > 0 then
    insert into boeking (datum, soort, omschrijving)
    values (make_date(p_jaar, 12, 31), 'memoriaal', 'Vennootschapsbelasting ' || p_jaar)
    returning id into b;
    perform boek_regel(b, i.rekening_vpb_kosten, berekend, 'Vpb ' || p_jaar);
    perform boek_regel(b, i.rekening_vpb_schuld, -berekend, 'Vpb ' || p_jaar);
  end if;
  update boekjaar set vpb_bedrag = berekend, vpb_boeking_id = b where jaar = p_jaar;
  return berekend;
end;
$$;

create or replace function boek_betaling_vpb(p_jaar integer, p_datum date, p_via uuid)
returns void
language plpgsql
set search_path = public
as $$
declare i record; bj record; b uuid;
begin
  select * into bj from boekjaar where jaar = p_jaar;
  if bj is null or bj.vpb_bedrag is null or bj.vpb_bedrag = 0 then raise exception 'Er is geen vennootschapsbelasting gereserveerd voor %.', p_jaar; end if;
  if bj.vpb_betaald_op is not null then raise exception 'De vennootschapsbelasting % is al betaald.', p_jaar; end if;
  select * into i from instellingen where id;
  insert into boeking (datum, soort, omschrijving)
  values (p_datum, 'bank', 'Betaling vennootschapsbelasting ' || p_jaar)
  returning id into b;
  perform boek_regel(b, i.rekening_vpb_schuld, bj.vpb_bedrag, 'Belastingdienst');
  perform boek_regel(b, p_via, -bj.vpb_bedrag, 'Belastingdienst');
  update boekjaar set vpb_betaald_op = p_datum where jaar = p_jaar;
end;
$$;

-- ----------------------------------------------------------------- loon ----

-- Parameters per jaar. Vooraf ingevuld naar beste weten; leg ze per jaar
-- naast de tabellen van de Belastingdienst en vink dan `gecontroleerd` aan.
create table loonparameters (
  jaar               integer primary key,
  gecontroleerd      boolean not null default false,
  schijven           jsonb not null,           -- [{"tot": 38883, "tarief": 35.70}, ..., {"tot": null, "tarief": 49.50}]
  ahk_max            numeric(10,2) not null,   -- algemene heffingskorting
  ahk_afbouw_vanaf   numeric(10,2) not null,
  ahk_afbouw_pct     numeric(6,3) not null,
  ak_schijven        jsonb not null,           -- arbeidskorting opbouw: [{"tot": 12635, "pct": 8.053}, ...]
  ak_max             numeric(10,2) not null,
  ak_afbouw_vanaf    numeric(10,2) not null,
  ak_afbouw_pct      numeric(6,3) not null,
  awf_laag           numeric(6,3) not null,    -- WW, vast contract
  awf_hoog           numeric(6,3) not null,    -- WW, flexibel contract
  aof                numeric(6,3) not null,    -- WIA/WAO, kleine werkgever
  whk                numeric(6,3) not null,    -- Werkhervattingskas (sectorafhankelijk)
  zvw_wg             numeric(6,3) not null,    -- werkgeversheffing Zvw
  zvw_wn             numeric(6,3) not null,    -- bijdrage Zvw bij inhouding (dga)
  max_premieloon     numeric(10,2) not null,   -- per jaar
  gebruikelijk_loon  numeric(10,2) not null,   -- dga-norm per jaar
  minimumloon_uur    numeric(6,2) not null
);

insert into loonparameters (jaar, schijven, ahk_max, ahk_afbouw_vanaf, ahk_afbouw_pct, ak_schijven, ak_max,
  ak_afbouw_vanaf, ak_afbouw_pct, awf_laag, awf_hoog, aof, whk, zvw_wg, zvw_wn, max_premieloon, gebruikelijk_loon, minimumloon_uur)
values
  (2025, '[{"tot": 38441, "tarief": 35.82}, {"tot": 76817, "tarief": 37.48}, {"tot": null, "tarief": 49.50}]',
   3068, 28406, 6.337, '[{"tot": 12169, "pct": 8.053}, {"tot": 26288, "pct": 30.030}, {"tot": 43071, "pct": 2.258}]',
   5599, 43071, 6.510, 2.74, 7.74, 6.28, 1.28, 6.51, 5.26, 75864, 56000, 14.06),
  (2026, '[{"tot": 38883, "tarief": 35.70}, {"tot": 79137, "tarief": 37.56}, {"tot": null, "tarief": 49.50}]',
   3115, 29736, 6.337, '[{"tot": 12635, "pct": 8.053}, {"tot": 27305, "pct": 30.030}, {"tot": 44713, "pct": 2.258}]',
   5712, 44713, 6.510, 2.74, 7.74, 6.28, 1.28, 6.51, 5.26, 79137, 56000, 14.71)
on conflict (jaar) do nothing;

create table dienstverband (
  id                  uuid primary key default gen_random_uuid(),
  medewerker_id       uuid not null references medewerker (id) on delete restrict,
  in_dienst           date not null,
  uit_dienst          date,
  bruto_maandloon     numeric(10,2) not null check (bruto_maandloon >= 0),
  uren_per_week       numeric(5,2) not null default 40 check (uren_per_week > 0 and uren_per_week <= 60),
  vakantiegeld_pct    numeric(5,2) not null default 8 check (vakantiegeld_pct >= 0),
  pensioen_wn_pct     numeric(5,2) not null default 0 check (pensioen_wn_pct >= 0),
  pensioen_wg_pct     numeric(5,2) not null default 0 check (pensioen_wg_pct >= 0),
  loonheffingskorting boolean not null default true,
  onbepaalde_tijd     boolean not null default true,
  dga                 boolean not null default false,
  geboortedatum       date,
  bsn                 text,
  iban                text,
  aangemaakt_op       timestamptz not null default now(),
  constraint dienstverband_periode_ok check (uit_dienst is null or uit_dienst >= in_dienst),
  constraint dienstverband_geen_overlap
    exclude using gist (medewerker_id with =, daterange(in_dienst, uit_dienst, '[]') with &&)
);

comment on table dienstverband is
  'Arbeidsvoorwaarden per medewerker; de basis van elke loonstrook.';

create table loonrun (
  id                       uuid primary key default gen_random_uuid(),
  jaar                     integer not null,
  maand                    integer not null check (maand between 1 and 12),
  status                   text not null default 'concept' check (status in ('concept', 'definitief')),
  vakantiegeld_uitbetalen  boolean not null default false,
  boeking_id               uuid references boeking (id) on delete set null,
  aangifte_ingediend_op    date,
  loonheffing_betaald_op   date,
  netto_betaald_op         date,
  pensioen_betaald_op      date,
  aangemaakt_door          uuid references medewerker (id) on delete set null,
  aangemaakt_op            timestamptz not null default now(),
  unique (jaar, maand)
);

create table loonstrook (
  id                     uuid primary key default gen_random_uuid(),
  loonrun_id             uuid not null references loonrun (id) on delete cascade,
  medewerker_id          uuid not null references medewerker (id) on delete restrict,
  dienstverband_id       uuid not null references dienstverband (id) on delete restrict,
  fractie                numeric(6,4) not null default 1,     -- deel van de maand in dienst
  bruto                  numeric(10,2) not null default 0,
  vakantiegeld_opbouw    numeric(10,2) not null default 0,
  vakantiegeld_uitbetaald numeric(10,2) not null default 0,
  pensioen_wn            numeric(10,2) not null default 0,
  loon_lh                numeric(10,2) not null default 0,    -- grondslag loonheffing (tabelloon)
  loonheffing            numeric(10,2) not null default 0,
  loonheffing_bijzonder  numeric(10,2) not null default 0,    -- over vakantiegeld
  zvw_wn                 numeric(10,2) not null default 0,    -- inhouding (dga)
  netto                  numeric(10,2) not null default 0,
  premieloon             numeric(10,2) not null default 0,
  awf                    numeric(10,2) not null default 0,
  aof                    numeric(10,2) not null default 0,
  whk                    numeric(10,2) not null default 0,
  zvw_wg                 numeric(10,2) not null default 0,
  pensioen_wg            numeric(10,2) not null default 0,
  werkgeverslasten       numeric(10,2) generated always as (awf + aof + whk + zvw_wg + pensioen_wg) stored,
  totale_kosten          numeric(10,2) generated always as (bruto + vakantiegeld_opbouw + awf + aof + whk + zvw_wg + pensioen_wg) stored,
  unique (loonrun_id, medewerker_id)
);

-- Een definitieve loonrun ligt vast.
create or replace function blokkeer_definitieve_loonrun()
returns trigger language plpgsql as $$
declare s text;
begin
  select status into s from loonrun where id = coalesce(new.loonrun_id, old.loonrun_id);
  if s = 'definitief' then
    raise exception 'De loonstroken van een definitieve loonrun liggen vast.' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger loonstrook_slot before insert or update or delete on loonstrook
  for each row execute function blokkeer_definitieve_loonrun();

create or replace function blokkeer_verwijderen_loonrun()
returns trigger language plpgsql as $$
begin
  if old.status = 'definitief' then
    raise exception 'Een definitieve loonrun verdwijnt niet.' using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger loonrun_verwijderslot before delete on loonrun
  for each row execute function blokkeer_verwijderen_loonrun();

-- Loonheffing over een jaarloon volgens schijven en heffingskortingen. Dit
-- is de jaarloonmethode; de maandtabel van de Belastingdienst komt hier op
-- enkele euro's na op uit.
create or replace function loonheffing_jaar(p_jaarloon numeric, p_jaar integer, p_korting boolean)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  p       record;
  s       jsonb;
  onder   numeric := 0;
  boven   numeric;
  loon    numeric := greatest(0, p_jaarloon);
  belast  numeric := 0;
  ahk     numeric := 0;
  ak      numeric := 0;
  rest    numeric;
begin
  select * into p from loonparameters where jaar = p_jaar;
  if p is null then select * into p from loonparameters order by jaar desc limit 1; end if;
  if p is null then raise exception 'Geen loonparameters voor %.', p_jaar; end if;

  for s in select * from jsonb_array_elements(p.schijven) loop
    boven := coalesce((s->>'tot')::numeric, 1e12);
    if loon > onder then
      belast := belast + (least(loon, boven) - onder) * (s->>'tarief')::numeric / 100;
    end if;
    onder := boven;
  end loop;

  if p_korting then
    ahk := greatest(0, least(p.ahk_max, p.ahk_max - greatest(0, loon - p.ahk_afbouw_vanaf) * p.ahk_afbouw_pct / 100));
    onder := 0;
    for s in select * from jsonb_array_elements(p.ak_schijven) loop
      boven := (s->>'tot')::numeric;
      if loon > onder then ak := ak + (least(loon, boven) - onder) * (s->>'pct')::numeric / 100; end if;
      onder := boven;
    end loop;
    ak := least(ak, p.ak_max);
    if loon > p.ak_afbouw_vanaf then
      ak := greatest(0, ak - (loon - p.ak_afbouw_vanaf) * p.ak_afbouw_pct / 100);
    end if;
  end if;
  rest := belast - ahk - ak;
  return round(greatest(0, rest), 2);
end;
$$;

-- Loonrun voor een maand: een strook per lopend dienstverband. Een bestaand
-- concept wordt opnieuw berekend.
create or replace function maak_loonrun(p_jaar integer, p_maand integer, p_vakantiegeld boolean default false, p_door uuid default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  run_id    uuid;
  p         record;
  d         record;
  m_start   date := make_date(p_jaar, p_maand, 1);
  m_eind    date := (make_date(p_jaar, p_maand, 1) + interval '1 month' - interval '1 day')::date;
  dagen     integer := extract(day from m_eind);
  fr        numeric;
  bruto     numeric; vg_opb numeric; vg_uit numeric; pens_wn numeric; loon_lh numeric;
  lh        numeric; lh_bijz numeric; zvw_wn numeric; netto numeric; premieloon numeric;
  awf numeric; aof numeric; whk numeric; zvw_wg numeric; pens_wg numeric;
  jaarloon  numeric;
begin
  select * into p from loonparameters where jaar = p_jaar;
  if p is null then raise exception 'Geen loonparameters voor %; vul ze eerst in.', p_jaar; end if;

  select id into run_id from loonrun where jaar = p_jaar and maand = p_maand;
  if run_id is not null then
    if (select status from loonrun where id = run_id) = 'definitief' then
      raise exception 'De loonrun van %-% is al definitief.', p_maand, p_jaar;
    end if;
    delete from loonstrook where loonrun_id = run_id;
    update loonrun set vakantiegeld_uitbetalen = p_vakantiegeld where id = run_id;
  else
    insert into loonrun (jaar, maand, vakantiegeld_uitbetalen, aangemaakt_door)
    values (p_jaar, p_maand, p_vakantiegeld, p_door) returning id into run_id;
  end if;

  for d in
    select dv.*, m.naam from dienstverband dv join medewerker m on m.id = dv.medewerker_id
    where dv.in_dienst <= m_eind and (dv.uit_dienst is null or dv.uit_dienst >= m_start)
    order by m.naam
  loop
    fr := (least(coalesce(d.uit_dienst, m_eind), m_eind) - greatest(d.in_dienst, m_start) + 1)::numeric / dagen;
    bruto   := round(d.bruto_maandloon * fr, 2);
    vg_opb  := round(bruto * d.vakantiegeld_pct / 100, 2);
    vg_uit  := 0;
    if p_vakantiegeld or d.uit_dienst between m_start and m_eind then
      -- opgebouwd en nog niet uitbetaald, inclusief deze maand
      select coalesce(sum(s.vakantiegeld_opbouw - s.vakantiegeld_uitbetaald), 0) into vg_uit
      from loonstrook s join loonrun r on r.id = s.loonrun_id
      where s.dienstverband_id = d.id and r.status = 'definitief';
      vg_uit := greatest(0, vg_uit + vg_opb);
    end if;
    pens_wn := round(bruto * d.pensioen_wn_pct / 100, 2);
    pens_wg := round(bruto * d.pensioen_wg_pct / 100, 2);
    loon_lh := bruto - pens_wn;
    jaarloon := round(loon_lh / greatest(fr, 0.0001) * 12, 2);
    lh      := round(loonheffing_jaar(jaarloon, p_jaar, d.loonheffingskorting) / 12 * fr, 2);
    lh_bijz := case when vg_uit > 0
                 then round(loonheffing_jaar(jaarloon + vg_uit, p_jaar, d.loonheffingskorting)
                          - loonheffing_jaar(jaarloon, p_jaar, d.loonheffingskorting), 2)
                 else 0 end;
    premieloon := least(loon_lh + vg_uit, round(p.max_premieloon / 12 * fr, 2) + vg_uit);
    if d.dga then
      awf := 0; aof := 0; whk := 0; zvw_wg := 0;
      zvw_wn := round(premieloon * p.zvw_wn / 100, 2);
    else
      awf := round(premieloon * (case when d.onbepaalde_tijd then p.awf_laag else p.awf_hoog end) / 100, 2);
      aof := round(premieloon * p.aof / 100, 2);
      whk := round(premieloon * p.whk / 100, 2);
      zvw_wg := round(premieloon * p.zvw_wg / 100, 2);
      zvw_wn := 0;
    end if;
    netto := bruto + vg_uit - pens_wn - lh - lh_bijz - zvw_wn;

    insert into loonstrook (loonrun_id, medewerker_id, dienstverband_id, fractie, bruto, vakantiegeld_opbouw,
      vakantiegeld_uitbetaald, pensioen_wn, loon_lh, loonheffing, loonheffing_bijzonder, zvw_wn, netto,
      premieloon, awf, aof, whk, zvw_wg, pensioen_wg)
    values (run_id, d.medewerker_id, d.id, round(fr, 4), bruto, vg_opb, vg_uit, pens_wn, loon_lh, lh, lh_bijz,
      zvw_wn, netto, premieloon, awf, aof, whk, zvw_wg, pens_wg);
  end loop;
  return run_id;
end;
$$;

-- Definitief: de loonjournaalpost op de laatste dag van de maand.
create or replace function maak_loonrun_definitief(p_run uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare r record; i record; t record; b uuid; m_eind date;
begin
  select * into r from loonrun where id = p_run;
  if r is null then raise exception 'Loonrun niet gevonden.'; end if;
  if r.status = 'definitief' then return r.boeking_id; end if;
  select coalesce(sum(bruto + vakantiegeld_opbouw), 0) as bruto,
         coalesce(sum(awf + aof + whk + zvw_wg), 0) as sociaal,
         coalesce(sum(pensioen_wg), 0) as pens_wg,
         coalesce(sum(netto), 0) as netto,
         coalesce(sum(loonheffing + loonheffing_bijzonder + zvw_wn + awf + aof + whk + zvw_wg), 0) as loonheffing,
         coalesce(sum(pensioen_wn + pensioen_wg), 0) as pensioen,
         coalesce(sum(vakantiegeld_opbouw - vakantiegeld_uitbetaald), 0) as vakantiegeld,
         count(*) as n
  into t from loonstrook where loonrun_id = p_run;
  if t.n = 0 then raise exception 'Een loonrun zonder loonstroken kan niet definitief worden.'; end if;
  select * into i from instellingen where id;
  m_eind := (make_date(r.jaar, r.maand, 1) + interval '1 month' - interval '1 day')::date;

  insert into boeking (datum, soort, omschrijving, aangemaakt_door)
  values (m_eind, 'memoriaal', 'Salarissen ' || to_char(m_eind, 'MM-YYYY'), r.aangemaakt_door)
  returning id into b;
  perform boek_regel(b, i.rekening_loon_bruto, t.bruto, 'Brutolonen en vakantiegeld');
  perform boek_regel(b, i.rekening_sociale_lasten, t.sociaal, 'Werkgeverspremies');
  perform boek_regel(b, i.rekening_pensioenlasten, t.pens_wg, 'Pensioen werkgever');
  perform boek_regel(b, i.rekening_netto_loon, -t.netto, 'Netto te betalen');
  perform boek_regel(b, i.rekening_loonheffing, -t.loonheffing, 'Loonheffingen');
  perform boek_regel(b, i.rekening_pensioen_schuld, -t.pensioen, 'Pensioenpremie');
  perform boek_regel(b, i.rekening_vakantiegeld, -t.vakantiegeld, 'Reservering vakantiegeld');

  update loonrun set status = 'definitief', boeking_id = b where id = p_run;
  return b;
end;
$$;

-- Betalingen uit een loonrun: netto lonen, loonheffingen (na de aangifte),
-- pensioenpremie.
create or replace function boek_betaling_loonrun(p_run uuid, p_wat text, p_datum date, p_via uuid)
returns void
language plpgsql
set search_path = public
as $$
declare r record; i record; bedrag numeric; schuld uuid; b uuid; tekst text;
begin
  select * into r from loonrun where id = p_run;
  if r is null or r.status <> 'definitief' then raise exception 'Alleen een definitieve loonrun kun je betalen.'; end if;
  if not exists (select 1 from grootboekrekening where id = p_via and betaalmiddel) then
    raise exception 'Kies een betaalmiddel (bank, kas of rekening-courant).';
  end if;
  select * into i from instellingen where id;
  if p_wat = 'netto' then
    if r.netto_betaald_op is not null then raise exception 'De netto lonen zijn al betaald.'; end if;
    select sum(netto) into bedrag from loonstrook where loonrun_id = p_run;
    schuld := i.rekening_netto_loon; tekst := 'Netto lonen';
  elsif p_wat = 'loonheffing' then
    if r.loonheffing_betaald_op is not null then raise exception 'De loonheffingen zijn al betaald.'; end if;
    select sum(loonheffing + loonheffing_bijzonder + zvw_wn + awf + aof + whk + zvw_wg) into bedrag from loonstrook where loonrun_id = p_run;
    schuld := i.rekening_loonheffing; tekst := 'Loonheffingen';
  elsif p_wat = 'pensioen' then
    if r.pensioen_betaald_op is not null then raise exception 'De pensioenpremie is al betaald.'; end if;
    select sum(pensioen_wn + pensioen_wg) into bedrag from loonstrook where loonrun_id = p_run;
    schuld := i.rekening_pensioen_schuld; tekst := 'Pensioenpremie';
  else
    raise exception 'Onbekende betaling %.', p_wat;
  end if;
  if coalesce(bedrag, 0) <> 0 then
    insert into boeking (datum, soort, omschrijving)
    values (p_datum, 'bank', tekst || ' ' || lpad(r.maand::text, 2, '0') || '-' || r.jaar)
    returning id into b;
    perform boek_regel(b, schuld, bedrag, tekst);
    perform boek_regel(b, p_via, -bedrag, tekst);
  end if;
  update loonrun set
    netto_betaald_op       = case when p_wat = 'netto' then p_datum else netto_betaald_op end,
    loonheffing_betaald_op = case when p_wat = 'loonheffing' then p_datum else loonheffing_betaald_op end,
    pensioen_betaald_op    = case when p_wat = 'pensioen' then p_datum else pensioen_betaald_op end
  where id = p_run;
end;
$$;

-- ------------------------------------------------------------- rechten -----

alter table activum        enable row level security;
alter table vpb_parameters enable row level security;
alter table boekjaar       enable row level security;
alter table loonparameters enable row level security;
alter table dienstverband  enable row level security;
alter table loonrun        enable row level security;
alter table loonstrook     enable row level security;

create policy activum_eigenaar on activum for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
create policy vpb_parameters_eigenaar on vpb_parameters for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
create policy boekjaar_eigenaar on boekjaar for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
create policy loonparameters_eigenaar on loonparameters for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
create policy dienstverband_eigenaar on dienstverband for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
create policy loonrun_eigenaar on loonrun for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
-- Een medewerker mag zijn eigen loonstroken zien; de eigenaar alles.
create policy loonstrook_lezen on loonstrook for select to authenticated
  using (is_eigenaar() or medewerker_id = huidige_medewerker());
create policy loonstrook_beheren on loonstrook for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

grant select, insert, update, delete on activum, vpb_parameters, boekjaar, loonparameters, dienstverband, loonrun, loonstrook
  to authenticated;
grant execute on all functions in schema public to authenticated;
