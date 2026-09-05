-- Boekhouding in de app (besluit E2, gewijzigd naar d: geen extern pakket).
--
-- Rekeningschema met balans en winst-en-verlies, een journaal van sluitende
-- boekingen (debet = credit, afgedwongen), automatische verkoopboekingen bij
-- het definitief maken van een factuur, betalingen via bank, kas of privé,
-- inkoopfacturen met voorbelasting, de btw-aangifte per periode, en het
-- afsluiten van een periode zodat er niets meer in verandert.
--
-- Alles wat geld verplaatst gaat door een functie; de functies draaien als
-- aanroeper, dus de rechten van de tabellen (alleen de eigenaar) gelden ook
-- daar. Boekingen worden nooit gewijzigd: een fout wordt teruggedraaid met
-- een tegenboeking of, zolang de periode open is, door de bron te verwijderen.

-- ------------------------------------------------------ rekeningschema ----

create type rekening_soort as enum ('activa', 'passiva', 'eigen_vermogen', 'omzet', 'kosten');

alter table grootboekrekening
  alter column soort drop default,
  alter column soort type rekening_soort
    using (case soort::text when 'balans' then 'activa' else soort::text end)::rekening_soort,
  alter column soort set default 'kosten',
  add column betaalmiddel boolean not null default false,
  add column btw_code     text references btw_tarief (code),
  add column toelichting  text;

drop type grootboek_soort;

comment on column grootboekrekening.betaalmiddel is
  'Waar een betaling vandaan komt of naartoe gaat: bank, kas, privé.';
comment on column grootboekrekening.btw_code is
  'Standaard btw-code bij een inkoop op deze rekening (kosten).';

insert into grootboekrekening (nummer, naam, soort, betaalmiddel, btw_code) values
  ('0500', 'Eigen vermogen',                   'eigen_vermogen', false, null),
  ('0600', 'Privé-stortingen en -opnamen',     'eigen_vermogen', true,  null),
  ('1000', 'Kas',                              'activa',         true,  null),
  ('1100', 'Bank',                             'activa',         true,  null),
  ('1300', 'Debiteuren',                       'activa',         false, null),
  ('1520', 'Te vorderen btw (voorbelasting)',  'activa',         false, null),
  ('1600', 'Crediteuren',                      'passiva',        false, null),
  ('1700', 'Af te dragen btw',                 'passiva',        false, null),
  ('1750', 'Btw-aangifte te betalen',          'passiva',        false, null),
  ('4000', 'Huisvesting',                      'kosten',         false, 'hoog'),
  ('4100', 'Auto- en reiskosten',              'kosten',         false, 'hoog'),
  ('4200', 'Kantoorkosten',                    'kosten',         false, 'hoog'),
  ('4300', 'Software en abonnementen',         'kosten',         false, 'hoog'),
  ('4400', 'Verzekeringen',                    'kosten',         false, 'vrijgesteld'),
  ('4500', 'Administratie en advies',          'kosten',         false, 'hoog'),
  ('4600', 'Marketing en acquisitie',          'kosten',         false, 'hoog'),
  ('4700', 'Lonen en salarissen',              'kosten',         false, 'vrijgesteld'),
  ('4800', 'Inhuur derden',                    'kosten',         false, 'hoog'),
  ('4900', 'Algemene kosten',                  'kosten',         false, 'hoog'),
  ('4950', 'Bankkosten',                       'kosten',         false, 'vrijgesteld')
on conflict (nummer) do nothing;

-- Vaste rekeningen waar de automatische boekingen op steunen.
alter table instellingen
  add column rekening_debiteuren        uuid references grootboekrekening (id),
  add column rekening_crediteuren       uuid references grootboekrekening (id),
  add column rekening_bank              uuid references grootboekrekening (id),
  add column rekening_btw_verschuldigd  uuid references grootboekrekening (id),
  add column rekening_btw_voorbelasting uuid references grootboekrekening (id),
  add column rekening_btw_aangifte      uuid references grootboekrekening (id),
  add column btw_aangifte_interval      herhaal_interval not null default 'kwartaal',
  add column afgesloten_tot             date;

