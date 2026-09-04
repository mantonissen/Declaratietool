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
  n int;
  r record;
begin
  -- Als eigenaar via de rechten: factureren en daarna op slot.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);

  update urenregel set status = 'gefactureerd', factuur_referentie = '2026-001'
   where datum = '2026-04-02';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Eigenaar hoort te kunnen factureren, raakte % regels', n; end if;

  select * into r from v_factuur where referentie = '2026-001';
  if r.minuten <> 480 then raise exception 'Factuur hoort 480 minuten te dragen, kreeg %', r.minuten; end if;
  if r.omzet is null then raise exception 'Eigenaar hoort het factuurbedrag te zien'; end if;

  begin
    update urenregel set minuten = 60 where factuur_referentie = '2026-001';
    raise exception 'Gefactureerde regel had op slot moeten zitten';
  exception when restrict_violation then null;
  end;

  reset role;

  -- Als medewerker: zelf factureren kan niet, en de eigen factuur is
  -- zichtbaar zonder bedrag.
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

  select * into r from v_factuur where referentie = '2026-001';
  if r.omzet is not null then raise exception 'Medewerker zag een factuurbedrag'; end if;

  reset role;
  raise notice 'OK 18. factureren zet op slot; medewerker kan het niet en ziet geen bedrag';
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

update termijn set factuur_referentie = '2026-002', gefactureerd_op = now()
 where omschrijving = 'Bij opdracht';

do $$
declare r record;
begin
  select * into r from v_urenregel where onderdeel_id = 'eeeeeeee-0000-0000-0000-000000000009';
  if r.omzet <> 0 then raise exception 'Uren op een vaste prijs horen geen omzet te dragen, kreeg %', r.omzet; end if;
  if r.kosten <> 620 then raise exception 'Kosten lopen wel door (10 u a 62), kreeg %', r.kosten; end if;

  select * into r from v_project_uitputting where project_id = 'dddddddd-0000-0000-0000-000000000002';
  if r.omzet <> 2000 then raise exception 'Omzet hoort de gefactureerde termijn te zijn, kreeg %', r.omzet; end if;
  if r.termijn_open <> 4000 then raise exception 'Open termijnen horen 4000 te zijn, kreeg %', r.termijn_open; end if;
  if r.effectief_uurtarief <> 200 then raise exception 'Effectief tarief 2000 / 10 u = 200, kreeg %', r.effectief_uurtarief; end if;

  select * into r from v_factuur where referentie = '2026-002';
  if r.totaal <> 2000 or r.project <> 'Quickscan' then
    raise exception 'Factuur uit alleen een termijn hoort 2000 op Quickscan te zijn';
  end if;

  begin
    update termijn set bedrag = 1 where factuur_referentie = '2026-002';
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
  select count(*) into n1 from v_factuur where project = 'Beheerabonnement' and totaal = 1250;
  if n1 <> 3 then raise exception 'v_factuur hoort drie abonnementsfacturen van 1250 te tonen, %', n1; end if;

  raise notice 'OK 20. abonnement: periodes ingehaald, idempotent, genummerd, uren als verantwoording';
end
$$;

select 'Alle tests geslaagd.' as resultaat;
