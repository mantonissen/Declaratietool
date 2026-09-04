-- Rechten (keuze D2a: drie rollen).
--
--   medewerker     eigen uren en ritten, geen bedragen
--   projectleider  daarbovenop de uren en het budget van eigen projecten,
--                  wel verkooptarieven, geen kostprijs
--   eigenaar       alles, inclusief kostprijs en marge
--
-- De interne kostprijs zegt in de praktijk iets over wat iemand verdient.
-- Daarom is `kostprijs` alleen leesbaar voor de eigenaar, en zijn de
-- opzoekfuncties security invoker: via een view lekt er zo niets.

-- ------------------------------------------------------------- helpers -----

-- Security definer, want deze functies worden aangeroepen ín het beleid op
-- `medewerker` zelf. Zonder definer levert dat oneindige recursie op. Ze
-- geven alleen iets over de aanroeper prijs, nooit over een ander.

create or replace function huidige_medewerker()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from medewerker where auth_user_id = auth.uid();
$$;

create or replace function mijn_rechten()
returns rechten_niveau
language sql
stable
security definer
set search_path = public, auth
as $$
  select rechten from medewerker where auth_user_id = auth.uid();
$$;

-- De enum is op volgorde gedefinieerd, dus >= werkt zoals je hoopt.
create or replace function minstens(p_niveau rechten_niveau)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(mijn_rechten() >= p_niveau, false);
$$;

create or replace function is_eigenaar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(mijn_rechten() = 'eigenaar', false);
$$;

-- Is de aanroeper projectleider van dít project?
create or replace function leidt_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project
    where id = p_project_id
      and projectleider_id = huidige_medewerker()
  );
$$;

-- ------------------------------------------------------- rls aanzetten -----

alter table instellingen     enable row level security;
alter table functie          enable row level security;
alter table medewerker       enable row level security;
alter table klant            enable row level security;
alter table klant_afstand    enable row level security;
alter table project          enable row level security;
alter table projectonderdeel enable row level security;
alter table tariefregel      enable row level security;
alter table kostprijs        enable row level security;
alter table km_tarief        enable row level security;
alter table weekstaat        enable row level security;
alter table urenregel        enable row level security;
alter table bevroren_verkoop enable row level security;
alter table bevroren_kosten  enable row level security;
alter table rit              enable row level security;

-- --------------------------------------------- stamgegevens: lezen mag -----

-- Iedereen moet klanten, projecten en onderdelen kunnen zien, anders valt er
-- niets te kiezen bij het schrijven. Beheren mag vanaf projectleider.

create policy instellingen_lezen on instellingen
  for select to authenticated using (true);
create policy instellingen_beheren on instellingen
  for update to authenticated using (is_eigenaar()) with check (is_eigenaar());

create policy functie_lezen on functie
  for select to authenticated using (true);
create policy functie_beheren on functie
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

create policy klant_lezen on klant
  for select to authenticated using (true);
create policy klant_beheren on klant
  for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));

create policy project_lezen on project
  for select to authenticated using (true);
create policy project_beheren on project
  for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));

create policy onderdeel_lezen on projectonderdeel
  for select to authenticated using (true);
create policy onderdeel_beheren on projectonderdeel
  for all to authenticated
  using (minstens('projectleider')) with check (minstens('projectleider'));

-- Afstanden: je eigen afwijkende afstand mag je zelf zetten.
create policy afstand_lezen on klant_afstand
  for select to authenticated
  using (medewerker_id = huidige_medewerker() or minstens('projectleider'));
create policy afstand_eigen on klant_afstand
  for all to authenticated
  using (medewerker_id = huidige_medewerker() or is_eigenaar())
  with check (medewerker_id = huidige_medewerker() or is_eigenaar());

-- ---------------------------------------------------------- medewerker -----

-- Namen van collega's zijn gewoon zichtbaar; dat is nodig voor elk overzicht.
-- Rechten en functie wijzigen mag alleen de eigenaar.
create policy medewerker_lezen on medewerker
  for select to authenticated using (true);
create policy medewerker_eigen_profiel on medewerker
  for update to authenticated
  using (auth_user_id = auth.uid() or is_eigenaar())
  with check (auth_user_id = auth.uid() or is_eigenaar());
create policy medewerker_beheren on medewerker
  for insert to authenticated with check (is_eigenaar());
create policy medewerker_verwijderen on medewerker
  for delete to authenticated using (is_eigenaar());

-- ------------------------------------------------------------ tarieven -----