update instellingen set
  rekening_debiteuren        = (select id from grootboekrekening where nummer = '1300'),
  rekening_crediteuren       = (select id from grootboekrekening where nummer = '1600'),
  rekening_bank              = (select id from grootboekrekening where nummer = '1100'),
  rekening_btw_verschuldigd  = (select id from grootboekrekening where nummer = '1700'),
  rekening_btw_voorbelasting = (select id from grootboekrekening where nummer = '1520'),
  rekening_btw_aangifte      = (select id from grootboekrekening where nummer = '1750')
where id;

comment on column instellingen.afgesloten_tot is
  'Tot en met deze datum is de boekhouding afgesloten: geen boekingen erbij of eraf.';

-- ------------------------------------------- factuur: export vervalt -------

-- Er is geen extern pakket meer; de exportvelden en de journaalview
-- verdwijnen. "Verwerkt" wordt "verstuurd": de eigenaar vinkt een
-- automatische factuur af zodra hij de deur uit is.
drop view v_factuur_journaal;
drop view v_factuur;

alter table factuur
  drop column geexporteerd_op,
  drop column export_kenmerk;
alter table factuur rename column verwerkt_op to verstuurd_op;

comment on column factuur.verstuurd_op is
  'Automatische factuur is verstuurd; tot dan staat hij bovenaan het factuurscherm.';

create view v_factuur with (security_invoker = true) as
select f.id, f.nummer, f.status, f.klant_id, k.naam as klant, f.project_id,
       p.naam as project, p.facturatiemodel::text as facturatiemodel,
       f.datum, f.vervaldatum, f.periode_van, f.periode_tot,
       f.subtotaal, f.btw_bedrag, f.totaal, f.betaald_op,
       case when f.status = 'definitief' then f.totaal else 0 end as openstaand,
       f.status = 'definitief' and f.vervaldatum < current_date as vervallen,
       f.credit_van_id, f.automatisch, f.verstuurd_op,
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

-- ---------------------------------------------------------- inkoop -------

create table inkoopfactuur (
  id              uuid primary key default gen_random_uuid(),
  leverancier     text not null check (length(btrim(leverancier)) > 0),
  omschrijving    text not null check (length(btrim(omschrijving)) > 0),
  kenmerk         text,                                   -- factuurnummer van de leverancier
  datum           date not null,
  vervaldatum     date,
  grootboek_id    uuid not null references grootboekrekening (id) on delete restrict,
  bedrag_excl     numeric(12,2) not null,
  btw_code        text not null references btw_tarief (code),
  btw_bedrag      numeric(12,2) not null default 0,
  bedrag_incl     numeric(12,2) generated always as (bedrag_excl + btw_bedrag) stored,
  betaald_op      date,
  betaald_via     uuid references grootboekrekening (id),
  aangemaakt_door uuid references medewerker (id) on delete set null,
  aangemaakt_op   timestamptz not null default now(),
  constraint inkoop_btw_zelfde_teken check (sign(btw_bedrag) in (0, sign(bedrag_excl))),
  constraint inkoop_betaald_compleet check ((betaald_op is null) = (betaald_via is null))
);

create index inkoopfactuur_datum_idx on inkoopfactuur (datum);
create index inkoopfactuur_open_idx on inkoopfactuur (vervaldatum) where betaald_op is null;

comment on table inkoopfactuur is
  'Kosten en inkopen: één regel per bon of factuur, op een kostenrekening, met voorbelasting.';

-- ---------------------------------------------------- btw-aangifte -------

create table btw_aangifte (
  id             uuid primary key default gen_random_uuid(),
  periode_start  date not null,
  periode_einde  date not null,
  omzet_hoog     numeric(12,2) not null default 0,
  btw_hoog       numeric(12,2) not null default 0,
  omzet_laag     numeric(12,2) not null default 0,
  btw_laag       numeric(12,2) not null default 0,
  omzet_nul      numeric(12,2) not null default 0,   -- 0%, verlegd
  voorbelasting  numeric(12,2) not null default 0,
  saldo          numeric(12,2) generated always as (btw_hoog + btw_laag - voorbelasting) stored,
  ingediend_op   date,
  betaald_op     date,
  betaald_via    uuid references grootboekrekening (id),
  aangemaakt_op  timestamptz not null default now(),
  constraint btw_aangifte_periode_ok check (periode_einde >= periode_start),
  constraint btw_aangifte_geen_overlap
    exclude using gist (daterange(periode_start, periode_einde, '[]') with &&)
);

