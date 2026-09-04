-- Wat er dagelijks in gaat: weekstaten, urenregels en ritten.
--
-- Keuzes die hier in zitten:
--   C2a  uren in stappen van 15 minuten
--   C3a  kilometers via een vaste afstand per klant, retour met één vinkje
--   C4a  een bezoek is een rit met een doel
--   B4a  bedragen worden bevroren zodra een regel wordt goedgekeurd
--   D1a  week indienen, eigenaar keurt goed
--   D3a  na facturatie corrigeer je met een tegenboeking, niet met een wijziging

-- ------------------------------------------------------------- weekstaat ---

create table weekstaat (
  id              uuid primary key default gen_random_uuid(),
  medewerker_id   uuid not null references medewerker (id) on delete cascade,
  jaar            smallint not null check (jaar between 2000 and 2100),
  week            smallint not null check (week between 1 and 53),
  status          weekstaat_status not null default 'concept',
  ingediend_op    timestamptz,
  beoordeeld_door uuid references medewerker (id) on delete set null,
  beoordeeld_op   timestamptz,
  opmerking       text,
  unique (medewerker_id, jaar, week)
);

comment on table weekstaat is
  'Eén week per medewerker: het moment waarop uren en ritten worden ingediend.';

-- ------------------------------------------------------------- urenregel ---

create table urenregel (
  id            uuid not null default gen_random_uuid(),
  medewerker_id uuid not null references medewerker (id) on delete restrict,
  onderdeel_id  uuid not null references projectonderdeel (id) on delete restrict,
  datum         date not null,

  -- C2a. Deze check en instellingen.tijdstap_minuten horen bij elkaar;
  -- een andere stap kiezen is één migratie.
  minuten       integer not null check (minuten <> 0 and minuten % 15 = 0),

  omschrijving  text,
  declarabel    boolean not null default true,
  status        regel_status not null default 'concept',

  -- Niveau 1 van de zoekvolgorde: een tarief dat op deze regel is opgelegd.
  tarief_handmatig numeric(10,2) check (tarief_handmatig >= 0),

  -- B4a. Het moment van bevriezen staat hier; de bevroren bedragen staan
  -- bewust in aparte tabellen, zie onder.
  bevroren_op            timestamptz,

  weekstaat_id       uuid references weekstaat (id) on delete set null,
  -- D3a: een correctie wijst terug naar de regel die hij tegenboekt.
  correctie_van_id   uuid,
  factuur_referentie text,

  aangemaakt_op timestamptz not null default now(),
  gewijzigd_op  timestamptz not null default now(),

  constraint urenregel_pkey primary key (id),
  constraint urenregel_correctie_fk
    foreign key (correctie_van_id) references urenregel (id) on delete set null
);

-- Negatieve minuten zijn alleen zinvol als tegenboeking.
alter table urenregel add constraint urenregel_negatief_is_correctie
  check (minuten > 0 or correctie_van_id is not null);

create index urenregel_medewerker_datum_idx on urenregel (medewerker_id, datum);
create index urenregel_onderdeel_idx        on urenregel (onderdeel_id);
create index urenregel_weekstaat_idx        on urenregel (weekstaat_id);
create index urenregel_status_idx           on urenregel (status);

comment on column urenregel.minuten is
  'Veelvoud van 15. Negatief is toegestaan voor een correctieregel.';

-- ------------------------------------------------- bevroren bedragen -------

-- De bevroren bedragen staan niet op de urenregel zelf. Een medewerker mag
-- zijn eigen regel lezen en een projectleider die van zijn hele team; stonden
-- de bedragen daarop, dan lag de kostprijs van collega's alsnog open (keuze
-- D2a). Twee tabellen, omdat de twee bedragen niet even gevoelig zijn:
-- een verkooptarief mag een projectleider zien, een kostprijs niet.

create table bevroren_verkoop (
  urenregel_id  uuid primary key references urenregel (id) on delete cascade,
  verkooptarief numeric(10,2),
  bevroren_op   timestamptz not null default now()
);

comment on table bevroren_verkoop is
  'Verkooptarief zoals het gold bij goedkeuring. Leesbaar vanaf projectleider.';

create table bevroren_kosten (
  urenregel_id uuid primary key references urenregel (id) on delete cascade,
  kostprijs    numeric(10,2),
  bevroren_op  timestamptz not null default now()
);

comment on table bevroren_kosten is
  'Interne kostprijs zoals die gold bij goedkeuring. Alleen voor de eigenaar.';

-- ------------------------------------------------------------------ rit ----

create table rit (
  id            uuid primary key default gen_random_uuid(),
  medewerker_id uuid not null references medewerker (id) on delete restrict,
  klant_id      uuid references klant (id) on delete restrict,
  project_id    uuid references project (id) on delete restrict,
  datum         date not null,
  doel          rit_doel not null default 'klantbezoek',
  omschrijving  text,
  van_adres     text,
  naar_adres    text,

  -- C3a: enkele reis; `retour` verdubbelt.
  afstand_km    numeric(7,1) not null check (afstand_km >= 0),
  retour        boolean not null default true,
  totaal_km     numeric(8,1) generated always as
                  (afstand_km * (case when retour then 2 else 1 end)) stored,

  declarabel    boolean not null default true,
  status        regel_status not null default 'concept',

  bevroren_km_tarief numeric(6,3),
  bevroren_op        timestamptz,

  weekstaat_id       uuid references weekstaat (id) on delete set null,
  factuur_referentie text,

  aangemaakt_op timestamptz not null default now(),
  gewijzigd_op  timestamptz not null default now()
);

