# Architectuur

Het datamodel staat in `docs/datamodel.md`. Dit gaat over de applicatie
erbovenop.

## Waar de afscherming zit

In de database, niet in de applicatie. Elke pagina die gegevens ophaalt gaat
door `alsGebruiker()` in `lib/db.ts`, en die doet binnen één transactie:

```sql
select set_config('request.jwt.claim.sub', <account>, true);
set local role authenticated;
```

Vanaf dat punt gelden de policies uit `supabase/migrations/…_rechten.sql`. De
applicatie kan dus niet per ongeluk meer tonen dan mag: een medewerker die het
urenoverzicht opvraagt krijgt lege bedragen terug omdat de database ze niet
teruggeeft, niet omdat een component ze wegfiltert.

Dat is te zien in de CSV-export. Dezelfde query, twee rollen:

```
eigenaar    2026-08-24;Petra Jansen;Gemeente Zwolle;…;8,00;ja;goedgekeurd;128,00;1024,00
medewerker  2026-08-24;Petra Jansen;Gemeente Zwolle;…;8,00;ja;goedgekeurd;;
```

`set local` en `set_config(…, true)` gelden alleen binnen de transactie, dus na
afloop staat de verbinding weer schoon in de pool.

## Waarom rechtstreeks op Postgres en niet via supabase-js

Supabase levert Postgres, authenticatie en opslag. Voor het lezen en schrijven
van gegevens gebruikt deze applicatie de databaseverbinding rechtstreeks
(server-side, met `postgres.js`) in plaats van de REST-laag van Supabase.

Dat scheelt: het beleid uit de migraties is de enige plek waar afscherming
staat en die geldt in ontwikkeling net zo goed als in productie, dus het is
lokaal te testen zonder de hele Supabase-stack te draaien. Alle datatoegang is
server-side; de browser praat nooit rechtstreeks met de database.

Wat je ermee opgeeft: de realtime-abonnementen van Supabase en het aanroepen
van de database vanuit de browser. Deze applicatie rendert op de server en
werkt met formulieren, dus daar is geen van beide nodig. Wordt dat later wel
nodig, dan kan supabase-js ernaast: het beleid geldt daar even goed.

## Inloggen

`lib/auth.ts` heeft twee wegen achter één functie:

- **`AUTH_MODUS=supabase`** — de sessie komt van Supabase Auth (keuze A4a:
  Google of Microsoft). Er wordt `getUser()` gebruikt en niet `getSession()`,
  omdat alleen de eerste het token daadwerkelijk laat controleren.
- **`AUTH_MODUS=dev`** — je kiest zelf een medewerker uit de database. Dit
  weigert te starten als `NODE_ENV=production`, want anders zou één verkeerd
  gezette variabele de hele afscherming omzeilen.

Het account uit Supabase wordt gekoppeld aan een rij in `medewerker` via
`auth_user_id`. Iemand zonder zo'n rij komt niet binnen, ook niet met een geldig
account.

> De Supabase-weg is niet in deze omgeving getest — daar was geen
> Supabase-instantie voor. De dev-weg is dat wel, en beide komen uit op dezelfde
> `Sessie`.

## Schermen

| Route | Wat |
|---|---|
| `/uren` | Dagweergave op mobiel, weekraster op desktop (keuze C1a) |
| `/uren/nieuw` | Uren toevoegen; werkt met een gewoon formulier |
| `/ritten` | Ritten en bezoeken; afstand komt van de klant (C3a) |
| `/week` | Weekstaat indienen en terugtrekken (D1a) |
| `/beheer` | Klanten, projecten en projectonderdelen |
| `/beheer/tarieven` | Verkooptarieven per niveau, functies, kilometervergoeding (B2a) |
| `/beheer/medewerkers` | Medewerkers, rechten en kostprijs per periode (B3a, D2a) |
| `/goedkeuren` | Ingediende weken beoordelen; goedkeuren bevriest de bedragen (D1a, B4a) |
| `/inzicht` | Uren, omzet, kosten, marge en budget per periode (E1a) |
| `/facturen` | Openstaand en vervallen, concepten, automatische abonnementsfacturen, factuurvoorstel per project, losse factuur, journaalexport |
| `/facturen/[id]` | Eén factuur: concept bewerken (regels, btw, grootboek), definitief maken, betaald, crediteren, correcties met tegenboeking (D3a) |
| `/api/factuur` | De factuur als PDF, met de urenspecificatie als bijlage |
| `/api/specificatie` | Urenspecificatie als PDF, per factuur of per project en periode (E3a) |
| `/api/export/facturen` | Journaal voor de boekhouding: per factuurregel één rij met grootboek en btw (E2) |
| `/beheer/instellingen` | Bedrijfsgegevens voor bovenaan factuur en specificatie |
| `/beheer/grootboek` | Grootboekrekeningen, standaardrekening per soort regel, btw-tarieven, betaaltermijn, voettekst |
| `/export` → `/api/export` | CSV van uren of ritten (E2a) |