comment on table btw_aangifte is
  'Vastgelegde btw-aangifte per periode; de bedragen zijn een momentopname bij het aanmaken.';

-- ---------------------------------------------------------- journaal -----

create type boeking_soort as enum ('verkoop', 'inkoop', 'bank', 'memoriaal', 'btw');

create table boeking (
  id              uuid primary key default gen_random_uuid(),
  volgnummer      bigint generated always as identity,   -- doorlopend, voor de accountant
  datum           date not null,
  soort           boeking_soort not null,
  omschrijving    text not null check (length(btrim(omschrijving)) > 0),
  factuur_id      uuid references factuur (id) on delete restrict,
  inkoop_id       uuid references inkoopfactuur (id) on delete cascade,
  aangifte_id     uuid references btw_aangifte (id) on delete cascade,
  aangemaakt_door uuid references medewerker (id) on delete set null,
  aangemaakt_op   timestamptz not null default now()
);

create index boeking_datum_idx on boeking (datum, volgnummer);
create index boeking_factuur_idx on boeking (factuur_id) where factuur_id is not null;
create index boeking_inkoop_idx on boeking (inkoop_id) where inkoop_id is not null;

create table boekingsregel (
  id           uuid primary key default gen_random_uuid(),
  boeking_id   uuid not null references boeking (id) on delete cascade,
  volgorde     smallint not null default 1,
  grootboek_id uuid not null references grootboekrekening (id) on delete restrict,
  debet        numeric(12,2) not null default 0 check (debet >= 0),
  credit       numeric(12,2) not null default 0 check (credit >= 0),
  omschrijving text,
  constraint boekingsregel_een_kant check (debet = 0 or credit = 0),
  constraint boekingsregel_niet_leeg check (debet <> 0 or credit <> 0)
);

create index boekingsregel_grootboek_idx on boekingsregel (grootboek_id);
create index boekingsregel_boeking_idx on boekingsregel (boeking_id, volgorde);

comment on table boeking is
  'Journaalpost: één gebeurtenis met regels die sluiten (debet = credit).';

-- Sluiten: aan het eind van de transactie moet elke geraakte boeking regels
-- hebben en in evenwicht zijn.
create or replace function controleer_boeking(p_boeking uuid)
returns void
language plpgsql
as $$
declare d numeric; c numeric;
begin
  if not exists (select 1 from boeking where id = p_boeking) then return; end if;
  select coalesce(sum(debet), 0), coalesce(sum(credit), 0) into d, c
  from boekingsregel where boeking_id = p_boeking;
  if d = 0 and c = 0 then
    raise exception 'Een boeking zonder regels.' using errcode = 'check_violation';
  end if;
  if d <> c then
    raise exception 'Boeking sluit niet: debet % tegenover credit %.', d, c
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function controleer_boeking_via_regel()
returns trigger language plpgsql as $$
begin
  perform controleer_boeking(coalesce(new.boeking_id, old.boeking_id));
  return null;
end;
$$;

create or replace function controleer_boeking_via_boeking()
returns trigger language plpgsql as $$
begin
  perform controleer_boeking(new.id);
  return null;
end;
$$;

create constraint trigger boekingsregel_sluit
  after insert or update or delete on boekingsregel
  deferrable initially deferred for each row
  execute function controleer_boeking_via_regel();

create constraint trigger boeking_heeft_regels
  after insert on boeking
  deferrable initially deferred for each row
  execute function controleer_boeking_via_boeking();

