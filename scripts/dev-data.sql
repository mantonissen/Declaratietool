-- Voorbeeldgegevens om lokaal mee te werken. Niet voor productie: er staan
-- verzonnen klanten en medewerkers in.
--
-- Draai dit na de migraties en supabase/seed.sql.

-- Accounts. In productie maakt Supabase deze aan bij het eerste inloggen.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'martijn@voorbeeld.nl'),
  ('22222222-2222-2222-2222-222222222222', 'petra@voorbeeld.nl'),
  ('33333333-3333-3333-3333-333333333333', 'sam@voorbeeld.nl')
on conflict (id) do nothing;

insert into medewerker (id, auth_user_id, naam, email, functie_id, rechten, standplaats, in_dienst_vanaf)
select v.id, v.auth_user_id, v.naam, v.email, f.id, v.rechten::rechten_niveau, v.standplaats, date '2024-01-01'
from (values
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   'Martijn Antonissen', 'martijn@voorbeeld.nl', 'Partner',         'eigenaar',      'Breda'),
  ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, '22222222-2222-2222-2222-222222222222'::uuid,
   'Petra Jansen',       'petra@voorbeeld.nl',   'Adviseur',        'medewerker',    'Utrecht'),
  ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, '33333333-3333-3333-3333-333333333333'::uuid,
   'Sam de Vries',       'sam@voorbeeld.nl',     'Senior adviseur', 'projectleider', 'Breda')
) as v(id, auth_user_id, naam, email, functienaam, rechten, standplaats)
join functie f on f.naam = v.functienaam
on conflict (id) do nothing;

-- Interne kostprijzen (keuze B3a). Alleen zichtbaar voor de eigenaar.
insert into kostprijs (medewerker_id, bedrag_per_uur, geldig_vanaf, toelichting)
select id, bedrag, date '2026-01-01', 'Schatting 2026'
from (values
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 95.00),
  ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 58.00),
  ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 74.00)
) as v(id, bedrag)
where not exists (select 1 from kostprijs k where k.medewerker_id = v.id);

-- Klanten, met de afstand vanaf kantoor voor de kilometerregistratie (C3a).
insert into klant (id, naam, code, plaats, adres, postcode, afstand_km, btw_percentage) values
  ('cccccccc-0000-0000-0000-000000000001', 'Gemeente Zwolle',      'ZWO', 'Zwolle',
   'Grote Kerkplein 15', '8011 PK', 82.5, 21.00),
  ('cccccccc-0000-0000-0000-000000000002', 'Waterschap Rivierenland', 'WSR', 'Tiel',
   'De Blomboogerd 1', '4003 BX', 46.0, 21.00),
  ('cccccccc-0000-0000-0000-000000000003', 'Bouwgroep Meridiaan',  'MER', 'Eindhoven',
   'Kanaaldijk-Noord 12', '5613 DJ', 61.5, 21.00)
on conflict (id) do nothing;

-- Petra woont in Utrecht en rijdt dus een andere afstand naar Zwolle.
insert into klant_afstand (klant_id, medewerker_id, afstand_km) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 96.0)
on conflict do nothing;

insert into project (id, klant_id, naam, code, projectleider_id, start_datum, budget_uren, budget_bedrag) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'Herinrichting stationsgebied', 'ZWO-01',
   'bbbbbbbb-0000-0000-0000-000000000003', date '2026-01-15', 420, 58000),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002',
   'Dijkversterking traject 4', 'WSR-02',
   'bbbbbbbb-0000-0000-0000-000000000003', date '2026-03-01', 260, 36000),
  ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003',
   'Vergunningtraject Kanaalzone', 'MER-01',
   'bbbbbbbb-0000-0000-0000-000000000001', date '2026-06-01', 120, 17000)
on conflict (id) do nothing;

