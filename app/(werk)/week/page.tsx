import Link from "next/link";
import { revalidatePath } from "next/cache";
import { vereisteSessie, zietBedragen } from "@/lib/auth";
import { weekOverzicht, dienWeekIn, trekWeekTerug } from "@/lib/data";
import {
  euro,
  getal,
  isGeldigeDatum,
  isoWeek,
  korteDatum,
  maandagVan,
  minutenAlsTijd,
  vandaag,
  verschuif,
  weekDagen,
} from "@/lib/datum";

export const dynamic = "force-dynamic";

const STATUS_TEKST: Record<string, string> = {
  concept: "Nog niet ingediend",
  ingediend: "Ingediend, wacht op goedkeuring",
  goedgekeurd: "Goedgekeurd",
  afgekeurd: "Teruggestuurd",
};

export default async function WeekPagina({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const sessie = await vereisteSessie();
  const params = await searchParams;

  const gekozen = isGeldigeDatum(params.datum) ? params.datum : vandaag();
  const maandag = maandagVan(gekozen);
  const dagen = weekDagen(maandag);
  const { jaar, week } = isoWeek(maandag);

  const { uren, ritten, weekstaat } = await weekOverzicht(sessie, maandag);

  const status = weekstaat?.status ?? "concept";
  const kanIndienen = status === "concept" || status === "afgekeurd";
  const kanTerugtrekken = status === "ingediend";

  const totaal = uren.reduce((s, r) => s + r.minuten, 0);
  const declarabel = uren.filter((r) => r.declarabel).reduce((s, r) => s + r.minuten, 0);
  const km = ritten.reduce((s, r) => s + r.totaalKm, 0);
  const omzet = uren.reduce((s, r) => s + (r.omzet ?? 0), 0);
  const kmBedrag = ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);

  // Per project samengevat: dat is wat je bij het indienen wilt nalopen.
  const perProject = new Map<string, { project: string; klant: string; minuten: number }>();
  for (const r of uren) {
    const huidig = perProject.get(r.projectId) ?? {
      project: r.project,
      klant: r.klant,
      minuten: 0,
    };
    huidig.minuten += r.minuten;
    perProject.set(r.projectId, huidig);
  }

  async function indienen() {
    "use server";
    const s = await vereisteSessie();
    await dienWeekIn(s, maandag);
    revalidatePath("/week");
    revalidatePath("/uren");
  }

  async function terugtrekken() {
    "use server";
    const s = await vereisteSessie();
    await trekWeekTerug(s, maandag);
    revalidatePath("/week");
    revalidatePath("/uren");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
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
            href={`/week?datum=${verschuif(maandag, -7)}`}
            aria-label="Vorige week"
            className="knop knop-stil px-3"
          >
            ←
          </Link>
          <Link href="/week" className="knop knop-stil">
            Deze week
          </Link>
          <Link
            href={`/week?datum=${verschuif(maandag, 7)}`}
            aria-label="Volgende week"
            className="knop knop-stil px-3"
          >
            →
          </Link>
        </div>
      </header>

      <div
        className={`mb-5 rounded border px-4 py-3 ${
          status === "goedgekeurd"
            ? "border-accent bg-accent-bg"
            : status === "afgekeurd"
              ? "border-warn bg-warn-bg"
              : "border-line bg-surface"
        }`}
      >
        <p className="label">Status</p>
        <p className="mt-0.5 font-semibold">{STATUS_TEKST[status]}</p>
        {status === "afgekeurd" && weekstaat?.opmerking && (
          <p className="mt-1 text-sm">{weekstaat.opmerking}</p>
        )}
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {[
          { t: "Geschreven", w: minutenAlsTijd(totaal) },
          { t: "Declarabel", w: minutenAlsTijd(declarabel) },
          { t: "Kilometers", w: getal(km) },
          ...(zietBedragen(sessie.rechten)
            ? [{ t: "Te factureren", w: euro(omzet + kmBedrag) }]
            : []),
        ].map((v) => (
          <div key={v.t} className="bg-surface px-4 py-3">
            <dt className="label">{v.t}</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">{v.w}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-2 text-lg font-semibold">Per project</h2>
      {perProject.size > 0 ? (
        <div className="tabel-omhulsel mb-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                  Project
                </th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                  Uren
                </th>
              </tr>
            </thead>
            <tbody>
              {[...perProject.values()].map((p) => (
                <tr key={p.project} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{p.project}</span>
                    <span className="block text-xs text-muted">{p.klant}</span>
                  </td>
                  <td className="cijfers px-4 py-2.5 text-right font-semibold">
                    {minutenAlsTijd(p.minuten)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-6 text-sm text-muted">Deze week nog niets geschreven.</p>
      )}

      {kanIndienen && (
        <form action={indienen}>
          <button
            type="submit"
            className="knop knop-primair w-full sm:w-auto"
            disabled={totaal === 0 && ritten.length === 0}
          >
            Week indienen
          </button>
          <p className="mt-2 text-xs text-muted">
            Na indienen kun je deze week niet meer wijzigen tot hij is beoordeeld.
          </p>
        </form>
      )}

      {kanTerugtrekken && (
        <form action={terugtrekken}>
          <button type="submit" className="knop knop-stil w-full sm:w-auto">
            Toch nog wijzigen
          </button>
          <p className="mt-2 text-xs text-muted">
            Trekt de week terug naar concept zolang hij nog niet is goedgekeurd.
          </p>
        </form>
      )}

      {status === "goedgekeurd" && (
        <p className="text-sm text-muted">
          Deze week is goedgekeurd; de bedragen liggen vast. Kloppen er uren
          niet, laat de eigenaar dan een correctie boeken.
        </p>
      )}
    </div>
  );
}
