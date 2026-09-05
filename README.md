# Declaratietool

Uren-, bezoek- en kilometerregistratie voor een klein team: uren op klant,
project en projectonderdeel, ritten en kilometers om te declareren,
verkooptarieven naast interne kostprijs zodat de marge per project zichtbaar is.

## Status

Fase 1 tot en met 3 draaien: inloggen, uren schrijven op mobiel en desktop,
ritten en kilometers, week indienen en goedkeuren, klanten, projecten, tarieven,
kostprijzen en medewerkers beheren, inzicht in uren, omzet, marge en budget,
factureren per project — nacalculatie, vaste prijs in termijnen bij
tussenopleveringen, of abonnement per maand, kwartaal of jaar dat zichzelf
factureert — met concept, nummering, btw en grootboekrekening per regel,
factuur en urenspecificatie als PDF, crediteren, correcties met een
tegenboeking, en een eigen boekhouding: journaal met sluitende boekingen,
balans en winst-en-verlies, inkoop en kosten, btw-aangifte, grootboekkaarten,
periode afsluiten.

| | |
|---|---|
| `docs/keuzeplan.html` | Het plan: per beslissing de opties en hun gevolgen |
| `docs/besluiten.md` | Wat er gekozen is, met de codes uit het plan |
| `docs/datamodel.md` | Hoe het model in elkaar zit en waarom |
| `docs/architectuur.md` | Hoe de applicatie op dat model zit |
| `docs/uitrollen.md` | Naar Supabase en Vercel, stap voor stap |
| `docs/demo.html` | Klikbare demo van de schermen, zonder server |
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
npm run test:db     # migraties en tweeëntwintig schemacontroles
npm run typecheck
npm run build
```

`test:db` start zelf een tijdelijke postgres, draait alle migraties, controleert
onder meer de tariefzoekvolgorde en de afscherming, en ruimt daarna op.

## Volgende stap

Het keuzeplan is tot en met fase 3 gebouwd, plus facturatie en een eigen
boekhouding. Fase 4 is optioneel en op volgorde van wat het meest irriteert:
bankafschriften inlezen (CAMT/MT940) en automatisch afletteren, bonnetjes
fotograferen bij een inkoop (C5), afschrijvingen op vaste activa, offline
invoeren, verlof en ziekte, bezettingsprognose.

Nog te beantwoorden: of er in een auto van de zaak gereden wordt. Zie het slot
van `docs/besluiten.md`.