-- Afgesloten periode: niets erbij, niets eraf, niets verplaatst.
create or replace function weiger_in_afgesloten_periode()
returns trigger
language plpgsql
as $$
declare grens date; d date;
begin
  select afgesloten_tot into grens from instellingen where id;
  if grens is null then return coalesce(new, old); end if;
  if tg_table_name = 'boeking' then
    -- Let op: `old is not null` is voor een rij pas waar als álle kolommen
    -- gevuld zijn; daarom op tg_op.
    if (tg_op in ('DELETE', 'UPDATE') and old.datum <= grens)
       or (tg_op in ('INSERT', 'UPDATE') and new.datum <= grens) then
      raise exception 'De boekhouding is afgesloten tot en met %; deze boeking valt daarbinnen.', grens
        using errcode = 'restrict_violation';
    end if;
  else
    select datum into d from boeking where id = coalesce(new.boeking_id, old.boeking_id);
    if d <= grens then
      raise exception 'De boekhouding is afgesloten tot en met %; deze boeking valt daarbinnen.', grens
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger boeking_afgesloten before insert or update or delete on boeking
  for each row execute function weiger_in_afgesloten_periode();
create trigger boekingsregel_afgesloten before insert or update or delete on boekingsregel
  for each row execute function weiger_in_afgesloten_periode();

-- Verkoopboekingen verdwijnen nooit (een factuur draai je terug met een
-- creditfactuur); een btw-boeking alleen zolang de aangifte niet is ingediend.
create or replace function blokkeer_verwijderen_boeking()
returns trigger
language plpgsql
as $$
begin
  if old.soort = 'verkoop' then
    raise exception 'Een verkoopboeking verdwijnt niet; maak een creditfactuur.'
      using errcode = 'restrict_violation';
  end if;
  if old.soort = 'btw' and exists (select 1 from btw_aangifte where id = old.aangifte_id and ingediend_op is not null) then
    raise exception 'Deze btw-aangifte is ingediend; de boeking blijft staan.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger boeking_verwijderslot before delete on boeking
  for each row execute function blokkeer_verwijderen_boeking();

-- Regels van een boeking liggen vast zodra ze er staan.
create or replace function blokkeer_wijzigen_boekingsregel()
returns trigger language plpgsql as $$
begin
  raise exception 'Een boekingsregel wijzig je niet; draai de boeking terug.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger boekingsregel_slot before update on boekingsregel
  for each row execute function blokkeer_wijzigen_boekingsregel();

-- ------------------------------------------------------------ rechten -----

alter table inkoopfactuur enable row level security;
alter table btw_aangifte  enable row level security;
alter table boeking       enable row level security;
alter table boekingsregel enable row level security;

create policy inkoop_eigenaar on inkoopfactuur for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());
create policy btw_aangifte_eigenaar on btw_aangifte for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());
create policy boeking_eigenaar on boeking for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());
create policy boekingsregel_eigenaar on boekingsregel for all to authenticated
  using (is_eigenaar()) with check (is_eigenaar());

grant select, insert, update, delete on inkoopfactuur, btw_aangifte, boeking, boekingsregel
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ----------------------------------------------------------- boeken -------

