import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, getal, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen, btwTarieven } from "@/lib/facturatie";
import { inkoopfacturen, leesPeriode, boekhoudInstellingen } from "@/lib/boekhouding";
import { PeriodeKiezer } from "@/components/PeriodeKiezer";
import { inkoopErbij, inkoopBetaald } from "../acties";

export const dynamic = "force-dynamic";

export default async function InkoopPagina({ searchParams }: { searchParams: Promise<{ van?: string; tot?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { van, tot } = leesPeriode(await searchParams, "jaar");
  const [lijst, rekeningen, btw, inst] = await Promise.all([
    inkoopfacturen(sessie, van, tot), grootboekrekeningen(sessie), btwTarieven(sessie), boekhoudInstellingen(sessie),
  ]);
  const kostenrekeningen = rekeningen.filter((g) => g.actief && !g.betaalmiddel && (g.soort === "kosten" || g.soort === "activa"));
  const betaalmiddelen = rekeningen.filter((g) => g.actief && g.betaalmiddel);
  const open = lijst.filter((k) => !k.betaaldOp);
  const betaald = lijst.filter((k) => k.betaaldOp);
  const openTotaal = open.reduce((s, k) => s + k.bedragIncl, 0);

  const ViaSelect = ({ naam = "via" }: { naam?: string }) => (
    <select name={naam} defaultValue={inst.rekeningBank ?? betaalmiddelen[0]?.id ?? ""} className="veld min-h-9 w-32 py-1 text-sm" aria-label="Betaald via">
      {betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{g.naam}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Inkoop en kosten</h1>
      <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">
        Elke bon of inkoopfactuur komt op een kostenrekening, met de btw als voorbelasting voor de aangifte.
        Betalen boekt van bank, kas of privé.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Te betalen <span className="cijfers ml-2 text-sm font-normal text-muted">{euro(openTotaal)}</span></h2>
        {open.length ? (
          <ul className="kaart divide-y divide-line">
            {open.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-48 flex-1">
                  <Link href={`/boekhouding/inkoop/${k.id}`} className="block font-medium text-accent-ink hover:underline">{k.leverancier} · {k.omschrijving}</Link>
                  <span className={`block text-xs ${k.vervallen ? "text-warn" : "text-muted"}`}>
                    {korteDatum(k.datum)}{k.vervaldatum ? ` · ${k.vervallen ? "vervallen op" : "vervalt"} ${korteDatum(k.vervaldatum)}` : ""} · <span className="cijfers">{k.grootboekNummer}</span> {k.grootboekNaam}
                  </span>
                </span>
                <span className="cijfers font-semibold">{euro(k.bedragIncl)}</span>
                <form action={inkoopBetaald} className="flex flex-wrap items-center gap-1">
                  <input type="hidden" name="id" value={k.id} />
                  <input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-36 py-1 text-sm" aria-label="Betaald op" />
                  <ViaSelect />
                  <button type="submit" className="knop knop-stil knop-klein">Betaald</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Niets open.</p>}
      </section>

      <form action={inkoopErbij} className="kaart mb-8 flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Inkoop of kosten vastleggen</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1"><span className="label">Leverancier</span><input name="leverancier" required maxLength={120} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Omschrijving</span><input name="omschrijving" required maxLength={160} className="veld" placeholder="Wat is het" /></label>
          <label className="flex flex-col gap-1"><span className="label">Factuurnummer leverancier</span><input name="kenmerk" maxLength={60} className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Factuurdatum</span><input type="date" name="datum" required defaultValue={vandaag()} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Vervaldatum</span><input type="date" name="vervaldatum" className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Rekening</span>
            <select name="grootboekId" required defaultValue="" className="veld">
              <option value="" disabled>Kies een kostenrekening…</option>
              {kostenrekeningen.map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Bedrag excl. btw</span><input name="bedragExcl" required inputMode="decimal" className="veld cijfers" placeholder="negatief = creditnota" /></label>
          <label className="flex flex-col gap-1"><span className="label">Btw</span>
            <select name="btwCode" defaultValue="hoog" className="veld">
              {btw.filter((t) => t.actief).map((t) => <option key={t.code} value={t.code}>{t.omschrijving} ({getal(t.percentage, 0)}%)</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Btw-bedrag <span className="normal-case tracking-normal">(leeg = berekend)</span></span><input name="btwBedrag" inputMode="decimal" className="veld cijfers" placeholder="van de bon" /></label>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="flex flex-col gap-1"><span className="label">Al betaald op</span><input type="date" name="betaaldOp" className="veld min-h-10 w-40 py-1" /></label>
          <label className="flex flex-col gap-1"><span className="label">Via</span><ViaSelect naam="betaaldVia" /></label>
          <span className="pb-2 text-xs text-muted">Leeg laten als hij nog open staat; dan betaal je hem hierboven af.</span>
          <button type="submit" className="knop knop-primair ml-auto">Vastleggen</button>
        </div>
      </form>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Betaald</h2>
        <PeriodeKiezer pad="/boekhouding/inkoop" van={van} tot={tot} />
        <div className="tabel-omhulsel mt-3">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Datum</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Leverancier</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Rekening</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Excl.</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Btw</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Incl.</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Betaald</th>
            </tr></thead>
            <tbody>
              {betaald.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(k.datum)}</td>
                  <td className="px-3 py-2"><Link href={`/boekhouding/inkoop/${k.id}`} className="font-medium text-accent-ink hover:underline">{k.leverancier}</Link><span className="block text-xs text-muted">{k.omschrijving}</span></td>
                  <td className="px-3 py-2 text-xs"><span className="cijfers">{k.grootboekNummer}</span> {k.grootboekNaam}</td>
                  <td className="cijfers px-3 py-2 text-right">{euro(k.bedragExcl)}</td>
                  <td className="cijfers px-3 py-2 text-right text-muted">{euro(k.btwBedrag)}</td>
                  <td className="cijfers px-3 py-2 text-right font-semibold">{euro(k.bedragIncl)}</td>
                  <td className="cijfers px-3 py-2 text-xs text-muted whitespace-nowrap">{korteDatum(k.betaaldOp!)}</td>
                </tr>
              ))}
              {betaald.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">Nog niets betaald in deze periode.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
