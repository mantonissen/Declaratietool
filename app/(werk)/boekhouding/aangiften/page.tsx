import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { korteDatum, vandaag } from "@/lib/datum";
import { aangiftenKalender } from "@/lib/jaarwerk";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  open: ["Nog te doen", "bg-surface-2"],
  vastgelegd: ["Vastgelegd", "bg-accent-bg text-accent-ink"],
  ingediend: ["Ingediend", "bg-accent-bg text-accent-ink"],
  afgerond: ["Afgerond", "bg-accent-bg text-accent-ink"],
};

export default async function AangiftenPagina({ searchParams }: { searchParams: Promise<{ jaar?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const dit = Number(vandaag().slice(0, 4));
  const p = await searchParams;
  const jaar = Number.isInteger(Number(p.jaar)) && Number(p.jaar) >= 2000 ? Number(p.jaar) : dit;
  const items = await aangiftenKalender(sessie, jaar);
  const nu = vandaag();
  const teLaat = items.filter((i) => i.status === "open" && i.deadline < nu);
  const komend = items.filter((i) => i.status !== "afgerond" && i.deadline >= nu);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Aangiften en deponeringen</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Wat een bv moet indienen, met de stand uit je eigen administratie. Indienen doe je zelf via Mijn Belastingdienst Zakelijk en de KvK; hier staan de bedragen klaar en hou je bij wat gedaan is.</p>
        </div>
        <div className="flex gap-1">{[dit - 1, dit].map((j) => <Link key={j} href={`/boekhouding/aangiften?jaar=${j}`} className={`rounded px-2 py-1 text-sm ${j === jaar ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{j}</Link>)}</div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
        {[
          { t: "Te laat", v: String(teLaat.length), s: "deadline voorbij, nog open", w: teLaat.length > 0 },
          { t: "Komend", v: String(komend.length), s: "nog te doen of af te ronden" },
          { t: "Afgerond", v: String(items.filter((i) => i.status === "afgerond").length), s: `van ${items.length} in ${jaar}` },
        ].map((x) => (
          <div key={x.t} className="bg-surface px-4 py-3"><dt className="label">{x.t}</dt><dd className={`cijfers mt-0.5 text-lg font-semibold ${x.w ? "text-warn" : ""}`}>{x.v}</dd><dd className="text-xs text-muted">{x.s}</dd></div>
        ))}
      </dl>

      <div className="tabel-omhulsel mt-5">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Uiterlijk</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Aangifte</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Stand</th>
          </tr></thead>
          <tbody>
            {items.map((i, k) => {
              const laat = i.status === "open" && i.deadline < nu;
              const [label, kleur] = STATUS[i.status];
              return (
                <tr key={k} className="border-b border-line last:border-0">
                  <td className={`cijfers px-3 py-2 whitespace-nowrap ${laat ? "text-warn" : ""}`}>{korteDatum(i.deadline)} {i.deadline.slice(0, 4)}</td>
                  <td className="px-3 py-2"><Link href={i.link} className="font-medium text-accent-ink hover:underline">{i.titel} · {i.periode}</Link><span className="block text-xs text-muted">{i.toelichting}</span></td>
                  <td className="px-3 py-2"><span className={`label rounded px-1.5 py-0.5 ${laat ? "bg-warn-bg text-warn" : kleur}`}>{laat ? "Te laat" : label}</span></td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">Niets voor dit jaar.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="mt-8 max-w-3xl">
        <h2 className="mb-2 text-lg font-semibold">Ook goed om te weten</h2>
        <ul className="kaart divide-y divide-line text-sm">
          {[
            ["Gebruikelijk loon dga", "De directeur-grootaandeelhouder moet een salaris krijgen dat past bij het werk, met de wettelijke norm als ondergrens (of 75% van het loon in de meest vergelijkbare functie). Staat als parameter bij Loon."],
            ["Werkkostenregeling (WKR)", "Vergoedingen en verstrekkingen aan personeel vallen in de vrije ruimte (2% van de loonsom tot € 400.000, daarboven 1,18%). Wat erboven komt, geef je aan in de loonaangifte over het tweede tijdvak van het volgende jaar tegen 80% eindheffing."],
            ["Opgaaf ICP", "Alleen als je diensten levert aan ondernemers in andere EU-landen (btw verlegd, rubriek 3b): per tijdvak een opgaaf intracommunautaire prestaties."],
            ["Dividend en dividendbelasting", "Keert de bv dividend uit, dan houd je 15% dividendbelasting in en doe je binnen een maand aangifte. De uitkeringstoets (kan de bv haar schulden blijven betalen) legt het bestuur vast."],
            ["UBO-register", "Wijzigingen in wie de uiteindelijk belanghebbende is, meld je binnen een week bij de KvK."],
            ["Bewaarplicht", "Zeven jaar; voor onroerend goed tien. De export van het journaal en de PDF's zijn daarvoor genoeg, samen met de bonnen."],
          ].map(([t, u]) => <li key={t} className="px-4 py-2.5"><span className="block font-medium">{t}</span><span className="block text-xs text-muted">{u}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