## Factureren

De app maakt de factuur zelf (keuze E2, gewijzigd naar c: factureren in de
app, met een koppeling naar de boekhouding voorbereid). De eigenaar kiest een
project, ziet wat er te factureren staat — goedgekeurde uren en ritten in een
periode, open termijnen — en maakt daar een **concept** van. De functie
`maak_factuur()` in de database bouwt de regels: uren gegroepeerd per onderdeel
en tarief, reiskosten per kilometertarief, elke aangevinkte termijn als eigen
regel. Uren, ritten en termijnen krijgen meteen `factuur_id`, zodat ze niet in
een tweede voorstel opduiken; een verwijderd concept geeft ze weer vrij.

Een concept is bewerkbaar: omschrijving, aantal, prijs, btw-code en
grootboekrekening per regel, extra regels erbij, referentie van de klant. De
totalen worden in de database herberekend (`herbereken_factuur()`, btw per regel
afgerond). **Definitief maken** (`maak_definitief()`) geeft het volgende nummer
uit de reeks `JJJJ-NNN`, zet de vervaldatum op factuurdatum plus de
betaaltermijn uit de instellingen, stempelt `gefactureerd` en de referentie op
de onderliggende regels en zet alles op slot — de triggers uit de migraties
weigeren vanaf dan elke wijziging aan factuur, regels, uren en termijnen.
Daarna: **betaald** (met datum) of **gecrediteerd** via `crediteer_factuur()`,
dat een nieuwe definitieve factuur maakt met dezelfde regels met een min ervoor.
Een creditfactuur hoort bij het origineel (`credit_van_id`); de uren blijven
gefactureerd, en klopt een aantal uren niet, dan is er de correctie hieronder.

Elke regel draagt een **btw-code** (tabel `btw_tarief`: hoog, laag, nul,
verlegd, vrijgesteld — percentage instelbaar) en een **grootboekrekening**
(tabel `grootboekrekening`). De code en het percentage en het rekeningnummer
worden op de regel vastgelegd, zodat een latere wijziging in het beheer een
oude factuur niet verandert. Welke rekening een regel krijgt bepaalt
`grootboek_voor()`: een rekening op het project gaat voor, anders de
standaardrekening per soort regel uit `instellingen` (uren, reiskosten,
termijnen vaste prijs, abonnementen, overig). De klant draagt de standaard
btw-code; per regel kun je afwijken.

Voor de boekhouding is er `v_factuur_journaal`: per factuurregel één rij met
factuurnummer, datum, vervaldatum, klant, grootboeknummer, btw-code en
-bedrag. `/api/export/facturen` levert die als CSV over een periode, desgewenst
alleen wat nog niet geëxporteerd is, en zet dan `geexporteerd_op` op de
factuur. Een directe koppeling met een pakket (E2b) stuurt straks dezelfde
kolommen door; de export blijft ernaast bestaan als controle en als uitweg.

Drie modellen per project (keuze B5b):

- **Nacalculatie** — de goedgekeurde uren en ritten in een periode, tegen het
  bevroren tarief.
- **Vaste prijs** — een afgesproken som, vastgelegd in `project.vaste_prijs`,
  gefactureerd in **termijnen** (tabel `termijn`) bij tussenopleveringen. Een
  termijn kan vooraf zijn ingepland of ter plekke worden toegevoegd. De uren
  worden gewoon geschreven en goedgekeurd, maar `v_urenregel` geeft ze omzet
  nul; ze tellen in de kosten en gaan bij het factureren mee als
  verantwoording op de specificatie, zonder bedrag. Omzet van zo'n project is
  de som van de gefactureerde termijnen; het effectieve uurtarief is die som
  gedeeld door de bestede uren — het getal dat bij een vaste prijs telt.

De view `v_factuur` geeft per factuur status, totalen, openstaand bedrag,
vervallen ja/nee en het aantal minuten en kilometers dat eraan hangt. Facturen
zijn alleen zichtbaar vanaf projectleider en alleen de eigenaar mag ze maken;
`maak_factuur()` en de andere factuurfuncties draaien als aanroeper, dus de
rechten van de tabellen gelden ook daar — getest in
`supabase/tests/10_schema_test.sql` (tests 18, 19 en 21).

