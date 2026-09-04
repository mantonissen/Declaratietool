# Datamodel

De migraties in `supabase/migrations/` zijn leidend; dit bestand legt uit
waarom het model is zoals het is. De besluiten waar het uit volgt staan in
`docs/besluiten.md`.

## De vorm in het kort

```
klant ── project ── projectonderdeel ──┐
                                       ├── urenregel ── weekstaat
medewerker ────────────────────────────┘        │
     │                                          ├── bevroren_verkoop
     └──────── rit ─────────── klant            └── bevroren_kosten
```

Een **urenregel** hangt aan een projectonderdeel, niet rechtstreeks aan een
project (besluit B1). Een **rit** staat ernaast: je maakt kilometers op dagen
dat je weinig schrijft en omgekeerd. Een bezoek is geen eigen tabel maar een
rit met een `doel` (besluit C4); `v_bezoek` filtert daarop.

## Waarom bedragen nergens hard op de regel staan

Een urenregel bewaart zijn tarief niet. Bij het berekenen loopt
`tarief_voor(onderdeel, medewerker, datum)` zeven niveaus af en stopt bij het
eerste dat iets oplevert:

| Niveau | Waar het tarief vandaan komt |
|---|---|
| 1 | `urenregel.tarief_handmatig` — met de hand op deze regel gezet |
| 2 | `tariefregel` op het projectonderdeel |
| 3 | `tariefregel` op project × functie |
| 4 | `tariefregel` op het project |
| 5 | `tariefregel` op klant × functie |
| 6 | `tariefregel` op de klant |
| 7 | `tariefregel` op de functie (organisatiebreed) |

Niveau 2 tot en met 7 staan in één tabel `tariefregel`. Welk niveau een regel
is, wordt afgeleid uit welke verwijzing gevuld is — een gegenereerde kolom, dus
het kan niet uit de pas lopen met de inhoud. Een check bewaakt dat er precies
één anker staat.

De **functie** (senior adviseur, junior adviseur) is wat in het keuzeplan "rol"
heet. Dat is bewust een andere naam dan `rechten`, want dat is een heel ander
begrip: wie wat mag zien.

## Alles wat geld is, is een periode

`tariefregel`, `kostprijs` en `km_tarief` hebben alle drie een `geldig_vanaf`
en een optionele `geldig_tot` (inclusief). Er wordt gezocht met de datum van de
urenregel, niet met vandaag — een tariefverhoging raakt oude uren dus niet.

Een gegenereerde `geldigheid`-kolom maakt er een `daterange` van. Daarop ligt
een exclusion constraint, zodat twee regels op hetzelfde anker elkaar niet
kunnen overlappen. Zonder die constraint zou niet te zeggen zijn welk tarief
geldt.

## Bevriezen (besluit B4)

Zolang een regel `concept` of `ingediend` is, worden de bedragen steeds opnieuw
uitgerekend — een fout in een tarief is dan nog met één correctie te herstellen.
Zodra de status `goedgekeurd` of `gefactureerd` wordt, zet een trigger de
bedragen vast. Gaat een regel terug naar concept, dan vervallen ze weer.

De bevroren bedragen staan **niet op de urenregel**. Dat is geen detail: een
medewerker mag zijn eigen regel lezen en een projectleider die van zijn hele
team, dus op de regel zelf zou de kostprijs van collega's alsnog open liggen.
Ze staan daarom in twee aparte tabellen met een eigen gevoeligheid:

- `bevroren_verkoop` — leesbaar vanaf projectleider
- `bevroren_kosten` — alleen voor de eigenaar

## Wie ziet wat (besluit D2)

| | medewerker | projectleider | eigenaar |
|---|---|---|---|
| eigen uren en ritten | ✓ | ✓ | ✓ |
| uren van het team | — | eigen projecten | ✓ |
| klanten, projecten, onderdelen lezen | ✓ | ✓ | ✓ |
| klanten en projecten beheren | — | ✓ | ✓ |
| verkooptarieven | — | ✓ | ✓ |
| interne kostprijs en marge | — | — | ✓ |
| uren goedkeuren | — | — | ✓ |

Dit is afgedwongen met row level security, niet in de applicatie. Twee dingen
maken dat sluitend:

- De views draaien met `security_invoker`, dus de rechten van de tabellen
  eronder blijven gelden.
- `tarief_voor` en `kostprijs_voor` zijn **security invoker**, geen definer.
  Zou dat andersom zijn, dan lekten de bedragen alsnog via een view. Voor wie
  geen leesrecht heeft geven ze `null` terug en blijven de bedragen leeg.

`huidige_medewerker()`, `mijn_rechten()` en `minstens()` zijn wél security
definer — anders zou het beleid op `medewerker` zichzelf aanroepen. Ze geven
alleen iets over de aanroeper prijs.

## Corrigeren en bewaren (besluit D3)

Een gefactureerde regel is op slot: een trigger weigert wijzigingen aan datum,
minuten, onderdeel of bedrag. Corrigeren gaat met een tegenboeking — een
urenregel met negatieve minuten en een `correctie_van_id`. Negatieve minuten
zijn alleen toegestaan mét zo'n verwijzing.

