import Link from "next/link";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { relaties, SOORT_LABEL, type GesprekSoort } from "@/lib/verkoop";
import { Transcriber } from "@/components/Transcriber";
import { gesprekOpslaan } from "../../acties";

export const dynamic = "force-dynamic";

export default async function NieuwGesprekPagina({ searchParams }: { searchParams: Promise<{ prospect?: string; klant?: string }> }) {
  const sessie = await vereisteSessie();
  const p = await searchParams;
  const rel = await relaties(sessie);
  const pl = magBeheren(sessie.rechten);
  const prospect = pl ? rel.prospects.find((x) => x.id === p.prospect) ?? null : null;
  const klant = rel.klanten.find((x) => x.id === p.klant) ?? null;
  const vast = prospect ?? klant;
  const nuLokaal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const terug = prospect ? `/verkoop/${prospect.id}` : klant ? `/beheer/klant/${klant.id}` : pl ? "/verkoop" : "/ritten";

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href={terug} className="knop knop-kaal -ml-2">← {vast ? vast.naam : "Terug"}</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Gesprek meeschrijven</h1>
      <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">
        Druk op de knop en praat: de browser schrijft mee. Na afloop vat je samen, noteer je de afspraken en sla je op bij de prospect of klant.
      </p>

      <form action={gesprekOpslaan} className="flex flex-col gap-5">
        <div className="kaart grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {vast ? (
            <>
              <input type="hidden" name={prospect ? "prospectId" : "klantId"} value={vast.id} />
              <p className="flex flex-col gap-1 lg:col-span-2"><span className="label">{prospect ? "Prospect" : "Klant"}</span><span className="text-sm font-semibold">{vast.naam}</span></p>
            </>
          ) : (
            <>
              {pl && (
                <label className="flex flex-col gap-1"><span className="label">Prospect</span>
                  <select name="prospectId" defaultValue="" className="veld"><option value="">—</option>{rel.prospects.map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}</select>
                </label>
              )}
              <label className="flex flex-col gap-1"><span className="label">{pl ? "of klant" : "Klant"}</span>
                <select name="klantId" defaultValue="" className="veld"><option value="">—</option>{rel.klanten.map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}</select>
              </label>
            </>
          )}
          <label className="flex flex-col gap-1"><span className="label">Titel</span><input name="titel" required maxLength={120} className="veld" placeholder="Bijvoorbeeld: kennismaking" /></label>
          <label className="flex flex-col gap-1"><span className="label">Soort</span>
            <select name="soort" defaultValue="telefoon" className="veld">{(Object.keys(SOORT_LABEL) as GesprekSoort[]).map((s) => <option key={s} value={s}>{SOORT_LABEL[s]}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Wanneer</span><input type="datetime-local" name="datum" defaultValue={nuLokaal} className="veld" /></label>
        </div>

        <section className="kaart p-4">
          <h2 className="mb-3 text-base font-semibold">Transcript</h2>
          <Transcriber />
        </section>

        <div className="kaart grid gap-4 p-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="label">Samenvatting</span><textarea name="samenvatting" rows={5} className="veld min-h-28 py-2" placeholder="Waar ging het over, wat wil de ander, wat is de stand." /></label>
          <label className="flex flex-col gap-1"><span className="label">Afspraken en actiepunten</span><textarea name="afspraken" rows={5} className="veld min-h-28 py-2" placeholder="Eén per regel. Bijvoorbeeld: offerte sturen vóór vrijdag" /></label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="knop knop-primair">Gesprek opslaan</button>
          <span className="text-xs text-muted">Het transcript staat alleen in deze administratie.</span>
        </div>
      </form>
    </div>
  );
}
