import Link from "next/link";
import { vandaag, type Datum } from "@/lib/datum";

// Periode kiezen voor de boekhoudschermen: twee datums en de gangbare
// sprongen. Een gewoon GET-formulier, dus de URL is deelbaar.

function kwartaal(jaar: number, k: number): { van: Datum; tot: Datum } {
  const m0 = (k - 1) * 3 + 1;
  const eind = new Date(Date.UTC(jaar, m0 + 2, 0)).getUTCDate();
  return { van: `${jaar}-${String(m0).padStart(2, "0")}-01`, tot: `${jaar}-${String(m0 + 2).padStart(2, "0")}-${eind}` };
}

export function PeriodeKiezer({ pad, van, tot, extra = {} }: { pad: string; van: Datum; tot: Datum; extra?: Record<string, string> }) {
  const d = vandaag();
  const jaar = Number(d.slice(0, 4)), maand = Number(d.slice(5, 7));
  const k = Math.ceil(maand / 3);
  const vorigK = k === 1 ? kwartaal(jaar - 1, 4) : kwartaal(jaar, k - 1);
  const eindMaand = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  const sprongen: [string, Datum, Datum][] = [
    ["Dit jaar", `${jaar}-01-01`, `${jaar}-12-31`],
    ["Vorig jaar", `${jaar - 1}-01-01`, `${jaar - 1}-12-31`],
    [`Q${k}`, kwartaal(jaar, k).van, kwartaal(jaar, k).tot],
    ["Vorig kwartaal", vorigK.van, vorigK.tot],
    ["Deze maand", `${d.slice(0, 8)}01`, `${d.slice(0, 8)}${eindMaand}`],
  ];
  const qs = (v: Datum, t: Datum) => {
    const u = new URLSearchParams({ ...extra, van: v, tot: t });
    return `${pad}?${u.toString()}`;
  };
  return (
    <form action={pad} method="get" className="flex flex-wrap items-end gap-2">
      {Object.entries(extra).map(([k2, v]) => <input key={k2} type="hidden" name={k2} value={v} />)}
      <label className="flex flex-col gap-1"><span className="label">Van</span><input type="date" name="van" defaultValue={van} className="veld min-h-10 py-1" /></label>
      <label className="flex flex-col gap-1"><span className="label">Tot en met</span><input type="date" name="tot" defaultValue={tot} className="veld min-h-10 py-1" /></label>
      <button type="submit" className="knop knop-stil knop-klein">Toon</button>
      <span className="flex flex-wrap gap-1 self-center pl-1">
        {sprongen.map(([l, v, t]) => (
          <Link key={l} href={qs(v, t)} className={`rounded px-2 py-1 text-xs ${v === van && t === tot ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{l}</Link>
        ))}
      </span>
    </form>
  );
}