Verwijderen gebeurt niet: regels krijgen de status `vervallen` en verdwijnen
uit de views. De administratie moet zeven jaar terug te lezen zijn.

## Kilometers (besluit C3)

`klant.afstand_km` is de enkele reis vanaf de standplaats. Woont een collega
ergens anders, dan zet `klant_afstand` daar een eigen afstand tegenover;
`afstand_voor(klant, medewerker)` kiest de juiste. Een rit legt de afstand vast
en `retour` verdubbelt hem via een gegenereerde kolom `totaal_km`.

Het kilometerbedrag staat bewust in een tabel met periodes en niet in de code:
het beweegt per jaar. Controleer het bedrag voor het lopende jaar voordat je
gaat declareren. Rijd je in een auto van de zaak, leg de eisen aan een sluitende
rittenregistratie dan naast je boekhouder — dat kan extra verplichte velden
betekenen.

## Rapportage (besluit E1)

| View | Waarvoor |
|---|---|
| `v_urenregel` | urenregels met uren, omzet, kosten en of ze bevroren zijn |
| `v_rit` | ritten met kilometers en bedrag |
| `v_bezoek` | ritten die als bezoek tellen |
| `v_project_uitputting` | besteed versus budget, marge, effectief uurtarief |
| `v_klant_marge` | hetzelfde per klant |
| `v_medewerker_maand` | uren, declarabiliteit en marge per persoon per maand |

Kosten lopen door op niet-declarabele uren: die betaal je ook. Een onderdeel
dat op niet-declarabel staat maakt elke regel eronder niet-declarabel.

`effectief_uurtarief` is omzet gedeeld door bestede uren. Bij nacalculatie is
dat gelijk aan het tarief; zodra er vaste prijzen bij komen (besluit B5, later)
is het het getal dat er werkelijk toe doet.

## Vaste prijs en termijnen (besluit B5, gewijzigd naar b)

Een project heeft een `facturatiemodel`: `nacalculatie` of `vaste_prijs`. Bij
een vaste prijs staat de afgesproken som in `project.vaste_prijs` en wordt hij
gefactureerd via de tabel `termijn`: per project een reeks (volgorde,
omschrijving, bedrag, geplande datum), elk met een `factuur_referentie` zodra
hij gefactureerd is. Een termijn kan vooraf zijn ingepland (30/40/30) of ter
plekke worden toegevoegd bij een tussenoplevering.

De uren op zo'n project worden gewoon geschreven en goedgekeurd, maar
`v_urenregel` geeft ze omzet **nul**: ze bepalen de factuur niet. Ze tellen wel
in de kosten, en bij het factureren gaan ze mee als verantwoording (met de
factuurreferentie, dus op slot). `v_project_uitputting` telt de gefactureerde
termijnen als omzet en rekent daar het effectieve uurtarief uit — som gedeeld
door bestede uren, het getal dat bij een vaste prijs telt.

Een gefactureerde termijn is op slot (trigger). Klopt hij niet, dan volgt een
creditnota in het boekhoudpakket; hier blijft de historie staan.

## Abonnementen

Het derde model, `abonnement`, hergebruikt de termijnen: `project` krijgt
`herhaal_interval` (maand, kwartaal, jaar), `herhaal_bedrag`, een omschrijving,
een begin- en optionele einddatum, en `herhaal_volgende` — de eerste dag van de
eerstvolgende periode die nog geen termijn heeft. `verwerk_periodieke_facturen()`
loopt van die datum tot vandaag en maakt per periode één termijn
(`periode_start`, `periode_einde`, `automatisch = true`), beschermd door een
unieke index op project en periode. Met `automatisch_factureren` krijgt de
termijn direct een nummer uit de reeks in `instellingen`
(`factuur_prefix`, `factuur_jaar`, `factuur_volgnummer`) en gaan de goedgekeurde
uren van vóór de periode mee als verantwoording. `verwerkt_op` op de termijn
markeert dat de eigenaar de factuur in de boekhouding heeft overgenomen.

## Facturen

Een factuur is geen tabel maar een `factuur_referentie` op urenregels, ritten
en termijnen van één project. `v_factuur` telt per referentie op: uren en
omzet, kilometers, termijnbedrag, totaal. Omdat de view op de afgeschermde views
leunt, ziet een medewerker zijn eigen regels zonder bedrag (test 18).

## Testen

```
./scripts/test-db.sh
```

Zet een wegwerp-postgres op, draait de migraties en controleert onder meer of
de zoekvolgorde alle niveaus goed afloopt, of een tariefverhoging goedgekeurde
uren met rust laat, en of een medewerker en een projectleider werkelijk geen
kostprijs te zien krijgen. Het `auth`-schema van Supabase wordt daarbij lokaal
nagebootst (`supabase/tests/00_auth_shim.sql`), zodat `auth.uid()` zich hetzelfde
gedraagt als in productie.
