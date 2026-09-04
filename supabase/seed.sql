-- Startgegevens. Veilig om op een verse database te draaien; bevat geen
-- verzonnen klanten of projecten, alleen wat je hoe dan ook nodig hebt.

update instellingen set
  bedrijfsnaam     = coalesce(nullif(bedrijfsnaam, ''), 'Declaratietool'),
  tijdstap_minuten = 15,      -- keuze C2a
  standaard_btw    = 21.00
where id;

-- Functieniveaus voor de tariefzoekvolgorde. Pas de namen aan naar wat je
-- intern gebruikt; de tarieven hangen eraan.
insert into functie (naam, sortering) values
  ('Partner',         1),
  ('Senior adviseur', 2),
  ('Adviseur',        3),
  ('Junior adviseur', 4)
on conflict (naam) do nothing;

-- Kilometervergoeding. Dit bedrag beweegt per jaar: controleer het voor het
-- lopende jaar voordat je ritten gaat declareren.
insert into km_tarief (bedrag_per_km, geldig_vanaf, toelichting)
select 0.230, date '2025-01-01', 'Onbelaste vergoeding 2025. Jaarlijks controleren.'
where not exists (select 1 from km_tarief);
