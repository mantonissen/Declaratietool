import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { teFactureren, facturen, specificatie } from "@/lib/facturatie";
import { euro, getal, isGeldigeDatum, korteDatum, minutenAlsTijd, vandaag } from "@/lib/datum";
import { factureer } from "./acties";

export const dynamic = "force-dynamic";

export default async function FacturenPagina({
  searchParams,
}: {
  searchParams: Promise<{ klant?: string; van?: string; tot?: string }>;
}) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const p = await searchParams;

  const [open, lijst] = await Promise.all([teFactureren(sessie), facturen(sessie)]);

  // Voorstel voor één klant zodra die gekozen is.
  const klantId = p.klant && open.some((o) => o.klantId === p.klant) ? p.klant : null;
  const gekozen = open.find((o) => o.klantId === klantId) ?? null;
  const van = isGeldigeDatum(p.van) ? p.van : (gekozen?.van ?? vandaag());
  const tot = isGeldigeDatum(p.tot) ? p.tot : (gekozen?.tot ?? vandaag());
  const voorstel = klantId ? await specificatie(sessie, { klantId, van, tot }) : null;

  const jaar = vandaag().slice(0, 4);
  const voorgesteldNummer = `${jaar}-${String(lijst.filter((f) => f.referentie.startsWith(jaar)).length + 1).padStart(3, "0")}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Facturen</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
        Van goedgekeurde uren naar een factuur. Je maakt de factuur zelf in je
        boekhouding; hier markeer je welke regels erop staan, met het
        factuurnummer, en download je de specificatie als bijlage. Daarna zijn
        die regels op slot.
      </p>

      <h2 className="mb-2 text-lg font-semibold">Te factureren</h2>
      {open.length ? (
        <ul className="mb-6 flex flex-col gap-2">
          {open.map((o) => (
            <li key={o.klantId} className={`kaart ${o.klantId === klantId ? "border-accent" : ""}`}>
              <Link href={`/facturen?klant=${o.klantId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{o.klant}</p>
                  <p className="text-xs text-muted">
                    {o.regels} {o.regels === 1 ? "regel" : "regels"} · {korteDatum(o.van)} — {korteDatum(o.tot)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="cijfers text-sm font-semibold">{euro(o.omzet)}</p>
                  <p className="cijfers text-xs text-muted">{minutenAlsTijd(o.minuten)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">Niets goedgekeurds dat nog niet gefactureerd is.</p>
      )}

      {voorstel && voorstel.klant && gekozen && (
        <section className="kaart mb-8 overflow-hidden">
          <header className="border-b border-line bg-surface-2 px-4 py-3">
            <p className="label">Factuurvoorstel</p>
            <h2 className="text-lg font-semibold">{voorstel.klant.naam}</h2>
          </header>

          <form className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3" action="/facturen" method="get">
            <input type="hidden" name="klant" value={klantId!} />
            <label className="flex flex-col gap-1"><span className="label">Van</span><input type="date" name="van" defaultValue={van} className="veld min-h-10 py-1" /></label>
            <label className="flex flex-col gap-1"><span className="label">Tot en met</span><input type="date" name="tot" defaultValue={tot} className="veld min-h-10 py-1" /></label>
            <button type="submit" className="knop knop-stil knop-klein">Periode toepassen</button>
            {voorstel.nietKlaar > 0 && (
              <span className="rounded border border-warn bg-warn-bg px-2 py-1 text-xs">
                ● {voorstel.nietKlaar} {voorstel.nietKlaar === 1 ? "regel" : "regels"} in deze periode nog niet goedgekeurd — die gaan niet mee
              </span>
            )}
          </form>

          {(() => {
            const perProject = new Map<string, typeof voorstel.uren>();
            for (const u of voorstel.uren) (perProject.get(u.project) ?? perProject.set(u.project, []).get(u.project)!).push(u);
            const totMin = voorstel.uren.reduce((s, u) => s + u.minuten, 0);
            const totOmzet = voorstel.uren.reduce((s, u) => s + (u.omzet ?? 0), 0);
            const km = voorstel.ritten.reduce((s, r) => s + r.totaalKm, 0);
            const kmBedrag = voorstel.ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);
            return (
              <>
                <div className="tabel-omhulsel rounded-none border-0 border-b">
                  <table className="w-full text-sm">
                    <tbody>
                      {[...perProject.entries()].map(([project, regels]) => {
                        const onderdelen = new Map<string, { min: number; omzet: number }>();
                        for (const u of regels) {
                          const o = onderdelen.get(u.onderdeel) ?? { min: 0, omzet: 0 };
                          o.min += u.minuten; o.omzet += u.omzet ?? 0;
                          onderdelen.set(u.onderdeel, o);
                        }
                        return (
                          <Fragment key={project}>
                            <tr className="bg-surface-2/60"><td colSpan={3} className="px-4 py-1.5 text-xs font-semibold">{project}</td></tr>
                            {[...onderdelen.entries()].map(([naam, o]) => (
                              <tr key={project + naam} className="border-b border-line">
                                <td className="px-4 py-1.5 pl-8">{naam}</td>
                                <td className="cijfers px-4 py-1.5 text-right">{minutenAlsTijd(o.min)}</td>
                                <td className="cijfers px-4 py-1.5 text-right">{euro(o.omzet)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                      {voorstel.ritten.length > 0 && (
                        <tr className="border-b border-line">
                          <td className="px-4 py-1.5">Reiskosten · {voorstel.ritten.length} {voorstel.ritten.length === 1 ? "rit" : "ritten"}</td>
                          <td className="cijfers px-4 py-1.5 text-right">{getal(km, 0)} km</td>
                          <td className="cijfers px-4 py-1.5 text-right">{euro(kmBedrag)}</td>
                        </tr>
                      )}
                      <tr className="bg-surface-2 font-semibold">
                        <td className="px-4 py-2">Totaal exclusief btw</td>
                        <td className="cijfers px-4 py-2 text-right">{minutenAlsTijd(totMin)}</td>
                        <td className="cijfers px-4 py-2 text-right">{euro(totOmzet + kmBedrag)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-end gap-3 px-4 py-4">
                  <a href={`/api/specificatie?klant=${klantId}&van=${van}&tot=${tot}`} className="knop knop-stil">
                    Specificatie (PDF)
                  </a>
                  <a href={`/api/specificatie?klant=${klantId}&van=${van}&tot=${tot}&detail=vol`} className="knop knop-kaal">
                    intern, met alles
                  </a>
                  <form action={factureer} className="ml-auto flex flex-wrap items-end gap-2">
                    <input type="hidden" name="klantId" value={klantId!} />
                    <input type="hidden" name="van" value={van} />
                    <input type="hidden" name="tot" value={tot} />
                    <label className="flex flex-col gap-1">
                      <span className="label">Factuurnummer</span>
                      <input name="referentie" required defaultValue={voorgesteldNummer} className="veld cijfers min-h-10 w-40 py-1" />
                    </label>
                    <button type="submit" className="knop knop-primair" disabled={voorstel.uren.length === 0 && voorstel.ritten.length === 0}>
                      Markeer als gefactureerd
                    </button>
                  </form>
                </div>
                <p className="px-4 pb-4 text-xs text-muted">
                  Op de specificatie voor de klant staan {voorstel.klant.metOmschrijving ? "wel" : "geen"} omschrijvingen en {voorstel.klant.metTarieven ? "wel" : "geen"} tarieven. Instelbaar bij de klant onder Beheer.
                </p>
              </>
            );
          })()}
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Gefactureerd</h2>
      {lijst.length ? (
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Factuur</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Klant</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Periode</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Uren</th>
                <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {lijst.map((f) => (
                <tr key={f.referentie} className="border-b border-line last:border-0">
                  <td className="px-4 py-2"><Link href={`/facturen/${encodeURIComponent(f.referentie)}`} className="cijfers font-medium text-accent-ink hover:underline">{f.referentie}</Link></td>
                  <td className="px-4 py-2">{f.klant}</td>
                  <td className="px-4 py-2 text-muted">{korteDatum(f.van)} — {korteDatum(f.tot)}</td>
                  <td className="cijfers px-4 py-2 text-right">{minutenAlsTijd(f.minuten)}</td>
                  <td className="cijfers px-4 py-2 text-right font-semibold">{euro(f.totaal)}</td>
                </tr>
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
