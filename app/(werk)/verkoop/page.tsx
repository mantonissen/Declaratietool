import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { prospects, pipeline, onderwerpen, OPEN_FASEN, FASE_LABEL, BRONNEN, type Prospect } from "@/lib/verkoop";
import { prospectErbij } from "./acties";

export const dynamic = "force-dynamic";

export default async function VerkoopPagina({ searchParams }: { searchParams: Promise<{ onderwerp?: string }> }) {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const p = await searchParams;
  const filter = p.onderwerp && /^[0-9a-f-]{36}$/.test(p.onderwerp) ? p.onderwerp : null;
  const [lijst, pijp, ows, medewerkers] = await Promise.all([
    prospects(sessie, filter), pipeline(sessie), onderwerpen(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select id, naam from medewerker where actief and rechten <> 'medewerker' order by naam`),
  ]);
  const nu = vandaag();
  const open = lijst.filter((x) => OPEN_FASEN.includes(x.fase));
  const gesloten = lijst.filter((x) => !OPEN_FASEN.includes(x.fase));
  const perFase = (f: string) => pijp.find((x) => x.fase === f);
  const openWaarde = OPEN_FASEN.reduce((s, f) => s + (perFase(f)?.waarde ?? 0), 0);
  const gewogen = OPEN_FASEN.reduce((s, f) => s + (perFase(f)?.gewogen ?? 0), 0);
  const achterstallig = open.filter((x) => x.volgendeActieOp && x.volgendeActieOp < nu).length;

  const Kaart = ({ x }: { x: Prospect }) => {
    const teLaat = !!x.volgendeActieOp && x.volgendeActieOp < nu;
    return (
      <li className="kaart p-3 text-sm">
        <Link href={`/verkoop/${x.id}`} className="block font-semibold text-accent-ink hover:underline">{x.naam}</Link>
        <p className="text-xs text-muted">{[x.contactpersoon, x.plaats].filter(Boolean).join(" · ") || "—"}</p>
        <p className="cijfers mt-1.5 flex items-baseline justify-between gap-2">
          <span className="font-semibold">{x.waarde === null ? "—" : euro(x.waarde)}</span>
          <span className="text-xs text-muted">{x.kans}%{x.verwachtOp ? ` · ${korteDatum(x.verwachtOp)}` : ""}</span>
        </p>
        {x.volgendeActie && (
          <p className={`mt-1.5 text-xs ${teLaat ? "text-warn" : "text-ink-2"}`}>
            <span className="label mr-1">{teLaat ? "te laat" : "actie"}</span>{x.volgendeActie}{x.volgendeActieOp ? ` · ${korteDatum(x.volgendeActieOp)}` : ""}
          </p>
        )}
        {x.onderwerpen.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1">{x.onderwerpen.map((o) => <span key={o.id} className="label rounded bg-surface-2 px-1.5 py-0.5 normal-case tracking-normal">{o.naam}</span>)}</p>
        )}
        <p className="mt-1.5 text-xs text-muted">{x.eigenaar ?? "geen eigenaar"}{x.gesprekken ? ` · ${x.gesprekken} ${x.gesprekken === 1 ? "gesprek" : "gesprekken"}` : ""}</p>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Verkoop</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Prospects van lead tot offerte. Gewonnen wordt een klant, verloren blijft leerzaam. Per prospect de onderwerpen die spelen en de gesprekken die je voerde.</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href="/verkoop/onderwerpen" className="knop knop-stil">Onderwerpen</Link>
          <Link href="/verkoop/gesprek/nieuw" className="knop knop-stil">Gesprek meeschrijven</Link>
        </nav>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {[
          { t: "Open", v: euro(openWaarde), s: `${open.length} prospects` },
          { t: "Gewogen", v: euro(gewogen), s: "waarde × kans" },
          { t: `Gewonnen ${nu.slice(0, 4)}`, v: euro(perFase("gewonnen")?.waarde ?? 0), s: `${perFase("gewonnen")?.aantal ?? 0} opdrachten` },
          { t: "Acties te laat", v: String(achterstallig), s: achterstallig ? "volgende actie is verlopen" : "alles op tijd", w: achterstallig > 0 },
        ].map((x) => (
          <div key={x.t} className="bg-surface px-4 py-3"><dt className="label">{x.t}</dt><dd className={`cijfers mt-0.5 text-lg font-semibold ${x.w ? "text-warn" : ""}`}>{x.v}</dd><dd className="text-xs text-muted">{x.s}</dd></div>
        ))}
      </dl>

      <form action="/verkoop" method="get" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="label">Onderwerp</label>
        <select name="onderwerp" defaultValue={filter ?? ""} className="veld min-h-9 w-56 py-1 text-sm">
          <option value="">alle</option>
          {ows.map((o) => <option key={o.id} value={o.id}>{o.naam} ({o.prospects.length})</option>)}
        </select>
        <button type="submit" className="knop knop-stil knop-klein">Toon</button>
        {filter && <Link href="/verkoop" className="text-xs text-muted hover:underline">wis filter</Link>}
      </form>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {OPEN_FASEN.map((f) => {
          const kol = open.filter((x) => x.fase === f);
          const st = perFase(f);
          return (
            <section key={f} className="min-w-0">
              <header className="mb-2 flex items-baseline justify-between border-b-2 border-line pb-1">
                <h2 className="text-sm font-semibold">{FASE_LABEL[f]} <span className="cijfers ml-1 text-xs font-normal text-muted">{kol.length}</span></h2>
                <span className="cijfers text-xs text-muted">{euro(st?.waarde ?? 0)}</span>
              </header>
              <ul className="flex flex-col gap-2">
                {kol.map((x) => <Kaart key={x.id} x={x} />)}
                {kol.length === 0 && <li className="rounded border border-dashed border-line px-3 py-4 text-center text-xs text-muted">leeg</li>}
              </ul>
            </section>
          );
        })}
      </div>

      <form action={prospectErbij} className="kaart mt-8 flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Prospect toevoegen</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 lg:col-span-2"><span className="label">Organisatie</span><input name="naam" required maxLength={120} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Contactpersoon</span><input name="contactpersoon" maxLength={120} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Plaats</span><input name="plaats" maxLength={80} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">E-mail</span><input name="email" type="email" className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Telefoon</span><input name="telefoon" type="tel" className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Bron</span><select name="bron" defaultValue="netwerk" className="veld">{BRONNEN.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Fase</span><select name="fase" defaultValue="lead" className="veld">{OPEN_FASEN.map((f) => <option key={f} value={f}>{FASE_LABEL[f]}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Verwachte waarde excl. btw</span><input name="waarde" inputMode="decimal" className="veld cijfers" /></label>
          <label className="flex flex-col gap-1"><span className="label">Verwachte beslissing</span><input type="date" name="verwachtOp" className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Eigenaar</span><select name="eigenaarId" defaultValue={sessie.medewerkerId} className="veld">{medewerkers.map((m) => <option key={m.id as string} value={m.id as string}>{m.naam as string}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="label">Volgende actie</span><input name="volgendeActie" maxLength={160} className="veld" placeholder="Bijvoorbeeld: bellen over de uitvraag" /></label>
          <label className="flex flex-col gap-1"><span className="label">Op</span><input type="date" name="volgendeActieOp" className="veld" /></label>
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4"><span className="label">Notities</span><input name="notities" maxLength={600} className="veld" /></label>
        </div>
        <button type="submit" className="knop knop-primair self-start">Toevoegen</button>
      </form>

      {gesloten.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Gewonnen en verloren</h2>
          <div className="tabel-omhulsel"><table className="w-full text-sm">
            <thead><tr><th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Prospect</th><th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Uitkomst</th><th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Waarde</th><th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Gesloten</th></tr></thead>
            <tbody>
              {gesloten.map((x) => (
                <tr key={x.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2"><Link href={`/verkoop/${x.id}`} className="font-medium text-accent-ink hover:underline">{x.naam}</Link>{x.klantId && <Link href={`/beheer/klant/${x.klantId}`} className="ml-2 text-xs text-muted hover:underline">→ klant</Link>}</td>
                  <td className="px-3 py-2"><span className={`label rounded px-1.5 py-0.5 ${x.fase === "gewonnen" ? "bg-accent-bg text-accent-ink" : "bg-surface-2"}`}>{FASE_LABEL[x.fase]}</span>{x.verlorenReden && <span className="ml-2 text-xs text-muted">{x.verlorenReden}</span>}</td>
                  <td className="cijfers px-3 py-2 text-right">{x.waarde === null ? "—" : euro(x.waarde)}</td>
                  <td className="cijfers px-3 py-2 text-xs text-muted">{x.geslotenOp ? `${korteDatum(x.geslotenOp)} ${x.geslotenOp.slice(0, 4)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
