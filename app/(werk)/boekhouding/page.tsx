import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen, SOORT_LABEL } from "@/lib/facturatie";
import { rapport, kerncijfers, boekhoudInstellingen, leesPeriode, periodeLabel, getoond, type Saldo } from "@/lib/boekhouding";
import { PeriodeKiezer } from "@/components/PeriodeKiezer";
import { memoriaalBoeken, afsluiten } from "./acties";

export const dynamic = "force-dynamic";

export default async function BoekhoudingPagina({ searchParams }: { searchParams: Promise<{ van?: string; tot?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { van, tot } = leesPeriode(await searchParams, "jaar");

  const [r, kern, inst, rekeningen] = await Promise.all([
    rapport(sessie, van, tot), kerncijfers(sessie, tot), boekhoudInstellingen(sessie), grootboekrekeningen(sessie),
  ]);
  const qs = `?van=${van}&tot=${tot}`;

  const Rij = ({ s }: { s: Saldo }) => (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-1.5"><Link href={`/boekhouding/rekening/${s.grootboekId}${qs}`} className="hover:underline"><span className="cijfers mr-2 text-xs text-muted">{s.nummer}</span>{s.naam}</Link></td>
      <td className="cijfers px-3 py-1.5 text-right">{euro(getoond(s))}</td>
    </tr>
  );
  const Totaal = ({ label, bedrag, sterk }: { label: string; bedrag: number; sterk?: boolean }) => (
    <tr className={sterk ? "bg-surface-2 font-semibold" : "font-medium"}>
      <td className="px-3 py-1.5">{label}</td><td className="cijfers px-3 py-1.5 text-right">{euro(bedrag)}</td>
    </tr>
  );
  const Kop = ({ t }: { t: string }) => <tr><th colSpan={2} className="label border-b border-line bg-surface-2/60 px-3 py-1.5 text-left">{t}</th></tr>;
  const som = (l: Saldo[]) => l.reduce((a, s) => a + getoond(s), 0);
  const passivaTotaal = som(r.passiva) + som(r.eigenVermogen) + r.resultaatCumulatief;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Boekhouding</h1>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">
        Elke definitieve factuur, betaling, inkoop en btw-aangifte staat als sluitende boeking in het
        journaal. Hier zie je wat dat oplevert: winst-en-verlies over de periode en de balans per einddatum.
      </p>
      <nav className="mb-5 flex flex-wrap gap-2">
        <Link href={`/boekhouding/journaal${qs}`} className="knop knop-stil">Journaal</Link>
        <Link href={`/boekhouding/inkoop${qs}`} className="knop knop-stil">Inkoop en kosten{kern.crediteurenAantal ? <span className="cijfers ml-1 rounded bg-warn-bg px-1.5 text-xs text-warn">{kern.crediteurenAantal}</span> : null}</Link>
        <Link href="/boekhouding/btw" className="knop knop-stil">Btw-aangifte</Link>
        <Link href="/boekhouding/loon" className="knop knop-stil">Loon</Link>
        <Link href="/boekhouding/jaarrekening" className="knop knop-stil">Jaarrekening</Link>
        <Link href="/boekhouding/aangiften" className="knop knop-stil">Aangiften</Link>
        <Link href="/facturen" className="knop knop-kaal">Facturen</Link>
        <Link href="/beheer/grootboek" className="knop knop-kaal">Rekeningschema</Link>
      </nav>

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {[
          { t: "Bank en kas", v: euro(kern.liquide), s: `per ${korteDatum(tot)}` },
          { t: "Debiteuren", v: euro(kern.debiteuren), s: `${kern.debiteurenAantal} open ${kern.debiteurenAantal === 1 ? "factuur" : "facturen"}` },
          { t: "Crediteuren", v: euro(kern.crediteuren), s: `${kern.crediteurenAantal} te betalen`, w: kern.crediteurenAantal > 0 },
          { t: `Resultaat ${periodeLabel(van, tot)}`, v: euro(r.resultaat), s: r.resultaat >= 0 ? "winst voor belasting" : "verlies", w: r.resultaat < 0 },
        ].map((x) => (
          <div key={x.t} className="bg-surface px-4 py-3">
            <dt className="label">{x.t}</dt>
            <dd className={`cijfers mt-0.5 text-lg font-semibold ${x.w ? "text-warn" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-muted">{x.s}</dd>
          </div>
        ))}
      </dl>

      <PeriodeKiezer pad="/boekhouding" van={van} tot={tot} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Winst-en-verlies <span className="text-sm font-normal text-muted">{korteDatum(van)} — {korteDatum(tot)}</span></h2>
          <div className="tabel-omhulsel"><table className="w-full text-sm">
            <tbody>
              <Kop t="Omzet" />
              {r.omzet.map((s) => <Rij key={s.grootboekId} s={s} />)}
              {r.omzet.length === 0 && <tr><td colSpan={2} className="px-3 py-2 text-muted">Geen omzet in deze periode.</td></tr>}
              <Totaal label="Totaal omzet" bedrag={som(r.omzet)} />
              <Kop t="Kosten" />
              {r.kosten.map((s) => <Rij key={s.grootboekId} s={s} />)}
              {r.kosten.length === 0 && <tr><td colSpan={2} className="px-3 py-2 text-muted">Geen kosten geboekt.</td></tr>}
              <Totaal label="Totaal kosten" bedrag={som(r.kosten)} />
              <Totaal label={r.resultaat >= 0 ? "Winst vóór belasting" : "Verlies vóór belasting"} bedrag={r.resultaat} sterk />
              {r.belastingen.length > 0 && (
                <>
                  {r.belastingen.map((s) => <Rij key={s.grootboekId} s={s} />)}
                  <Totaal label={r.resultaatNaBelasting >= 0 ? "Winst na belasting" : "Verlies na belasting"} bedrag={r.resultaatNaBelasting} sterk />
                </>
              )}
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-muted">De omzet is wat gefactureerd is, niet wat ontvangen is. Afschrijvingen komen uit <Link href="/boekhouding/activa" className="text-accent-ink">vaste activa</Link>, de vennootschapsbelasting uit het <Link href="/boekhouding/jaarrekening" className="text-accent-ink">jaarwerk</Link>.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Balans <span className="text-sm font-normal text-muted">per {korteDatum(tot)}</span></h2>
          <div className="tabel-omhulsel"><table className="w-full text-sm">
            <tbody>
              <Kop t="Activa" />
              {r.activa.map((s) => <Rij key={s.grootboekId} s={s} />)}
              <Totaal label="Totaal activa" bedrag={r.balansTotaal} sterk />
              <Kop t="Passiva" />
              {r.passiva.map((s) => <Rij key={s.grootboekId} s={s} />)}
              {r.eigenVermogen.map((s) => <Rij key={s.grootboekId} s={s} />)}
              <tr className="border-b border-line"><td className="px-3 py-1.5">Resultaat tot en met {korteDatum(tot)}</td><td className="cijfers px-3 py-1.5 text-right">{euro(r.resultaatCumulatief)}</td></tr>
              <Totaal label="Totaal passiva" bedrag={passivaTotaal} sterk />
            </tbody>
          </table></div>
          {Math.abs(r.balansTotaal - passivaTotaal) > 0.005 && (
            <p className="mt-2 text-xs text-danger">De balans sluit niet ({euro(r.balansTotaal - passivaTotaal)} verschil); dat kan alleen als een rekening van soort is veranderd nadat erop geboekt is.</p>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <form action={memoriaalBoeken} className="kaart flex min-w-0 flex-col gap-3 p-4">
          <h2 className="text-base font-semibold">Memoriaalboeking</h2>
          <p className="text-xs text-muted">Voor wat niet via een factuur of inkoop loopt: privé-opname of -storting, afschrijving, correctie. Debet en credit moeten gelijk zijn. Begin je halverwege met deze boekhouding? Boek dan eerst de beginbalans: banksaldo debet op Bank, hetzelfde bedrag credit op Eigen vermogen.</p>
          <div className="flex flex-wrap gap-2">
            <input type="date" name="datum" defaultValue={vandaag()} required className="veld min-h-10 w-40 py-1" aria-label="Datum" />
            <input name="omschrijving" required maxLength={160} placeholder="Omschrijving" className="veld min-h-10 flex-1 py-1" />
          </div>
          <div className="tabel-omhulsel min-w-0"><table className="w-full text-sm">
            <thead><tr><th className="label px-2 py-1.5 text-left">Rekening</th><th className="label px-2 py-1.5 text-right">Debet</th><th className="label px-2 py-1.5 text-right">Credit</th><th className="label px-2 py-1.5 text-left">Toelichting</th></tr></thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i}>
                  <td className="px-2 py-1"><select name="gb" defaultValue="" className="veld min-h-9 w-full min-w-48 py-1 text-sm"><option value="">—</option>{rekeningen.filter((g) => g.actief).map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}</select></td>
                  <td className="px-2 py-1"><input name="debet" inputMode="decimal" className="veld cijfers min-h-9 w-28 py-1 text-right text-sm" /></td>
                  <td className="px-2 py-1"><input name="credit" inputMode="decimal" className="veld cijfers min-h-9 w-28 py-1 text-right text-sm" /></td>
                  <td className="px-2 py-1"><input name="oms" maxLength={120} className="veld min-h-9 w-full min-w-32 py-1 text-sm" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button type="submit" className="knop knop-primair self-start">Boek</button>
        </form>

        <section className="flex flex-col gap-4">
          <form action={afsluiten} className="kaart flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">Periode afsluiten</h2>
            <p className="text-xs text-muted">
              {inst.afgeslotenTot ? <>Afgesloten tot en met <span className="cijfers">{korteDatum(inst.afgeslotenTot)}</span>. Tot die datum komt er niets bij of af.</> : <>Nog niets afgesloten. Sluit af zodra een kwartaal of jaar is aangegeven, dan verandert er niets meer in.</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <input type="date" name="afsluitenTot" defaultValue={inst.afgeslotenTot ?? ""} className="veld min-h-10 w-40 py-1" aria-label="Afsluiten tot en met" />
              <button type="submit" className="knop knop-stil">Sluit af</button>
              {inst.afgeslotenTot && <button type="submit" name="heropen" value="ja" className="knop knop-kaal text-danger">Heropen</button>}
            </div>
          </form>
          <div className="kaart p-4 text-xs text-muted">
            <p className="label mb-1">Soorten rekeningen</p>
            <p>{Object.values(SOORT_LABEL).join(" · ")}. Activa en kosten staan debet, de rest credit. Het rekeningschema beheer je onder <Link href="/beheer/grootboek" className="text-accent-ink">Grootboek en btw</Link>.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
