-- Tests op het schema. Draait tegen een lege database waarop de migraties
-- zijn uitgevoerd. Faalt hard bij de eerste afwijking.
--
--   psql -f supabase/tests/00_auth_shim.sql
--   psql -f supabase/migrations/*.sql
--   psql -f supabase/tests/10_schema_test.sql

\set ON_ERROR_STOP on
set client_min_messages to notice;

-- ------------------------------------------------------------ opzetten -----

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'martijn@example.nl'),
  ('22222222-2222-2222-2222-222222222222', 'jansen@example.nl'),
  ('33333333-3333-3333-3333-333333333333', 'devries@example.nl');

insert into functie (id, naam, sortering) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Senior adviseur', 1),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Junior adviseur', 2);

insert into medewerker (id, auth_user_id, naam, email, functie_id, rechten, standplaats) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Martijn Antonissen', 'martijn@example.nl',
   'aaaaaaaa-0000-0000-0000-000000000001', 'eigenaar', 'Breda'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Petra Jansen', 'jansen@example.nl',
   'aaaaaaaa-0000-0000-0000-000000000002', 'medewerker', 'Utrecht'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'Sam de Vries', 'devries@example.nl',
   'aaaaaaaa-0000-0000-0000-000000000001', 'projectleider', 'Breda');

insert into klant (id, naam, code, plaats, afstand_km) values
  ('cccccccc-0000-0000-0000-000000000001', 'Gemeente Noord', 'NOORD', 'Zwolle', 82.5);

insert into project (id, klant_id, naam, code, projectleider_id, budget_uren) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'Herinrichting centrum', 'NOORD-01',
   'bbbbbbbb-0000-0000-0000-000000000003', 200);

insert into projectonderdeel (id, project_id, naam, sortering) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'Migratie', 1),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'Intern overleg', 2);

update projectonderdeel set declarabel = false
  where id = 'eeeeeeee-0000-0000-0000-000000000002';

insert into kostprijs (medewerker_id, bedrag_per_uur, geldig_vanaf) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 62.00, '2026-01-01');

insert into km_tarief (bedrag_per_km, geldig_vanaf, toelichting) values
  (0.230, '2026-01-01', 'Controleer het bedrag voor het lopende jaar.');

-- ------------------------------------------- 1. de tariefzoekvolgorde ------

-- Alle zes niveaus tegelijk, allemaal van toepassing op dezelfde urenregel.
insert into tariefregel (onderdeel_id, bedrag_per_uur, geldig_vanaf) values
  ('eeeeeeee-0000-0000-0000-000000000001', 120, '2026-01-01');                    -- 2
insert into tariefregel (project_id, functie_id, bedrag_per_uur, geldig_vanaf) values
  ('dddddddd-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 145, '2026-01-01');                    -- 3
insert into tariefregel (project_id, bedrag_per_uur, geldig_vanaf) values
  ('dddddddd-0000-0000-0000-000000000001', 130, '2026-01-01');                    -- 4
insert into tariefregel (klant_id, functie_id, bedrag_per_uur, geldig_vanaf) values
  ('cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 110, '2026-01-01');                    -- 5
insert into tariefregel (klant_id, bedrag_per_uur, geldig_vanaf) values
  ('cccccccc-0000-0000-0000-000000000001', 105, '2026-01-01');                    -- 6
insert into tariefregel (functie_id, bedrag_per_uur, geldig_vanaf) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 95, '2026-01-01');                     -- 7

do $$
declare
  v_onderdeel constant uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_mw        constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_datum     constant date := '2026-03-12';
  verwacht    numeric[] := array[120, 145, 130, 110, 105, 95];
  stap        int;
  gevonden    numeric;
begin
  -- Zak niveau voor niveau af door telkens de bovenste regel weg te halen.
  for stap in 1 .. array_length(verwacht, 1) loop
    gevonden := tarief_voor(v_onderdeel, v_mw, v_datum);
    if gevonden is distinct from verwacht[stap] then
      raise exception 'Zoekvolgorde stap %: verwacht %, gevonden %',
        stap, verwacht[stap], gevonden;
    end if;
    delete from tariefregel
     where id = (select t.id from tariefregel t order by t.niveau limit 1);
  end loop;

  if tarief_voor(v_onderdeel, v_mw, v_datum) is not null then
    raise exception 'Zonder tariefregels hoort er geen tarief te zijn';
  end if;
  raise notice 'OK  1. zoekvolgorde doorloopt alle zes niveaus';
end
$$;

-- --------------------------------------- 2. tarieven werken op datum ------

insert into tariefregel (project_id, bedrag_per_uur, geldig_vanaf, geldig_tot) values
  ('dddddddd-0000-0000-0000-000000000001', 130, '2026-01-01', '2026-06-30');
insert into tariefregel (project_id, bedrag_per_uur, geldig_vanaf) values
  ('dddddddd-0000-0000-0000-000000000001', 140, '2026-07-01');

do $$
declare
  v_onderdeel constant uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_mw        constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
begin
  if tarief_voor(v_onderdeel, v_mw, '2026-03-12') <> 130 then
    raise exception 'Maart hoort het oude tarief te krijgen';
  end if;
  if tarief_voor(v_onderdeel, v_mw, '2026-06-30') <> 130 then
    raise exception 'geldig_tot hoort inclusief te zijn';
  end if;
  if tarief_voor(v_onderdeel, v_mw, '2026-08-01') <> 140 then
    raise exception 'Augustus hoort het nieuwe tarief te krijgen';
  end if;
  raise notice 'OK  2. tarief wordt gezocht op de datum van de regel';
end
$$;

do $$
begin
  begin
    insert into tariefregel (project_id, bedrag_per_uur, geldig_vanaf) values
      ('dddddddd-0000-0000-0000-000000000001', 999, '2026-03-01');
    raise exception 'Overlappende tariefregel had geweigerd moeten worden';
  exception when exclusion_violation then
    raise notice 'OK  3. overlappende tariefperiodes worden geweigerd';
  end;
end
$$;

-- ------------------------------------------------- 4. invoerbewaking -------

do $$
begin
  begin
    insert into urenregel (medewerker_id, onderdeel_id, datum, minuten) values
      ('bbbbbbbb-0000-0000-0000-000000000002',
       'eeeeeeee-0000-0000-0000-000000000001', '2026-03-12', 20);
    raise exception '20 minuten had geweigerd moeten worden (keuze C2a)';
  exception when check_violation then
    raise notice 'OK  4. uren buiten het kwartier worden geweigerd';
  end;

  begin
    insert into urenregel (medewerker_id, onderdeel_id, datum, minuten) values
      ('bbbbbbbb-0000-0000-0000-000000000002',
       'eeeeeeee-0000-0000-0000-000000000001', '2026-03-12', -60);
    raise exception 'Negatieve uren zonder correctieverwijzing horen te weigeren';
  exception when check_violation then
    raise notice 'OK  5. negatieve uren alleen als correctieregel';
  end;
end
$$;

-- ------------------------------------------ 6. bevriezen bij goedkeuren ----

insert into urenregel (id, medewerker_id, onderdeel_id, datum, minuten, omschrijving)
values ('ffffffff-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'eeeeeeee-0000-0000-0000-000000000001', '2026-03-12', 210, 'Datamigratie');

do $$
declare r record;
begin
  select * into r from v_urenregel where id = 'ffffffff-0000-0000-0000-000000000001';
  if r.uren <> 3.5 then raise exception 'Verwacht 3,5 uur, kreeg %', r.uren; end if;
  if r.verkooptarief <> 130 then
    raise exception 'Live tarief hoort 130 te zijn, kreeg %', r.verkooptarief;
  end if;
  if r.omzet <> 455.00 then raise exception 'Omzet hoort 455 te zijn, kreeg %', r.omzet; end if;
  if r.kosten <> 217.00 then raise exception 'Kosten horen 217 te zijn, kreeg %', r.kosten; end if;
  if r.bevroren then raise exception 'Een conceptregel hoort niet bevroren te zijn'; end if;
  raise notice 'OK  6. bedragen worden live berekend zolang de regel concept is';
end
$$;

update urenregel set status = 'goedgekeurd'
 where id = 'ffffffff-0000-0000-0000-000000000001';

-- Tariefverhoging met terugwerkende kracht: de goedgekeurde regel mag niet
-- meebewegen (keuze B4a).
update tariefregel set bedrag_per_uur = 200
 where project_id = 'dddddddd-0000-0000-0000-000000000001'
   and geldig_vanaf = '2026-01-01';

do $$
declare r record;
begin
  select * into r from v_urenregel where id = 'ffffffff-0000-0000-0000-000000000001';
  if not r.bevroren then raise exception 'Goedgekeurde regel hoort bevroren te zijn'; end if;
  if r.verkooptarief <> 130 then
    raise exception 'Bevroren tarief hoort 130 te blijven, kreeg %', r.verkooptarief;
  end if;
  if r.omzet <> 455.00 then
    raise exception 'Bevroren omzet hoort 455 te blijven, kreeg %', r.omzet;
  end if;
  raise notice 'OK  7. tariefverhoging raakt goedgekeurde uren niet';
end
$$;

-- Terug naar concept: dan telt weer het actuele tarief.
update urenregel set status = 'concept'
 where id = 'ffffffff-0000-0000-0000-000000000001';

do $$
declare r record;
begin
  select * into r from v_urenregel where id = 'ffffffff-0000-0000-0000-000000000001';
  if r.verkooptarief <> 200 then
    raise exception 'Na terugzetten hoort het actuele tarief te gelden, kreeg %',
      r.verkooptarief;
  end if;
  raise notice 'OK  8. afgekeurde regel valt terug op het actuele tarief';
end
$$;

-- ---------------------------------------------- 9. slot na facturatie ------

update urenregel set status = 'gefactureerd'
 where id = 'ffffffff-0000-0000-0000-000000000001';

do $$
begin
  begin
    update urenregel set minuten = 240
     where id = 'ffffffff-0000-0000-0000-000000000001';
    raise exception 'Een gefactureerde regel mag niet gewijzigd worden';
  exception when restrict_violation then
    raise notice 'OK  9. gefactureerde regel is op slot (keuze D3a)';
  end;
end
$$;

insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, correctie_van_id)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        'eeeeeeee-0000-0000-0000-000000000001', '2026-05-04', -60,
        'ffffffff-0000-0000-0000-000000000001');

do $$
begin
  raise notice 'OK 10. tegenboeking op een gefactureerde regel kan wel';
end
$$;

-- ------------------------------------------------ 11. ritten en bezoek -----

insert into rit (medewerker_id, klant_id, project_id, datum, doel, afstand_km, retour)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', '2026-03-12', 'klantbezoek',
        afstand_voor('cccccccc-0000-0000-0000-000000000001',
                     'bbbbbbbb-0000-0000-0000-000000000002'), true);

do $$
declare r record;
begin
  select * into r from v_rit where datum = '2026-03-12';
  if r.afstand_km <> 82.5 then
    raise exception 'Afstand hoort van de klant te komen, kreeg %', r.afstand_km;
  end if;
  if r.totaal_km <> 165.0 then
    raise exception 'Retour hoort te verdubbelen, kreeg %', r.totaal_km;
  end if;
  if r.km_bedrag <> 37.95 then
    raise exception '165 km a 0,23 hoort 37,95 te zijn, kreeg %', r.km_bedrag;
  end if;
  if (select count(*) from v_bezoek) <> 1 then
    raise exception 'Het bezoek hoort in v_bezoek te staan';
  end if;
  raise notice 'OK 11. rit met vaste klantafstand, retour en bezoektelling';
end
$$;

-- Afwijkende standplaats gaat voor.
insert into klant_afstand (klant_id, medewerker_id, afstand_km) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 55.0);

do $$
begin
  if afstand_voor('cccccccc-0000-0000-0000-000000000001',
                  'bbbbbbbb-0000-0000-0000-000000000002') <> 55.0 then
    raise exception 'Persoonlijke afstand hoort voor te gaan';
  end if;
  raise notice 'OK 12. eigen afstand gaat voor de standaard van de klant';
end
$$;

-- ------------------------------------------------------ 13. afscherming ----

-- Dit is keuze D2a, en het belangrijkste dat hier getest wordt.

insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, status)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        'eeeeeeee-0000-0000-0000-000000000001', '2026-04-02', 480, 'goedgekeurd');

do $$
declare
  n int;
  r record;
begin
  -- Als medewerker.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);

  select count(*) into n from kostprijs;
  if n <> 0 then raise exception 'Medewerker mag geen kostprijzen zien, zag %', n; end if;

  select count(*) into n from tariefregel;
  if n <> 0 then raise exception 'Medewerker mag geen tarieven zien, zag %', n; end if;

  select count(*) into n from bevroren_kosten;
  if n <> 0 then raise exception 'Medewerker mag geen bevroren kosten zien, zag %', n; end if;

  select count(*) into n from urenregel;
  if n = 0 then raise exception 'Medewerker hoort zijn eigen uren wel te zien'; end if;

  select * into r from v_urenregel where datum = '2026-04-02';
  if r.uren is null then raise exception 'Eigen uren horen zichtbaar te zijn'; end if;
  if r.verkooptarief is not null then
    raise exception 'Medewerker zag een verkooptarief: %', r.verkooptarief;
  end if;
  if r.kostprijs is not null then
    raise exception 'Medewerker zag een kostprijs: %', r.kostprijs;
  end if;

  -- Eigen uren goedkeuren mag niet.
  begin
    update urenregel set status = 'goedgekeurd'
     where medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000002'
       and datum = '2026-05-04';
    raise exception 'Medewerker mocht zijn eigen uren goedkeuren';
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  raise notice 'OK 13. medewerker ziet eigen uren, geen bedragen, keurt niets goed';
end
$$;

do $$
declare r record;
begin
  -- Als projectleider.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '33333333-3333-3333-3333-333333333333', true);

  select * into r from v_urenregel where datum = '2026-04-02';
  if r.uren is null then
    raise exception 'Projectleider hoort uren op zijn project te zien';
  end if;
  if r.verkooptarief is null then
    raise exception 'Projectleider hoort het verkooptarief te zien';
  end if;
  if r.kostprijs is not null then
    raise exception 'Projectleider zag een kostprijs: %', r.kostprijs;
  end if;

  reset role;
  raise notice 'OK 14. projectleider ziet omzet, geen kostprijs';
end
$$;

do $$
declare r record;
begin
  -- Als eigenaar.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);

  select * into r from v_urenregel where datum = '2026-04-02';
  if r.verkooptarief is null or r.kostprijs is null then
    raise exception 'Eigenaar hoort alle bedragen te zien';
  end if;
  if r.kosten <> 496.00 then
    raise exception '8 uur a 62 hoort 496 te zijn, kreeg %', r.kosten;
  end if;

  reset role;
  raise notice 'OK 15. eigenaar ziet omzet, kosten en marge';
end
$$;

-- ------------------------------------------------------- 16. rapportage ----

do $$
declare r record;
begin
  select * into r from v_project_uitputting
   where project_id = 'dddddddd-0000-0000-0000-000000000001';

  if r.bestede_uren <> 10.5 then
    raise exception 'Verwacht 10,5 uur (3,5 + 8 - 1), kreeg %', r.bestede_uren;
  end if;
  if r.budget_uren_verbruikt_pct <> 5.3 then
    raise exception 'Verwacht 5,3%% van 200 uur, kreeg %', r.budget_uren_verbruikt_pct;
  end if;
  if r.marge <> r.omzet - r.kosten then
    raise exception 'Marge hoort omzet min kosten te zijn';
  end if;
  if r.km_bedrag <> 37.95 then
    raise exception 'Kilometers horen mee te tellen, kreeg %', r.km_bedrag;
  end if;
  raise notice 'OK 16. projectuitputting telt uren, marge en kilometers op';
end
$$;

do $$
declare r record;
begin
  select * into r from v_medewerker_maand
   where medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     and maand = '2026-04-01';
  if r.declarabiliteit_pct <> 100.0 then
    raise exception 'April is volledig declarabel, kreeg %', r.declarabiliteit_pct;
  end if;
  raise notice 'OK 17. declarabiliteit per medewerker per maand';
end
$$;

-- ------------------------------------------------------- 18. facturatie ----

do $$
declare
  n    int;
  r    record;
  f_id uuid;
  nr   text;
begin
  -- Als eigenaar via de rechten: factureren en daarna op slot.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);

  f_id := maak_factuur('dddddddd-0000-0000-0000-000000000001', '2026-04-01', '2026-04-30',
                       array[]::uuid[], true, 'bbbbbbbb-0000-0000-0000-000000000001');
  nr := maak_definitief(f_id, '2026-05-01');

  select * into r from v_factuur where nummer = nr;
  if r.minuten <> 480 then raise exception 'Factuur hoort 480 minuten te dragen, kreeg %', r.minuten; end if;
  if r.subtotaal <> 1600 then raise exception 'Factuur hoort 8 u a 200 = 1600 te zijn, kreeg %', r.subtotaal; end if;
  if r.totaal <> 1936 then raise exception 'Met 21%% btw hoort het 1936 te zijn, kreeg %', r.totaal; end if;

  select status, factuur_referentie into r from urenregel where datum = '2026-04-02';
  if r.status <> 'gefactureerd' or r.factuur_referentie <> nr then
    raise exception 'De regel hoort gefactureerd te zijn onder %', nr;
  end if;

  begin
    update urenregel set minuten = 60 where factuur_referentie = nr;
    raise exception 'Gefactureerde regel had op slot moeten zitten';
  exception when restrict_violation then null;
  end;

  reset role;

  -- Als medewerker: zelf factureren kan niet, en facturen zijn onzichtbaar.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);

  begin
    update urenregel set status = 'gefactureerd', factuur_referentie = 'X'
     where datum = '2026-05-04';
    get diagnostics n = row_count;
    if n > 0 then raise exception 'Medewerker mocht factureren'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    perform maak_factuur('dddddddd-0000-0000-0000-000000000001', '2026-05-01', '2026-05-31',
                         array[]::uuid[], false, null);
    raise exception 'Medewerker mocht een factuur maken';
  exception when insufficient_privilege or raise_exception then null;
  end;

  select count(*) into n from v_factuur;
  if n <> 0 then raise exception 'Medewerker zag % facturen', n; end if;

  reset role;
  raise notice 'OK 18. factureren zet op slot; medewerker kan het niet en ziet niets';
end
$$;

-- ------------------------------------------------ 19. vaste prijs -----------

insert into project (id, klant_id, naam, code, facturatiemodel, vaste_prijs) values
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
   'Quickscan', 'NOORD-02', 'vaste_prijs', 6000);
insert into projectonderdeel (id, project_id, naam) values
  ('eeeeeeee-0000-0000-0000-000000000009', 'dddddddd-0000-0000-0000-000000000002', 'Uitvoering');
insert into tariefregel (project_id, bedrag_per_uur, geldig_vanaf) values
  ('dddddddd-0000-0000-0000-000000000002', 150, '2026-01-01');
insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, status) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000009',
   '2026-06-10', 600, 'goedgekeurd');
insert into termijn (project_id, volgorde, omschrijving, bedrag) values
  ('dddddddd-0000-0000-0000-000000000002', 1, 'Bij opdracht', 2000),
  ('dddddddd-0000-0000-0000-000000000002', 2, 'Tussenoplevering', 2500),
  ('dddddddd-0000-0000-0000-000000000002', 3, 'Eindoplevering', 1500);

do $$
declare
  r    record;
  f_id uuid;
  nr   text;
begin
  -- De eerste termijn factureren; de periode ligt bewust vóór de uren van
  -- juni, zodat die niet meeliften.
  f_id := maak_factuur('dddddddd-0000-0000-0000-000000000002', '2026-01-01', '2026-01-31',
                       array[(select id from termijn where omschrijving = 'Bij opdracht')],
                       false, null);
  nr := maak_definitief(f_id, '2026-06-01');

  select * into r from v_urenregel where onderdeel_id = 'eeeeeeee-0000-0000-0000-000000000009';
  if r.omzet <> 0 then raise exception 'Uren op een vaste prijs horen geen omzet te dragen, kreeg %', r.omzet; end if;
  if r.kosten <> 620 then raise exception 'Kosten lopen wel door (10 u a 62), kreeg %', r.kosten; end if;

  select * into r from v_project_uitputting where project_id = 'dddddddd-0000-0000-0000-000000000002';
  if r.omzet <> 2000 then raise exception 'Omzet hoort de gefactureerde termijn te zijn, kreeg %', r.omzet; end if;
  if r.termijn_open <> 4000 then raise exception 'Open termijnen horen 4000 te zijn, kreeg %', r.termijn_open; end if;
  if r.effectief_uurtarief <> 200 then raise exception 'Effectief tarief 2000 / 10 u = 200, kreeg %', r.effectief_uurtarief; end if;

  select * into r from v_factuur where nummer = nr;
  if r.subtotaal <> 2000 or r.project <> 'Quickscan' or r.status <> 'definitief' then
    raise exception 'Factuur uit alleen een termijn hoort 2000 op Quickscan te zijn, kreeg % (%)', r.subtotaal, r.status;
  end if;
  if r.minuten <> 0 then raise exception 'Uren van juni horen niet mee te liften, kreeg % minuten', r.minuten; end if;
  select * into r from factuurregel where factuur_id = f_id;
  if r.grootboek_nummer <> '8020' or r.bron <> 'termijn' then
    raise exception 'Termijnregel hoort op 8020 (vaste prijs) te staan, kreeg %', r.grootboek_nummer;
  end if;

  begin
    update termijn set bedrag = 1 where factuur_referentie = nr;
    raise exception 'Gefactureerde termijn had op slot moeten zitten';
  exception when restrict_violation then null;
  end;
  raise notice 'OK 19. vaste prijs: uren zonder omzet, termijnen als omzet, effectief tarief';
end
$$;

-- ------------------------------------------------ 20. abonnementen ----------

insert into project (id, klant_id, naam, code, facturatiemodel, herhaal_interval,
                     herhaal_bedrag, herhaal_omschrijving, herhaal_start, herhaal_volgende)
values ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
        'Beheerabonnement', 'NOORD-03', 'abonnement', 'maand', 1250, 'Beheer',
        date_trunc('month', current_date - interval '2 months')::date,
        date_trunc('month', current_date - interval '2 months')::date);
insert into projectonderdeel (id, project_id, naam) values
  ('eeeeeeee-0000-0000-0000-000000000010', 'dddddddd-0000-0000-0000-000000000003', 'Beheer');
-- Goedgekeurde uren van vóór de eerste periode: die horen als verantwoording mee.
insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, status) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000010',
   (date_trunc('month', current_date - interval '3 months') + interval '5 days')::date, 120, 'goedgekeurd');

do $$
declare
  n1 int; n2 int; r record; volgende date;
begin
  -- Eerste run als eigenaar via de rechten: drie periodes inhalen.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n1 from verwerk_periodieke_facturen();
  if n1 <> 3 then raise exception 'Verwacht 3 ingehaalde periodes, kreeg %', n1; end if;

  -- Tweede run doet niets: idempotent.
  select count(*) into n2 from verwerk_periodieke_facturen();
  if n2 <> 0 then raise exception 'Tweede run hoort niets te doen, deed %', n2; end if;
  reset role;

  select count(*) into n1 from termijn
   where project_id = 'dddddddd-0000-0000-0000-000000000003' and factuur_referentie is not null;
  if n1 <> 3 then raise exception 'Drie termijnen horen gefactureerd te zijn, %', n1; end if;

  -- Nummers uit de reeks, oplopend, huidig jaar.
  select string_agg(factuur_referentie, ',' order by periode_start) into r
    from termijn where project_id = 'dddddddd-0000-0000-0000-000000000003';
  if r.string_agg !~ ('^' || extract(year from current_date)::int || '-\d{3},') then
    raise exception 'Nummers horen JJJJ-NNN te zijn, kreeg %', r.string_agg;
  end if;

  select herhaal_volgende into volgende from project where id = 'dddddddd-0000-0000-0000-000000000003';
  if volgende <= current_date then raise exception 'herhaal_volgende hoort in de toekomst te staan, is %', volgende; end if;

  -- De oude goedgekeurde uren hangen aan de eerste automatische factuur.
  select u.status, u.factuur_referentie into r from urenregel u
   where u.onderdeel_id = 'eeeeeeee-0000-0000-0000-000000000010';
  if r.status <> 'gefactureerd' or r.factuur_referentie is null then
    raise exception 'Uren van voor de periode horen als verantwoording mee te gaan';
  end if;

  -- Een handmatig nummer in dezelfde vorm schuift de teller mee.
  perform noteer_factuurnummer(extract(year from current_date)::int || '-050');
  if volgend_factuurnummer() <> extract(year from current_date)::int || '-051' then
    raise exception 'Teller hoort na handmatig 050 op 051 te staan';
  end if;

  -- v_factuur kent de automatische facturen als project Beheerabonnement.
  select count(*) into n1 from v_factuur where project = 'Beheerabonnement' and subtotaal = 1250 and status = 'definitief';
  if n1 <> 3 then raise exception 'v_factuur hoort drie definitieve abonnementsfacturen van 1250 te tonen, %', n1; end if;

  raise notice 'OK 20. abonnement: periodes ingehaald, idempotent, genummerd, uren als verantwoording';
end
$$;

-- ------------------------------------------------- 21. echte facturen ------

do $$
declare
  f_id  uuid;
  c_id  uuid;
  nr    text;
  r     record;
  n     int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);

  -- Concept voor het nacalculatieproject over juni: de correctieregels van
  -- 4 september vallen erbuiten, dus alleen wat er in juni goedgekeurd is.
  insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, status) values
    ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001',
     '2026-06-15', 240, 'goedgekeurd');
  insert into rit (medewerker_id, klant_id, project_id, datum, doel, afstand_km, retour, status) values
    ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
     'dddddddd-0000-0000-0000-000000000001', '2026-06-15', 'klantbezoek', 50, true, 'goedgekeurd');

  f_id := maak_factuur('dddddddd-0000-0000-0000-000000000001', '2026-06-01', '2026-06-30',
                       array[]::uuid[], true, 'bbbbbbbb-0000-0000-0000-000000000001');

  select * into r from factuur where id = f_id;
  if r.status <> 'concept' or r.nummer is not null then raise exception 'Nieuwe factuur hoort concept zonder nummer te zijn'; end if;

  select count(*) into n from factuurregel where factuur_id = f_id;
  if n <> 2 then raise exception 'Verwacht twee regels (uren en reiskosten), kreeg %', n; end if;

  -- Uren: 4 u a 200 (het projecttarief van test 2, verhoogd in test 7) = 800.
  select * into r from factuurregel where factuur_id = f_id and bron = 'uren';
  if r.bedrag <> 800 or r.eenheid <> 'uur' or r.aantal <> 4 then
    raise exception 'Urenregel hoort 4 uur a 200 = 800 te zijn, kreeg % x % = %', r.aantal, r.prijs, r.bedrag;
  end if;
  if r.grootboek_nummer <> '8000' or r.btw_percentage <> 21 then
    raise exception 'Urenregel hoort op 8000 met 21%% te staan, kreeg % / %', r.grootboek_nummer, r.btw_percentage;
  end if;
  select * into r from factuurregel where factuur_id = f_id and bron = 'ritten';
  if r.grootboek_nummer <> '8010' or r.bedrag <> 23.00 then
    raise exception 'Reiskosten horen op 8010 voor 100 km a 0,23 = 23,00, kreeg % / %', r.grootboek_nummer, r.bedrag;
  end if;

  -- Een handmatige regel erbij, en de totalen kloppen met btw.
  perform voeg_factuurregel_toe(f_id, 'Materiaal', 2, 'stuk', 50, 100, 'handmatig');
  select * into r from factuur where id = f_id;
  if r.subtotaal <> 923.00 or r.btw_bedrag <> 193.83 or r.totaal <> 1116.83 then
    raise exception 'Totalen kloppen niet: % / % / %', r.subtotaal, r.btw_bedrag, r.totaal;
  end if;

  -- Wat aan het concept hangt telt niet meer als te factureren.
  select count(*) into n from urenregel where datum = '2026-06-15' and factuur_id = f_id;
  if n <> 1 then raise exception 'De urenregel hoort aan het concept te hangen'; end if;

  -- Definitief: nummer, datums, slot.
  nr := maak_definitief(f_id, '2026-07-01');
  select * into r from factuur where id = f_id;
  if r.status <> 'definitief' or r.nummer <> nr or r.vervaldatum <> date '2026-07-31' then
    raise exception 'Definitief maken klopt niet: % % %', r.status, r.nummer, r.vervaldatum;
  end if;
  select status, factuur_referentie into r from urenregel where datum = '2026-06-15';
  if r.status <> 'gefactureerd' or r.factuur_referentie <> nr then
    raise exception 'Uren horen gefactureerd te zijn onder %', nr;
  end if;
  begin
    update factuurregel set bedrag = 1 where factuur_id = f_id;
    raise exception 'Regels van een definitieve factuur horen vast te liggen';
  exception when restrict_violation then null;
  end;
  begin
    delete from factuur where id = f_id;
    raise exception 'Een definitieve factuur hoort niet verwijderbaar te zijn';
  exception when restrict_violation then null;
  end;

  -- Verkoopboeking: debiteuren tegenover omzet per rekening en btw, en sluitend.
  select count(*) into n from boekingsregel br join boeking b on b.id = br.boeking_id
   where b.factuur_id = f_id and b.soort = 'verkoop';
  if n <> 5 then raise exception 'Verkoopboeking hoort 5 regels te hebben (debiteuren, 8000, 8010, 8090, btw), kreeg %', n; end if;
  select sum(br.debet) - sum(br.credit) as verschil into r from boekingsregel br join boeking b on b.id = br.boeking_id
   where b.factuur_id = f_id;
  if r.verschil <> 0 then raise exception 'Verkoopboeking sluit niet'; end if;
  select sum(br.debet) as debiteuren into r from boekingsregel br join boeking b on b.id = br.boeking_id
   join grootboekrekening g on g.id = br.grootboek_id
   where b.factuur_id = f_id and g.nummer = '1300';
  if r.debiteuren <> 1116.83 then raise exception 'Debiteuren hoort 1116,83 te zijn, kreeg %', r.debiteuren; end if;

  -- Crediteren: omgekeerde regels, meteen definitief, origineel gecrediteerd.
  c_id := crediteer_factuur(f_id, 'Verkeerde klant');
  select * into r from factuur where id = c_id;
  if r.status <> 'definitief' or r.totaal <> -1116.83 or r.credit_van_id <> f_id then
    raise exception 'Creditfactuur klopt niet: % %', r.status, r.totaal;
  end if;
  if (select status from factuur where id = f_id) <> 'gecrediteerd' then
    raise exception 'Origineel hoort gecrediteerd te zijn';
  end if;

  -- Een concept weggooien geeft alles vrij.
  insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, status) values
    ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001',
     '2026-07-10', 60, 'goedgekeurd');
  f_id := maak_factuur('dddddddd-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31',
                       array[]::uuid[], false, null);
  perform verwijder_concept(f_id);
  select count(*) into n from urenregel where datum = '2026-07-10' and factuur_id is null and status = 'goedgekeurd';
  if n <> 1 then raise exception 'Na verwijderen van het concept hoort de regel weer vrij te zijn'; end if;

  reset role;

  -- Een medewerker ziet geen facturen.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from v_factuur;
  if n <> 0 then raise exception 'Medewerker zag % facturen', n; end if;
  reset role;

  raise notice 'OK 21. facturen: concept met grootboek en btw, definitief met nummer en slot, credit, verkoopboeking';
end
$$;

-- ------------------------------------------------- 22. boekhouding ---------

do $$
declare
  bank   uuid;
  prive  uuid;
  k_id   uuid;
  a_id   uuid;
  f_id   uuid;
  b_id   uuid;
  s      numeric;
  s2     numeric;
  r      record;
  n      int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  select id into bank  from grootboekrekening where nummer = '1100';
  select id into prive from grootboekrekening where nummer = '0600';

  -- Debiteuren = alles wat gefactureerd is (nog niets betaald).
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1300';
  select sum(totaal) into s2 from factuur where status <> 'concept';
  if s <> s2 then raise exception 'Debiteuren hoort % te zijn, kreeg %', s2, s; end if;

  -- Omzet op de rekeningen is het subtotaal van alle facturen (credit, dus negatief).
  select sum(saldo) into s from grootboek_saldi('1900-01-01', '2100-01-01') where soort = 'omzet';
  select sum(subtotaal) into s2 from factuur where status <> 'concept';
  if s <> -s2 then raise exception 'Omzet hoort -% te zijn, kreeg %', s2, s; end if;

  -- Betaling van een abonnementsfactuur via bank; ongedaan maken herstelt.
  select id into f_id from factuur where status = 'definitief' and totaal > 0 order by nummer limit 1;
  perform boek_betaling_factuur(f_id, '2026-07-05', bank);
  select * into r from factuur where id = f_id;
  if r.status <> 'betaald' or r.betaald_op <> date '2026-07-05' then raise exception 'Factuur hoort betaald te zijn'; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1100';
  if s <> r.totaal then raise exception 'Bank hoort % te zijn na de ontvangst, kreeg %', r.totaal, s; end if;
  perform maak_betaling_factuur_ongedaan(f_id);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1100';
  if s <> 0 or (select status from factuur where id = f_id) <> 'definitief' then
    raise exception 'Ongedaan maken hoort bank en status te herstellen';
  end if;
  perform boek_betaling_factuur(f_id, '2026-07-05', bank);

  -- Inkoop: kosten en voorbelasting tegenover crediteuren; daarna betaald.
  k_id := maak_inkoopfactuur('KPN', 'Internet juli', 'F-889', '2026-07-03', '2026-07-31',
                             (select id from grootboekrekening where nummer = '4300'), 100, 'hoog', 21);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1600';
  if s <> -121 then raise exception 'Crediteuren hoort -121 te zijn, kreeg %', s; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1520';
  if s <> 21 then raise exception 'Voorbelasting hoort 21 te zijn, kreeg %', s; end if;
  perform boek_betaling_inkoop(k_id, '2026-07-20', bank);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1600';
  if s <> 0 then raise exception 'Crediteuren hoort 0 te zijn na betaling, kreeg %', s; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1100';
  if s <> r.totaal - 121 then raise exception 'Bank hoort % te zijn, kreeg %', r.totaal - 121, s; end if;

  -- Wijzigen boekt opnieuw, inclusief de betaling.
  perform werk_inkoopfactuur_bij(k_id, 'KPN', 'Internet en telefonie juli', 'F-889', '2026-07-03', '2026-07-31',
                                 (select id from grootboekrekening where nummer = '4300'), 150, 'hoog', 31.50);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '4300';
  if s <> 150 then raise exception 'Kosten 4300 horen 150 te zijn na wijziging, kreeg %', s; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1100';
  if s <> r.totaal - 181.50 then raise exception 'Bank hoort de nieuwe betaling te dragen, kreeg %', s; end if;

  -- Btw-aangifte over het derde kwartaal: voorbelasting 31,50, saldo klopt met de boeking.
  select btw into s from btw_overzicht('2026-07-01', '2026-09-30') where rubriek = '5b';
  if s <> 31.50 then raise exception 'Voorbelasting Q3 hoort 31,50 te zijn, kreeg %', s; end if;
  a_id := maak_btw_aangifte('2026-07-01', '2026-09-30');
  select * into r from btw_aangifte where id = a_id;
  if r.voorbelasting <> 31.50 or r.saldo <> r.btw_hoog + r.btw_laag - 31.50 then
    raise exception 'Aangifte klopt niet: % / %', r.voorbelasting, r.saldo;
  end if;
  select btw into s from btw_overzicht('2026-07-01', '2026-09-30') where rubriek = '1a';
  if s <> r.btw_hoog then raise exception 'Btw hoog in de aangifte hoort % te zijn', s; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1750';
  if s <> -r.saldo then raise exception 'Btw-aangifte te betalen hoort -% te zijn, kreeg %', r.saldo, s; end if;
  begin
    perform maak_btw_aangifte('2026-09-01', '2026-11-30');
    raise exception 'Overlappende aangifte had geweigerd moeten worden';
  exception when exclusion_violation then null;
  end;
  perform verwijder_btw_aangifte(a_id);
  select count(*) into n from boeking where soort = 'btw';
  if n <> 0 then raise exception 'Btw-boeking hoort mee te verdwijnen'; end if;
  a_id := maak_btw_aangifte('2026-07-01', '2026-09-30');
  perform boek_betaling_btw(a_id, '2026-10-20', bank);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1750';
  if s <> 0 then raise exception 'Na afdracht hoort 1750 op nul te staan, kreeg %', s; end if;
  begin
    perform verwijder_btw_aangifte(a_id);
    raise exception 'Ingediende aangifte had niet verwijderd mogen worden';
  exception when restrict_violation then null;
  end;

  -- Memoriaal: sluit niet → geweigerd; sluit wel → geboekt.
  begin
    perform boek_memoriaal('2026-08-01', 'Scheef', jsonb_build_array(
      jsonb_build_object('grootboek_id', prive, 'debet', 500),
      jsonb_build_object('grootboek_id', bank, 'credit', 400)));
    raise exception 'Scheve boeking had geweigerd moeten worden';
  exception when check_violation then null;
  end;
  b_id := boek_memoriaal('2026-08-01', 'Privé-opname', jsonb_build_array(
    jsonb_build_object('grootboek_id', prive, 'debet', 500),
    jsonb_build_object('grootboek_id', bank, 'credit', 500)));
  select saldo into s from grootboek_saldi('2026-08-01', '2026-08-31') where nummer = '0600';
  if s <> 500 then raise exception 'Privé hoort 500 te zijn in augustus, kreeg %', s; end if;

  -- Regels liggen vast; een verkoopboeking verdwijnt niet.
  begin
    update boekingsregel set debet = 1 where boeking_id = b_id and debet > 0;
    raise exception 'Boekingsregel had op slot moeten zitten';
  exception when restrict_violation then null;
  end;
  begin
    delete from boeking where soort = 'verkoop' and factuur_id = f_id;
    raise exception 'Verkoopboeking had niet verwijderd mogen worden';
  exception when restrict_violation then null;
  end;

  -- Winst-en-verlies over het jaar: omzet min kosten.
  select -sum(saldo) filter (where soort = 'omzet') - sum(saldo) filter (where soort = 'kosten') into s
  from grootboek_saldi('2026-01-01', '2026-12-31');
  select sum(subtotaal) into s2 from factuur where status <> 'concept' and datum between '2026-01-01' and '2026-12-31';
  if s <> s2 - 150 then raise exception 'Resultaat hoort omzet % min kosten 150 te zijn, kreeg %', s2, s; end if;

  -- Afsluiten: niets meer in een gesloten periode.
  update instellingen set afgesloten_tot = '2026-07-31' where id;
  begin
    perform boek_memoriaal('2026-07-15', 'Te laat', jsonb_build_array(
      jsonb_build_object('grootboek_id', prive, 'debet', 1),
      jsonb_build_object('grootboek_id', bank, 'credit', 1)));
    raise exception 'Boeken in een afgesloten periode had geweigerd moeten worden';
  exception when restrict_violation then null;
  end;
  begin
    delete from inkoopfactuur where id = k_id;
    raise exception 'Verwijderen uit een afgesloten periode had geweigerd moeten worden';
  exception when restrict_violation then null;
  end;
  update instellingen set afgesloten_tot = null where id;
  delete from boeking where id = b_id;
  reset role;

  -- Een medewerker ziet en boekt niets.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from boeking;
  if n <> 0 then raise exception 'Medewerker zag % boekingen', n; end if;
  begin
    perform boek_memoriaal('2026-08-02', 'Stiekem', jsonb_build_array(
      jsonb_build_object('grootboek_id', prive, 'debet', 1),
      jsonb_build_object('grootboek_id', bank, 'credit', 1)));
    raise exception 'Medewerker mocht boeken';
  exception when insufficient_privilege or check_violation or raise_exception then null;
  end;
  reset role;

  raise notice 'OK 22. boekhouding: verkoop, betaling, inkoop, btw-aangifte, memoriaal, sloten, afsluiten';
end
$$;

-- ------------------------------------------------- 23. jaarwerk en vpb -----

do $$
declare
  a_id   uuid;
  n      int;
  s      numeric;
  r      record;
  bank   uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  select id into bank from grootboekrekening where nummer = '1100';

  -- Rubrieken: nieuwe rekening krijgt er een naar soort.
  insert into grootboekrekening (nummer, naam, soort) values ('4610', 'Beurzen', 'kosten');
  if (select rubriek from grootboekrekening where nummer = '4610') <> 'overige_bedrijfskosten' then
    raise exception 'Nieuwe kostenrekening hoort onder overige bedrijfskosten te vallen';
  end if;

  -- Activum van 3600 met restwaarde 0 in 36 maanden, gekocht 15 januari:
  -- t/m 30 juni zijn dat 5 maanden a 100.
  insert into activum (omschrijving, aanschafdatum, aanschafwaarde, afschrijvingsmaanden,
                       grootboek_activa, grootboek_afschrijving, grootboek_kosten)
  values ('Laptop', '2026-01-15', 3600, 36,
          (select id from grootboekrekening where nummer = '0100'),
          (select id from grootboekrekening where nummer = '0150'),
          (select id from grootboekrekening where nummer = '4990'))
  returning id into a_id;
  n := boek_afschrijvingen('2026-06-30');
  if n <> 5 then raise exception 'Verwacht 5 afschrijvingsboekingen t/m juni, kreeg %', n; end if;
  n := boek_afschrijvingen('2026-06-30');
  if n <> 0 then raise exception 'Nogmaals afschrijven hoort niets te doen, deed %', n; end if;
  select saldo into s from grootboek_saldi('2026-01-01', '2026-12-31') where nummer = '4990';
  if s <> 500 then raise exception 'Afschrijvingskosten horen 500 te zijn, kreeg %', s; end if;
  select saldo into s from grootboek_saldi('1900-01-01', '2026-12-31') where nummer = '0150';
  if s <> -500 then raise exception 'Cumulatieve afschrijving hoort -500 te zijn, kreeg %', s; end if;

  -- Vennootschapsbelasting: 19% over het (afgeronde) resultaat, gereserveerd
  -- op 31-12, en het resultaat na belasting daalt ermee.
  s := resultaat_voor_belasting(2026);
  select * into r from vpb_berekening(2026);
  if r.resultaat <> s or r.vpb <> floor(floor(s) * 0.19) then
    raise exception 'Vpb hoort 19%% van % te zijn, kreeg %', s, r.vpb;
  end if;
  update boekjaar set vpb_correcties = 1000 where jaar = 2026;
  if not found then insert into boekjaar (jaar, vpb_correcties) values (2026, 1000); end if;
  select * into r from vpb_berekening(2026);
  if r.belastbaar <> floor(s + 1000) then raise exception 'Correcties horen bij het belastbare bedrag te komen'; end if;
  s := reserveer_vpb(2026);
  if s <> r.vpb then raise exception 'Gereserveerd hoort % te zijn, kreeg %', r.vpb, s; end if;
  select saldo into s from grootboek_saldi('2026-01-01', '2026-12-31') where nummer = '0700';
  if s <> -r.vpb then raise exception 'Te betalen vpb hoort -% te zijn, kreeg %', r.vpb, s; end if;
  if resultaat_voor_belasting(2026) <> r.resultaat then
    raise exception 'De vpb-boeking hoort het resultaat vóór belasting niet te raken';
  end if;
  -- Opnieuw reserveren vervangt de boeking.
  perform reserveer_vpb(2026);
  select count(*) into n from boeking where omschrijving = 'Vennootschapsbelasting 2026';
  if n <> 1 then raise exception 'Er hoort precies één vpb-boeking te zijn, zag %', n; end if;
  perform boek_betaling_vpb(2026, '2027-03-01', bank);
  select saldo into s from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '0700';
  if s <> 0 then raise exception 'Na betaling hoort 0700 op nul te staan, kreeg %', s; end if;

  reset role;
  raise notice 'OK 23. jaarwerk: rubrieken, afschrijving per maand, vpb berekend, gereserveerd en betaald';
end
$$;

-- --------------------------------------------------------- 24. loon --------

do $$
declare
  run_id uuid;
  s      record;
  t      record;
  n      int;
  lh     numeric;
  bank   uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  select id into bank from grootboekrekening where nummer = '1100';

  -- Loonheffing 2026: onder de eerste schijf zonder korting = tarief schijf 1.
  lh := loonheffing_jaar(30000, 2026, false);
  if lh <> round(30000 * 35.70 / 100, 2) then raise exception 'Loonheffing zonder korting klopt niet: %', lh; end if;
  -- Met korting lager, nooit negatief, en oplopend met het loon.
  if loonheffing_jaar(30000, 2026, true) >= lh then raise exception 'Heffingskortingen horen de heffing te verlagen'; end if;
  if loonheffing_jaar(5000, 2026, true) <> 0 then raise exception 'Een laag loon hoort met korting op nul uit te komen'; end if;
  if loonheffing_jaar(90000, 2026, true) <= loonheffing_jaar(60000, 2026, true) then raise exception 'Heffing hoort op te lopen'; end if;

  -- Twee dienstverbanden: een medewerker met vast contract, en de dga.
  insert into dienstverband (medewerker_id, in_dienst, bruto_maandloon, pensioen_wn_pct, pensioen_wg_pct)
  values ('bbbbbbbb-0000-0000-0000-000000000002', '2026-01-01', 4000, 4, 8);
  insert into dienstverband (medewerker_id, in_dienst, bruto_maandloon, dga, onbepaalde_tijd)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '2026-01-01', 5000, true, true);
  -- Halverwege in dienst: 16 t/m 31 juli = 16/31 van de maand.
  insert into dienstverband (medewerker_id, in_dienst, bruto_maandloon, onbepaalde_tijd)
  values ('bbbbbbbb-0000-0000-0000-000000000003', '2026-07-16', 3100, false);
  begin
    insert into dienstverband (medewerker_id, in_dienst, bruto_maandloon)
    values ('bbbbbbbb-0000-0000-0000-000000000002', '2026-06-01', 1);
    raise exception 'Overlappend dienstverband had geweigerd moeten worden';
  exception when exclusion_violation then null;
  end;

  run_id := maak_loonrun(2026, 7, false);
  select count(*) into n from loonstrook where loonrun_id = run_id;
  if n <> 3 then raise exception 'Verwacht 3 loonstroken, kreeg %', n; end if;

  select * into s from loonstrook where loonrun_id = run_id and medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if s.bruto <> 4000 or s.vakantiegeld_opbouw <> 320 or s.pensioen_wn <> 160 or s.pensioen_wg <> 320 or s.loon_lh <> 3840 then
    raise exception 'Strook medewerker klopt niet: % % % % %', s.bruto, s.vakantiegeld_opbouw, s.pensioen_wn, s.pensioen_wg, s.loon_lh;
  end if;
  if s.loonheffing <> round(loonheffing_jaar(3840 * 12, 2026, true) / 12, 2) then raise exception 'Loonheffing op de strook klopt niet'; end if;
  if s.netto <> s.bruto - s.pensioen_wn - s.loonheffing then raise exception 'Netto klopt niet: %', s.netto; end if;
  if s.awf <> round(3840 * 2.74 / 100, 2) or s.zvw_wg <> round(3840 * 6.51 / 100, 2) or s.zvw_wn <> 0 then
    raise exception 'Werkgeverspremies kloppen niet: % %', s.awf, s.zvw_wg;
  end if;

  select * into s from loonstrook where loonrun_id = run_id and medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if s.awf <> 0 or s.aof <> 0 or s.zvw_wg <> 0 or s.zvw_wn <> round(5000 * 5.26 / 100, 2) then
    raise exception 'Dga hoort geen werknemersverzekeringen te hebben en wel zvw-inhouding: % %', s.awf, s.zvw_wn;
  end if;

  select * into s from loonstrook where loonrun_id = run_id and medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000003';
  if s.fractie <> round(16.0 / 31, 4) or s.bruto <> round(3100 * 16.0 / 31, 2) then
    raise exception 'Deel van de maand klopt niet: % %', s.fractie, s.bruto;
  end if;
  if s.awf <> round(s.premieloon * 7.74 / 100, 2) then raise exception 'Flexibel contract hoort de hoge Awf-premie te krijgen'; end if;

  -- Herberekenen van een concept mag; definitief boekt sluitend.
  run_id := maak_loonrun(2026, 7, false);
  perform maak_loonrun_definitief(run_id);
  select coalesce(sum(debet), 0) as d, coalesce(sum(credit), 0) as c into t
  from boekingsregel r join boeking b on b.id = r.boeking_id join loonrun l on l.boeking_id = b.id where l.id = run_id;
  if t.d <> t.c or t.d = 0 then raise exception 'Loonjournaalpost sluit niet: % / %', t.d, t.c; end if;
  select coalesce(sum(totale_kosten), 0) as kosten into t from loonstrook where loonrun_id = run_id;
  select sum(saldo) into lh from grootboek_saldi('2026-07-01', '2026-07-31') where rubriek = 'personeelskosten';
  if lh <> t.kosten then raise exception 'Personeelskosten horen % te zijn, kreeg %', t.kosten, lh; end if;
  begin
    update loonstrook set bruto = 1 where loonrun_id = run_id;
    raise exception 'Definitieve loonstrook had op slot moeten zitten';
  exception when restrict_violation then null;
  end;
  begin
    perform maak_loonrun(2026, 7, false);
    raise exception 'Definitieve run hoort niet herberekend te worden';
  exception when raise_exception then null;
  end;

  -- Betalingen: netto, loonheffing en pensioen; schulden lopen naar nul.
  perform boek_betaling_loonrun(run_id, 'netto', '2026-07-25', bank);
  perform boek_betaling_loonrun(run_id, 'loonheffing', '2026-08-28', bank);
  perform boek_betaling_loonrun(run_id, 'pensioen', '2026-08-05', bank);
  select sum(saldo) into lh from grootboek_saldi('1900-01-01', '2100-01-01') where nummer in ('1800', '1810', '1820');
  if lh <> 0 then raise exception 'Loonschulden horen betaald te zijn, restant %', lh; end if;
  select saldo into lh from grootboek_saldi('1900-01-01', '2100-01-01') where nummer = '1830';
  select -sum(vakantiegeld_opbouw) as reservering into t from loonstrook where loonrun_id = run_id;
  if lh <> t.reservering then raise exception 'Vakantiegeldreservering hoort % te zijn, kreeg %', t.reservering, lh; end if;

  -- Mei met vakantiegeld: alles wat gereserveerd is komt eruit, belast als bijzonder loon.
  run_id := maak_loonrun(2026, 8, true);
  select * into s from loonstrook where loonrun_id = run_id and medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if s.vakantiegeld_uitbetaald <> 640 or s.loonheffing_bijzonder <= 0 then
    raise exception 'Vakantiegeld hoort 320 + 320 = 640 te zijn met bijzondere heffing, kreeg % / %', s.vakantiegeld_uitbetaald, s.loonheffing_bijzonder;
  end if;
  reset role;

  -- Medewerker: ziet alleen zijn eigen stroken, mag niets maken.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from loonstrook;
  if n <> 2 then raise exception 'Medewerker hoort zijn 2 eigen stroken te zien, zag %', n; end if;
  select count(*) into n from loonrun;
  if n <> 0 then raise exception 'Medewerker zag % loonruns', n; end if;
  begin
    perform maak_loonrun(2026, 9, false);
    raise exception 'Medewerker mocht een loonrun maken';
  exception when insufficient_privilege or raise_exception then null;
  end;
  reset role;

  raise notice 'OK 24. loon: heffing, stroken voor medewerker, dga en deeltijdmaand, journaalpost, betalingen, vakantiegeld';
end
$$;

select 'Alle tests geslaagd.' as resultaat;
