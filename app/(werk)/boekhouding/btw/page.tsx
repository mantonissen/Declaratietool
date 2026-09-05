import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen } from "@/lib/facturatie";
import { btwOverzicht, aangiftes, leesPeriode, periodeLabel, boekhoudInstellingen, kwartaalGrenzen, maandGrenzen, jaarGrenzen } from "@/lib/boekhouding";
import { PeriodeKiezer } from "@/components/PeriodeKiezer";
import { aangifteVastleggen, aangifteWeg, aangifteIngediend, aangifteBetaald } from "../acties";

export const dynamic = "force-dynamic";

export default async function BtwPagina({ searchParams }: { searchParams: Promise<{ van?: string; tot?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const p = await searchParams;
  const [lijst, inst, rekeningen] = await Promise.all([aangiftes(sessie), boekhoudInstellingen(sessie), grootboekrekeningen(sessie)]);

  // Standaard: de eerstvolgende periode na de laatste aangifte, in het
  // ingestelde ritme; anders het lopende kwartaal.
  let standaard = leesPeriode({}, "kwartaal");
  const laatste = lijst[0];
  if (laatste && !(p.van && p.tot)) {
    const d = new Date(laatste.tot + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    const j = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    standaard = inst.btwInterval === "maand" ? maandGrenzen(j, m) : inst.btwInterval === "jaar" ? jaarGrenzen(j) : kwartaalGrenzen(j, Math.ceil(m / 3));
  }
  const { van, tot } = p.van && p.tot ? leesPeriode(p, "kwartaal") : standaard;
  const rubrieken = await btwOverzicht(sessie, van, tot);
  const r = (code: string) => rubrieken.find((x) => x.rubriek === code)!;
  const verschuldigd = r("1a").btw + r("1b").btw;
  const saldo = verschuldigd - r("5b").btw;
  const overlapt = lijst.find((a) => a.van <= tot && a.tot >= van);
  const betaalmiddelen = rekeningen.filter((g) => g.actief && g.betaalmiddel);
  const nogNietBegonnen = tot > vandaag();

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Btw-aangifte</h1>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">
        De rubrieken van de aangifte omzetbelasting, op factuurdatum. Vastleggen zet de bedragen vast en boekt
        verschuldigde btw en voorbelasting weg naar één post; die betaal je daarna van de bank.
      </p>
      <PeriodeKiezer pad="/boekhouding/btw" van={van} tot={tot} />

      <section className="kaart mt-4 overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3">
          <h2 className="text-lg font-semibold">{periodeLabel(van, tot)} <span className="text-sm font-normal text-muted">{korteDatum(van)} — {korteDatum(tot)}</span></h2>
          {overlapt && <span className="label rounded bg-accent-bg px-1.5 py-0.5 text-accent-ink">al vastgelegd{overlapt.van !== van || overlapt.tot !== tot ? " (deels)" : ""}</span>}
        </header>
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line px-4 py-2 text-left">Rubriek</th>
            <th className="label border-b border-line px-4 py-2 text-right">Bedrag waarover</th>
            <th className="label border-b border-line px-4 py-2 text-right">Btw</th>
          </tr></thead>
          <tbody>
            {["1a", "1b", "1e"].map((code) => (
              <tr key={code} className="border-b border-line"><td className="px-4 py-2"><span className="cijfers mr-2 text-muted">{code}</span>{r(code).omschrijving}</td><td className="cijfers px-4 py-2 text-right">{euro(r(code).grondslag ?? 0)}</td><td className="cijfers px-4 py-2 text-right">{code === "1e" ? "—" : euro(r(code).btw)}</td></tr>
            ))}
            <tr className="border-b border-line font-medium"><td className="px-4 py-2"><span className="cijfers mr-2 text-muted">5a</span>Verschuldigde omzetbelasting</td><td></td><td className="cijfers px-4 py-2 text-right">{euro(verschuldigd)}</td></tr>
            <tr className="border-b border-line"><td className="px-4 py-2"><span className="cijfers mr-2 text-muted">5b</span>Voorbelasting</td><td></td><td className="cijfers px-4 py-2 text-right">{euro(r("5b").btw)}</td></tr>
            <tr className="bg-surface-2 font-semibold"><td className="px-4 py-2"><span className="cijfers mr-2 text-muted">5c</span>{saldo >= 0 ? "Te betalen" : "Terug te vragen"}</td><td></td><td className="cijfers px-4 py-2 text-right">{euro(Math.abs(saldo))}</td></tr>
          </tbody>
        </table>
        <form action={aangifteVastleggen} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <input type="hidden" name="van" value={van} /><input type="hidden" name="tot" value={tot} />
          <span className="text-xs text-muted">{nogNietBegonnen ? "De periode is nog niet voorbij; vastleggen kan, maar facturen van later komen er dan niet meer in." : "Neem deze bedragen over in de aangifte bij de Belastingdienst en leg ze hier vast."}</span>
          <button type="submit" className="knop knop-primair ml-auto" disabled={!!overlapt}>Leg aangifte vast</button>
        </form>
      </section>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Vastgelegde aangiftes</h2>
      {lijst.length ? (
        <ul className="kaart divide-y divide-line">
          {lijst.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-40 flex-1">
                <Link href={`/boekhouding/btw?van=${a.van}&tot=${a.tot}`} className="block font-medium text-accent-ink hover:underline">{periodeLabel(a.van, a.tot)}</Link>
                <span className="block text-xs text-muted">
                  omzet hoog {euro(a.omzetHoog)} · btw {euro(a.btwHoog + a.btwLaag)} · voorbelasting {euro(a.voorbelasting)}
                  {a.ingediendOp ? ` · ingediend ${korteDatum(a.ingediendOp)}` : " · nog niet ingediend"}
                  {a.betaaldOp ? ` · ${a.saldo < 0 ? "ontvangen" : "betaald"} ${korteDatum(a.betaaldOp)}` : ""}
                </span>
              </span>
              <span className={`cijfers font-semibold ${a.saldo < 0 ? "text-accent-ink" : ""}`}>{euro(a.saldo)}</span>
              {!a.ingediendOp && (
                <form action={aangifteIngediend} className="flex items-center gap-1"><input type="hidden" name="id" value={a.id} /><input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-36 py-1 text-sm" aria-label="Ingediend op" /><button type="submit" className="knop knop-stil knop-klein">Ingediend</button></form>
              )}
              {!a.betaaldOp && a.saldo !== 0 && (
                <form action={aangifteBetaald} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-36 py-1 text-sm" aria-label="Betaald op" />
                  <select name="via" defaultValue={inst.rekeningBank ?? ""} className="veld min-h-9 py-1 text-sm">{betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{g.naam}</option>)}</select>
                  <button type="submit" className="knop knop-stil knop-klein">{a.saldo < 0 ? "Ontvangen" : "Betaald"}</button>
                </form>
              )}
              {!a.ingediendOp && (
                <form action={aangifteWeg}><input type="hidden" name="id" value={a.id} /><button type="submit" className="knop knop-kaal knop-klein text-danger">×</button></form>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nog geen aangifte vastgelegd.</p>}
      <p className="mt-2 text-xs text-muted">Aangifteritme: {inst.btwInterval === "maand" ? "per maand" : inst.btwInterval === "jaar" ? "per jaar" : "per kwartaal"}; instelbaar onder Beheer → Grootboek en btw. Een factuur die later nog in een ingediende periode valt, neem je mee in de volgende aangifte (of een suppletie).</p>
    </div>
  );
}