insert into projectonderdeel (id, project_id, naam, declarabel, budget_uren, sortering) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Inventarisatie',      true,  80,  1),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'Ontwerp',             true,  200, 2),
  ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001', 'Participatieavonden', true,  60,  3),
  ('eeeeeeee-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001', 'Intern overleg',      false, null, 9),
  ('eeeeeeee-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000002', 'Veldwerk',            true,  120, 1),
  ('eeeeeeee-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000002', 'Rapportage',          true,  90,  2),
  ('eeeeeeee-0000-0000-0000-000000000007', 'dddddddd-0000-0000-0000-000000000003', 'Vooroverleg bevoegd gezag', true, 40, 1),
  ('eeeeeeee-0000-0000-0000-000000000008', 'dddddddd-0000-0000-0000-000000000003', 'Aanvraag opstellen',  true,  70,  2)
on conflict (id) do nothing;

-- Tarieven op verschillende niveaus, zodat de zoekvolgorde zichtbaar werkt.
insert into tariefregel (klant_id, functie_id, bedrag_per_uur, geldig_vanaf, toelichting)
select k.id, f.id, v.bedrag, date '2026-01-01', 'Tariefkaart klant x functie'
from (values
  ('ZWO', 'Partner',         185.00),
  ('ZWO', 'Senior adviseur', 155.00),
  ('ZWO', 'Adviseur',        128.00),
  ('WSR', 'Senior adviseur', 148.00),
  ('WSR', 'Adviseur',        122.00),
  ('MER', 'Partner',         195.00),
  ('MER', 'Adviseur',        135.00)
) as v(klantcode, functienaam, bedrag)
join klant k   on k.code = v.klantcode
join functie f on f.naam = v.functienaam
where not exists (
  select 1 from tariefregel t
  where t.klant_id = k.id and t.functie_id = f.id
);

-- Participatieavonden gaan tegen een afwijkend tarief: een onderdeeltarief
-- (niveau 2) wint van de tariefkaart van de klant.
insert into tariefregel (onderdeel_id, bedrag_per_uur, geldig_vanaf, toelichting)
select 'eeeeeeee-0000-0000-0000-000000000003', 165.00, date '2026-01-01',
       'Avondwerk, afwijkend tarief'
where not exists (
  select 1 from tariefregel
  where onderdeel_id = 'eeeeeeee-0000-0000-0000-000000000003'
);

-- Een paar weken geschreven uren, geteld vanaf de maandag van deze week.
with basis as (select date_trunc('week', current_date)::date as maandag)
insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving, status)
select v.medewerker::uuid, v.onderdeel::uuid, b.maandag + v.dag, v.minuten,
       v.omschrijving, v.status::regel_status
