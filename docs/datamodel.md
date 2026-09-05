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

Een gefactureerde termijn is op slot (trigger). Klopt hij niet, dan crediteer
je de factuur; de historie blijft staan.

## Abonnementen

Het derde model, `abonnement`, hergebruikt de termijnen: `project` krijgt
`herhaal_interval` (maand, kwartaal, jaar), `herhaal_bedrag`, een omschrijving,
een begin- en optionele einddatum, en `herhaal_volgende` — de eerste dag van de
eerstvolgende periode die nog geen termijn heeft. `verwerk_periodieke_facturen()`
loopt van die datum tot vandaag en maakt per periode één termijn
(`periode_start`, `periode_einde`, `automatisch = true`), beschermd door een
unieke index op project en periode. Met `automatisch_factureren` wordt van de
termijn direct een definitieve factuur gemaakt, met een nummer uit de reeks in
`instellingen` (`factuur_prefix`, `factuur_jaar`, `factuur_volgnummer`) en de
goedgekeurde uren van vóór de periode als verantwoording. `verstuurd_op` op de
factuur markeert dat de eigenaar hem heeft verstuurd en afgehandeld.

## Facturen en grootboek (besluit E2, gewijzigd naar c)

Een factuur is een eigen tabel: `factuur` (klant, project, status, nummer,
datum, vervaldatum, periode, subtotaal, btw, totaal, betaald op, `credit_van_id`,
`automatisch`, `verstuurd_op`) met `factuurregel`
(volgorde, omschrijving, aantal, eenheid, prijs, bedrag, `bron`: uren, ritten,
termijn, handmatig of credit). De status loopt van `concept` via `definitief`
naar `betaald` of `gecrediteerd`. Urenregels, ritten en termijnen wijzen met
`factuur_id` naar de factuur waar ze op staan; `factuur_referentie` blijft als
leesbaar nummer bestaan, want daar hangen de sloten en de rapportage aan.

Elke regel legt btw en grootboek vast op het moment van factureren:
`btw_code` en `btw_percentage` uit `btw_tarief`, `grootboek_id` en
`grootboek_nummer` uit `grootboekrekening`. Zo blijft een oude factuur gelijk
als je later een percentage of rekeningnaam aanpast. Welke rekening een regel
krijgt: `project.grootboek_id` als dat is ingevuld, anders de standaard per
soort regel in `instellingen` (`grootboek_uren`, `grootboek_reiskosten`,
`grootboek_termijn`, `grootboek_abonnement`, `grootboek_overig`). De klant
draagt de standaard `btw_code`.

De logica zit in functies die als aanroeper draaien, zodat de rechten van de
tabellen gelden: `maak_factuur()` (concept uit uren, ritten en termijnen),
`voeg_factuurregel_toe()`, `herbereken_factuur()`, `maak_definitief()` (nummer,
vervaldatum, sloten), `verwijder_concept()` (geeft de regels weer vrij) en
`crediteer_factuur()` (nieuwe definitieve factuur met omgekeerde regels).
Facturen zijn zichtbaar vanaf projectleider; alleen de eigenaar schrijft.

De view `v_factuur` geeft per factuur totalen, openstaand, vervallen, en de
minuten en kilometers die eraan hangen. Tests 18, 19 en 21 dekken dit:
bedragen en btw, sloten na definitief maken, grootboek per regel, creditering,
de verkoopboeking, en dat een medewerker geen factuur kan maken of zien.

## Boekhouding (besluit E2, gewijzigd naar d)

`boeking` en `boekingsregel` vormen het journaal. Een boeking heeft een
datum, een dagboek (`verkoop`, `inkoop`, `bank`, `memoriaal`, `btw`), een
doorlopend `volgnummer` en hoogstens één bron: `factuur_id`, `inkoop_id` of
`aangifte_id`. Een regel heeft een rekening en debet óf credit, nooit beide,
nooit nul. Een uitgestelde constraint-trigger (`controleer_boeking`)
controleert aan het eind van de transactie dat elke geraakte boeking regels
heeft en sluit. Regels zijn na het schrijven onveranderlijk (trigger); een
verkoopboeking is nooit te verwijderen, een btw-boeking niet na indienen.

