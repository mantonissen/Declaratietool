import Link from "next/link";
import { notFound } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { korteDatum } from "@/lib/datum";
import { gesprek, SOORT_LABEL, type GesprekSoort } from "@/lib/verkoop";
import { gesprekBijwerken, gesprekWeg } from "../../acties";

export const dynamic = "force-dynamic";

export default async function GesprekPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  const { id } = await params;
  const g = await gesprek(sessie, id);
  if (!g) notFound();
  const terug = g.prospectId && magBeheren(sessie.rechten) ? `/verkoop/${g.prospectId}` : g.klantId && magBeheren(sessie.rechten) ? `/beheer/klant/${g.klantId}` : "/ritten";
  const lokaal = new Date(new Date(g.datum).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const afspraken = (g.afspraken ?? "").split("\n").map((r) => r.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const magBewerken = magBeheren(sessie.rechten) || g.medewerkerId === sessie.medewerkerId;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href={terug} className="knop knop-kaal -ml-2">← {g.prospect ?? g.klant ?? "Terug"}</Link>
      <p className="label mt-2">Gesprek · {SOORT_LABEL[g.soort]}{g.live ? " · meegeschreven" : ""}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{g.titel}</h1>
      <p className="mt-1 text-sm text-muted">{korteDatum(g.datum.slice(0, 10))} {g.datum.slice(0, 4)} · {g.medewerker}{g.duurMinuten ? ` · ${g.duurMinuten} minuten` : ""} · met {g.prospect ?? g.klant}</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="min-w-0">
          <h2 className="mb-2 text-lg font-semibold">Transcript</h2>
          <div className="kaart max-h-[32rem] overflow-y-auto px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">{g.transcript || <span className="text-muted">Geen transcript.</span>}</div>
        </section>
        <section className="flex min-w-0 flex-col gap-5">
          <div><h2 className="mb-2 text-lg font-semibold">Samenvatting</h2><div className="kaart px-4 py-3 text-sm whitespace-pre-wrap">{g.samenvatting || <span className="text-muted">Nog geen samenvatting.</span>}</div></div>
          <div>
            <h2 className="mb-2 text-lg font-semibold">Afspraken</h2>
            {afspraken.length ? <ul className="kaart divide-y divide-line text-sm">{afspraken.map((a, i) => <li key={i} className="flex gap-2 px-4 py-2"><span className="text-accent-ink">▸</span>{a}</li>)}</ul> : <p className="kaart px-4 py-3 text-sm text-muted">Geen afspraken genoteerd.</p>}
          </div>
        </section>
      </div>

      {magBewerken && (
        <details className="kaart mt-8">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Bewerken</summary>
          <form action={gesprekBijwerken} className="flex flex-col gap-4 border-t border-line p-4">
            <input type="hidden" name="id" value={g.id} />
            {g.prospectId && <input type="hidden" name="prospectId" value={g.prospectId} />}
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1"><span className="label">Titel</span><input name="titel" required defaultValue={g.titel} className="veld" /></label>
              <label className="flex flex-col gap-1"><span className="label">Soort</span><select key={g.soort} name="soort" defaultValue={g.soort} className="veld">{(Object.keys(SOORT_LABEL) as GesprekSoort[]).map((s) => <option key={s} value={s}>{SOORT_LABEL[s]}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="label">Wanneer</span><input type="datetime-local" name="datum" defaultValue={lokaal} className="veld" /></label>
              <label className="flex flex-col gap-1"><span className="label">Duur in minuten</span><input name="duurMinuten" inputMode="numeric" defaultValue={g.duurMinuten ?? ""} className="veld cijfers" /></label>
              <input type="hidden" name="taal" value={g.taal} />
            </div>
            <label className="flex flex-col gap-1"><span className="label">Transcript</span><textarea name="transcript" rows={12} defaultValue={g.transcript ?? ""} className="veld min-h-48 py-2 text-sm leading-relaxed" /></label>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="label">Samenvatting</span><textarea name="samenvatting" rows={5} defaultValue={g.samenvatting ?? ""} className="veld min-h-28 py-2" /></label>
              <label className="flex flex-col gap-1"><span className="label">Afspraken, één per regel</span><textarea name="afspraken" rows={5} defaultValue={g.afspraken ?? ""} className="veld min-h-28 py-2" /></label>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="knop knop-primair">Opslaan</button>
              <button type="submit" formAction={gesprekWeg} name="terug" value={terug} className="ml-auto knop knop-kaal knop-klein text-danger">Verwijderen</button>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
