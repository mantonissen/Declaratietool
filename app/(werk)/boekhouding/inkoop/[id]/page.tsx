import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, getal, korteDatum } from "@/lib/datum";
import { grootboekrekeningen, btwTarieven } from "@/lib/facturatie";
import { inkoopfactuur, boekhoudInstellingen } from "@/lib/boekhouding";
import { inkoopOpslaan, inkoopWeg, inkoopBetaald } from "../../acties";

export const dynamic = "force-dynamic";

export default async function InkoopDetail({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { id } = await params;
  const [k, rekeningen, btw, inst] = await Promise.all([
    inkoopfactuur(sessie, id), grootboekrekeningen(sessie), btwTarieven(sessie), boekhoudInstellingen(sessie),
  ]);
  if (!k) notFound();
  const kostenrekeningen = rekeningen.filter((g) => (g.actief && !g.betaalmiddel && (g.soort === "kosten" || g.soort === "activa")) || g.id === k.grootboekId);
  const betaalmiddelen = rekeningen.filter((g) => g.actief && g.betaalmiddel);
  const afgesloten = !!inst.afgeslotenTot && k.datum <= inst.afgeslotenTot;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding/inkoop" className="knop knop-kaal -ml-2">← Inkoop en kosten</Link>
      <p className="label mt-2">Inkoop · {k.betaaldOp ? `betaald ${korteDatum(k.betaaldOp)}` : k.vervallen ? "vervallen" : "open"}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{k.leverancier} <span className="font-normal text-muted">· {euro(k.bedragIncl)}</span></h1>
      {afgesloten && <p className="mt-2 rounded border border-warn bg-warn-bg px-3 py-2 text-sm">Deze inkoop valt in een afgesloten periode en kan niet meer veranderen.</p>}

      <form action={inkoopOpslaan} className="kaart mt-5 flex flex-col gap-4 p-4">
        <input type="hidden" name="id" value={k.id} />
        <fieldset disabled={afgesloten} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="label">Leverancier</span><input name="leverancier" required defaultValue={k.leverancier} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Omschrijving</span><input name="omschrijving" required defaultValue={k.omschrijving} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Factuurnummer leverancier</span><input name="kenmerk" defaultValue={k.kenmerk ?? ""} className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Rekening</span>
            <select key={k.grootboekId} name="grootboekId" defaultValue={k.grootboekId} className="veld">
              {kostenrekeningen.map((g) => <option key={g.id} value={g.id}>{g.nummer} · {g.naam}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Factuurdatum</span><input type="date" name="datum" required defaultValue={k.datum} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Vervaldatum</span><input type="date" name="vervaldatum" defaultValue={k.vervaldatum ?? ""} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Bedrag excl. btw</span><input name="bedragExcl" required inputMode="decimal" defaultValue={String(k.bedragExcl).replace(".", ",")} className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Btw</span>
            <select key={k.btwCode} name="btwCode" defaultValue={k.btwCode} className="veld">
              {btw.filter((t) => t.actief || t.code === k.btwCode).map((t) => <option key={t.code} value={t.code}>{t.omschrijving} ({getal(t.percentage, 0)}%)</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Btw-bedrag</span><input name="btwBedrag" inputMode="decimal" defaultValue={String(k.btwBedrag).replace(".", ",")} className="veld cijfers" /></label>
        </fieldset>
        {!afgesloten && <button type="submit" className="knop knop-primair self-start">Opslaan</button>}
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!k.betaaldOp ? (
          <form action={inkoopBetaald} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={k.id} />
            <input type="date" name="datum" className="veld min-h-10 w-40 py-1" aria-label="Betaald op" />
            <select name="via" defaultValue={inst.rekeningBank ?? ""} className="veld min-h-10 py-1">{betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{g.naam}</option>)}</select>
            <button type="submit" className="knop knop-stil">Betaald</button>
          </form>
        ) : !afgesloten && (
          <form action={inkoopBetaald}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="ongedaan" value="ja" /><button type="submit" className="knop knop-kaal">Toch niet betaald</button></form>
        )}
        {!afgesloten && (
          <form action={inkoopWeg} className="ml-auto"><input type="hidden" name="id" value={k.id} /><button type="submit" className="knop knop-kaal text-danger">Verwijderen</button></form>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">Opslaan draait de boeking terug en boekt opnieuw, inclusief de betaling; verwijderen haalt alles weg. Beide kunnen alleen in een open periode.</p>
    </div>
  );
}