-- Eén regel op een boeking. Positief is debet, negatief is credit; nul
-- slaat de regel over.
create or replace function boek_regel(p_boeking uuid, p_grootboek uuid, p_debet numeric, p_omschrijving text default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_debet is null or p_debet = 0 then return; end if;
  if p_grootboek is null then
    raise exception 'Geen grootboekrekening voor deze regel; controleer de vaste rekeningen onder Beheer → Grootboek.';
  end if;
  insert into boekingsregel (boeking_id, volgorde, grootboek_id, debet, credit, omschrijving)
  select p_boeking, coalesce(max(volgorde), 0) + 1, p_grootboek,
         greatest(p_debet, 0), greatest(-p_debet, 0), p_omschrijving
  from boekingsregel where boeking_id = p_boeking;
end;
$$;

-- Verkoop: debiteuren tegenover omzet per rekening en af te dragen btw.
-- Idempotent: een factuur heeft hoogstens één verkoopboeking.
create or replace function boek_verkoop(p_factuur uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  f   record;
  i   record;
  b   uuid;
  rij record;
begin
  select f2.*, k.naam as klant into f from factuur f2 join klant k on k.id = f2.klant_id where f2.id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  if f.status = 'concept' then raise exception 'Een concept boek je niet.'; end if;
  select id into b from boeking where factuur_id = p_factuur and soort = 'verkoop';
  if b is not null then return b; end if;
  select * into i from instellingen where id;

  insert into boeking (datum, soort, omschrijving, factuur_id, aangemaakt_door)
  values (f.datum, 'verkoop',
          case when f.credit_van_id is null then 'Factuur ' else 'Creditfactuur ' end || f.nummer || ' · ' || f.klant,
          p_factuur, f.aangemaakt_door)
  returning id into b;

  perform boek_regel(b, i.rekening_debiteuren, f.totaal, f.klant);
  for rij in
    select coalesce(fr.grootboek_id, i.grootboek_overig) as gb, sum(fr.bedrag) as bedrag
    from factuurregel fr where fr.factuur_id = p_factuur group by 1
  loop
    perform boek_regel(b, rij.gb, -rij.bedrag, 'Omzet');
  end loop;
  perform boek_regel(b, i.rekening_btw_verschuldigd, -f.btw_bedrag, 'Btw');
  return b;
end;
$$;

-- Definitief maken boekt nu ook.
create or replace function maak_definitief(p_factuur uuid, p_datum date default current_date)
returns text
language plpgsql
set search_path = public
as $$
declare
  f     record;
  nr    text;
  dagen integer;
  grens date;
begin
  select * into f from factuur where id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  if f.status <> 'concept' then raise exception 'Factuur % is al definitief.', f.nummer; end if;
  if not exists (select 1 from factuurregel where factuur_id = p_factuur) then
    raise exception 'Een factuur zonder regels kan niet definitief worden.';
  end if;
  select afgesloten_tot, betaaltermijn_dagen into grens, dagen from instellingen where id;
  if grens is not null and p_datum <= grens then
    raise exception 'De boekhouding is afgesloten tot en met %; kies een latere factuurdatum.', grens
      using errcode = 'restrict_violation';
  end if;

  perform herbereken_factuur(p_factuur);
  nr := volgend_factuurnummer();

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

  perform boek_verkoop(p_factuur);
  return nr;
end;
$$;

-- Betaling van een verkoopfactuur. `p_via` is het betaalmiddel (bank, kas,
-- privé); null betekent verrekend, bijvoorbeeld een creditfactuur tegen het
-- origineel — dan verschuift er niets, alleen de status.
create or replace function boek_betaling_factuur(p_factuur uuid, p_datum date, p_via uuid default null)
returns void
language plpgsql
set search_path = public
as $$
declare f record; i record; b uuid;
begin
  select f2.*, k.naam as klant into f from factuur f2 join klant k on k.id = f2.klant_id where f2.id = p_factuur;
  if f is null then raise exception 'Factuur niet gevonden.'; end if;
  if f.status <> 'definitief' then raise exception 'Alleen een openstaande factuur kan betaald worden.'; end if;
  if p_via is not null then
    if not exists (select 1 from grootboekrekening where id = p_via and betaalmiddel) then
      raise exception 'Kies een betaalmiddel (bank, kas of privé).';
    end if;
    select * into i from instellingen where id;
    insert into boeking (datum, soort, omschrijving, factuur_id)
    values (p_datum, 'bank',
            case when f.totaal < 0 then 'Terugbetaling ' else 'Ontvangst ' end || f.nummer || ' · ' || f.klant, p_factuur)
    returning id into b;
    perform boek_regel(b, p_via, f.totaal, f.klant);
    perform boek_regel(b, i.rekening_debiteuren, -f.totaal, f.nummer);
  end if;
  update factuur set status = 'betaald', betaald_op = p_datum where id = p_factuur;
end;
$$;

create or replace function maak_betaling_factuur_ongedaan(p_factuur uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if (select status from factuur where id = p_factuur) <> 'betaald' then
    raise exception 'Deze factuur staat niet op betaald.';
  end if;
  delete from boeking where factuur_id = p_factuur and soort = 'bank';
  update factuur set status = 'definitief', betaald_op = null where id = p_factuur;
end;
$$;

-- Inkoop: kosten en voorbelasting tegenover crediteuren.
create or replace function boek_inkoop(p_inkoop uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare k record; i record; b uuid;
begin
  select * into k from inkoopfactuur where id = p_inkoop;
  select * into i from instellingen where id;
  insert into boeking (datum, soort, omschrijving, inkoop_id, aangemaakt_door)
  values (k.datum, 'inkoop', k.leverancier || ' · ' || k.omschrijving, p_inkoop, k.aangemaakt_door)
  returning id into b;
  perform boek_regel(b, k.grootboek_id, k.bedrag_excl, k.omschrijving);
  perform boek_regel(b, i.rekening_btw_voorbelasting, k.btw_bedrag, 'Voorbelasting');
  perform boek_regel(b, i.rekening_crediteuren, -k.bedrag_incl, k.leverancier);
  return b;
end;
$$;

create or replace function boek_betaling_inkoop(p_inkoop uuid, p_datum date, p_via uuid)
returns void
language plpgsql
set search_path = public
as $$
declare k record; i record; b uuid;
begin
  select * into k from inkoopfactuur where id = p_inkoop;
  if k is null then raise exception 'Inkoopfactuur niet gevonden.'; end if;
  if k.betaald_op is not null then raise exception 'Deze inkoopfactuur is al betaald.'; end if;
  if not exists (select 1 from grootboekrekening where id = p_via and betaalmiddel) then
    raise exception 'Kies een betaalmiddel (bank, kas of privé).';
  end if;
  select * into i from instellingen where id;
  insert into boeking (datum, soort, omschrijving, inkoop_id)
  values (p_datum, 'bank', 'Betaling ' || k.leverancier || ' · ' || k.omschrijving, p_inkoop)
  returning id into b;
  perform boek_regel(b, i.rekening_crediteuren, k.bedrag_incl, k.leverancier);
  perform boek_regel(b, p_via, -k.bedrag_incl, k.leverancier);
  update inkoopfactuur set betaald_op = p_datum, betaald_via = p_via where id = p_inkoop;
end;
$$;

create or replace function maak_betaling_inkoop_ongedaan(p_inkoop uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from boeking where inkoop_id = p_inkoop and soort = 'bank';
  update inkoopfactuur set betaald_op = null, betaald_via = null where id = p_inkoop;
end;
$$;

-- Inkoopfactuur vastleggen (en meteen boeken). Een negatief bedrag is een
-- creditnota van de leverancier.
create or replace function maak_inkoopfactuur(
  p_leverancier text, p_omschrijving text, p_kenmerk text, p_datum date, p_vervaldatum date,
  p_grootboek uuid, p_bedrag_excl numeric, p_btw_code text, p_btw_bedrag numeric,
  p_betaald_op date default null, p_betaald_via uuid default null, p_door uuid default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare k_id uuid;
begin
  if not exists (select 1 from grootboekrekening where id = p_grootboek and soort in ('kosten', 'activa') and not betaalmiddel) then
    raise exception 'Kies een kosten- of activarekening voor de inkoop.';
  end if;
  insert into inkoopfactuur (leverancier, omschrijving, kenmerk, datum, vervaldatum, grootboek_id,
                             bedrag_excl, btw_code, btw_bedrag, aangemaakt_door)
  values (btrim(p_leverancier), btrim(p_omschrijving), nullif(btrim(p_kenmerk), ''), p_datum, p_vervaldatum,
          p_grootboek, p_bedrag_excl, p_btw_code, coalesce(p_btw_bedrag, 0), p_door)
  returning id into k_id;
  perform boek_inkoop(k_id);
  if p_betaald_op is not null then
    perform boek_betaling_inkoop(k_id, p_betaald_op, p_betaald_via);
  end if;
  return k_id;
end;
$$;

-- Wijzigen = terugdraaien en opnieuw boeken; de betaling gaat mee.
create or replace function werk_inkoopfactuur_bij(
  p_inkoop uuid, p_leverancier text, p_omschrijving text, p_kenmerk text, p_datum date, p_vervaldatum date,
  p_grootboek uuid, p_bedrag_excl numeric, p_btw_code text, p_btw_bedrag numeric)
returns void
language plpgsql
set search_path = public
as $$
declare k record;
begin
  select * into k from inkoopfactuur where id = p_inkoop;
  if k is null then raise exception 'Inkoopfactuur niet gevonden.'; end if;
  delete from boeking where inkoop_id = p_inkoop;
  update inkoopfactuur set
    leverancier = btrim(p_leverancier), omschrijving = btrim(p_omschrijving),
    kenmerk = nullif(btrim(p_kenmerk), ''), datum = p_datum, vervaldatum = p_vervaldatum,
    grootboek_id = p_grootboek, bedrag_excl = p_bedrag_excl, btw_code = p_btw_code,
    btw_bedrag = coalesce(p_btw_bedrag, 0)
  where id = p_inkoop;
  perform boek_inkoop(p_inkoop);
  if k.betaald_op is not null then
    update inkoopfactuur set betaald_op = null, betaald_via = null where id = p_inkoop;
    perform boek_betaling_inkoop(p_inkoop, k.betaald_op, k.betaald_via);
  end if;
end;
$$;

-- Memoriaal: een vrije boeking met regels als json:
--   [{"grootboek_id": "...", "debet": 500, "credit": 0, "omschrijving": "..."}, ...]
create or replace function boek_memoriaal(p_datum date, p_omschrijving text, p_regels jsonb, p_door uuid default null)
returns uuid
language plpgsql
set search_path = public
as $$
declare b uuid; r jsonb;
begin
  insert into boeking (datum, soort, omschrijving, aangemaakt_door)
  values (p_datum, 'memoriaal', btrim(p_omschrijving), p_door)
  returning id into b;
  for r in select * from jsonb_array_elements(p_regels) loop
    perform boek_regel(b, (r->>'grootboek_id')::uuid,
                       coalesce((r->>'debet')::numeric, 0) - coalesce((r->>'credit')::numeric, 0),
                       nullif(btrim(coalesce(r->>'omschrijving', '')), ''));
  end loop;
  perform controleer_boeking(b);
  return b;
end;
$$;

-- ------------------------------------------------------ btw-aangifte -----

-- Wat er in een periode is gefactureerd en ingekocht, in de rubrieken van
-- de aangifte. Op factuurdatum; vrijgestelde omzet staat niet in de aangifte.
create or replace function btw_overzicht(p_van date, p_tot date)
returns table (rubriek text, omschrijving text, grondslag numeric, btw numeric)
language sql
stable
set search_path = public
as $$
  with regels as (
    select fr.btw_code, fr.bedrag, round(fr.bedrag * fr.btw_percentage / 100, 2) as btw
    from factuurregel fr join factuur f on f.id = fr.factuur_id
    where f.status <> 'concept' and f.datum between p_van and p_tot
  ),
  inkoop as (
    select coalesce(sum(btw_bedrag), 0) as btw from inkoopfactuur where datum between p_van and p_tot
  )
  select '1a', 'Leveringen/diensten belast met hoog tarief',
         coalesce(sum(bedrag) filter (where btw_code = 'hoog'), 0),
         coalesce(sum(btw) filter (where btw_code = 'hoog'), 0)
  from regels
  union all
  select '1b', 'Leveringen/diensten belast met laag tarief',
         coalesce(sum(bedrag) filter (where btw_code = 'laag'), 0),
         coalesce(sum(btw) filter (where btw_code = 'laag'), 0)
  from regels
  union all
  select '1e', 'Leveringen/diensten belast met 0% of verlegd',
         coalesce(sum(bedrag) filter (where btw_code in ('nul', 'verlegd')), 0), 0
  from regels
  union all
  select '5b', 'Voorbelasting', null, btw from inkoop;
$$;

create or replace function maak_btw_aangifte(p_van date, p_tot date)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  a_id uuid;
  i    record;
  a    record;
  b    uuid;
  o_hoog numeric; b_hoog numeric; o_laag numeric; b_laag numeric; o_nul numeric; vb numeric;
begin
  select grondslag, btw into o_hoog, b_hoog from btw_overzicht(p_van, p_tot) where rubriek = '1a';
  select grondslag, btw into o_laag, b_laag from btw_overzicht(p_van, p_tot) where rubriek = '1b';
  select grondslag into o_nul from btw_overzicht(p_van, p_tot) where rubriek = '1e';
  select btw into vb from btw_overzicht(p_van, p_tot) where rubriek = '5b';

  insert into btw_aangifte (periode_start, periode_einde, omzet_hoog, btw_hoog, omzet_laag, btw_laag, omzet_nul, voorbelasting)
  values (p_van, p_tot, o_hoog, b_hoog, o_laag, b_laag, o_nul, vb)
  returning * into a;
  a_id := a.id;

  -- De aangifte schuift verschuldigd en voorbelasting naar één post.
  if a.saldo <> 0 or b_hoog + b_laag <> 0 or vb <> 0 then
    select * into i from instellingen where id;
    insert into boeking (datum, soort, omschrijving, aangifte_id)
    values (p_tot, 'btw', 'Btw-aangifte ' || to_char(p_van, 'DD-MM-YYYY') || ' t/m ' || to_char(p_tot, 'DD-MM-YYYY'), a_id)
    returning id into b;
    perform boek_regel(b, i.rekening_btw_verschuldigd, b_hoog + b_laag, 'Af te dragen');
    perform boek_regel(b, i.rekening_btw_voorbelasting, -vb, 'Voorbelasting');
    perform boek_regel(b, i.rekening_btw_aangifte, -a.saldo, 'Te betalen');
  end if;
  return a_id;
end;
$$;

create or replace function verwijder_btw_aangifte(p_aangifte uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if (select ingediend_op from btw_aangifte where id = p_aangifte) is not null then
    raise exception 'Deze aangifte is ingediend en blijft staan.' using errcode = 'restrict_violation';
  end if;
  delete from btw_aangifte where id = p_aangifte;   -- boeking gaat mee (cascade)
end;
$$;

create or replace function boek_betaling_btw(p_aangifte uuid, p_datum date, p_via uuid)
returns void
language plpgsql
set search_path = public
as $$
declare a record; i record; b uuid;
begin
  select * into a from btw_aangifte where id = p_aangifte;
  if a is null then raise exception 'Aangifte niet gevonden.'; end if;
  if a.betaald_op is not null then raise exception 'Deze aangifte is al afgerekend.'; end if;
  if not exists (select 1 from grootboekrekening where id = p_via and betaalmiddel) then
    raise exception 'Kies een betaalmiddel (bank, kas of privé).';
  end if;
  select * into i from instellingen where id;
  insert into boeking (datum, soort, omschrijving, aangifte_id)
  values (p_datum, 'bank',
          case when a.saldo < 0 then 'Teruggaaf btw ' else 'Afdracht btw ' end
            || to_char(a.periode_start, 'DD-MM-YYYY') || ' t/m ' || to_char(a.periode_einde, 'DD-MM-YYYY'),
          p_aangifte)
  returning id into b;
  perform boek_regel(b, i.rekening_btw_aangifte, a.saldo, 'Aangifte');
  perform boek_regel(b, p_via, -a.saldo, 'Belastingdienst');
  update btw_aangifte set betaald_op = p_datum, betaald_via = p_via,
                          ingediend_op = coalesce(ingediend_op, p_datum)
  where id = p_aangifte;
end;
$$;

-- ---------------------------------------------------------- rapporten -----

-- Saldi per rekening over een periode. Saldo is debet min credit: activa en
-- kosten positief, passiva, eigen vermogen en omzet negatief.
create or replace function grootboek_saldi(p_van date, p_tot date)
returns table (grootboek_id uuid, nummer text, naam text, soort rekening_soort, actief boolean,
               debet numeric, credit numeric, saldo numeric)
language sql
stable
set search_path = public
as $$
  select g.id, g.nummer, g.naam, g.soort, g.actief,
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

create view v_boeking with (security_invoker = true) as
select b.id, b.volgnummer, b.datum, b.soort, b.omschrijving, b.factuur_id, b.inkoop_id, b.aangifte_id,
       b.aangemaakt_op, f.nummer as factuurnummer,
       (select coalesce(sum(debet), 0) from boekingsregel r where r.boeking_id = b.id) as bedrag,
       (select count(*) from boekingsregel r where r.boeking_id = b.id) as regels
from boeking b
left join factuur f on f.id = b.factuur_id;

grant select on v_boeking to authenticated;
grant execute on all functions in schema public to authenticated;
