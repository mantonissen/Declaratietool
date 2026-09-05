import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen } from "@/lib/facturatie";
import { activa } from "@/lib/jaarwerk";
import { activumErbij, activumBuitenGebruik, activumWeg, afschrijven } from "../jaarwerk-acties";

export const dynamic = "force-dynamic";

export default async function ActivaPagina() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const [lijst, rekeningen] = await Promise.all([activa(sessie), grootboekrekeningen(sessie)]);
  const vast = rekeningen.filter((g) => g.actief && g.rubriek === "vaste_activa");
  const kosten = rekeningen.filter((g) => g.actief && g.soort === "kosten");
  const tegenrekeningen = rekeningen.filter((g) => g.actief && (g.betaalmiddel || g.nummer === "1600"));
  const kies = (nummer: string, lijst2 = rekeningen) => lijst2.find((g) => g.nummer === nummer)?.id ?? lijst2[0]?.id ?? "";
  const d = vandaag();
  const vorigeMaandEind = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const totaal = lijst.reduce((s, a) => ({ aanschaf: s.aanschaf + a.aanschafwaarde, boek: s.boek + a.boekwaarde }), { aanschaf: 0, boek: 0 });

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Vaste activa</h1>
      <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">
        Apparatuur, inventaris en andere aanschaffen boven de € 450 die je over meerdere jaren afschrijft. De inkoop zelf boek je op de activarekening
        (bijvoorbeeld 0100); hier leg je het bezit vast en boekt de app elke maand een deel als kosten.
      </p>

      <form action={afschrijven} className="kaart mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-48 flex-1">
          <h2 className="text-base font-semibold">Afschrijven</h2>
          <p className="text-xs text-muted">Boekt per activum een regel per maand, vanaf de maand na aanschaf tot en met de gekozen datum. Al geboekte maanden slaat hij over.</p>
        </div>
        <input type="date" name="tot" defaultValue={vorigeMaandEind} className="veld min-h-10 w-40 py-1" aria-label="Tot en met" />
        <button type="submit" className="knop knop-primair" disabled={lijst.length === 0}>Afschrijven tot en met</button>
      </form>

      <div className="tabel-omhulsel">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Activum</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Aanschaf</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Afgeschreven</th>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Boekwaarde</th>
            <th className="border-b border-line bg-surface-2"></th>
          </tr></thead>
          <tbody>
            {lijst.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <span className="block font-medium">{a.omschrijving}</span>
                  <span className="block text-xs text-muted">
                    gekocht {korteDatum(a.aanschafdatum)} {a.aanschafdatum.slice(0, 4)} · {a.afschrijvingsmaanden} maanden{a.restwaarde ? ` · rest ${euro(a.restwaarde)}` : ""}
                    {a.afgeschrevenTot ? ` · afgeschreven t/m ${korteDatum(a.afgeschrevenTot)} ${a.afgeschrevenTot.slice(0, 4)}` : " · nog niet afgeschreven"}
                    {a.buitenGebruikOp ? ` · buiten gebruik ${korteDatum(a.buitenGebruikOp)}` : ""}
                  </span>
                </td>
                <td className="cijfers px-3 py-2 text-right">{euro(a.aanschafwaarde)}</td>
                <td className="cijfers px-3 py-2 text-right text-muted">{euro(a.afgeschreven)}</td>
                <td className="cijfers px-3 py-2 text-right font-semibold">{euro(a.boekwaarde)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {a.afgeschreven === 0 ? (
                    <form action={activumWeg} className="inline"><input type="hidden" name="id" value={a.id} /><button type="submit" className="knop knop-kaal knop-klein text-danger">×</button></form>
                  ) : a.buitenGebruikOp ? (
                    <form action={activumBuitenGebruik} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="ongedaan" value="ja" /><button type="submit" className="knop knop-kaal knop-klein">weer in gebruik</button></form>
                  ) : (
                    <form action={activumBuitenGebruik} className="inline-flex items-center gap-1"><input type="hidden" name="id" value={a.id} /><input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-8 w-36 py-0.5 text-xs" aria-label="Buiten gebruik per" /><button type="submit" className="knop knop-kaal knop-klein">buiten gebruik</button></form>
                  )}
                </td>
              </tr>
            ))}
            {lijst.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Nog geen vaste activa.</td></tr>}
          </tbody>
          {lijst.length > 0 && <tfoot><tr className="bg-surface-2 font-semibold"><td className="px-3 py-2">Totaal</td><td className="cijfers px-3 py-2 text-right">{euro(totaal.aanschaf)}</td><td className="cijfers px-3 py-2 text-right">{euro(totaal.aanschaf - totaal.boek)}</td><td className="cijfers px-3 py-2 text-right">{euro(totaal.boek)}</td><td></td></tr></tfoot>}
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Buiten gebruik stopt de afschrijving; de restboekwaarde boek je bij verkoop of afvoer als memoriaal weg. Verwijderen kan alleen zolang er niets op is afgeschreven.</p>

      <form action={activumErbij} className="kaart mt-6 flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Activum vastleggen</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 lg:col-span-2"><span className="label">Omschrijving</span><input name="omschrijving" required maxLength={120} className="veld" placeholder="Bijvoorbeeld: laptop Sam" /></label>
          <label className="flex flex-col gap-1"><span className="label">Aanschafdatum</span><input type="date" name="aanschafdatum" required defaultValue={vandaag()} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Aanschafwaarde excl. btw</span><input name="aanschafwaarde" required inputMode="decimal" className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Restwaarde</span><input name="restwaarde" inputMode="decimal" defaultValue="0" className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Afschrijven in maanden</span><input name="maanden" inputMode="numeric" required defaultValue="60" className="veld cijfers" /><span className="text-xs text-muted">Computers 36, inventaris 60, verbouwing 120.</span></label>
          <label className="flex flex-col gap-1"><span className="label">Activarekening</span><select name="grootboekActiva" defaultValue={kies("0100", vast)} className="veld">{vast.map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Cumulatieve afschrijving</span><select name="grootboekAfschrijving" defaultValue={kies("0150", vast)} className="veld">{vast.map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Kostenrekening</span><select name="grootboekKosten" defaultValue={kies("4990", kosten)} className="veld">{kosten.map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}</select></label>
          <label className="flex flex-col gap-1 lg:col-span-3"><span className="label">Aanschaf boeken</span>
            <select name="tegenrekening" defaultValue="" className="veld">
              <option value="">Niet boeken — staat al op de activarekening via een inkoop</option>
              {tegenrekeningen.map((g) => <option key={g.id} value={g.id}>Nu boeken, betaald via {g.nummer} · {g.naam}</option>)}
            </select>
            <span className="text-xs text-muted">Heb je de aankoop onder Inkoop en kosten op de activarekening geboekt, kies dan niet boeken. Anders zet dit de aanschaf op de balans tegenover het gekozen betaalmiddel of crediteuren.</span>
          </label>
        </div>
        <button type="submit" className="knop knop-primair self-start">Vastleggen</button>
      </form>
    </div>
  );
}
