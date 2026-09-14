import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import {
  prospect, onderwerpen, gesprekken, relaties, OPEN_FASEN, FASE_LABEL, BRONNEN, ONDERWERP_STATUSSEN, STATUS_LABEL, SOORT_LABEL,
} from "@/lib/verkoop";
import { prospectOpslaan, faseZetten, prospectWeg, onderwerpKoppelen, onderwerpOntkoppelen } from "../acties";

export const dynamic = "force-dynamic";

const wanneer = (iso: string) => `${korteDatum(iso.slice(0, 10))} ${iso.slice(0, 4)}`;

export default async function ProspectPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const { id } = await params;
  const [x, ows, gesp, rel, medewerkers] = await Promise.all([
    prospect(sessie, id), onderwerpen(sessie), gesprekken(sessie, { prospectId: id }), relaties(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select id, naam from medewerker where actief and rechten <> 'medewerker' order by naam`),
  ]);
  if (!x) notFound();
  const nu = vandaag();
  const open = OPEN_FASEN.includes(x.fase);
  const beschikbaar = ows.filter((o) => o.actief && !x.onderwerpen.some((po) => po.id === o.id));
  const s = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/verkoop" className="knop knop-kaal -ml-2">← Verkoop</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Prospect · <span className={x.fase === "gewonnen" ? "text-accent-ink" : ""}>{FASE_LABEL[x.fase]}</span>{x.eigenaar ? ` · ${x.eigenaar}` : ""}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{x.naam}</h1>
          <p className="mt-1 text-sm text-muted">{[x.contactpersoon, x.email, x.telefoon, x.plaats].filter(Boolean).join(" · ") || "Nog geen contactgegevens"}</p>
        </div>
        <div className="text-right">
          <p className="label">Verwachte waarde</p>
          <p className="cijfers text-2xl font-semibold">{x.waarde === null ? "—" : euro(x.waarde)}</p>
          <p className="cijfers text-xs text-muted">kans {x.kans}%{x.verwachtOp ? ` · beslissing ${korteDatum(x.verwachtOp)}` : ""}</p>
        </div>
      </div>

      <div className="kaart mt-5 flex flex-wrap items-center gap-3 p-3">
        {open ? (
          <>
            <form action={faseZetten} className="flex items-center gap-2">
              <input type="hidden" name="id" value={x.id} />
              <select key={x.fase} name="fase" defaultValue={x.fase} className="veld min-h-10 py-1">{OPEN_FASEN.map((f) => <option key={f} value={f}>{FASE_LABEL[f]}</option>)}</select>
              <button type="submit" className="knop knop-stil">Naar fase</button>
            </form>
            <form action={faseZetten} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="fase" value="gewonnen" />
              <select name="klantId" defaultValue="" className="veld min-h-10 py-1 text-sm"><option value="">nieuwe klant aanmaken</option>{rel.klanten.map((k) => <option key={k.id} value={k.id}>bestaande klant: {k.naam}</option>)}</select>
              <button type="submit" className="knop knop-primair">Gewonnen</button>
            </form>
            <form action={faseZetten} className="ml-auto flex items-center gap-2">
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="fase" value="verloren" />
              <input name="reden" maxLength={200} placeholder="waarom verloren" className="veld min-h-10 w-48 py-1 text-sm" />
              <button type="submit" className="knop knop-kaal text-danger">Verloren</button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm">
              {x.fase === "gewonnen" ? <>Gewonnen{x.geslotenOp ? ` op ${korteDatum(x.geslotenOp)} ${x.geslotenOp.slice(0, 4)}` : ""}{x.klantId && <>, nu klant <Link href={`/beheer/klant/${x.klantId}`} className="text-accent-ink hover:underline">{x.klant}</Link></>}.</> : <>Verloren{x.geslotenOp ? ` op ${korteDatum(x.geslotenOp)} ${x.geslotenOp.slice(0, 4)}` : ""}{x.verlorenReden ? `: ${x.verlorenReden}` : ""}.</>}
            </p>
            <form action={faseZetten} className="ml-auto"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="fase" value="offerte" /><button type="submit" className="knop knop-kaal knop-klein">Heropen als offerte</button></form>
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="flex min-w-0 flex-col gap-6">
          <div>
            <div className="mb-2 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Gesprekken</h2><Link href={`/verkoop/gesprek/nieuw?prospect=${x.id}`} className="knop knop-primair knop-klein">Gesprek meeschrijven</Link></div>
            <ul className="kaart divide-y divide-line">
              {gesp.map((g) => (
                <li key={g.id} className="px-4 py-2.5 text-sm">
                  <Link href={`/verkoop/gesprek/${g.id}`} className="font-medium text-accent-ink hover:underline">{g.titel}</Link>
                  <span className="ml-2 text-xs text-muted">{wanneer(g.datum)} · {SOORT_LABEL[g.soort]}{g.duurMinuten ? ` · ${g.duurMinuten} min` : ""} · {g.medewerker}{g.live ? " · meegeschreven" : ""}</span>
                  {g.samenvatting && <p className="mt-0.5 text-xs text-ink-2">{g.samenvatting}</p>}
                </li>
              ))}
              {gesp.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nog geen gesprek vastgelegd.</li>}
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">Onderwerpen</h2>
            <ul className="kaart divide-y divide-line">
              {x.onderwerpen.map((o) => (
                <li key={o.id}>
                  <form action={onderwerpKoppelen} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <input type="hidden" name="prospectId" value={x.id} /><input type="hidden" name="onderwerpId" value={o.id} />
                    <span className="min-w-32 flex-1 font-medium">{o.naam}</span>
                    <select key={o.status} name="status" defaultValue={o.status} className="veld min-h-9 w-32 py-1 text-sm">{ONDERWERP_STATUSSEN.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select>
                    <input name="notitie" defaultValue={o.notitie ?? ""} maxLength={160} placeholder="notitie" className="veld min-h-9 w-44 py-1 text-sm" />
                    <button type="submit" className="knop knop-stil knop-klein">Opslaan</button>
                    <button type="submit" formAction={onderwerpOntkoppelen} className="knop knop-kaal knop-klein text-danger">×</button>
                  </form>
                </li>
              ))}
              {x.onderwerpen.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nog geen onderwerpen gekoppeld.</li>}
            </ul>
            {beschikbaar.length > 0 && (
              <form action={onderwerpKoppelen} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="prospectId" value={x.id} />
                <select name="onderwerpId" defaultValue="" required className="veld min-h-9 w-56 py-1 text-sm"><option value="" disabled>Onderwerp…</option>{beschikbaar.map((o) => <option key={o.id} value={o.id}>{o.naam}</option>)}</select>
                <select name="status" defaultValue="interesse" className="veld min-h-9 w-32 py-1 text-sm">{ONDERWERP_STATUSSEN.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</select>
                <button type="submit" className="knop knop-stil knop-klein">Koppelen</button>
                <Link href="/verkoop/onderwerpen" className="text-xs text-muted hover:underline">catalogus</Link>
              </form>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">Verloop</h2>
            <ol className="kaart divide-y divide-line text-sm">
              {x.log.map((l, i) => (
                <li key={i} className="flex items-baseline gap-3 px-4 py-2"><span className="cijfers w-40 shrink-0 text-xs text-muted">{wanneer(l.op)}</span><span>{l.van ? `${FASE_LABEL[l.van]} → ` : "Aangemaakt als "}<b>{FASE_LABEL[l.naar]}</b>{l.door ? <span className="text-muted"> · {l.door}</span> : null}</span></li>
              ))}
            </ol>
          </div>
        </section>

        <form action={prospectOpslaan} className="kaart flex min-w-0 flex-col gap-3 p-4">
          <input type="hidden" name="id" value={x.id} />
          <h2 className="text-lg font-semibold">Gegevens</h2>
          <label className="flex flex-col gap-1"><span className="label">Organisatie</span><input name="naam" required defaultValue={x.naam} className="veld" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="label">Contactpersoon</span><input name="contactpersoon" defaultValue={x.contactpersoon ?? ""} className="veld" /></label>
            <label className="flex flex-col gap-1"><span className="label">Plaats</span><input name="plaats" defaultValue={x.plaats ?? ""} className="veld" /></label>
            <label className="flex flex-col gap-1"><span className="label">E-mail</span><input name="email" type="email" defaultValue={x.email ?? ""} className="veld" /></label>
            <label className="flex flex-col gap-1"><span className="label">Telefoon</span><input name="telefoon" defaultValue={x.telefoon ?? ""} className="veld cijfers" /></label>
            <label className="flex flex-col gap-1"><span className="label">Bron</span><select key={x.bron ?? ""} name="bron" defaultValue={x.bron ?? "netwerk"} className="veld">{[...new Set([...BRONNEN, ...(x.bron ? [x.bron] : [])])].map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="label">Eigenaar</span><select key={x.eigenaarId ?? ""} name="eigenaarId" defaultValue={x.eigenaarId ?? ""} className="veld"><option value="">—</option>{medewerkers.map((m) => <option key={m.id as string} value={m.id as string}>{m.naam as string}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="label">Waarde excl. btw</span><input name="waarde" inputMode="decimal" defaultValue={s(x.waarde)} className="veld cijfers" /></label>
            <label className="flex flex-col gap-1"><span className="label">Kans %</span><input key={x.kans} name="kans" inputMode="numeric" defaultValue={String(x.kans)} className="veld cijfers" /></label>
            <label className="flex flex-col gap-1"><span className="label">Verwachte beslissing</span><input type="date" name="verwachtOp" defaultValue={x.verwachtOp ?? ""} className="veld" /></label>
            <label className="flex flex-col gap-1"><span className="label">Fase</span><select key={x.fase} name="fase" defaultValue={x.fase} className="veld">{[...OPEN_FASEN, "gewonnen", "verloren"].map((f) => <option key={f} value={f}>{FASE_LABEL[f as keyof typeof FASE_LABEL]}</option>)}</select></label>
          </div>
          <label className="flex flex-col gap-1"><span className="label">Volgende actie</span><input name="volgendeActie" defaultValue={x.volgendeActie ?? ""} maxLength={160} className={`veld ${x.volgendeActieOp && x.volgendeActieOp < nu ? "border-warn" : ""}`} /></label>
          <label className="flex flex-col gap-1"><span className="label">Op</span><input type="date" name="volgendeActieOp" defaultValue={x.volgendeActieOp ?? ""} className="veld" /></label>
          <label className="flex flex-col gap-1"><span className="label">Notities</span><textarea name="notities" rows={4} defaultValue={x.notities ?? ""} className="veld min-h-20 py-2" /></label>
          <div className="flex items-center gap-3">
            <button type="submit" className="knop knop-primair">Opslaan</button>
            {sessie.rechten === "eigenaar" && <button type="submit" formAction={prospectWeg} className="ml-auto knop knop-kaal knop-klein text-danger">Verwijderen</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