from basis b, (values
  -- Vorige week: ingediend en goedgekeurd, dus met bevroren bedragen.
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', -7, 480, 'Veldbezoek en inventarisatie',    'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', -6, 450, 'Schetsontwerp uitgewerkt',        'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', -5, 480, 'Varianten doorgerekend',          'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000004', -5,  60, 'Weekstart',                       'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003', -4, 240, 'Participatieavond wijk noord',    'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000006', -3, 360, 'Conceptrapport',                  'goedgekeurd'),
  -- Deze week: nog concept.
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',  0, 390, 'Definitief ontwerp',              'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000004',  0,  45, 'Weekstart',                       'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',  1, 480, 'Detaillering plein',              'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000005',  2, 300, 'Veldwerk dijkvak 4b',             'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000006',  2, 120, 'Meetgegevens verwerkt',           'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003',  3, 195, 'Voorbereiding avond wijk zuid',   'concept'),
  -- Sam, om te laten zien dat een projectleider meer ziet dan zijn eigen uren.
  ('bbbbbbbb-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000002',  0, 240, 'Toetsing ontwerp',                'concept'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000007',  1, 180, 'Vooroverleg gemeente',            'concept')
) as v(medewerker, onderdeel, dag, minuten, omschrijving, status)
where not exists (select 1 from urenregel limit 1);

with basis as (select date_trunc('week', current_date)::date as maandag)
insert into rit (medewerker_id, klant_id, project_id, datum, doel, afstand_km, retour, omschrijving, status)
select v.medewerker::uuid, k.id, p.id, b.maandag + v.dag, v.doel::rit_doel,
       afstand_voor(k.id, v.medewerker::uuid), true, v.omschrijving, v.status::regel_status
from basis b, (values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ZWO', 'ZWO-01', -7, 'klantbezoek',   'Startoverleg op locatie', 'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ZWO', 'ZWO-01', -4, 'locatiebezoek', 'Participatieavond',       'goedgekeurd'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'WSR', 'WSR-02',  2, 'locatiebezoek', 'Veldwerk dijkvak 4b',     'concept')
) as v(medewerker, klantcode, projectcode, dag, doel, omschrijving, status)
join klant k   on k.code = v.klantcode
join project p on p.code = v.projectcode
where not exists (select 1 from rit limit 1);

-- Het vergunningtraject is een vaste prijs in drie termijnen (keuze B5b).
update project set facturatiemodel = 'vaste_prijs', vaste_prijs = 17000
 where code = 'MER-01';
insert into termijn (project_id, volgorde, omschrijving, bedrag, gepland_op)
select p.id, v.volgorde, v.oms, v.bedrag, v.gepland
from project p, (values
  (1, 'Bij opdracht (30%)',                 5100.00, date '2026-06-15'),
  (2, 'Tussenoplevering vooroverleg (40%)', 6800.00, date '2026-09-30'),
  (3, 'Eindoplevering aanvraag (30%)',      5100.00, date '2026-12-15')
) as v(volgorde, oms, bedrag, gepland)
where p.code = 'MER-01'
  and not exists (select 1 from termijn t where t.project_id = p.id);

-- Sam heeft twee weken geleden ingediend en wacht op goedkeuring, zodat het
-- goedkeurscherm iets te doen heeft.
with basis as (select (date_trunc('week', current_date) - interval '14 days')::date as maandag)
insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving, status)
select 'bbbbbbbb-0000-0000-0000-000000000003', v.onderdeel::uuid, b.maandag + v.dag, v.minuten, v.oms, 'ingediend'
from basis b, (values
  ('eeeeeeee-0000-0000-0000-000000000002', 0, 420, 'Toetsing schetsontwerp'),
  ('eeeeeeee-0000-0000-0000-000000000005', 1, 480, 'Veldwerk met Petra'),
  ('eeeeeeee-0000-0000-0000-000000000006', 2, 360, 'Rapportage dijkvak 3'),
  ('eeeeeeee-0000-0000-0000-000000000004', 3, 60,  'Teamoverleg'),
  ('eeeeeeee-0000-0000-0000-000000000002', 3, 300, 'Review varianten')
) as v(onderdeel, dag, minuten, oms)
where not exists (
  select 1 from urenregel where medewerker_id = 'bbbbbbbb-0000-0000-0000-000000000003' and status = 'ingediend'
);

insert into weekstaat (medewerker_id, jaar, week, status, ingediend_op)
select 'bbbbbbbb-0000-0000-0000-000000000003',
       extract(isoyear from d)::int, extract(week from d)::int, 'ingediend', now() - interval '9 days'
from (select (date_trunc('week', current_date) - interval '14 days')::date as d) s
on conflict (medewerker_id, jaar, week) do nothing;

update urenregel u set weekstaat_id = w.id
from weekstaat w
where u.medewerker_id = w.medewerker_id and u.status = 'ingediend' and u.weekstaat_id is null
  and extract(isoyear from u.datum)::int = w.jaar and extract(week from u.datum)::int = w.week;

-- De goedgekeurde week een weekstaat geven, zodat het scherm klopt.
insert into weekstaat (medewerker_id, jaar, week, status, ingediend_op, beoordeeld_door, beoordeeld_op)
select 'bbbbbbbb-0000-0000-0000-000000000002',
       extract(isoyear from d)::int, extract(week from d)::int,
       'goedgekeurd', now() - interval '5 days',
       'bbbbbbbb-0000-0000-0000-000000000001', now() - interval '4 days'
from (select (date_trunc('week', current_date) - interval '7 days')::date as d) s
on conflict (medewerker_id, jaar, week) do nothing;

update urenregel u
set weekstaat_id = w.id
from weekstaat w
where u.medewerker_id = w.medewerker_id
  and u.status = 'goedgekeurd'
  and u.weekstaat_id is null
  and extract(isoyear from u.datum)::int = w.jaar
  and extract(week    from u.datum)::int = w.week;
