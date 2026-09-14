-- Verkoop: pipeline van prospects, onderwerpen per prospect, en gesprekken
-- met transcript (live meegeschreven in de browser of geplakt).
--
-- Een prospect loopt door fasen tot hij gewonnen of verloren is; gewonnen
-- maakt er een klant van. Onderwerpen zijn een catalogus (diensten, thema's)
-- die je aan een prospect hangt met een status, zodat je ziet wie waarin
-- geïnteresseerd is. Gesprekken hangen aan een prospect of een klant en
-- dragen transcript, samenvatting en afspraken.
--
-- Rechten: verkoop is voor projectleider en eigenaar. Een medewerker ziet
-- geen prospects, maar mag wel een gesprek met een klant vastleggen en zijn
-- eigen gesprekken teruglezen.

create type pipeline_fase as enum ('lead', 'contact', 'afspraak', 'offerte', 'gewonnen', 'verloren');
create type onderwerp_status as enum ('interesse', 'besproken', 'offerte', 'akkoord', 'afgewezen');
create type gesprek_soort as enum ('telefoon', 'bezoek', 'video', 'overig');

-- --------------------------------------------------------------- prospect --

create table prospect (
  id                 uuid primary key default gen_random_uuid(),
  naam               text not null check (length(btrim(naam)) > 0),   -- organisatie
  contactpersoon     text,
  email              text,
  telefoon           text,
  plaats             text,
  bron               text,                                            -- website, netwerk, verwijzing, koud, overig
  fase               pipeline_fase not null default 'lead',
  waarde             numeric(12,2) check (waarde >= 0),               -- verwachte opdrachtwaarde excl. btw
  kans               smallint not null default 20 check (kans between 0 and 100),
  verwacht_op        date,                                            -- verwachte beslissing
  volgende_actie     text,
  volgende_actie_op  date,
  eigenaar_id        uuid references medewerker (id) on delete set null,
  klant_id           uuid references klant (id) on delete set null,   -- na winst
  verloren_reden     text,
  notities           text,
  gesloten_op        date,
  aangemaakt_op      timestamptz not null default now(),
  gewijzigd_op       timestamptz not null default now()
);

create index prospect_fase_idx on prospect (fase, verwacht_op);
create index prospect_eigenaar_idx on prospect (eigenaar_id);

comment on table prospect is 'Een mogelijke opdracht: van lead tot gewonnen of verloren.';

-- Standaardkans per fase; de gebruiker mag hem daarna zelf zetten.
create or replace function kans_bij_fase(p pipeline_fase) returns smallint language sql immutable as $$
  select case p when 'lead' then 10 when 'contact' then 25 when 'afspraak' then 50
                when 'offerte' then 70 when 'gewonnen' then 100 else 0 end::smallint;
$$;

-- Fasehistorie, voor doorlooptijd en om te zien wat er gebeurd is.
create table prospect_fase_log (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospect (id) on delete cascade,
  van         pipeline_fase,
  naar        pipeline_fase not null,
  door        uuid references medewerker (id) on delete set null,
  op          timestamptz not null default now()
);

create index prospect_fase_log_idx on prospect_fase_log (prospect_id, op);

-- Vóór het schrijven: kans en sluitdatum volgen de fase.
create or replace function prospect_voor_schrijven()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.fase is distinct from old.fase then
    if new.fase in ('gewonnen', 'verloren') then
      new.gesloten_op := coalesce(new.gesloten_op, current_date);
      new.kans := case when new.fase = 'gewonnen' then 100 else 0 end;
    else
      if old.fase in ('gewonnen', 'verloren') then new.gesloten_op := null; end if;
      if new.kans = old.kans then new.kans := kans_bij_fase(new.fase); end if;
    end if;
  end if;
  new.gewijzigd_op := now();
  return new;
end;
$$;

-- Ná het schrijven: de fasewissel in het logboek. Security definer, want de
-- log is voor gebruikers alleen leesbaar.
create or replace function prospect_fase_loggen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into prospect_fase_log (prospect_id, van, naar, door) values (new.id, null, new.fase, huidige_medewerker());
  elsif new.fase is distinct from old.fase then
    insert into prospect_fase_log (prospect_id, van, naar, door) values (new.id, old.fase, new.fase, huidige_medewerker());
  end if;
  return null;
end;
$$;

create trigger prospect_voor before insert or update on prospect
  for each row execute function prospect_voor_schrijven();
create trigger prospect_log after insert or update on prospect
  for each row execute function prospect_fase_loggen();

-- Gewonnen: er komt een klant, of hij wordt aan een bestaande gekoppeld.
create or replace function win_prospect(p_prospect uuid, p_klant uuid default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare p record; k uuid;
begin
  select * into p from prospect where id = p_prospect;
  if p is null then raise exception 'Prospect niet gevonden.'; end if;
  k := coalesce(p_klant, p.klant_id);
  if k is null then
    insert into klant (naam, contactpersoon, email, telefoon, plaats, notities)
    values (p.naam, p.contactpersoon, p.email, p.telefoon, p.plaats,
            'Gewonnen prospect' || coalesce(' · bron: ' || p.bron, ''))
    returning id into k;
  end if;
  update prospect set fase = 'gewonnen', klant_id = k, volgende_actie = null, volgende_actie_op = null
  where id = p_prospect;
  -- De gesprekken gaan mee naar de klant, zodat de geschiedenis daar staat.
  update gesprek set klant_id = k where prospect_id = p_prospect and klant_id is null;
  return k;
end;
$$;

create or replace function verlies_prospect(p_prospect uuid, p_reden text)
returns void
language sql
set search_path = public
as $$
  update prospect set fase = 'verloren', verloren_reden = nullif(btrim(p_reden), ''),
                      volgende_actie = null, volgende_actie_op = null
  where id = p_prospect;
$$;

-- ------------------------------------------------------------ onderwerpen --

create table onderwerp (
  id           uuid primary key default gen_random_uuid(),
  naam         text not null check (length(btrim(naam)) > 0),
  omschrijving text,
  actief       boolean not null default true,
  sortering    smallint not null default 0
);

create unique index onderwerp_naam_uniek on onderwerp (lower(naam));

comment on table onderwerp is 'Catalogus van diensten en thema''s die je met prospects bespreekt.';

create table prospect_onderwerp (
  prospect_id  uuid not null references prospect (id) on delete cascade,
  onderwerp_id uuid not null references onderwerp (id) on delete restrict,
  status       onderwerp_status not null default 'interesse',
  notitie      text,
  gewijzigd_op timestamptz not null default now(),
  primary key (prospect_id, onderwerp_id)
);

-- --------------------------------------------------------------- gesprek --

create table gesprek (
  id             uuid primary key default gen_random_uuid(),
  prospect_id    uuid references prospect (id) on delete cascade,
  klant_id       uuid references klant (id) on delete cascade,
  medewerker_id  uuid not null references medewerker (id) on delete restrict,
  datum          timestamptz not null default now(),
  titel          text not null check (length(btrim(titel)) > 0),
  soort          gesprek_soort not null default 'telefoon',
  duur_minuten   integer check (duur_minuten >= 0),
  taal           text not null default 'nl-NL',
  transcript     text,
  samenvatting   text,
  afspraken      text,                                 -- actiepunten, één per regel
  live           boolean not null default false,       -- meegeschreven met spraakherkenning
  aangemaakt_op  timestamptz not null default now(),
  gewijzigd_op   timestamptz not null default now(),
  constraint gesprek_heeft_relatie check (prospect_id is not null or klant_id is not null)
);

create index gesprek_prospect_idx on gesprek (prospect_id, datum desc);
create index gesprek_klant_idx on gesprek (klant_id, datum desc);
create index gesprek_medewerker_idx on gesprek (medewerker_id, datum desc);

comment on table gesprek is 'Gespreksverslag met transcript, samenvatting en afspraken.';

-- ------------------------------------------------------------- pipeline --

create view v_pipeline with (security_invoker = true) as
select f.fase,
       count(p.id)                                        as aantal,
       coalesce(sum(p.waarde), 0)                         as waarde,
       coalesce(sum(p.waarde * p.kans / 100.0), 0)        as gewogen,
       count(p.id) filter (where p.volgende_actie_op < current_date) as achterstallig
from unnest(enum_range(null::pipeline_fase)) as f(fase)
left join prospect p on p.fase = f.fase
  and (p.fase not in ('gewonnen', 'verloren') or p.gesloten_op >= date_trunc('year', current_date))
group by f.fase
order by f.fase;

grant select on v_pipeline to authenticated;

-- ------------------------------------------------------------- rechten -----

alter table prospect           enable row level security;
alter table prospect_fase_log  enable row level security;
alter table onderwerp          enable row level security;
alter table prospect_onderwerp enable row level security;
alter table gesprek            enable row level security;

create policy prospect_pl on prospect for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));
create policy prospect_fase_log_pl on prospect_fase_log for select to authenticated
  using (minstens('projectleider'));
create policy onderwerp_lezen on onderwerp for select to authenticated using (true);
create policy onderwerp_pl on onderwerp for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));
create policy prospect_onderwerp_pl on prospect_onderwerp for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));
-- Gesprekken: projectleider en eigenaar alles; een medewerker zijn eigen
-- gesprekken, en alleen met een klant (prospects zijn voor hem onzichtbaar).
create policy gesprek_lezen on gesprek for select to authenticated
  using (minstens('projectleider') or medewerker_id = huidige_medewerker());
create policy gesprek_schrijven on gesprek for insert to authenticated
  with check (minstens('projectleider') or (medewerker_id = huidige_medewerker() and prospect_id is null));
create policy gesprek_wijzigen on gesprek for update to authenticated
  using (minstens('projectleider') or medewerker_id = huidige_medewerker())
  with check (minstens('projectleider') or (medewerker_id = huidige_medewerker() and prospect_id is null));
create policy gesprek_verwijderen on gesprek for delete to authenticated
  using (minstens('projectleider') or medewerker_id = huidige_medewerker());

grant select, insert, update, delete on prospect, onderwerp, prospect_onderwerp, gesprek to authenticated;
grant select on prospect_fase_log to authenticated;
grant execute on all functions in schema public to authenticated;
