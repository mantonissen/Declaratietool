# Declaratietool

Uren-, bezoek- en kilometerregistratie voor een klein team: uren op klant,
project en projectonderdeel, ritten en kilometers om te declareren,
verkooptarieven naast interne kostprijs zodat de marge per project zichtbaar is.

## Status

De keuzes zijn gemaakt en het datamodel staat er, met tests. Nog geen
applicatiecode.

| | |
|---|---|
| `docs/keuzeplan.html` | Het plan: per beslissing de opties en hun gevolgen |
| `docs/besluiten.md` | Wat er gekozen is, met de codes uit het plan |
| `docs/datamodel.md` | Hoe het model in elkaar zit en waarom |
| `supabase/migrations/` | Het schema: tabellen, tarieflogica, rechten |
| `supabase/tests/` | Schematests |
| `scripts/test-db.sh` | Draait migraties en tests tegen een wegwerpdatabase |

## Testen

```sh
./scripts/test-db.sh
```

Start zelf een tijdelijke postgres, draait alle migraties, voert zeventien
controles uit en ruimt daarna op. Vereist een lokale PostgreSQL-installatie
(versie 15 of hoger, vanwege `security_invoker` op views).

Tegen een draaiende server:

```sh
PGHOST=... PGPORT=... PGUSER=... ./scripts/test-db.sh --bestaande-server
```

## Volgende stap

Fase 1 uit het keuzeplan: klanten, projecten en onderdelen beheren, uren
schrijven op mobiel en desktop, ritten en kilometers, export. Het schema
hieronder is daarop voorbereid.

Nog te beantwoorden voordat fase 3 begint: welk boekhoudpakket in gebruik is,
en of er in een auto van de zaak gereden wordt. Zie het slot van
`docs/besluiten.md`.
