# Declaratietool

Uren-, bezoek- en kilometerregistratie voor een klein team: uren op klant,
project en projectonderdeel, ritten en kilometers om te declareren,
verkooptarieven naast interne kostprijs zodat de marge per project zichtbaar is.

## Status

Fase 1 draait: inloggen, uren schrijven op mobiel en desktop, ritten en
kilometers, week indienen, klanten en projecten beheren, export naar CSV.

| | |
|---|---|
| `docs/keuzeplan.html` | Het plan: per beslissing de opties en hun gevolgen |
| `docs/besluiten.md` | Wat er gekozen is, met de codes uit het plan |
| `docs/datamodel.md` | Hoe het model in elkaar zit en waarom |
| `docs/architectuur.md` | Hoe de applicatie op dat model zit |
| `supabase/migrations/` | Het schema: tabellen, tarieflogica, rechten |
| `supabase/tests/` | Schematests |
| `app/`, `lib/`, `components/` | De applicatie (Next.js) |

## Aan de praat krijgen

Je hebt Node 22 en PostgreSQL 15 of hoger nodig (15 vanwege `security_invoker`
op views).

```sh
npm install
cp .env.example .env          # vul DATABASE_URL in
./scripts/dev-db.sh           # database opzetten met voorbeeldgegevens
npm run dev
```

Op <http://localhost:3000> kies je in ontwikkelmodus zelf met wie je werkt. De
voorbeeldgegevens bevatten een eigenaar, een projectleider en een medewerker,
zodat je kunt zien wat elk van hen wel en niet ziet.

`AUTH_MODUS=dev` weigert te draaien als `NODE_ENV=production`. Voor een echte
omgeving zet je `AUTH_MODUS=supabase` en vul je de Supabase-variabelen in.

## Testen

```sh
npm run test:db     # migraties en zeventien schemacontroles
npm run typecheck
npm run build
```

`test:db` start zelf een tijdelijke postgres, draait alle migraties, controleert
onder meer de tariefzoekvolgorde en de afscherming, en ruimt daarna op.

## Volgende stap

Fase 2 uit het keuzeplan: tarieven en kostprijzen beheren in de app zelf,
marge-overzichten per klant en per maand, en goedkeuren van ingediende weken
door de eigenaar. Het schema en de views daarvoor liggen er al.

Nog te beantwoorden: welk boekhoudpakket in gebruik is, en of er in een auto van
de zaak gereden wordt. Zie het slot van `docs/besluiten.md`.
