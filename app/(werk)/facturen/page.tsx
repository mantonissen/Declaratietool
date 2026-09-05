import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { teFactureren, facturen, specificatie, verwerkPeriodiek, volgendNummerSuggestie } from "@/lib/facturatie";
import { euro, getal, isGeldigeDatum, korteDatum, minutenAlsTijd, vandaag } from "@/lib/datum";
import { conceptVanVoorstel, losseFactuur, termijnToevoegen, verwerktInBoekhouding } from "./acties";

export const dynamic = "force-dynamic";

const MODEL_LABEL: Record<string, string> = { vaste_prijs: "vaste prijs", abonnement: "abonnement" };
const STATUS_LABEL: Record<string, string> = {
  concept: "Concept", definitief: "Open", betaald: "Betaald", gecrediteerd: "Gecrediteerd",
};

export default async function FacturenPagina({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; van?: string; tot?: string; toon?: string }>;
}) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const p = await searchParams;

  // Abonnementen bijwerken vóór we lezen: wat vandaag verschuldigd is, staat er dan.
  const zojuist = await verwerkPeriodiek(sessie);
  const [open, lijst, suggestie, klanten] = await Promise.all([
    teFactureren(sessie), facturen(sessie), volgendNummerSuggestie(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select id, naam from klant where actief order by naam`),
  ]);

  const concepten = lijst.filter((f) => f.status === "concept");
  const teVerwerken = lijst.filter((f) => f.automatisch && !f.verwerktOp && f.status !== "concept");
  const openstaand = lijst.filter((f) => f.status === "definitief");
  const openBedrag = openstaand.reduce((s, f) => s + f.totaal, 0);
  const vervallen = openstaand.filter((f) => f.vervallen);
  const alles = p.toon === "alles";
  const historie = lijst.filter((f) => f.status !== "concept").slice(0, alles ? undefined : 25);

  const gekozen = open.find((o) => o.projectId === p.project) ?? null;
  const projectId = gekozen?.projectId ?? null;
  const van = isGeldigeDatum(p.van) ? p.van : (gekozen?.van ?? vandaag().slice(0, 8) + "01");
  const tot = isGeldigeDatum(p.tot) ? p.tot : (gekozen?.tot ?? vandaag());
  const voorstel = projectId ? await specificatie(sessie, { projectId, van, tot }) : null;
  const huidigeUrl = `/facturen?project=${projectId}&van=${van}&tot=${tot}`;
  const maand = vandaag().slice(0, 8) + "01";

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Facturen</h1>
      <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">
        Van goedgekeurde uren, termijnen of een abonnement naar een factuur met btw en
        grootboekrekening per regel. Een concept kun je nog bewerken; definitief krijgt het
        een nummer uit de reeks (volgende: <span className="cijfers">{suggestie}</span>) en ligt vast.
      </p>

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {[
          { t: "Openstaand", v: euro(openBedrag), s: `${openstaand.length} ${openstaand.length === 1 ? "factuur" : "facturen"}` },
          { t: "Vervallen", v: vervallen.length ? euro(vervallen.reduce((s, f) => s + f.totaal, 0)) : "—", s: vervallen.length ? `${vervallen.length} over de vervaldatum` : "niets", w: vervallen.length > 0 },
          { t: "Concepten", v: String(concepten.length), s: "nog te versturen" },
          { t: "Te verwerken", v: String(teVerwerken.length), s: "automatisch, nog niet in de boekhouding", w: teVerwerken.length > 0 },
        ].map((x) => (
          <div key={x.t} className="bg-surface px-4 py-3">
            <dt className="label">{x.t}</dt>
            <dd className={`cijfers mt-0.5 text-lg font-semibold ${x.w ? "text-warn" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-muted">{x.s}</dd>
          </div>
        ))}
      </dl>

      {zojuist.length > 0 && (
        <p className="mb-4 rounded border border-accent bg-accent-bg px-3 py-2 text-sm">
          Zojuist {zojuist.length} {zojuist.length === 1 ? "abonnementsfactuur" : "abonnementsfacturen"} aangemaakt.
        </p>
      )}

      {concepten.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Concepten</h2>
          <ul className="flex flex-col gap-2">
            {concepten.map((f) => (
              <li key={f.id} className="kaart border-dashed">
                <Link href={`/facturen/${f.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{f.klant}{f.project ? <span className="font-normal text-muted"> · {f.project}</span> : ""}</p>
                    <p className="text-xs text-muted">{f.regels} {f.regels === 1 ? "regel" : "regels"}{f.periodeVan ? ` · ${korteDatum(f.periodeVan)} — ${korteDatum(f.periodeTot!)}` : ""}</p>
                  </div>
                  <p className="cijfers text-sm font-semibold">{euro(f.totaal)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {teVerwerken.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Automatisch aangemaakt <span className="cijfers ml-2 rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">{teVerwerken.length} nog te verwerken</span></h2>
          <p className="mb-3 text-sm text-muted">Abonnementsfacturen met een nummer uit de reeks. Verstuur ze, neem ze over in je boekhouding en vink ze dan af.</p>
          <div className="tabel-omhulsel">
            <table className="w-full text-sm"><tbody>
              {teVerwerken.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2"><Link href={`/facturen/${f.id}`} className="cijfers font-medium text-accent-ink hover:underline">{f.nummer}</Link></td>
                  <td className="px-4 py-2"><span className="block">{f.project}</span><span className="block text-xs text-muted">{f.klant} · {korteDatum(f.datum!)}</span></td>
                  <td className="cijfers px-4 py-2 text-right font-semibold whitespace-nowrap">{euro(f.totaal)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <a href={`/api/factuur?id=${f.id}`} className="knop knop-kaal knop-klein">PDF</a>
                    <form action={verwerktInBoekhouding} className="inline"><input type="hidden" name="factuurId" value={f.id} /><button type="submit" className="knop knop-stil knop-klein ml-2">Verwerkt</button></form>
                  </td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Te factureren</h2>
      {open.length ? (
        <ul className="mb-6 flex flex-col gap-2">
          {open.map((o) => (
            <li key={o.projectId} className={`kaart ${o.projectId === projectId ? "border-accent" : ""}`}>
              <Link href={`/facturen?project=${o.projectId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {o.project}
                    {o.facturatiemodel !== "nacalculatie" && <span className="label ml-2 rounded bg-accent-bg px-1.5 py-0.5 text-accent-ink">{MODEL_LABEL[o.facturatiemodel]}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {o.klant}
                    {o.regels > 0 && ` · ${o.regels} ${o.regels === 1 ? "regel" : "regels"} · ${korteDatum(o.van!)} — ${korteDatum(o.tot!)}`}
                    {o.termijnenOpen > 0 && ` · ${o.termijnenOpen} ${o.termijnenOpen === 1 ? "termijn" : "termijnen"} open`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="cijfers text-sm font-semibold">{o.facturatiemodel !== "nacalculatie" ? euro(o.termijnBedrag ?? 0) : euro(o.omzet)}</p>
                  <p className="cijfers text-xs text-muted">{minutenAlsTijd(o.minuten)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">Niets goedgekeurds dat nog niet gefactureerd is, en geen open termijnen.</p>
      )}

      {voorstel && voorstel.klant && voorstel.project && gekozen && (() => {
        const vast = voorstel.project.facturatiemodel !== "nacalculatie";
        const perOnderdeel = new Map<string, { min: number; omzet: number }>();
        for (const u of voorstel.uren) { const o = perOnderdeel.get(u.onderdeel) ?? { min: 0, omzet: 0 }; o.min += u.minuten; o.omzet += u.omzet ?? 0; perOnderdeel.set(u.onderdeel, o); }
        const totMin = voorstel.uren.reduce((s, u) => s + u.minuten, 0);
        const totOmzet = voorstel.uren.reduce((s, u) => s + (u.omzet ?? 0), 0);
        const km = voorstel.ritten.reduce((s, r) => s + r.totaalKm, 0);
        const kmBedrag = voorstel.ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);
        const termijnTotaal = voorstel.termijnen.reduce((s, t) => s + t.bedrag, 0);
        return (
          <section className="kaart mb-8 overflow-hidden">
            <header className="border-b border-line bg-surface-2 px-4 py-3">
              <p className="label">Factuurvoorstel · {vast ? MODEL_LABEL[voorstel.project.facturatiemodel] : "nacalculatie"}</p>
              <h2 className="text-lg font-semibold">{voorstel.project.naam} <span className="font-normal text-muted">· {voorstel.klant.naam}</span></h2>
            </header>
            <form className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3" action="/facturen" method="get">
              <input type="hidden" name="project" value={projectId!} />
              <label className="flex flex-col gap-1"><span className="label">Uren van</span><input type="date" name="van" defaultValue={van} className="veld min-h-10 py-1" /></label>
              <label className="flex flex-col gap-1"><span className="label">Tot en met</span><input type="date" name="tot" defaultValue={tot} className="veld min-h-10 py-1" /></label>
              <button type="submit" className="knop knop-stil knop-klein">Periode toepassen</button>
              {voorstel.nietKlaar > 0 && <span className="rounded border border-warn bg-warn-bg px-2 py-1 text-xs">● {voorstel.nietKlaar} {voorstel.nietKlaar === 1 ? "regel" : "regels"} in deze periode nog niet goedgekeurd — die gaan niet mee</span>}
            </form>
            <form action={conceptVanVoorstel}>
              <input type="hidden" name="projectId" value={projectId!} />
              <input type="hidden" name="van" value={van} />
              <input type="hidden" name="tot" value={tot} />
              {vast && (
                <div className="border-b border-line px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Termijnen</h3>
                    <p className="cijfers text-xs text-muted">{voorstel.project.facturatiemodel === "abonnement" ? `open ${euro(termijnTotaal)}` : `Vaste prijs ${euro(voorstel.project.vastePrijs)} · open ${euro(termijnTotaal)}`}</p>
                  </div>
                  {voorstel.termijnen.length ? (
                    <ul className="flex flex-col gap-1">
                      {voorstel.termijnen.map((t, i) => (
                        <li key={t.id}><label className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                          <input type="checkbox" name="termijn" value={t.id} defaultChecked={i === 0} className="size-5 accent-[var(--accent)]" />
                          <span className="min-w-0 flex-1"><span className="block font-medium">{t.omschrijving}</span>{t.geplandOp && <span className="block text-xs text-muted">gepland {korteDatum(t.geplandOp)}</span>}</span>
                          <span className="cijfers font-semibold">{euro(t.bedrag)}</span>
                        </label></li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Geen open termijnen. Voeg er hieronder een toe voor een tussenoplevering.</p>}
                </div>
              )}
              <div className="tabel-omhulsel rounded-none border-0 border-b">
                <table className="w-full text-sm"><tbody>
                  {perOnderdeel.size > 0 && <tr className="bg-surface-2/60"><td colSpan={3} className="px-4 py-1.5 text-xs font-semibold">{vast ? "Verantwoording uren in deze periode (niet in rekening gebracht)" : "Uren"}</td></tr>}
                  {[...perOnderdeel.entries()].map(([naam, o]) => (
                    <tr key={naam} className="border-b border-line"><td className="px-4 py-1.5 pl-8">{naam}</td><td className="cijfers px-4 py-1.5 text-right">{minutenAlsTijd(o.min)}</td><td className="cijfers px-4 py-1.5 text-right">{vast ? "" : euro(o.omzet)}</td></tr>
                  ))}
                  {voorstel.ritten.length > 0 && (
                    <tr className="border-b border-line">
                      <td className="px-4 py-1.5"><label className="flex items-center gap-2"><input type="checkbox" name="reiskosten" value="aan" defaultChecked className="size-4 accent-[var(--accent)]" /><input type="hidden" name="reiskosten" value="uit" />Reiskosten · {voorstel.ritten.length} {voorstel.ritten.length === 1 ? "rit" : "ritten"}</label></td>
                      <td className="cijfers px-4 py-1.5 text-right">{getal(km, 0)} km</td><td className="cijfers px-4 py-1.5 text-right">{euro(kmBedrag)}</td>
                    </tr>
                  )}
                  <tr className="bg-surface-2 font-semibold"><td className="px-4 py-2">Exclusief btw{vast ? " (aangevinkte termijnen + reiskosten)" : ""}</td><td className="cijfers px-4 py-2 text-right">{minutenAlsTijd(totMin)}</td><td className="cijfers px-4 py-2 text-right">{vast ? `${euro(kmBedrag)} + termijnen` : euro(totOmzet + kmBedrag)}</td></tr>
                </tbody></table>
              </div>
              <div className="flex flex-wrap items-center gap-3 px-4 py-4">
                <a href={`/api/specificatie?project=${projectId}&van=${van}&tot=${tot}&detail=vol`} className="knop knop-kaal">Specificatie vooraf bekijken</a>
                <button type="submit" className="knop knop-primair ml-auto" disabled={voorstel.uren.length === 0 && voorstel.ritten.length === 0 && voorstel.termijnen.length === 0}>Maak conceptfactuur</button>
              </div>
            </form>
            {vast && (
              <form action={termijnToevoegen} className="flex flex-wrap items-end gap-2 border-t border-line bg-surface-2/40 px-4 py-3">
                <input type="hidden" name="projectId" value={projectId!} /><input type="hidden" name="terug" value={huidigeUrl} />
                <span className="label w-full">Nieuwe termijn of tussenoplevering</span>
                <input name="omschrijving" required maxLength={120} placeholder="Bijvoorbeeld: tussenoplevering fase 2" className="veld min-h-10 flex-1 py-1" />
                <input name="bedrag" required inputMode="decimal" placeholder="bedrag" className="veld cijfers min-h-10 w-32 py-1" />
                <input name="geplandOp" type="date" className="veld min-h-10 w-40 py-1" aria-label="Gepland op" />
                <button type="submit" className="knop knop-stil knop-klein">Toevoegen</button>
              </form>
            )}
          </section>
        );
      })()}

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <form action={losseFactuur} className="kaart flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold">Losse factuur</h2>
          <p className="text-xs text-muted">Een lege conceptfactuur voor een klant; regels zet je er zelf op.</p>
          <div className="flex gap-2">
            <select name="klantId" required className="veld" defaultValue=""><option value="" disabled>Kies een klant…</option>{klanten.map((k) => <option key={k.id as string} value={k.id as string}>{k.naam as string}</option>)}</select>
            <button type="submit" className="knop knop-stil">Maak</button>
          </div>
        </form>
        <form action="/api/export/facturen" method="get" className="kaart flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold">Journaal voor de boekhouding</h2>
          <p className="text-xs text-muted">Per factuurregel één rij met grootboek en btw, als CSV. Later gaat dit rechtstreeks naar je pakket.</p>
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" name="van" defaultValue={maand} required className="veld min-h-10 py-1" aria-label="Van" />
            <input type="date" name="tot" defaultValue={vandaag()} required className="veld min-h-10 py-1" aria-label="Tot en met" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="alleen_nieuw" value="ja" defaultChecked className="size-4 accent-[var(--accent)]" />alleen nieuwe</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="markeer" value="ja" defaultChecked className="size-4 accent-[var(--accent)]" />markeer als geëxporteerd</label>
            <button type="submit" className="knop knop-stil">Download</button>
          </div>
        </form>
      </div>

      <h2 className="mb-2 text-lg font-semibold">Alle facturen</h2>
      {historie.length ? (
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Nummer</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Klant · project</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Datum</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Status</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Totaal</th>
            </tr></thead>
            <tbody>
              {historie.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2"><Link href={`/facturen/${f.id}`} className="cijfers font-medium text-accent-ink hover:underline">{f.nummer}</Link></td>
                  <td className="px-4 py-2"><span className="block">{f.klant}</span><span className="block text-xs text-muted">{f.project ?? "losse factuur"}{f.automatisch ? " · automatisch" : ""}{f.creditVanId ? " · creditfactuur" : ""}</span></td>
                  <td className="cijfers px-4 py-2 text-muted whitespace-nowrap">{f.datum ? korteDatum(f.datum) : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`label rounded px-1.5 py-0.5 ${f.status === "betaald" ? "bg-accent-bg text-accent-ink" : f.vervallen ? "bg-warn-bg text-warn" : "bg-surface-2"}`}>
                      {f.vervallen ? "Vervallen" : STATUS_LABEL[f.status]}
                    </span>
                    {f.geexporteerdOp && <span className="label ml-1 text-muted">· geëxporteerd</span>}
                  </td>
                  <td className="cijfers px-4 py-2 text-right font-semibold">{euro(f.totaal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!alles && lijst.filter((f) => f.status !== "concept").length > 25 && (
            <p className="border-t border-line px-4 py-2 text-xs"><Link href="/facturen?toon=alles" className="text-accent-ink">Toon alles</Link></p>
          )}
        </div>
      ) : <p className="text-sm text-muted">Nog geen facturen.</p>}
    </div>
  );
}
