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
   `…120400_rechten.sql`. Daarna `supabase/seed.sql`.

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

3. Deploy. Je krijgt een adres als `declaratietool.vercel.app`; een eigen
   domein koppel je onder *Domains*.

## 4. Jezelf en je collega's toevoegen

Inloggen lukt alleen voor wie in de tabel `medewerker` staat. Log eerst zelf
een keer in (dat maakt je account aan in `auth.users`), en koppel dat dan in
de SQL Editor:

```sql
insert into medewerker (auth_user_id, naam, email, functie_id, rechten)
select u.id, 'Martijn Antonissen', u.email,
       (select id from functie where naam = 'Partner'), 'eigenaar'
from auth.users u
where u.email = 'jouw@adres.nl';
```

Collega's op dezelfde manier, met `rechten` op `medewerker` of
`projectleider`. Zet daarna per persoon een kostprijs (keuze B3):

```sql
insert into kostprijs (medewerker_id, bedrag_per_uur, geldig_vanaf)
select id, 58.00, date '2026-01-01' from medewerker where email = 'collega@adres.nl';
```

Een scherm hiervoor hoort bij fase 2; tot die tijd is dit de weg.

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
