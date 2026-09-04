-- Basis: organisatie-instellingen, functies, medewerkers, klanten, projecten
-- en projectonderdelen.
--
-- Keuzes die hier in zitten:
--   B1a  klant -> project -> projectonderdeel (drie niveaus, geen subtaken)
--   B5a  alleen nacalculatie; het enum is uitbreidbaar zodra dat verandert
--   D2a  drie rechtenniveaus: medewerker, projectleider, eigenaar

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- enums ----

-- De volgorde is betekenisvol: rechten worden vergeleken met >= , dus
-- medewerker < projectleider < eigenaar.
create type rechten_niveau as enum ('medewerker', 'projectleider', 'eigenaar');

create type project_status as enum ('concept', 'actief', 'afgerond', 'gearchiveerd');

-- Levenscyclus van een uren- of ritregel. 'vervallen' vervangt verwijderen:
-- de administratie moet zeven jaar terug te lezen zijn.
create type regel_status as enum
  ('concept', 'ingediend', 'goedgekeurd', 'gefactureerd', 'vervallen');

create type weekstaat_status as enum ('concept', 'ingediend', 'goedgekeurd', 'afgekeurd');

-- C4a: een bezoek is een rit met een doel, geen eigen registratie.
create type rit_doel as enum
  ('klantbezoek', 'locatiebezoek', 'overleg', 'opleiding', 'overig');

-- B5a: voorlopig alleen nacalculatie. Uitbreiden gaat met
-- `alter type facturatiemodel add value 'vaste_prijs';`
create type facturatiemodel as enum ('nacalculatie');

-- --------------------------------------------------------- instellingen ----

-- Eén rij, afgedwongen door de primary key.
create table instellingen (
  id               boolean primary key default true check (id),
  bedrijfsnaam     text        not null default '',
  adres            text,
  postcode         text,
  plaats           text,
  -- C2a: kwartieren. Zie ook de check op urenregel.minuten; die twee horen
  -- bij elkaar en veranderen samen.
  tijdstap_minuten smallint    not null default 15
                     check (tijdstap_minuten in (1, 5, 10, 15, 30)),
  standaard_btw    numeric(5,2) not null default 21.00
                     check (standaard_btw >= 0 and standaard_btw <= 100),
  valuta           char(3)     not null default 'EUR',
  gewijzigd_op     timestamptz not null default now()
);

comment on table instellingen is
  'Organisatiebrede instellingen; bevat altijd precies één rij.';

insert into instellingen (id) values (true);

-- -------------------------------------------------------------- functie ----

-- De functie (junior adviseur, senior adviseur, ...) is wat in de
-- tariefzoekvolgorde "rol" heet. Bewust een andere naam dan `rechten`,
-- want dat is een heel ander begrip.
create table functie (
  id        uuid primary key default gen_random_uuid(),
  naam      text     not null unique,
  sortering smallint not null default 0,
  actief    boolean  not null default true
);

comment on table functie is
  'Functieniveaus voor tariefdifferentiatie (niveau 3, 5 en 7 van de zoekvolgorde).';

-- ----------------------------------------------------------- medewerker ----

create table medewerker (
  id             uuid primary key default gen_random_uuid(),
  -- Koppeling naar het Supabase-account. Null zolang iemand is aangemaakt
  -- maar nog niet heeft ingelogd.
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  naam           text not null check (length(btrim(naam)) > 0),
  email          text not null,
  functie_id     uuid references functie (id) on delete set null,
  rechten        rechten_niveau not null default 'medewerker',
  -- C3a: vanaf hier wordt de standaardafstand naar een klant gerekend.
  standplaats    text,
  in_dienst_vanaf date,
  uit_dienst_op  date,
  actief         boolean not null default true,
  aangemaakt_op  timestamptz not null default now(),
  check (uit_dienst_op is null or in_dienst_vanaf is null
         or uit_dienst_op >= in_dienst_vanaf)
);

create unique index medewerker_email_uniek on medewerker (lower(email));
create index medewerker_actief_idx on medewerker (actief) where actief;

-- ---------------------------------------------------------------- klant ----

create table klant (
  id                 uuid primary key default gen_random_uuid(),
  naam               text not null check (length(btrim(naam)) > 0),
  code               text,
  contactpersoon     text,
  email              text,
  telefoon           text,
  adres              text,
  postcode           text,
  plaats             text,
  land               text not null default 'NL',
  factuur_email      text,
  factuur_referentie text,
  btw_percentage     numeric(5,2) check (btw_percentage >= 0 and btw_percentage <= 100),
  -- C3a: enkele reis vanaf de standplaats. Eén keer invullen, daarna is een
  -- bezoek registreren twee tikken.
  afstand_km         numeric(6,1) check (afstand_km >= 0),
  actief             boolean not null default true,
  notities           text,
  aangemaakt_op      timestamptz not null default now()
);

create unique index klant_code_uniek on klant (lower(code)) where code is not null;

-- Woont een collega heel ergens anders, dan klopt de standaardafstand niet.
create table klant_afstand (
  klant_id      uuid not null references klant (id) on delete cascade,
  medewerker_id uuid not null references medewerker (id) on delete cascade,
  afstand_km    numeric(6,1) not null check (afstand_km >= 0),
  primary key (klant_id, medewerker_id)
);

comment on table klant_afstand is
  'Afwijkende enkele-reisafstand per medewerker; valt terug op klant.afstand_km.';

-- -------------------------------------------------------------- project ----

create table project (
  id               uuid primary key default gen_random_uuid(),
  klant_id         uuid not null references klant (id) on delete restrict,
  naam             text not null check (length(btrim(naam)) > 0),
  code             text,
  omschrijving     text,
  status           project_status  not null default 'actief',
  facturatiemodel  facturatiemodel not null default 'nacalculatie',
  projectleider_id uuid references medewerker (id) on delete set null,
  start_datum      date,
  eind_datum       date,
  budget_uren      numeric(10,2) check (budget_uren >= 0),
  budget_bedrag    numeric(12,2) check (budget_bedrag >= 0),
  aangemaakt_op    timestamptz not null default now(),
  check (eind_datum is null or start_datum is null or eind_datum >= start_datum)
);

create unique index project_code_uniek
  on project (klant_id, lower(code)) where code is not null;
create index project_klant_idx on project (klant_id);

-- ----------------------------------------------------- projectonderdeel ----

create table projectonderdeel (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  naam          text not null check (length(btrim(naam)) > 0),
  code          text,
  omschrijving  text,
  -- Niet-declarabele onderdelen (intern overleg, garantie) tellen wel mee in
  -- de kosten en niet in de omzet.
  declarabel    boolean not null default true,
  budget_uren   numeric(10,2) check (budget_uren >= 0),
  budget_bedrag numeric(12,2) check (budget_bedrag >= 0),
  sortering     smallint not null default 0,
  actief        boolean not null default true
);

create index projectonderdeel_project_idx on projectonderdeel (project_id);