**Corrigeren** (keuze D3a): het origineel blijft staan. Er komt een tegenboeking
bij met negatieve minuten, `correctie_van_id` naar het origineel, en als
handmatig tarief het bevroren tarief van het origineel — zodat de creditering
precies het origineel opheft, ook als het tarief inmiddels is veranderd. Wil je
een ander aantal uren, dan komt er een nieuwe regel bij. Beide vallen in de
huidige periode en verschijnen in het volgende factuurvoorstel van die klant.

- **Abonnement** — een vast bedrag per maand, kwartaal of jaar. De functie
  `verwerk_periodieke_facturen()` maakt per verstreken periode één termijn aan
  (uniek op project en periode, dus de functie mag zo vaak draaien als je
  wilt) en maakt daar, als *automatisch factureren* aanstaat, meteen een
  definitieve factuur van via `maak_factuur()` en `maak_definitief()`, met
  een nummer uit de reeks en de goedgekeurde uren van vóór die periode als
  verantwoording. Staat het vinkje uit, dan verschijnt de periode als open
  termijn in het factuurvoorstel.

  De verwerking draait op twee manieren: dagelijks via Vercel Cron
  (`vercel.json` → `/api/cron/facturen`, beveiligd met `CRON_SECRET`), en
  telkens als de eigenaar het factuurscherm opent. Het tweede maakt de eerste
  optioneel — zonder cron loopt hooguit de datum van aanmaken iets achter.
  Op Supabase kan pg_cron hetzelfde doen: `select cron.schedule('abonnementen',
  '15 5 * * *', $$select verwerk_periodieke_facturen()$$)`.

  Automatische facturen staan bovenaan het factuurscherm tot de eigenaar ze
  heeft verstuurd en afvinkt (`factuur.verwerkt_op`).

## Factuur en specificatie als PDF

`lib/pdf.ts` tekent beide met pdfkit: A4, Helvetica, één kolomraster. De
factuur heeft de regels met btw-percentage, subtotaal, btw per tarief, totaal,
de betaalinstructie met IBAN en vervaldatum, en de voettekst uit de
instellingen; bij btw verlegd staat dat erbij. Standaard hangt de
urenspecificatie erachter als bijlage (`/api/factuur?id=…`, met `bijlage=nee`
zonder). De specificatie toont per project een blok met subtotaal, reiskosten
apart en termijnen; per klant is instelbaar of omschrijvingen en tarieven erop
staan (`klant.specificatie_omschrijving`, `klant.specificatie_tarieven`); met
`?detail=vol` krijg je altijd alles, voor intern gebruik. pdfkit staat in
`serverExternalPackages`, anders raakt het zijn lettertypen kwijt in de bundel.

## Inzicht en grafieken

De cijfers komen uit de afgeschermde views, dus dezelfde pagina toont een
medewerker zijn uren en declarabiliteit, een projectleider daarbovenop omzet,
en de eigenaar ook kosten en marge. De kolommen en het heldencijfer schakelen
mee: waar geen omzet is, tonen ze uren.

De grafieken zijn inline SVG, op de server gerenderd. De twee reeks­kleuren zijn
niet de huisstijlgroen — die zit onder de chromadrempel en leest in een staaf
als grijs — maar een groen-blauwpaar dat met `validate_palette.js` uit de
dataviz-richtlijnen is gecontroleerd op kleurenblindheid en contrast, apart voor
licht en donker. De budgetmeter gebruikt statuskleuren en zet er altijd een woord
naast, want kleur alleen is voor een deel van de lezers geen signaal. Elke grafiek
heeft een tabelversie eronder.

## Collega's toevoegen

De eigenaar maakt een medewerker aan met naam en e-mailadres. Logt er daarna
iemand in met precies dat adres, dan koppelt `huidigeSessie()` het account
eenmalig aan die rij. Er komt geen SQL aan te pas; wie niet is aangemaakt komt
ook met een geldig account niet binnen.

Het weekraster stuurt bij opslaan alleen de cellen die veranderd zijn; anders
zou elke opslag zeven dagen maal het aantal regels aan schrijfacties kosten. Dat
raster heeft javascript nodig. De mobiele weg — dagweergave met losse
formulieren — werkt zonder, en dat is ook de weg die op een telefoon telt.

## Vorm

Dezelfde taal als het keuzeplan: koel papier, grootboekgroen, Archivo voor de
tekst en IBM Plex Mono voor alles wat in een kolom moet uitlijnen. Licht en
donker volgen de instelling van het apparaat.

Op mobiel staat de navigatie onderaan binnen duimbereik, op desktop links.
Invoervelden zijn minstens 44 pixels hoog en 16 pixels groot, want daaronder
zoomt iOS in bij het focussen.

## De CSV

Puntkomma's als scheidingsteken en een BOM vooraan. Zonder die twee opent een
Nederlandse Excel het bestand als één kolom met kapotte accenten. Bedragen en
aantallen staan met een komma in het bestand.