-- Verkooptarieven: leesbaar vanaf projectleider, wijzigen alleen eigenaar.
create policy tarief_lezen on tariefregel
  for select to authenticated using (minstens('projectleider'));
create policy tarief_beheren on tariefregel
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

-- Kostprijs: alleen de eigenaar. Dit is het gevoelige deel.
create policy kostprijs_eigenaar on kostprijs
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

-- De kilometervergoeding mag iedereen zien: het is je eigen vergoeding.
create policy km_tarief_lezen on km_tarief
  for select to authenticated using (true);
create policy km_tarief_beheren on km_tarief
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

-- ----------------------------------------------------------- weekstaat -----

create policy weekstaat_lezen on weekstaat
  for select to authenticated
  using (medewerker_id = huidige_medewerker() or minstens('projectleider'));

create policy weekstaat_eigen on weekstaat
  for insert to authenticated
  with check (medewerker_id = huidige_medewerker());

-- Je mag je eigen week indienen; goedkeuren doet de eigenaar (keuze D1a).
create policy weekstaat_indienen on weekstaat
  for update to authenticated
  using (medewerker_id = huidige_medewerker() or is_eigenaar())
  with check (
    is_eigenaar()
    or (medewerker_id = huidige_medewerker()
        and status in ('concept', 'ingediend'))
  );

-- ------------------------------------------------- urenregels en ritten ----

-- Lezen: eigen regels, of alles op een project dat je leidt, of alles als
-- eigenaar.
create policy urenregel_lezen on urenregel
  for select to authenticated using (
    medewerker_id = huidige_medewerker()
    or is_eigenaar()
    or leidt_project((select project_id from projectonderdeel
                       where id = urenregel.onderdeel_id))
  );

create policy urenregel_schrijven on urenregel
  for insert to authenticated
  with check (medewerker_id = huidige_medewerker() or is_eigenaar());

-- Wijzigen kan zolang de regel niet is goedgekeurd. Daarna is het aan de
-- eigenaar (keuze B4a en D3a).
create policy urenregel_wijzigen on urenregel
  for update to authenticated
  using (
    (medewerker_id = huidige_medewerker()
     and status in ('concept', 'ingediend'))
    or is_eigenaar()
  )
  -- Zonder de statusvoorwaarde in de with check zou je je eigen uren kunnen
  -- goedkeuren en daarmee de bedragen laten bevriezen.
  with check (
    is_eigenaar()
    or (medewerker_id = huidige_medewerker()
        and status in ('concept', 'ingediend'))
  );

-- Verwijderen mag alleen zolang er niets mee is gebeurd; daarna zet je de
-- status op 'vervallen', want de administratie moet zeven jaar terug leesbaar
-- blijven.
create policy urenregel_verwijderen on urenregel
  for delete to authenticated
  using (medewerker_id = huidige_medewerker() and status = 'concept');

create policy rit_lezen on rit
  for select to authenticated using (
    medewerker_id = huidige_medewerker()
    or is_eigenaar()
    or (project_id is not null and leidt_project(rit.project_id))
  );

create policy rit_schrijven on rit
  for insert to authenticated
  with check (medewerker_id = huidige_medewerker() or is_eigenaar());

create policy rit_wijzigen on rit
  for update to authenticated
  using (
    (medewerker_id = huidige_medewerker()
     and status in ('concept', 'ingediend'))
    or is_eigenaar()
  )
  with check (
    is_eigenaar()
    or (medewerker_id = huidige_medewerker()
        and status in ('concept', 'ingediend'))
  );

create policy rit_verwijderen on rit
  for delete to authenticated
  using (medewerker_id = huidige_medewerker() and status = 'concept');

-- ------------------------------------------------- bevroren bedragen -------

-- Hier zit het verschil tussen de drie rollen. Een projectleider mag zien wat
-- een uur oplevert; wat het kost is alleen voor de eigenaar.

create policy bevroren_verkoop_lezen on bevroren_verkoop
  for select to authenticated using (minstens('projectleider'));
create policy bevroren_verkoop_schrijven on bevroren_verkoop
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

create policy bevroren_kosten_eigenaar on bevroren_kosten
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());

-- ------------------------------------------------------------- grants ------

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on v_urenregel, v_rit, v_bezoek, v_project_uitputting,
                v_klant_marge, v_medewerker_maand to authenticated;
grant execute on all functions in schema public to authenticated;

-- Anonieme bezoekers hebben hier niets te zoeken.
revoke all on schema public from anon;
