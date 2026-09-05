# Uitrollen

Van deze repository naar een adres dat jij en je collega's kunnen openen. Met
de keuzes A2 en A3 (Next.js + Supabase, Europese cloud) is dat: database en
inloggen bij Supabase, de applicatie bij Vercel. Reken op een kwartier tot een
half uur, het meeste daarvan is klikken door instellingen.

## 1. Supabase-project

1. Maak op <https://supabase.com> een nieuw project. Kies als regio
   **Frankfurt (eu-central-1)** of een andere EU-regio (keuze A3).
2. Ga naar *SQL Editor* en voer de migraties uit, in volgorde:
   `supabase/migrations/20260904120000_basis.sql` tot en met
   `…20260906090000_jaarwerk.sql`. Daarna `supabase/seed.sql`.

   Heb je de Supabase CLI: `supabase link` en `supabase db push` doen
   hetzelfde.
3. Noteer bij *Project Settings → Database* de **connection string**. Gebruik
   de pooler-variant (poort 6543, "Transaction" mode) — Vercel draait
   serverless en opent anders te veel verbindingen.
4. Noteer bij *Project Settings → API* de **Project URL** en de **anon key**.

## 2. Inloggen met Google of Microsoft (keuze A4)

Bij *Authentication → Providers*:

- **Google**: maak in de Google Cloud Console een OAuth-client aan (type
  Web application) met als redirect URL het adres dat Supabase je toont.
  Plak client-id en secret in Supabase.
- **Microsoft (Azure)**: registreer een app in Entra ID, zelfde redirect URL,
  plak application-id en secret in Supabase.

Zet bij *Authentication → URL Configuration* de *Site URL* op je Vercel-adres
zodra je dat hebt (stap 3), en voeg `https://<jouw-adres>/**` toe aan de
redirect-lijst.

## 3. Vercel

1. Importeer de repository op <https://vercel.com>. Framework wordt
   automatisch herkend als Next.js.
2. Zet bij *Environment Variables*:

   | Naam | Waarde |
   |---|---|
   | `DATABASE_URL` | de pooler connection string uit stap 1 |
   | `AUTH_MODUS` | `supabase` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL uit stap 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key uit stap 1 |
   | `CRON_SECRET` | een lang willekeurig geheim; Vercel gebruikt het voor de dagelijkse abonnementsverwerking |

3. Deploy. Je krijgt een adres als `declaratietool.vercel.app`; een eigen
   domein koppel je onder *Domains*.

## 4. Jezelf en je collega's toevoegen

Inloggen lukt alleen voor wie in de tabel `medewerker` staat. De eerste
eigenaar zet je eenmalig zelf in de SQL Editor, vóórdat je inlogt — het account
wordt bij die eerste login automatisch gekoppeld op e-mailadres:

```sql
insert into medewerker (naam, email, functie_id, rechten)
values ('Martijn Antonissen', 'jouw@adres.nl',
        (select id from functie where naam = 'Partner'), 'eigenaar');
```

Daarna gaat alles via de app: onder *Beheer → Medewerkers* voeg je collega's
toe met hun e-mailadres, functie en rechten, en zet je per persoon een kostprijs.
Zodra een collega inlogt met dat adres, is het account gekoppeld.

Tarieven en de kilometervergoeding staan onder *Beheer → Tarieven*.

Vóór de eerste factuur: vul onder *Beheer → Bedrijfsgegevens* naam, adres,
KvK, btw-nummer en IBAN in (die komen op de factuur) en loop onder *Beheer →
Grootboek en btw* het rekeningschema na: het standaardschema (0–1 balans,
4 kosten, 8 omzet) mag je hernoemen of aanvullen, en het btw-aangifteritme
moet kloppen met wat de Belastingdienst je heeft opgelegd. Zet daar ook de
betaaltermijn en de voettekst.

Begin je halverwege een jaar met deze boekhouding? Boek dan onder
*Boekhouding* eerst de beginbalans als memoriaal: het banksaldo debet op
Bank, het aandelenkapitaal credit op 0500 en de rest credit op Overige
reserves; openstaande facturen en inkopen van vóór die datum voer je gewoon
in, ze boeken zichzelf. Bestaande apparatuur zet je onder *Vaste activa* met
de oorspronkelijke aanschafdatum; afschrijven tot en met vandaag haalt de
achterstand in.

Voor het loon: vul onder *Bedrijfsgegevens* het loonheffingennummer in, loop
onder *Boekhouding → Loon → Parameters* de tarieven en premies van het jaar na
(de Whk-premie staat in je beschikking van de Belastingdienst) en vink ze af,
en maak per medewerker een dienstverband aan — ook voor de dga.

## 5. Controleren

- Open het adres op je telefoon en zet het op je beginscherm (keuze A5): in
  Safari via *Deel → Zet op beginscherm*, in Chrome via het menu → *Toevoegen
  aan startscherm*.
- Log in als medewerker en controleer dat je bij Beheer niet binnenkomt en bij
  Export geen bedragen krijgt. Dat is de afscherming uit de migraties aan het
  werk; de app doet daar zelf niets voor.

## Wat er niet in zit

- **Back-ups**: Supabase maakt dagelijkse back-ups op het betaalde plan; op het
  gratis plan niet. Voor een administratie die zeven jaar mee moet is dat de
  eerste reden om te betalen.
- **Verwerkersovereenkomst**: Supabase en Vercel bieden er allebei een aan
  (DPA) die je online accepteert. Doe dat voordat er echte namen in staan.
