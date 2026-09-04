import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { teFactureren, facturen, specificatie } from "@/lib/facturatie";
import { euro, getal, isGeldigeDatum, korteDatum, minutenAlsTijd, vandaag } from "@/lib/datum";
import { factureer, termijnToevoegen } from "./acties";

export const dynamic = "force-dynamic";

export default async function FacturenPagina({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; van?: string; tot?: string }>;
}) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const p = await searchParams;

  const [open, lijst] = await Promise.all([teFactureren(sessie), facturen(sessie)]);

  const gekozen = open.find((o) => o.projectId === p.project) ?? null;
  const projectId = gekozen?.projectId ?? null;
  const van = isGeldigeDatum(p.van) ? p.van : (gekozen?.van ?? vandaag().slice(0, 8) + "01");
  const tot = isGeldigeDatum(p.tot) ? p.tot : (gekozen?.tot ?? vandaag());
  const voorstel = projectId ? await specificatie(sessie, { projectId, van, tot }) : null;

  const jaar = vandaag().slice(0, 4);
  const voorgesteldNummer = `${jaar}-${String(lijst.filter((f) => f.referentie.startsWith(jaar)).length + 1).padStart(3, "0")}`;
  const huidigeUrl = `/facturen?project=${projectId}&van=${van}&tot=${tot}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Facturen</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
        Per project, van goedgekeurde uren of van termijnen bij een tussenoplevering
        naar een factuur. Je maakt de factuur zelf in je boekhouding; hier markeer je
        wat erop staat, met het factuurnummer, en download je de specificatie als
        bijlage. Daarna is het op slot.
      </p>

      <h2 className="mb-2 text-lg font-semibold">Te factureren</h2>
      {open.length ? (
        <ul className="mb-6 flex flex-col gap-2">
          {open.map((o) => (
            <li key={o.projectId} className={`kaart ${o.projectId === projectId ? "border-accent" : ""}`}>
              <Link href={`/facturen?project=${o.projectId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {o.project}
                    {o.facturatiemodel === "vaste_prijs" && <span className="label ml-2 rounded bg-accent-bg px-1.5 py-0.5 text-accent-ink">vaste prijs</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {o.klant}
                    {o.regels > 0 && ` · ${o.regels} ${o.regels === 1 ? "regel" : "regels"} · ${korteDatum(o.van!)} — ${korteDatum(o.tot!)}`}
                    {o.termijnenOpen > 0 && ` · ${o.termijnenOpen} ${o.termijnenOpen === 1 ? "termijn" : "termijnen"} open`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="cijfers text-sm font-semibold">
                    {o.facturatiemodel === "vaste_prijs" ? euro(o.termijnBedrag ?? 0) : euro(o.omzet)}
                  </p>
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
        const vast = voorstel.project.facturatiemodel === "vaste_prijs";
        const perOnderdeel = new Map<string, { min: number; omzet: number }>();
        for (const u of voorstel.uren) {
          const o = perOnderdeel.get(u.onderdeel) ?? { min: 0, omzet: 0 };
          o.min += u.minuten; o.omzet += u.omzet ?? 0;
          perOnderdeel.set(u.onderdeel, o);
        }
        const totMin = voorstel.uren.reduce((s, u) => s + u.minuten, 0);
        const totOmzet = voorstel.uren.reduce((s, u) => s + (u.omzet ?? 0), 0);
        const km = voorstel.ritten.reduce((s, r) => s + r.totaalKm, 0);
        const kmBedrag = voorstel.ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);
        const termijnTotaal = voorstel.termijnen.reduce((s, t) => s + t.bedrag, 0);
        const alGefactureerd = (voorstel.project.vastePrijs ?? 0) - termijnTotaal;

        return (
          <section className="kaart mb-8 overflow-hidden">
            <header className="border-b border-line bg-surface-2 px-4 py-3">
              <p className="label">Factuurvoorstel · {vast ? "vaste prijs" : "nacalculatie"}</p>
              <h2 className="text-lg font-semibold">{voorstel.project.naam} <span className="font-normal text-muted">· {voorstel.klant.naam}</span></h2>
            </header>

            <form className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3" action="/facturen" method="get">
              <input type="hidden" name="project" value={projectId!} />
              <label className="flex flex-col gap-1"><span className="label">Uren van</span><input type="date" name="van" defaultValue={van} className="veld min-h-10 py-1" /></label>
              <label className="flex flex-col gap-1"><span className="label">Tot en met</span><input type="date" name="tot" defaultValue={tot} className="veld min-h-10 py-1" /></label>
              <button type="submit" className="knop knop-stil knop-klein">Periode toepassen</button>
              {voorstel.nietKlaar > 0 && (
                <span className="rounded border border-warn bg-warn-bg px-2 py-1 text-xs">
                  ● {voorstel.nietKlaar} {voorstel.nietKlaar === 1 ? "regel" : "regels"} in deze periode nog niet goedgekeurd — {vast ? "die staan dan niet op de verantwoording" : "die gaan niet mee"}
                </span>
              )}
            </form>

            <form action={factureer}>
              <input type="hidden" name="projectId" value={projectId!} />
              <input type="hidden" name="van" value={van} />
              <input type="hidden" name="tot" value={tot} />

              {vast && (
                <div className="border-b border-line px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Termijnen</h3>
                    <p className="cijfers text-xs text-muted">
                      Vaste prijs {euro(voorstel.project.vastePrijs)} · al gefactureerd {euro(alGefactureerd)} · open {euro(termijnTotaal)}
                    </p>
                  </div>
                  {voorstel.termijnen.length ? (
                    <ul className="flex flex-col gap-1">
                      {voorstel.termijnen.map((t, i) => (
                        <li key={t.id}>
                          <label className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                            <input type="checkbox" name="termijn" value={t.id} defaultChecked={i === 0} className="size-5 accent-[var(--accent)]" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">{t.omschrijving}</span>
                              {t.geplandOp && <span className="block text-xs text-muted">gepland {korteDatum(t.geplandOp)}</span>}
                            </span>
                            <span className="cijfers font-semibold">{euro(t.bedrag)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Geen open termijnen meer. Voeg er hieronder een toe voor een tussenoplevering.</p>
                  )}
                </div>
              )}

              <div className="tabel-omhulsel rounded-none border-0 border-b">
                <table className="w-full text-sm">
                  <tbody>
                    {perOnderdeel.size > 0 && (
                      <tr className="bg-surface-2/60">
                        <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold">
                          {vast ? "Verantwoording uren in deze periode (niet in rekening gebracht)" : "Uren"}
                        </td>
                      </tr>
                    )}
                    {[...perOnderdeel.entries()].map(([naam, o]) => (
                      <tr key={naam} className="border-b border-line">
                        <td className="px-4 py-1.5 pl-8">{naam}</td>
                        <td className="cijfers px-4 py-1.5 text-right">{minutenAlsTijd(o.min)}</td>
                        <td className="cijfers px-4 py-1.5 text-right">{vast ? "" : euro(o.omzet)}</td>
                      </tr>
                    ))}
                    {voorstel.ritten.length > 0 && (
                      <tr className="border-b border-line">
                        <td className="px-4 py-1.5">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="reiskosten" value="aan" defaultChecked className="size-4 accent-[var(--accent)]" />
                            <input type="hidden" name="reiskosten" value="uit" />
                            Reiskosten · {voorstel.ritten.length} {voorstel.ritten.length === 1 ? "rit" : "ritten"}
                          </label>
                        </td>
                        <td className="cijfers px-4 py-1.5 text-right">{getal(km, 0)} km</td>
                        <td className="cijfers px-4 py-1.5 text-right">{euro(kmBedrag)}</td>
                      </tr>
                    )}
                    <tr className="bg-surface-2 font-semibold">
                      <td className="px-4 py-2">Totaal exclusief btw{vast ? " (gekozen termijnen + reiskosten)" : ""}</td>
                      <td className="cijfers px-4 py-2 text-right">{minutenAlsTijd(totMin)}</td>
                      <td className="cijfers px-4 py-2 text-right">{vast ? euro(kmBedrag) + " + termijnen" : euro(totOmzet + kmBedrag)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-3 px-4 py-4">
                <a href={`/api/specificatie?project=${projectId}&van=${van}&tot=${tot}`} className="knop knop-stil">Specificatie (PDF)</a>
                <a href={`/api/specificatie?project=${projectId}&van=${van}&tot=${tot}&detail=vol`} className="knop knop-kaal">intern, met alles</a>
                <div className="ml-auto flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="label">Factuurnummer</span>
                    <input name="referentie" required defaultValue={voorgesteldNummer} className="veld cijfers min-h-10 w-40 py-1" />
                  </label>
                  <button type="submit" className="knop knop-primair" disabled={voorstel.uren.length === 0 && voorstel.ritten.length === 0 && voorstel.termijnen.length === 0}>
                    Markeer als gefactureerd
                  </button>
                </div>
              </div>
            </form>

            {vast && (
              <form action={termijnToevoegen} className="flex flex-wrap items-end gap-2 border-t border-line bg-surface-2/40 px-4 py-3">
                <input type="hidden" name="projectId" value={projectId!} />
                <input type="hidden" name="terug" value={huidigeUrl} />
                <span className="label w-full">Nieuwe termijn of tussenoplevering</span>
                <input name="omschrijving" required maxLength={120} placeholder="Bijvoorbeeld: tussenoplevering fase 2" className="veld min-h-10 flex-1 py-1" />
                <input name="bedrag" required inputMode="decimal" placeholder="bedrag" className="veld cijfers min-h-10 w-32 py-1" />
                <input name="geplandOp" type="date" className="veld min-h-10 w-40 py-1" aria-label="Gepland op" />
                <button type="submit" className="knop knop-stil knop-klein">Toevoegen</button>
              </form>
            )}

            <p className="px-4 py-3 text-xs text-muted">
              Op de specificatie voor de klant staan {voorstel.klant.metOmschrijving ? "wel" : "geen"} omschrijvingen en {voorstel.klant.metTarieven ? "wel" : "geen"} tarieven{vast ? "; termijnbedragen staan er altijd op" : ""}. Instelbaar bij de klant onder Beheer.
            </p>
          </section>
        );
      })()}

      <h2 className="mb-2 text-lg font-semibold">Gefactureerd</h2>
      {lijst.length ? (
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Factuur</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Project</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Periode</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Uren</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {lijst.map((f) => (
                <Fragment key={f.referentie}>
                  <tr className="border-b border-line last:border-0">
                    <td className="px-4 py-2"><Link href={`/facturen/${encodeURIComponent(f.referentie)}`} className="cijfers font-medium text-accent-ink hover:underline">{f.referentie}</Link></td>
                    <td className="px-4 py-2"><span className="block">{f.project}</span><span className="block text-xs text-muted">{f.klant}{f.termijnBedrag ? " · termijn" : ""}</span></td>
                    <td className="px-4 py-2 text-muted">{f.van ? `${korteDatum(f.van)} — ${korteDatum(f.tot!)}` : "—"}</td>
                    <td className="cijfers px-4 py-2 text-right">{f.minuten ? minutenAlsTijd(f.minuten) : "—"}</td>
                    <td className="cijfers px-4 py-2 text-right font-semibold">{euro(f.totaal)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Nog niets gefactureerd.</p>
      )}
    </div>
  );
}