`grootboekrekening.soort` is `activa`, `passiva`, `eigen_vermogen`, `omzet`
of `kosten`; `betaalmiddel` markeert bank, kas en privé. De vaste rekeningen
staan in `instellingen` (`rekening_debiteuren`, `rekening_crediteuren`,
`rekening_bank`, `rekening_btw_verschuldigd`, `rekening_btw_voorbelasting`,
`rekening_btw_aangifte`), net als `btw_aangifte_interval` en
`afgesloten_tot`. Tot en met die laatste datum weigert een trigger elke
boeking, wijziging en verwijdering.

`inkoopfactuur` is één regel per bon: leverancier, omschrijving, kenmerk,
datum, vervaldatum, kostenrekening, bedrag exclusief, btw-code en -bedrag,
`bedrag_incl` als berekende kolom, en `betaald_op` met `betaald_via`. De
boeking verwijst ernaar met `on delete cascade`, dus een inkoop weghalen
haalt haar boekingen mee — wat de afsluittrigger dan weer tegenhoudt in een
gesloten periode. Wijzigen is terugdraaien en opnieuw boeken.

`btw_aangifte` is een momentopname per periode (uitsluitingsbeperking op
overlap): grondslag en btw per rubriek, voorbelasting, `saldo` als berekende
kolom, `ingediend_op`, `betaald_op`. `btw_overzicht(van, tot)` rekent de
rubrieken live uit; `maak_btw_aangifte` legt ze vast en boekt de
verschuiving naar "btw-aangifte te betalen".

Rapporten: `grootboek_saldi(van, tot)` geeft per rekening debet, credit en
saldo over de periode; `v_boeking` de boekingen met bedrag en aantal regels.
Test 22 rekent de keten door: debiteuren gelijk aan alles wat gefactureerd
is, betaling en ongedaan maken, inkoop met voorbelasting en crediteuren,
wijzigen, de aangifte en haar boeking, overlap geweigerd, memoriaal die niet
sluit geweigerd, regels op slot, resultaat gelijk aan omzet min kosten,
afsluiten dat boeken en verwijderen tegenhoudt, en een medewerker die niets
ziet en niets boekt.

## Jaarwerk en loon

`grootboekrekening.rubriek` plaatst elke rekening in de jaarrekening; een
trigger vult hem naar soort als hij ontbreekt. `activum` (aanschaf, restwaarde,
afschrijvingsmaanden, drie rekeningen) met `boeking.activum_id` voor de
afschrijvingsboekingen. `vpb_parameters` per jaar (grens en twee tarieven) en
`boekjaar` per jaar: correcties en verrekend verlies voor de vpb, het
gereserveerde bedrag met zijn boeking, en de datums van opmaken, vaststellen,
deponeren, aangifte en betaling. `resultaat_voor_belasting(jaar)` en
`vpb_berekening(jaar)` rekenen; `reserveer_vpb` en `boek_betaling_vpb` boeken.

`loonparameters` per jaar met de schijven en heffingskortingen als json en de
premies als kolommen; `dienstverband` per medewerker met een
uitsluitingsbeperking tegen overlap; `loonrun` per jaar en maand (uniek) met
status, journaalpost en de datums van aangifte en betalingen; `loonstrook`
per run en medewerker met alle componenten, `werkgeverslasten` en
`totale_kosten` als berekende kolommen. Een definitieve run zet zijn stroken
op slot en is niet te verwijderen. Rechten: alles voor de eigenaar; een
medewerker leest alleen zijn eigen loonstroken.

Test 23 rekent afschrijving en vennootschapsbelasting door; test 24 de
loonheffing (schijven, kortingen), stroken voor een werknemer, een dga en een
deeltijdmaand, de sluitende journaalpost, de betalingen, het vakantiegeld als
bijzondere beloning en de afscherming.

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
