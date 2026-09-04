-- Tarieven en kostprijzen.
--
-- Keuzes die hier in zitten:
--   B2a  de volledige zoekvolgorde van zeven niveaus
--   B3a  interne kostprijs als vast bedrag per medewerker per periode
--   C3a  kilometervergoeding per periode instelbaar
--
-- Alles wat geld is, is een periode: elke regel heeft een geldig_vanaf en een
-- optionele geldig_tot (inclusief). Daardoor raakt een tariefverhoging nooit
-- de uren van vorig jaar. De gegenereerde kolom `geldigheid` maakt daar een
-- daterange van, zodat overlap met een exclusion constraint is uit te sluiten
-- en opzoeken één `@>` is.

-- ---------------------------------------------------------- tariefregel ----

-- Eén tabel voor de niveaus 2 tot en met 7 van de zoekvolgorde. Niveau 1
-- (handmatig tarief) staat op de urenregel zelf.
--
--   2  onderdeel
--   3  project x functie
--   4  project
--   5  klant x functie
--   6  klant
--   7  functie (organisatiebreed standaardtarief)
create table tariefregel (
  id             uuid primary key default gen_random_uuid(),
  onderdeel_id   uuid references projectonderdeel (id) on delete cascade,
  project_id     uuid references project (id) on delete cascade,
  klant_id       uuid references klant (id) on delete cascade,
  functie_id     uuid references functie (id) on delete cascade,
  bedrag_per_uur numeric(10,2) not null check (bedrag_per_uur >= 0),
  geldig_vanaf   date not null,
  geldig_tot     date,
  toelichting    text,
  aangemaakt_op  timestamptz not null default now(),

  -- Half-open interval, zodat aansluitende periodes niet als overlap gelden.
  -- geldig_tot is voor de gebruiker inclusief: 31-12 betekent tot en met 31-12.
  geldigheid daterange generated always as (
    daterange(geldig_vanaf,
              case when geldig_tot is null then null else geldig_tot + 1 end,
              '[)')
  ) stored,

  niveau smallint generated always as (
    case
      when onderdeel_id is not null                             then 2
      when project_id is not null and functie_id is not null    then 3
      when project_id is not null                               then 4
      when klant_id   is not null and functie_id is not null    then 5
      when klant_id   is not null                               then 6
      else                                                            7
    end
  ) stored,

  constraint tariefregel_periode_ok
    check (geldig_tot is null or geldig_tot >= geldig_vanaf),

  -- Precies één anker, en niveau 7 heeft een functie nodig omdat het anders
  -- een organisatiebreed tarief voor iedereen zou zijn.
  constraint tariefregel_anker_ok check (
       (onderdeel_id is not null and project_id is null and klant_id is null
        and functie_id is null)
    or (onderdeel_id is null and project_id is not null and klant_id is null)
    or (onderdeel_id is null and project_id is null and klant_id is not null)
    or (onderdeel_id is null and project_id is null and klant_id is null
        and functie_id is not null)
  ),

  -- Twee regels op hetzelfde anker mogen elkaar niet overlappen in de tijd;
  -- anders is niet te zeggen welke geldt.
  constraint tariefregel_geen_overlap exclude using gist (
    coalesce(onderdeel_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(project_id,   '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(klant_id,     '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(functie_id,   '00000000-0000-0000-0000-000000000000'::uuid) with =,
    geldigheid with &&
  )
);

comment on table tariefregel is
  'Verkooptarieven, niveau 2 t/m 7 van de zoekvolgorde. Laagste niveau wint.';

create index tariefregel_onderdeel_idx on tariefregel (onderdeel_id) where onderdeel_id is not null;
create index tariefregel_project_idx   on tariefregel (project_id)   where project_id   is not null;
create index tariefregel_klant_idx     on tariefregel (klant_id)     where klant_id     is not null;

-- ------------------------------------------------------------ kostprijs ----

-- B3a: één bedrag per medewerker per periode. Zelf berekend of geschat --
-- voor sturen op marge is dat nauwkeurig genoeg.
create table kostprijs (
  id             uuid primary key default gen_random_uuid(),
  medewerker_id  uuid not null references medewerker (id) on delete cascade,
  bedrag_per_uur numeric(10,2) not null check (bedrag_per_uur >= 0),
  geldig_vanaf   date not null,
  geldig_tot     date,
  toelichting    text,
  aangemaakt_op  timestamptz not null default now(),

  geldigheid daterange generated always as (
    daterange(geldig_vanaf,
              case when geldig_tot is null then null else geldig_tot + 1 end,
              '[)')
  ) stored,

  constraint kostprijs_periode_ok
    check (geldig_tot is null or geldig_tot >= geldig_vanaf),
  constraint kostprijs_geen_overlap exclude using gist (
    medewerker_id with =,
    geldigheid    with &&
  )
);

comment on table kostprijs is
  'Interne uurkosten per medewerker. Alleen zichtbaar voor de eigenaar.';

-- ----------------------------------------------------------- km-tarief -----

-- Bewust een tabel en geen constante: het bedrag beweegt per jaar.
create table km_tarief (
  id            uuid primary key default gen_random_uuid(),
  bedrag_per_km numeric(6,3) not null check (bedrag_per_km >= 0),
  geldig_vanaf  date not null,
  geldig_tot    date,
  toelichting   text,

  geldigheid daterange generated always as (
    daterange(geldig_vanaf,
              case when geldig_tot is null then null else geldig_tot + 1 end,
              '[)')
  ) stored,

  constraint km_tarief_periode_ok
    check (geldig_tot is null or geldig_tot >= geldig_vanaf),
  constraint km_tarief_geen_overlap exclude using gist (geldigheid with &&)
);

comment on table km_tarief is
  'Kilometervergoeding per periode. Controleer het actuele bedrag per jaar.';

-- ------------------------------------------------------------- opzoeken ----

-- Let op: deze functies zijn security invoker. Dat is opzettelijk. Een
-- medewerker mag tariefregel en kostprijs niet lezen (keuze D2a), dus voor
-- hem geven ze null terug en blijven bedragen in de rapportageviews leeg.
-- Zou dit security definer zijn, dan lekten de bedragen alsnog via de views.

create or replace function tarief_voor(
  p_onderdeel_id  uuid,
  p_medewerker_id uuid,
  p_datum         date
) returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with ctx as (
    select o.id         as onderdeel_id,
           o.project_id as project_id,
           p.klant_id   as klant_id,
           (select functie_id from medewerker where id = p_medewerker_id) as functie_id
    from projectonderdeel o
    join project p on p.id = o.project_id
    where o.id = p_onderdeel_id
  )
  select t.bedrag_per_uur
  from tariefregel t
  cross join ctx
  where t.geldigheid @> p_datum
    and (
         t.onderdeel_id = ctx.onderdeel_id
      or (t.project_id = ctx.project_id
          and (t.functie_id is null or t.functie_id = ctx.functie_id))
      or (t.klant_id = ctx.klant_id
          and (t.functie_id is null or t.functie_id = ctx.functie_id))
      or (t.onderdeel_id is null and t.project_id is null and t.klant_id is null
          and t.functie_id = ctx.functie_id)
    )
  order by t.niveau
  limit 1;
$$;

comment on function tarief_voor(uuid, uuid, date) is
  'Verkooptarief volgens de zoekvolgorde, gezocht op de datum van de urenregel.';

create or replace function kostprijs_voor(
  p_medewerker_id uuid,
  p_datum         date
) returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select k.bedrag_per_uur
  from kostprijs k
  where k.medewerker_id = p_medewerker_id
    and k.geldigheid @> p_datum
  limit 1;
$$;

create or replace function km_tarief_voor(p_datum date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select t.bedrag_per_km
  from km_tarief t
  where t.geldigheid @> p_datum
  limit 1;
$$;

-- C3a: de afstand die de app invult zodra je een klant kiest.
create or replace function afstand_voor(
  p_klant_id      uuid,
  p_medewerker_id uuid
) returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select afstand_km from klant_afstand
      where klant_id = p_klant_id and medewerker_id = p_medewerker_id),
    (select afstand_km from klant where id = p_klant_id)
  );
$$;
