import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, getal, vandaag } from "@/lib/datum";
import { loonparameters, loonheffingProef } from "@/lib/loon";
import { loonparametersOpslaan, loonparametersKopieren } from "../acties";

export const dynamic = "force-dynamic";

export default async function ParametersPagina({ searchParams }: { searchParams: Promise<{ jaar?: string; proef?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const dit = Number(vandaag().slice(0, 4));
  const p = await searchParams;
  const jaar = Number.isInteger(Number(p.jaar)) && Number(p.jaar) >= 2000 ? Number(p.jaar) : dit;
  const alle = await loonparameters(sessie);
  const par = alle.find((x) => x.jaar === jaar);
  const proefLoon = Number(String(p.proef ?? "").replace(",", ".")) || 0;
  const proef = par && proefLoon > 0 ? await Promise.all([loonheffingProef(sessie, proefLoon, jaar, true), loonheffingProef(sessie, proefLoon, jaar, false)]) : null;
  const s = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x).replace(".", ","));
  const Veld = ({ naam, label, waarde, hint }: { naam: string; label: string; waarde: number | null | undefined; hint?: string }) => (
    <label className="flex flex-col gap-1"><span className="label">{label}</span><input name={naam} required inputMode="decimal" defaultValue={s(waarde)} className="veld cijfers min-h-9 py-1 text-sm" />{hint && <span className="text-xs text-muted">{hint}</span>}</label>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href={`/boekhouding/loon?jaar=${jaar}`} className="knop knop-kaal -ml-2">← Loon</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Loonparameters {jaar}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Tarieven, heffingskortingen en premies van het jaar. Vooraf ingevuld naar beste weten; leg ze naast het <em>Handboek Loonheffingen</em> en de premiepercentages van de Belastingdienst en vink dan aan dat ze kloppen. De Whk-premie is per bedrijf: die staat in de beschikking van de Belastingdienst.</p>
        </div>
        <div className="flex gap-1">{alle.map((x) => <Link key={x.jaar} href={`/boekhouding/loon/parameters?jaar=${x.jaar}`} className={`rounded px-2 py-1 text-sm ${x.jaar === jaar ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{x.jaar}{x.gecontroleerd ? "" : " ·"}</Link>)}</div>
      </div>

      {!par ? (
        <form action={loonparametersKopieren} className="kaart mt-5 flex flex-wrap items-end gap-3 p-4">
          <p className="w-full text-sm">Nog geen parameters voor {jaar}. Kopieer een eerder jaar en pas de bedragen daarna aan.</p>
          <input type="hidden" name="naar" value={jaar} />
          <label className="flex flex-col gap-1"><span className="label">Kopieer van</span><select name="van" className="veld min-h-10 py-1">{alle.map((x) => <option key={x.jaar} value={x.jaar}>{x.jaar}</option>)}</select></label>
          <button type="submit" className="knop knop-primair">Aanmaken</button>
        </form>
      ) : (
        <>
          <form action={loonparametersOpslaan} className="kaart mt-5 flex flex-col gap-5 p-4">
            <input type="hidden" name="jaar" value={jaar} />
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="label mb-2">Loonbelasting en premie volksverzekeringen (schijven, jaarloon)</legend>
              <Veld naam="schijf1Tot" label="Schijf 1 tot" waarde={par.schijven[0]?.tot} /><Veld naam="schijf1Tarief" label="Tarief 1 %" waarde={par.schijven[0]?.tarief} /><div />
              <Veld naam="schijf2Tot" label="Schijf 2 tot" waarde={par.schijven[1]?.tot} /><Veld naam="schijf2Tarief" label="Tarief 2 %" waarde={par.schijven[1]?.tarief} /><div />
              <div className="hidden sm:block" /><Veld naam="schijf3Tarief" label="Tarief 3 % (daarboven)" waarde={par.schijven[2]?.tarief} />
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="label mb-2">Algemene heffingskorting</legend>
              <Veld naam="ahkMax" label="Maximum" waarde={par.ahkMax} /><Veld naam="ahkAfbouwVanaf" label="Afbouw vanaf" waarde={par.ahkAfbouwVanaf} /><Veld naam="ahkAfbouwPct" label="Afbouw %" waarde={par.ahkAfbouwPct} />
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="label mb-2">Arbeidskorting (opbouw in drie stappen, daarna afbouw)</legend>
              <Veld naam="ak1Tot" label="Stap 1 tot" waarde={par.akSchijven[0]?.tot} /><Veld naam="ak1Pct" label="Opbouw 1 %" waarde={par.akSchijven[0]?.pct} /><div />
              <Veld naam="ak2Tot" label="Stap 2 tot" waarde={par.akSchijven[1]?.tot} /><Veld naam="ak2Pct" label="Opbouw 2 %" waarde={par.akSchijven[1]?.pct} /><div />
              <Veld naam="ak3Tot" label="Stap 3 tot" waarde={par.akSchijven[2]?.tot} /><Veld naam="ak3Pct" label="Opbouw 3 %" waarde={par.akSchijven[2]?.pct} /><Veld naam="akMax" label="Maximum" waarde={par.akMax} />
              <Veld naam="akAfbouwVanaf" label="Afbouw vanaf" waarde={par.akAfbouwVanaf} /><Veld naam="akAfbouwPct" label="Afbouw %" waarde={par.akAfbouwPct} />
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <legend className="label mb-2">Premies werkgever (% van het premieloon)</legend>
              <Veld naam="awfLaag" label="Awf laag (vast)" waarde={par.awfLaag} /><Veld naam="awfHoog" label="Awf hoog (flex)" waarde={par.awfHoog} /><Veld naam="aof" label="Aof (kleine werkgever)" waarde={par.aof} /><Veld naam="whk" label="Whk (beschikking)" waarde={par.whk} />
              <Veld naam="zvwWg" label="Zvw werkgeversheffing" waarde={par.zvwWg} /><Veld naam="zvwWn" label="Zvw bijdrage (dga)" waarde={par.zvwWn} /><Veld naam="maxPremieloon" label="Maximum premieloon per jaar" waarde={par.maxPremieloon} />
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="label mb-2">Normen</legend>
              <Veld naam="gebruikelijkLoon" label="Gebruikelijk loon dga per jaar" waarde={par.gebruikelijkLoon} /><Veld naam="minimumloonUur" label="Minimumloon per uur" waarde={par.minimumloonUur} />
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gecontroleerd" value="aan" defaultChecked={par.gecontroleerd} className="size-5 accent-[var(--accent)]" />Gecontroleerd tegen de tabellen van de Belastingdienst voor {jaar}</label>
            <button type="submit" className="knop knop-primair self-start">Opslaan</button>
          </form>

          <form action="/boekhouding/loon/parameters" method="get" className="kaart mt-4 flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="jaar" value={jaar} />
            <div className="min-w-48 flex-1"><h2 className="text-base font-semibold">Proefberekening</h2><p className="text-xs text-muted">Vergelijk met de witte maandtabel: de jaarloonmethode zit er hooguit enkele euro's naast.</p></div>
            <label className="flex flex-col gap-1"><span className="label">Jaarloon</span><input name="proef" inputMode="decimal" defaultValue={proefLoon ? s(proefLoon) : "48000"} className="veld cijfers min-h-10 w-32 py-1" /></label>
            <button type="submit" className="knop knop-stil">Reken</button>
            {proef && (
              <p className="w-full text-sm">
                Jaarloon {euro(proefLoon)}: loonheffing <span className="cijfers font-semibold">{euro(proef[0])}</span> per jaar met loonheffingskorting ({euro(proef[0] / 12)} per maand, {getal(proef[0] / proefLoon * 100, 1)}%), {euro(proef[1])} zonder.
              </p>
            )}
          </form>

          <form action={loonparametersKopieren} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="van" value={jaar} />
            <label className="flex flex-col gap-1"><span className="label">Kopieer naar jaar</span><input name="naar" inputMode="numeric" defaultValue={String(jaar + 1)} className="veld cijfers min-h-9 w-24 py-1 text-sm" /></label>
            <button type="submit" className="knop knop-kaal knop-klein">Kopieer als startpunt</button>
          </form>
        </>
      )}
    </div>
  );
}
