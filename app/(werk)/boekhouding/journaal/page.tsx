import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum } from "@/lib/datum";
import { boekingen, leesPeriode, BOEKING_SOORT_LABEL, type BoekingSoort } from "@/lib/boekhouding";
import { PeriodeKiezer } from "@/components/PeriodeKiezer";
import { boekingWeg } from "../acties";

export const dynamic = "force-dynamic";

const SOORTEN = Object.keys(BOEKING_SOORT_LABEL) as BoekingSoort[];

export default async function JournaalPagina({ searchParams }: { searchParams: Promise<{ van?: string; tot?: string; soort?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const p = await searchParams;
  const { van, tot } = leesPeriode(p, "jaar");
  const soort = SOORTEN.includes(p.soort as BoekingSoort) ? (p.soort as BoekingSoort) : null;
  const lijst = await boekingen(sessie, van, tot, soort);
  const qs = `van=${van}&tot=${tot}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href={`/boekhouding?${qs}`} className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Journaal</h1>
          <p className="mt-1 text-sm text-muted">Alle boekingen op volgorde, met hun regels. Nummers lopen door en worden nooit hergebruikt.</p>
        </div>
        <a href={`/api/export/journaal?${qs}`} className="knop knop-stil">CSV voor de accountant</a>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <PeriodeKiezer pad="/boekhouding/journaal" van={van} tot={tot} extra={soort ? { soort } : {}} />
        <span className="flex flex-wrap gap-1">
          <Link href={`/boekhouding/journaal?${qs}`} className={`rounded px-2 py-1 text-xs ${!soort ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>alles</Link>
          {SOORTEN.map((s) => <Link key={s} href={`/boekhouding/journaal?${qs}&soort=${s}`} className={`rounded px-2 py-1 text-xs ${soort === s ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{BOEKING_SOORT_LABEL[s]}</Link>)}
        </span>
      </div>

      <div className="tabel-omhulsel mt-4">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Nr</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Datum</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Boeking</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Bedrag</th>
            <th className="border-b border-line bg-surface-2"></th>
          </tr></thead>
          <tbody>
            {lijst.map((b) => (
              <tr key={b.id} className="border-b border-line align-top last:border-0">
                <td className="cijfers px-3 py-2 text-muted">{b.volgnummer}</td>
                <td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(b.datum)}</td>
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <span className="label mr-2 rounded bg-surface-2 px-1.5 py-0.5">{BOEKING_SOORT_LABEL[b.soort]}</span>
                      {b.factuurId ? <Link href={`/facturen/${b.factuurId}`} className="font-medium text-accent-ink hover:underline">{b.omschrijving}</Link> : b.inkoopId ? <Link href={`/boekhouding/inkoop/${b.inkoopId}`} className="font-medium text-accent-ink hover:underline">{b.omschrijving}</Link> : <span className="font-medium">{b.omschrijving}</span>}
                    </summary>
                    <table className="mt-2 w-full max-w-xl text-xs">
                      <tbody>
                        {b.regels.map((r) => (
                          <tr key={r.id}>
                            <td className="py-0.5 pr-3"><Link href={`/boekhouding/rekening/${r.grootboekId}?${qs}`} className="hover:underline"><span className="cijfers mr-1 text-muted">{r.nummer}</span>{r.naam}</Link>{r.omschrijving ? <span className="text-muted"> · {r.omschrijving}</span> : null}</td>
                            <td className="cijfers w-24 py-0.5 text-right">{r.debet ? euro(r.debet) : ""}</td>
                            <td className="cijfers w-24 py-0.5 text-right text-muted">{r.credit ? euro(r.credit) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </td>
                <td className="cijfers px-3 py-2 text-right whitespace-nowrap">{euro(b.bedrag)}</td>
                <td className="px-2 py-2 text-right">
                  {b.soort === "memoriaal" && (
                    <form action={boekingWeg}><input type="hidden" name="id" value={b.id} /><button type="submit" className="knop knop-kaal knop-klein text-danger">×</button></form>
                  )}
                </td>
              </tr>
            ))}
            {lijst.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Geen boekingen in deze periode.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Klik op een boeking voor de regels. Alleen een memoriaalboeking kun je weghalen; de rest draai je terug via de bron: creditfactuur, betaling ongedaan maken, inkoop aanpassen.</p>
    </div>
  );
}
