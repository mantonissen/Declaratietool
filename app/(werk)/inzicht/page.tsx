import Link from "next/link";
import { vereisteSessie, zietBedragen } from "@/lib/auth";
import { kerncijfers, perPeriode, perProject, perKlant, perMedewerker } from "@/lib/statistiek";
import {
  euro, getal, isGeldigeDatum, isoWeek, minutenAlsTijd, naarDatum, naarTekst,
  vandaag, verschuif, type Datum,
} from "@/lib/datum";
import { Kolommen, Legenda, Meter } from "@/components/grafieken";

export const dynamic = "force-dynamic";

const MAAND_K = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

type Preset = { key: string; label: string; van: Datum; tot: Datum };

function presets(): Preset[] {
  const nu = vandaag();
  const d = naarDatum(nu);
  const j = d.getUTCFullYear(), m = d.getUTCMonth();
  const eerste = (jaar: number, maand: number) => naarTekst(new Date(Date.UTC(jaar, maand, 1)));
  const laatste = (jaar: number, maand: number) => verschuif(eerste(jaar, maand + 1), -1);
  const kw = Math.floor(m / 3) * 3;
  return [
    { key: "maand", label: "Deze maand", van: eerste(j, m), tot: laatste(j, m) },
    { key: "vorige", label: "Vorige maand", van: eerste(j, m - 1), tot: laatste(j, m - 1) },
    { key: "kwartaal", label: "Dit kwartaal", van: eerste(j, kw), tot: laatste(j, kw + 2) },
    { key: "jaar", label: "Dit jaar", van: eerste(j, 0), tot: laatste(j, 11) },
    { key: "12m", label: "12 maanden", van: eerste(j, m - 11), tot: laatste(j, m) },
  ];
}

const pct = (deel: number, geheel: number) => (geheel > 0 ? (deel / geheel) * 100 : null);

