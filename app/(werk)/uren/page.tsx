import Link from "next/link";
import { vereisteSessie } from "@/lib/auth";
import { weekOverzicht, onderdeelKeuzes, favorieteOnderdelen } from "@/lib/data";
import {
  isGeldigeDatum,
  isoWeek,
  korteDatum,
  maandagVan,
  minutenAlsTijd,
  vandaag,
  verschuif,
  weekDagen,
} from "@/lib/datum";
import { DagLijst } from "@/components/DagLijst";
import { WeekRaster } from "@/components/WeekRaster";

export const dynamic = "force-dynamic";

export default async function UrenPagina({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const sessie = await vereisteSessie();
  const params = await searchParams;

  const nu = vandaag();
  const gekozen = isGeldigeDatum(params.datum) ? params.datum : nu;
  const maandag = maandagVan(gekozen);
  const dagen = weekDagen(maandag);
  const { jaar, week } = isoWeek(maandag);

  const [{ uren, weekstaat }, keuzes, favorieten] = await Promise.all([
    weekOverzicht(sessie, maandag),
    onderdeelKeuzes(sessie),
    favorieteOnderdelen(sessie),
  ]);

  const totaal = uren.reduce((s, r) => s + r.minuten, 0);
  const declarabel = uren
    .filter((r) => r.declarabel)
    .reduce((s, r) => s + r.minuten, 0);

  // Na indienen of goedkeuren mag je niet meer zomaar wijzigen.
  const vergrendeld =
    weekstaat?.status === "ingediend" || weekstaat?.status === "goedgekeurd";

  // Favorieten bovenaan de keuzelijst: dat scheelt bij bijna elke boeking zoeken.
  const gesorteerd = [
    ...favorieten
      .map((id) => keuzes.find((k) => k.onderdeelId === id))
      .filter((k): k is (typeof keuzes)[number] => Boolean(k)),
    ...keuzes.filter((k) => !favorieten.includes(k.onderdeelId)),
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            Week {week} · {jaar}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {korteDatum(maandag)} — {korteDatum(dagen[6])}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`/uren?datum=${verschuif(maandag, -7)}`}
            aria-label="Vorige week"
            className="knop knop-stil px-3"
          >
            ←
          </Link>
          <Link href="/uren" className="knop knop-stil">
            Deze week
          </Link>
          <Link
            href={`/uren?datum=${verschuif(maandag, 7)}`}
            aria-label="Volgende week"
            className="knop knop-stil px-3"
          >
            →
          </Link>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-line py-3">
        <div>
          <p className="label">Totaal</p>
          <p className="cijfers text-xl font-semibold">{minutenAlsTijd(totaal)}</p>
        </div>
        <div>
          <p className="label">Declarabel</p>
          <p className="cijfers text-xl font-semibold">
            {minutenAlsTijd(declarabel)}
          </p>
        </div>
        {vergrendeld && (
          <p className="rounded border border-line bg-surface-2 px-3 py-1.5 text-sm">
            Deze week is <strong>{weekstaat?.status}</strong> en staat op slot.{" "}
            <Link href="/week" className="text-accent-ink underline">
              Bekijk de weekstaat
            </Link>
          </p>
        )}
        {weekstaat?.status === "afgekeurd" && (
          <p className="rounded border border-warn bg-warn-bg px-3 py-1.5 text-sm">
            Teruggestuurd: {weekstaat.opmerking ?? "geen toelichting"}
          </p>
        )}
      </div>

      {/* Mobiel: per dag. Desktop: het hele weekraster. (Keuze C1a.) */}
      <div className="md:hidden">
        <DagLijst
          dagen={dagen}
          regels={uren}
          vandaagDatum={nu}
          vergrendeld={vergrendeld}
        />
      </div>
      <div className="hidden md:block">
        <WeekRaster
          dagen={dagen}
          regels={uren}
          keuzes={gesorteerd}
          vergrendeld={vergrendeld}
        />
      </div>

      {keuzes.length === 0 && (
        <p className="mt-6 rounded border border-warn bg-warn-bg p-4 text-sm">
          Er zijn nog geen projectonderdelen om op te schrijven. Maak eerst een
          klant en een project aan bij Beheer.
        </p>
      )}
    </div>
  );
}
