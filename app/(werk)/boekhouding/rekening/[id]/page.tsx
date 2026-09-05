import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum } from "@/lib/datum";
import { grootboekrekeningen, SOORT_LABEL } from "@/lib/facturatie";
import { grootboekkaart, leesPeriode, BOEKING_SOORT_LABEL } from "@/lib/boekhouding";
import { PeriodeKiezer } from "@/components/PeriodeKiezer";

export const dynamic = "force-dynamic";

export default async function RekeningPagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ van?: string; tot?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { id } = await params;
  const { van, tot } = leesPeriode(await searchParams, "jaar");
  const rekening = (await grootboekrekeningen(sessie)).find((g) => g.id === id);
  if (!rekening) notFound();
  const kaart = await grootboekkaart(sessie, id, van, tot);
  const debetzijde = rekening.soort === "activa" || rekening.soort === "kosten";
  const toon = (s: number) => euro(debetzijde ? s : -s);
  const qs = `van=${van}&tot=${tot}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href={`/boekhouding?${qs}`} className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <p className="label mt-2">Grootboekkaart · {SOORT_LABEL[rekening.soort]}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl"><span className="cijfers">{rekening.nummer}</span> · {rekening.naam}</h1>
      <div className="mt-4"><PeriodeKiezer pad={`/boekhouding/rekening/${id}`} van={van} tot={tot} /></div>

      <div className="tabel-omhulsel mt-4">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Datum</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Boeking</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Debet</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Credit</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Saldo</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-line bg-surface-2/40"><td className="px-3 py-1.5 text-muted" colSpan={4}>Beginsaldo per {korteDatum(van)}</td><td className="cijfers px-3 py-1.5 text-right">{toon(kaart.beginsaldo)}</td></tr>
            {kaart.regels.map((r, i) => (
              <tr key={`${r.boekingId}-${i}`} className="border-b border-line last:border-0">
                <td className="cijfers px-3 py-1.5 whitespace-nowrap">{korteDatum(r.datum)}</td>
                <td className="px-3 py-1.5">
                  <span className="label mr-2 rounded bg-surface-2 px-1.5 py-0.5">{BOEKING_SOORT_LABEL[r.soort]}</span>
                  {r.factuurId ? <Link href={`/facturen/${r.factuurId}`} className="text-accent-ink hover:underline">{r.omschrijving}</Link> : r.omschrijving}
                  {r.regelOmschrijving && r.regelOmschrijving !== r.omschrijving ? <span className="text-xs text-muted"> · {r.regelOmschrijving}</span> : null}
                  <span className="cijfers ml-2 text-xs text-muted">#{r.volgnummer}</span>
                </td>
                <td className="cijfers px-3 py-1.5 text-right">{r.debet ? euro(r.debet) : ""}</td>
                <td className="cijfers px-3 py-1.5 text-right">{r.credit ? euro(r.credit) : ""}</td>
                <td className="cijfers px-3 py-1.5 text-right">{toon(r.saldo)}</td>
              </tr>
            ))}
            {kaart.regels.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Geen mutaties in deze periode.</td></tr>}
          </tbody>
          <tfoot><tr className="bg-surface-2 font-semibold"><td className="px-3 py-2" colSpan={4}>Eindsaldo per {korteDatum(tot)}</td><td className="cijfers px-3 py-2 text-right">{toon(kaart.eindsaldo)}</td></tr></tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Saldo als {debetzijde ? "debet" : "credit"}saldo; een negatief getal staat dus aan de andere kant.</p>
    </div>
  );
}