export default async function InzichtPagina({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; van?: string; tot?: string }>;
}) {
  const sessie = await vereisteSessie();
  const p = await searchParams;
  const lijst = presets();

  let gekozen: Preset;
  if (isGeldigeDatum(p.van) && isGeldigeDatum(p.tot) && p.van <= p.tot) {
    gekozen = { key: "eigen", label: "Eigen periode", van: p.van, tot: p.tot };
  } else {
    gekozen = lijst.find((x) => x.key === p.periode) ?? lijst[0];
  }
  const { van, tot } = gekozen;

  // Korter dan ongeveer tien weken: per week, anders is de grafiek één staaf.
  const dagen = (naarDatum(tot).getTime() - naarDatum(van).getTime()) / 864e5;
  const eenheid: "week" | "month" = dagen < 70 ? "week" : "month";

  const [kern, reeks, projecten, klanten, mensen] = await Promise.all([
    kerncijfers(sessie, van, tot),
    perPeriode(sessie, van, tot, eenheid),
    perProject(sessie, van, tot),
    perKlant(sessie, van, tot),
    perMedewerker(sessie, van, tot),
  ]);

  const geld = zietBedragen(sessie.rechten) && kern.omzet !== null;
  const kosten = sessie.rechten === "eigenaar" && kern.kosten !== null;
  const marge = geld && kosten ? (kern.omzet ?? 0) - (kern.kosten ?? 0) : null;
  const declPct = pct(kern.declarabeleMinuten, kern.minuten);

  const labelVan = (d: Datum) =>
    eenheid === "week" ? `wk ${isoWeek(d).week}` : `${MAAND_K[naarDatum(d).getUTCMonth()]}${naarDatum(d).getUTCMonth() === 0 ? ` '${String(naarDatum(d).getUTCFullYear()).slice(2)}` : ""}`;

  // Wat de grafiek toont hangt af van wat je mag zien: geld, of anders uren.
  const reeksen = geld
    ? [{ naam: "Omzet" }, ...(kosten ? [{ naam: "Kosten" }] : [])]
    : [{ naam: "Declarabel" }, { naam: "Niet declarabel" }];
  const vakken = reeks.map((r) => ({
    label: labelVan(r.maand),
    waarden: geld
      ? [r.omzet ?? 0, ...(kosten ? [r.kosten ?? 0] : [])]
      : [r.declarabeleMinuten / 60, (r.minuten - r.declarabeleMinuten) / 60],
  }));
  const fmt = geld ? (n: number) => euro(n) : (n: number) => `${getal(n, 0)} u`;
  const asFmt = geld
    ? (n: number) => (n >= 1000 ? `${getal(n / 1000, n % 1000 ? 1 : 0)}k` : getal(n, 0))
    : (n: number) => getal(n, 0);

  const hero = marge !== null
    ? { label: "Marge", waarde: euro(marge), sub: kern.omzet ? `${getal((marge / kern.omzet) * 100)}% van ${euro(kern.omzet)} omzet` : null }
    : geld
      ? { label: "Omzet", waarde: euro((kern.omzet ?? 0) + (kern.kmBedrag ?? 0)), sub: `${euro(kern.omzet)} uren · ${euro(kern.kmBedrag)} kilometers` }
      : { label: "Geschreven", waarde: minutenAlsTijd(kern.minuten), sub: declPct === null ? null : `${getal(declPct)}% declarabel` };

  const tegels = [
    { t: "Uren", v: minutenAlsTijd(kern.minuten) },
    { t: "Declarabiliteit", v: declPct === null ? "—" : `${getal(declPct)}%` },
    ...(geld && marge !== null ? [{ t: "Omzet", v: euro(kern.omzet) }] : []),
    ...(kosten ? [{ t: "Kosten", v: euro(kern.kosten) }] : []),
    { t: "Kilometers", v: getal(kern.km, 0) },
    ...(geld ? [{ t: "Km-bedrag", v: euro(kern.kmBedrag) }] : []),
    { t: "Projecten", v: String(kern.projecten) },
    ...(kern.medewerkers > 1 ? [{ t: "Medewerkers", v: String(kern.medewerkers) }] : []),
  ];

  const Th = ({ children, r }: { children: React.ReactNode; r?: boolean }) => (
    <th className={`label border-b border-line bg-surface-2 px-3 py-2 ${r ? "text-right" : "text-left"}`}>{children}</th>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <header className="mb-4">
        <p className="label">Inzicht</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
          {gekozen.label}
          <span className="ml-3 text-base font-normal text-muted">
            {van} — {tot}
          </span>
        </h1>
      </header>

      {/* Eén filterrij, boven alles wat hij bepaalt. */}
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        {lijst.map((x) => (
          <Link
            key={x.key}
            href={`/inzicht?periode=${x.key}`}
            aria-current={gekozen.key === x.key ? "page" : undefined}
            className={`knop knop-klein ${gekozen.key === x.key ? "knop-primair" : "knop-stil"}`}
          >
            {gekozen.key === x.key ? "✓ " : ""}{x.label}
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-2" action="/inzicht" method="get">
          <label className="sr-only" htmlFor="van">Van</label>
          <input id="van" name="van" type="date" defaultValue={gekozen.key === "eigen" ? van : ""} className="veld min-h-9 w-40 py-1 text-sm" />
          <span className="text-muted">—</span>
          <label className="sr-only" htmlFor="tot">Tot en met</label>
          <input id="tot" name="tot" type="date" defaultValue={gekozen.key === "eigen" ? tot : ""} className="veld min-h-9 w-40 py-1 text-sm" />
          <button type="submit" className="knop knop-stil knop-klein">Toon</button>
        </form>
      </div>

      <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <div className="kaart p-5">
          <p className="label">{hero.label}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">{hero.waarde}</p>
          {hero.sub && <p className="mt-2 text-sm text-muted">{hero.sub}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {tegels.map((x) => (
            <div key={x.t} className="bg-surface px-4 py-3">
              <dt className="label">{x.t}</dt>
              <dd className="mt-0.5 text-lg font-semibold">{x.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="kaart mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">
            {geld ? (kosten ? "Omzet en kosten" : "Omzet") : "Uren"} per {eenheid === "week" ? "week" : "maand"}
          </h2>
          <Legenda reeksen={reeksen} />
        </div>
        <Kolommen vakken={vakken} reeksen={reeksen} formatteer={fmt} asFormatteer={asFmt} />
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-accent-ink">Als tabel</summary>
          <div className="tabel-omhulsel mt-2">
            <table className="w-full text-sm">
              <thead><tr><Th>Periode</Th>{reeksen.map((r) => <Th key={r.naam} r>{r.naam}</Th>)}</tr></thead>
              <tbody>
                {vakken.map((v) => (
                  <tr key={v.label} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">{v.label}</td>
                    {v.waarden.map((w, k) => <td key={k} className="cijfers px-3 py-1.5 text-right">{fmt(w ?? 0)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Projecten</h2>
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Project</Th><Th r>Uren</Th><Th>Budget</Th>
                {geld && <Th r>Omzet</Th>}
                {geld && <Th r>Effectief tarief</Th>}
                {kosten && <Th r>Marge</Th>}
              </tr>
            </thead>
            <tbody>
              {projecten.map((r) => (
                <tr key={r.projectId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{r.project}</span>
                    <span className="block text-xs text-muted">{r.klant}</span>
                  </td>
                  <td className="cijfers px-3 py-2 text-right">{minutenAlsTijd(r.minuten)}</td>
                  <td className="px-3 py-2"><Meter pct={r.budgetVerbruiktPct} /></td>
                  {geld && <td className="cijfers px-3 py-2 text-right">{euro(r.omzet)}</td>}
                  {geld && <td className="cijfers px-3 py-2 text-right">{r.effectiefUurtarief === null ? "—" : euro(r.effectiefUurtarief)}</td>}
                  {kosten && <td className="cijfers px-3 py-2 text-right font-semibold">{r.omzet === null || r.kosten === null ? "—" : euro(r.omzet - r.kosten)}</td>}
                </tr>
              ))}
              {projecten.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-muted">Geen uren in deze periode.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Budget is over de hele looptijd; uren en bedragen over de gekozen periode.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Klanten</h2>
          <div className="tabel-omhulsel">
            <table className="w-full text-sm">
              <thead><tr><Th>Klant</Th><Th r>Uren</Th><Th r>Km</Th>{geld && <Th r>Omzet</Th>}{kosten && <Th r>Marge</Th>}</tr></thead>
              <tbody>
                {klanten.map((r) => (
                  <tr key={r.klantId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><span className="block font-medium">{r.klant}</span><span className="block text-xs text-muted">{r.projecten} {r.projecten === 1 ? "project" : "projecten"}</span></td>
                    <td className="cijfers px-3 py-2 text-right">{minutenAlsTijd(r.minuten)}</td>
                    <td className="cijfers px-3 py-2 text-right">{getal(r.km, 0)}</td>
                    {geld && <td className="cijfers px-3 py-2 text-right">{euro(r.omzet)}</td>}
                    {kosten && <td className="cijfers px-3 py-2 text-right font-semibold">{r.omzet === null || r.kosten === null ? "—" : euro(r.omzet - r.kosten)}</td>}
                  </tr>
                ))}
                {klanten.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-muted">Geen uren in deze periode.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Medewerkers</h2>
          <div className="tabel-omhulsel">
            <table className="w-full text-sm">
              <thead><tr><Th>Medewerker</Th><Th r>Uren</Th><Th r>Declarabel</Th>{geld && <Th r>Omzet</Th>}{kosten && <Th r>Marge</Th>}</tr></thead>
              <tbody>
                {mensen.map((r) => {
                  const d = pct(r.declarabeleMinuten, r.minuten);
                  return (
                    <tr key={r.medewerkerId} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium">{r.medewerker}</td>
                      <td className="cijfers px-3 py-2 text-right">{minutenAlsTijd(r.minuten)}</td>
                      <td className="cijfers px-3 py-2 text-right">{d === null ? "—" : `${getal(d, 0)}%`}</td>
                      {geld && <td className="cijfers px-3 py-2 text-right">{euro(r.omzet)}</td>}
                      {kosten && <td className="cijfers px-3 py-2 text-right font-semibold">{r.omzet === null || r.kosten === null ? "—" : euro(r.omzet - r.kosten)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sessie.rechten === "medewerker" && (
            <p className="mt-2 text-xs text-muted">Je ziet hier je eigen uren. Bedragen zijn voor de projectleider en de eigenaar.</p>
          )}
        </section>
      </div>
    </div>
  );
}
