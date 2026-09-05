import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, getal, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen } from "@/lib/facturatie";
import { boekhoudInstellingen } from "@/lib/boekhouding";
import { jaarrekening, boekjaar, vpbBerekening, vpbParameters, type Groep } from "@/lib/jaarwerk";
import { boekjaarOpslaan, jaarstapOpslaan, vpbReserveren, vpbBetalen, vpbParametersOpslaan } from "../jaarwerk-acties";

export const dynamic = "force-dynamic";

export default async function JaarrekeningPagina({ searchParams }: { searchParams: Promise<{ jaar?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const dit = Number(vandaag().slice(0, 4));
  const p = await searchParams;
  const jaar = Number.isInteger(Number(p.jaar)) && Number(p.jaar) >= 2000 ? Number(p.jaar) : dit;

  const [jr, bj, vpb, params, inst, rekeningen] = await Promise.all([
    jaarrekening(sessie, jaar), boekjaar(sessie, jaar), vpbBerekening(sessie, jaar), vpbParameters(sessie),
    boekhoudInstellingen(sessie), grootboekrekeningen(sessie),
  ]);
  const par = params.find((x) => x.jaar === jaar);
  const betaalmiddelen = rekeningen.filter((g) => g.actief && g.betaalmiddel);
  const gereserveerd = bj.vpbBedrag !== null;
  const afwijkend = gereserveerd && Math.abs((bj.vpbBedrag ?? 0) - vpb.vpb) > 0.5;

  const Tabel = ({ groepen, totaalLabel, totaal, vorig }: { groepen: Groep[]; totaalLabel: string; totaal: number; vorig: number }) => (
    <tbody>
      {groepen.map((g) => (
        <GroepRijen key={g.rubriek} g={g} jaar={jaar} />
      ))}
      <tr className="bg-surface-2 font-semibold"><td className="px-3 py-2">{totaalLabel}</td><td className="cijfers px-3 py-2 text-right">{euro(totaal)}</td><td className="cijfers px-3 py-2 text-right text-muted">{euro(vorig)}</td></tr>
    </tbody>
  );
  const Kop = () => (
    <thead><tr>
      <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left"></th>
      <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">{jaar}</th>
      <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">{jaar - 1}</th>
    </tr></thead>
  );
  const Stap = ({ stap, label, datum }: { stap: string; label: string; datum: string | null }) => (
    <form action={jaarstapOpslaan} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="jaar" value={jaar} /><input type="hidden" name="stap" value={stap} />
      <span className="w-full font-medium sm:w-52">{label}</span>
      {datum ? (
        <><span className="cijfers text-accent-ink">{korteDatum(datum)} {datum.slice(0, 4)}</span><button type="submit" name="ongedaan" value="ja" className="knop knop-kaal knop-klein text-danger">×</button></>
      ) : (
        <><input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-40 py-1 text-sm" /><button type="submit" className="knop knop-stil knop-klein">Vastleggen</button></>
      )}
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Jaarrekening {jaar}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Balans en winst-en-verlies in de indeling van de publicatiestukken, de vennootschapsbelasting, en de stappen tot en met deponeren.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[dit - 2, dit - 1, dit].map((j) => <Link key={j} href={`/boekhouding/jaarrekening?jaar=${j}`} className={`rounded px-2 py-1 text-sm ${j === jaar ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{j}</Link>)}
          <a href={`/api/jaarrekening?jaar=${jaar}`} className="knop knop-primair">Jaarrekening (PDF)</a>
        </div>
      </div>

      {inst.afgeslotenTot && inst.afgeslotenTot >= `${jaar}-12-31` ? null : (
        <p className="mt-4 rounded border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
          Vóór je opmaakt: <Link href="/boekhouding/activa" className="text-accent-ink">afschrijvingen</Link> boeken tot en met 31 december, de btw-aangifte van het laatste tijdvak vastleggen, de vennootschapsbelasting hieronder reserveren, en daarna de periode <Link href="/boekhouding" className="text-accent-ink">afsluiten</Link> tot en met 31-12-{jaar}.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-2 text-lg font-semibold">Balans per 31 december</h2>
          <div className="tabel-omhulsel"><table className="w-full text-sm">
            <Kop />
            <tbody><tr><td colSpan={3} className="label bg-surface-2/60 px-3 py-1.5">Activa</td></tr></tbody>
            <Tabel groepen={jr.activa} totaalLabel="Totaal activa" totaal={jr.totaalActiva} vorig={jr.totaalActivaVorig} />
            <tbody><tr><td colSpan={3} className="label bg-surface-2/60 px-3 py-1.5">Passiva</td></tr></tbody>
            <Tabel groepen={jr.passiva} totaalLabel="Totaal passiva" totaal={jr.totaalPassiva} vorig={jr.totaalPassivaVorig} />
          </table></div>
          {Math.abs(jr.totaalActiva - jr.totaalPassiva) > 0.005 && <p className="mt-2 text-xs text-danger">De balans sluit niet: {euro(jr.totaalActiva - jr.totaalPassiva)} verschil.</p>}
        </section>

        <section className="min-w-0">
          <h2 className="mb-2 text-lg font-semibold">Winst-en-verliesrekening</h2>
          <div className="tabel-omhulsel"><table className="w-full text-sm">
            <Kop />
            <tbody>
              {jr.wv.filter((g) => g.rubriek !== "belastingen" && g.rubriek !== "financiele_baten_lasten").map((g) => <GroepRijen key={g.rubriek} g={g} jaar={jaar} />)}
              <tr className="font-medium"><td className="px-3 py-1.5">Som der bedrijfskosten</td><td className="cijfers px-3 py-1.5 text-right">{euro(jr.somKosten)}</td><td className="cijfers px-3 py-1.5 text-right text-muted">{euro(jr.somKostenVorig)}</td></tr>
              <tr className="font-semibold"><td className="px-3 py-1.5">Bedrijfsresultaat</td><td className="cijfers px-3 py-1.5 text-right">{euro(jr.bedrijfsresultaat)}</td><td className="cijfers px-3 py-1.5 text-right text-muted">{euro(jr.bedrijfsresultaatVorig)}</td></tr>
              <tr><td className="px-3 py-1.5">Financiële baten en lasten</td><td className="cijfers px-3 py-1.5 text-right">{euro(jr.financieel)}</td><td className="cijfers px-3 py-1.5 text-right text-muted">{euro(jr.financieelVorig)}</td></tr>
              <tr className="font-semibold"><td className="px-3 py-1.5">Resultaat vóór belastingen</td><td className="cijfers px-3 py-1.5 text-right">{euro(jr.resultaatVoor)}</td><td className="cijfers px-3 py-1.5 text-right text-muted">{euro(jr.resultaatVoorVorig)}</td></tr>
              <tr><td className="px-3 py-1.5">Belastingen</td><td className="cijfers px-3 py-1.5 text-right">{euro(-jr.belastingen)}</td><td className="cijfers px-3 py-1.5 text-right text-muted">{euro(-jr.belastingenVorig)}</td></tr>
              <tr className="bg-surface-2 font-semibold"><td className="px-3 py-2">Resultaat na belastingen</td><td className="cijfers px-3 py-2 text-right">{euro(jr.resultaatNa)}</td><td className="cijfers px-3 py-2 text-right text-muted">{euro(jr.resultaatNaVorig)}</td></tr>
            </tbody>
          </table></div>
        </section>
      </div>

      <section className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="kaart min-w-0 p-4">
          <h2 className="text-lg font-semibold">Vennootschapsbelasting {jaar}</h2>
          {!par?.gecontroleerd && <p className="mt-1 rounded border border-warn bg-warn-bg px-2 py-1 text-xs">Tarieven {jaar} nog niet gecontroleerd tegen de Belastingdienst; zie rechts.</p>}
          <table className="mt-3 w-full text-sm">
            <tbody>
              <tr><td className="py-1">Resultaat vóór belastingen</td><td className="cijfers py-1 text-right">{euro(vpb.resultaat)}</td></tr>
              <tr><td className="py-1">Bij: niet-aftrekbare kosten en overige correcties</td><td className="cijfers py-1 text-right">{euro(vpb.correcties)}</td></tr>
              <tr><td className="py-1">Af: verrekend verlies uit eerdere jaren</td><td className="cijfers py-1 text-right">{euro(-vpb.verlies)}</td></tr>
              <tr className="border-t border-line font-medium"><td className="py-1">Belastbaar bedrag</td><td className="cijfers py-1 text-right">{euro(vpb.belastbaar)}</td></tr>
              <tr><td className="py-1 text-muted">{getal(vpb.tariefLaag, 1)}% over {euro(vpb.laagBedrag)}</td><td className="cijfers py-1 text-right">{euro(Math.floor(vpb.laagBedrag * vpb.tariefLaag / 100))}</td></tr>
              {vpb.hoogBedrag > 0 && <tr><td className="py-1 text-muted">{getal(vpb.tariefHoog, 1)}% over {euro(vpb.hoogBedrag)}</td><td className="cijfers py-1 text-right">{euro(Math.floor(vpb.hoogBedrag * vpb.tariefHoog / 100))}</td></tr>}
              <tr className="border-t-2 border-line-2 font-semibold"><td className="py-1.5">Verschuldigde vennootschapsbelasting</td><td className="cijfers py-1.5 text-right">{euro(vpb.vpb)}</td></tr>
            </tbody>
          </table>
          <form action={boekjaarOpslaan} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <input type="hidden" name="jaar" value={jaar} />
            <label className="flex flex-col gap-1"><span className="label">Correcties</span><input name="vpbCorrecties" inputMode="decimal" defaultValue={String(bj.vpbCorrecties).replace(".", ",")} className="veld cijfers min-h-9 w-32 py-1 text-sm" /></label>
            <label className="flex flex-col gap-1"><span className="label">Verlies verrekend</span><input name="vpbVerlies" inputMode="decimal" defaultValue={String(bj.vpbVerliesVerrekend).replace(".", ",")} className="veld cijfers min-h-9 w-32 py-1 text-sm" /></label>
            <label className="flex flex-col gap-1"><span className="label">Gem. werknemers</span><input name="gemiddeldWerknemers" inputMode="decimal" defaultValue={bj.gemiddeldWerknemers === null ? "" : String(bj.gemiddeldWerknemers).replace(".", ",")} className="veld cijfers min-h-9 w-24 py-1 text-sm" /></label>
            <label className="flex min-w-48 flex-1 flex-col gap-1"><span className="label">Toelichting in de jaarrekening</span><input name="toelichting" defaultValue={bj.toelichting ?? ""} maxLength={600} className="veld min-h-9 py-1 text-sm" /></label>
            <button type="submit" className="knop knop-stil knop-klein">Opslaan</button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <form action={vpbReserveren}>
              <input type="hidden" name="jaar" value={jaar} />
              <button type="submit" className={`knop ${gereserveerd && !afwijkend ? "knop-stil" : "knop-primair"}`}>{gereserveerd ? "Opnieuw reserveren" : "Reserveer op 31-12"}</button>
            </form>
            <span className="text-xs text-muted">
              {gereserveerd ? <>Gereserveerd: <span className="cijfers">{euro(bj.vpbBedrag ?? 0)}</span>{afwijkend ? <span className="text-warn"> · wijkt af van de berekening, reserveer opnieuw</span> : null}</> : "Boekt de kosten en de schuld op 31 december; daarna telt hij mee in het resultaat na belasting."}
            </span>
            {gereserveerd && (bj.vpbBedrag ?? 0) > 0 && !bj.vpbBetaaldOp && (
              <form action={vpbBetalen} className="ml-auto flex items-center gap-1">
                <input type="hidden" name="jaar" value={jaar} />
                <input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-36 py-1 text-sm" />
                <select name="via" defaultValue={inst.rekeningBank ?? ""} className="veld min-h-9 py-1 text-sm">{betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{g.naam}</option>)}</select>
                <button type="submit" className="knop knop-stil knop-klein">Betaald</button>
              </form>
            )}
            {bj.vpbBetaaldOp && <span className="ml-auto text-xs text-accent-ink">betaald {korteDatum(bj.vpbBetaaldOp)} {bj.vpbBetaaldOp.slice(0, 4)}</span>}
          </div>
          <p className="mt-3 text-xs text-muted">Aangifte doen via Mijn Belastingdienst Zakelijk met deze bedragen: belastbare winst {euro(vpb.belastbaar)}, te betalen {euro(vpb.vpb)}. Gemengde kosten (representatie, eten en drinken) zijn voor 0,4% van de loonsom met een minimum van € 5.600 niet aftrekbaar, of voor 26,5% van die kosten; zet dat bij de correcties.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <form action={vpbParametersOpslaan} className="kaart flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">Tarieven vennootschapsbelasting {jaar}</h2>
            <input type="hidden" name="jaar" value={jaar} />
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1"><span className="label">Grens</span><input name="grens" inputMode="decimal" defaultValue={String(par?.grens ?? 200000)} className="veld cijfers min-h-9 py-1 text-sm" /></label>
              <label className="flex flex-col gap-1"><span className="label">Laag %</span><input name="tariefLaag" inputMode="decimal" defaultValue={String(par?.tariefLaag ?? 19).replace(".", ",")} className="veld cijfers min-h-9 py-1 text-sm" /></label>
              <label className="flex flex-col gap-1"><span className="label">Hoog %</span><input name="tariefHoog" inputMode="decimal" defaultValue={String(par?.tariefHoog ?? 25.8).replace(".", ",")} className="veld cijfers min-h-9 py-1 text-sm" /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gecontroleerd" value="aan" defaultChecked={par?.gecontroleerd} className="size-5 accent-[var(--accent)]" />Gecontroleerd tegen de Belastingdienst</label>
            <button type="submit" className="knop knop-stil self-start">Opslaan</button>
          </form>

          <div className="kaart flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">Stappen</h2>
            <Stap stap="opgemaakt" label="Jaarrekening opgemaakt door bestuur" datum={bj.opgemaaktOp} />
            <Stap stap="vastgesteld" label="Vastgesteld door de aandeelhouders" datum={bj.vastgesteldOp} />
            <Stap stap="gedeponeerd" label="Gedeponeerd bij de KvK" datum={bj.gedeponeerdOp} />
            <Stap stap="vpbAangifte" label="Aangifte vennootschapsbelasting ingediend" datum={bj.vpbAangifteIngediendOp} />
            <p className="text-xs text-muted">Opmaken binnen vijf maanden na het boekjaar (verlengbaar met vijf), deponeren binnen acht dagen na vaststelling en uiterlijk twaalf maanden na het boekjaar. Aangifte vpb vóór 1 juni, of later met uitstel.</p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Deponeren bij de KvK</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">Een micro-onderneming (balanstotaal onder € 450.000, omzet onder € 900.000, minder dan tien werknemers) deponeert alleen een beperkte balans. Dit zijn de velden van de KvK-dienst <em>Zelf deponeren jaarrekening</em>; de PDF is voor je eigen dossier en de aandeelhoudersvergadering.</p>
        <div className="tabel-omhulsel max-w-2xl"><table className="w-full text-sm"><tbody>
          {jr.kvk.map((v) => (
            <tr key={v.naam} className={`border-b border-line last:border-0 ${v.naam.startsWith("Totaal") ? "bg-surface-2 font-semibold" : ""}`}><td className="px-3 py-1.5">{v.naam}</td><td className="cijfers px-3 py-1.5 text-right">{euro(v.waarde)}</td></tr>
          ))}
        </tbody></table></div>
      </section>
    </div>
  );
}

function GroepRijen({ g, jaar }: { g: Groep; jaar: number }) {
  const qs = `?van=${jaar}-01-01&tot=${jaar}-12-31`;
  return (
    <>
      <tr><td colSpan={3} className="px-3 pt-2 pb-0.5 text-xs font-semibold text-muted">{g.naam}</td></tr>
      {g.posten.map((p) => (
        <tr key={`${g.rubriek}-${p.grootboekId ?? p.naam}`} className="border-b border-line">
          <td className="px-3 py-1 pl-6">{p.grootboekId ? <Link href={`/boekhouding/rekening/${p.grootboekId}${qs}`} className="hover:underline">{p.naam}</Link> : p.naam}</td>
          <td className="cijfers px-3 py-1 text-right">{euro(p.bedrag)}</td>
          <td className="cijfers px-3 py-1 text-right text-muted">{euro(p.vorig)}</td>
        </tr>
      ))}
      <tr className="font-medium"><td className="px-3 py-1">Totaal {g.naam.toLowerCase()}</td><td className="cijfers px-3 py-1 text-right">{euro(g.totaal)}</td><td className="cijfers px-3 py-1 text-right text-muted">{euro(g.vorig)}</td></tr>
    </>
  );
}