create index rit_medewerker_datum_idx on rit (medewerker_id, datum);
create index rit_klant_idx            on rit (klant_id);
create index rit_weekstaat_idx        on rit (weekstaat_id);

comment on table rit is
  'Rit en bezoek in één. Het veld `doel` maakt er een bezoek van (keuze C4a).';

-- --------------------------------------------------------------- triggers --

create or replace function zet_gewijzigd_op()
returns trigger
language plpgsql
as $$
begin
  new.gewijzigd_op := now();
  return new;
end;
$$;

create trigger urenregel_gewijzigd before update on urenregel
  for each row execute function zet_gewijzigd_op();
create trigger rit_gewijzigd before update on rit
  for each row execute function zet_gewijzigd_op();

-- B4a: zodra een regel wordt goedgekeurd of gefactureerd liggen de bedragen
-- vast. Daarvoor worden ze steeds opnieuw berekend, zodat een fout in een
-- tarief nog te herstellen is. Gaat een regel terug naar concept, dan
-- vervallen de bevroren bedragen weer.

create or replace function markeer_bevroren()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('goedgekeurd', 'gefactureerd') then
    if tg_op = 'INSERT' or old.status not in ('goedgekeurd', 'gefactureerd') then
      new.bevroren_op := now();
    end if;
  elsif new.status in ('concept', 'ingediend') then
    new.bevroren_op := null;
  end if;
  return new;
end;
$$;

create trigger urenregel_bevriesmoment before insert or update on urenregel
  for each row execute function markeer_bevroren();

-- Na de rij-wijziging, want de zijtabellen verwijzen met een foreign key
-- naar de urenregel.
create or replace function bevries_bedragen()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status in ('goedgekeurd', 'gefactureerd')
     and (tg_op = 'INSERT' or old.status not in ('goedgekeurd', 'gefactureerd'))
  then
    insert into bevroren_verkoop (urenregel_id, verkooptarief)
    values (new.id, coalesce(new.tarief_handmatig,
                             tarief_voor(new.onderdeel_id, new.medewerker_id, new.datum)))
    on conflict (urenregel_id) do update
      set verkooptarief = excluded.verkooptarief,
          bevroren_op   = excluded.bevroren_op;

    insert into bevroren_kosten (urenregel_id, kostprijs)
    values (new.id, kostprijs_voor(new.medewerker_id, new.datum))
    on conflict (urenregel_id) do update
      set kostprijs   = excluded.kostprijs,
          bevroren_op = excluded.bevroren_op;

  elsif tg_op = 'UPDATE'
        and new.status in ('concept', 'ingediend')
        and old.status in ('goedgekeurd', 'gefactureerd')
  then
    delete from bevroren_verkoop where urenregel_id = new.id;
    delete from bevroren_kosten  where urenregel_id = new.id;
  end if;
  return null;
end;
$$;

create trigger urenregel_bevriezen after insert or update on urenregel
  for each row execute function bevries_bedragen();

create or replace function bevries_rit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status in ('goedgekeurd', 'gefactureerd')
     and (tg_op = 'INSERT' or old.status not in ('goedgekeurd', 'gefactureerd'))
  then
    new.bevroren_km_tarief := km_tarief_voor(new.datum);
    new.bevroren_op := now();
  end if;
  return new;
end;
$$;

create trigger rit_bevriezen before insert or update on rit
  for each row execute function bevries_rit();

-- D3a: een gefactureerde regel wijzig je niet meer. Alleen de status mag nog
-- veranderen (bijvoorbeeld naar 'vervallen', met een tegenboeking ernaast).
create or replace function blokkeer_gefactureerde_urenregel()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'gefactureerd'
     and (new.datum         is distinct from old.datum
       or new.minuten       is distinct from old.minuten
       or new.onderdeel_id  is distinct from old.onderdeel_id
       or new.medewerker_id is distinct from old.medewerker_id
       or new.declarabel    is distinct from old.declarabel
       or new.tarief_handmatig is distinct from old.tarief_handmatig)
  then
    raise exception
      'Urenregel % is gefactureerd; maak een correctieregel in plaats van te wijzigen.',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger urenregel_gefactureerd_slot before update on urenregel
  for each row execute function blokkeer_gefactureerde_urenregel();

create or replace function blokkeer_gefactureerde_rit()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'gefactureerd'
     and (new.datum         is distinct from old.datum
       or new.afstand_km    is distinct from old.afstand_km
       or new.retour        is distinct from old.retour
       or new.klant_id      is distinct from old.klant_id
       or new.medewerker_id is distinct from old.medewerker_id
       or new.declarabel    is distinct from old.declarabel
       or new.bevroren_km_tarief is distinct from old.bevroren_km_tarief)
  then
    raise exception
      'Rit % is gefactureerd; maak een correctieregel in plaats van te wijzigen.',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger rit_gefactureerd_slot before update on rit
  for each row execute function blokkeer_gefactureerde_rit();
