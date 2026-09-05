import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { specificatie, grootboekrekeningen, btwTarieven } from "@/lib/facturatie";
import { euro, getal, korteDatum, minutenAlsTijd, vandaag } from "@/lib/datum";
import {
  regelErbij, regelOpslaan, regelWeg, kopOpslaan, definitiefMaken, conceptWeg,
  betaald, crediteren, verstuurd, corrigeer,
} from "../acties";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { concept: "Concept", definitief: "Open", betaald: "Betaald", gecrediteerd: "Gecrediteerd" };

export default async function FactuurPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const { id } = await params;

  const s = await specificatie(sessie, { factuurId: id });
  if (!s.factuur || !s.klant) notFound();
  const f = s.factuur;
  const concept = f.status === "concept";
  const [gb, btw] = await Promise.all([grootboekrekeningen(sessie), concept ? btwTarieven(sessie) : []]);
  // Bank vooraan: dat is bijna altijd het antwoord.
  const betaalmiddelen = gb.filter((g) => g.actief && g.betaalmiddel)
    .sort((a, b) => Number(b.soort === "activa") - Number(a.soort === "activa") || b.nummer.localeCompare(a.nummer));
  const bankId = betaalmiddelen.find((g) => g.nummer === "1100")?.id ?? betaalmiddelen[0]?.id ?? "";
  const vast = !!s.project && s.project.facturatiemodel !== "nacalculatie";

  const Th = ({ children, r, w }: { children?: React.ReactNode; r?: boolean; w?: string }) => (
    <th className={`label border-b border-line bg-surface-2 px-3 py-2 ${r ? "text-right" : "text-left"} ${w ?? ""}`}>{children}</th>
  );

  // De velden van een regel staan in de tabelrij; het formulier zelf staat
  // (verborgen) in de laatste cel. Het `form`-attribuut koppelt ze.
  const RegelVelden = ({ r, formId }: { r?: (typeof s.regels)[number]; formId: string }) => (
    <>
      <td className="px-2 py-1.5"><input form={formId} name="omschrijving" required defaultValue={r?.omschrijving ?? ""} className="veld min-h-9 min-w-48 py-1 text-sm" placeholder="Omschrijving" /></td>
      <td className="px-2 py-1.5"><input form={formId} name="aantal" inputMode="decimal" required defaultValue={r ? String(r.aantal).replace(".", ",") : "1"} className="veld cijfers min-h-9 w-20 py-1 text-right text-sm" /></td>
      <td className="px-2 py-1.5">
        <select key={r?.eenheid ?? "stuk"} form={formId} name="eenheid" defaultValue={r?.eenheid ?? "stuk"} className="veld min-h-9 w-20 py-1 text-sm"><option value="stuk">st</option><option value="uur">uur</option><option value="km">km</option><option value="dag">dag</option></select>
      </td>
      <td className="px-2 py-1.5"><input form={formId} name="prijs" inputMode="decimal" required defaultValue={r ? String(r.prijs).replace(".", ",") : ""} className="veld cijfers min-h-9 w-24 py-1 text-right text-sm" placeholder="0,00" /></td>
      <td className="px-2 py-1.5">
        <select key={r?.btwCode ?? s.klant!.btwCode} form={formId} name="btwCode" defaultValue={r?.btwCode ?? s.klant!.btwCode} className="veld min-h-9 w-28 py-1 text-sm">
          {btw.filter((b) => b.actief || b.code === r?.btwCode).map((b) => <option key={b.code} value={b.code}>{b.code} {getal(b.percentage, 0)}%</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select key={r?.grootboekId ?? "geen"} form={formId} name="grootboekId" defaultValue={r?.grootboekId ?? ""} className="veld min-h-9 w-44 py-1 text-sm">
          <option value="">— standaard</option>
          {gb.filter((g) => g.actief || g.id === r?.grootboekId).map((g) => <option key={g.id} value={g.id}>{g.nummer} {g.naam}</option>)}
        </select>
      </td>
    </>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/facturen" className="knop knop-kaal -ml-2">← Facturen</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">{f.creditVanId ? "Creditfactuur" : "Factuur"} · {STATUS[f.status]}{f.automatisch ? " · automatisch" : ""}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            <span className="cijfers">{f.nummer ?? "concept"}</span> · {s.klant.naam}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {s.project ? `${s.project.code ? s.project.code + " · " : ""}${s.project.naam}` : "losse factuur"}
            {f.datum ? ` · ${korteDatum(f.datum)}` : ""}{f.vervaldatum && f.status === "definitief" && !f.creditVanId ? ` · vervalt ${korteDatum(f.vervaldatum)}` : ""}
            {f.betaaldOp ? ` · ${f.creditVanId ? "verrekend" : "betaald"} ${korteDatum(f.betaaldOp)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="label">Totaal incl. btw</p>
          <p className="cijfers text-2xl font-semibold">{euro(f.totaal)}</p>
        </div>
      </div>

      <div className="mt-4 mb-6 flex flex-wrap items-center gap-2">
        <a href={`/api/factuur?id=${f.id}`} className={`knop ${concept ? "knop-stil" : "knop-primair"}`}>{concept ? "Voorbeeld (PDF)" : "Factuur (PDF)"}</a>
        <a href={`/api/factuur?id=${f.id}&bijlage=nee`} className="knop knop-kaal">zonder bijlage</a>
        <a href={`/api/specificatie?factuur=${f.id}&detail=vol`} className="knop knop-kaal">specificatie intern</a>
        {f.status === "definitief" && (
          <form action={betaald} className="ml-auto flex flex-wrap items-center gap-2">
            <input type="hidden" name="factuurId" value={f.id} />
            <input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-10 w-40 py-1" aria-label="Betaald op" />
            <select name="via" defaultValue={f.creditVanId ? "verrekend" : bankId} className="veld min-h-10 py-1" aria-label="Via">
              {f.creditVanId && <option value="verrekend">verrekend met een factuur</option>}
              {betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{f.creditVanId ? "terugbetaald via " : "ontvangen op "}{g.naam.toLowerCase()}</option>)}
            </select>
            <button type="submit" className="knop knop-stil">{f.creditVanId ? "Afgehandeld" : "Betaald"}</button>
          </form>
        )}
        {f.status === "betaald" && (
          <form action={betaald} className="ml-auto"><input type="hidden" name="factuurId" value={f.id} /><input type="hidden" name="ongedaan" value="ja" /><button type="submit" className="knop knop-kaal">Toch niet betaald</button></form>
        )}
        {f.automatisch && !f.verstuurdOp && f.status !== "concept" && (
          <form action={verstuurd}><input type="hidden" name="factuurId" value={f.id} /><button type="submit" className="knop knop-stil">Verstuurd</button></form>
        )}
        {f.status !== "concept" && (
          <Link href={`/boekhouding/journaal?van=${f.datum}&tot=${vandaag()}&soort=verkoop`} className="knop knop-kaal">in het journaal</Link>
        )}
      </div>

      {concept ? (
        <>
          <form action={kopOpslaan} className="kaart mb-4 flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="factuurId" value={f.id} />
            <label className="flex flex-1 flex-col gap-1"><span className="label">Referentie van de klant</span><input name="referentieKlant" defaultValue={f.referentieKlant ?? ""} className="veld min-h-10 py-1" placeholder="Inkoopnummer of PO" /></label>
            <label className="flex flex-[2] flex-col gap-1"><span className="label">Opmerking op de factuur</span><input name="opmerking" defaultValue={f.opmerking ?? ""} className="veld min-h-10 py-1" /></label>
            <button type="submit" className="knop knop-stil">Opslaan</button>
          </form>

          <div className="tabel-omhulsel">
            <table className="w-full text-sm">
              <thead><tr><Th>Omschrijving</Th><Th r>Aantal</Th><Th>Eenh.</Th><Th r>Prijs</Th><Th>Btw</Th><Th>Grootboek</Th><Th r>Bedrag</Th><Th></Th></tr></thead>
              <tbody>
                {s.regels.map((r) => (
                  <tr key={r.id} className="border-b border-line">
                    <RegelRij r={r} factuurId={f.id} Velden={RegelVelden} />
                  </tr>
                ))}
                <tr className="bg-surface-2/40">
                  <NieuweRegel factuurId={f.id} Velden={RegelVelden} />
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-2"><td colSpan={6} className="px-3 py-1.5 text-right text-muted">Subtotaal</td><td className="cijfers px-3 py-1.5 text-right">{euro(f.subtotaal)}</td><td></td></tr>
                <tr><td colSpan={6} className="px-3 py-1.5 text-right text-muted">Btw</td><td className="cijfers px-3 py-1.5 text-right">{euro(f.btwBedrag)}</td><td></td></tr>
                <tr className="bg-surface-2 font-semibold"><td colSpan={6} className="px-3 py-2 text-right">Totaal</td><td className="cijfers px-3 py-2 text-right">{euro(f.totaal)}</td><td></td></tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Een regel bewerk je in zijn eigen rij en slaat je op met de knop erachter. Regels uit uren, ritten en termijnen kun je aanpassen; de onderliggende uren blijven aan deze factuur hangen.</p>

          <div className="kaart mt-6 flex flex-wrap items-end gap-3 p-4">
            <form action={definitiefMaken} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="factuurId" value={f.id} />
              <label className="flex flex-col gap-1"><span className="label">Factuurdatum</span><input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-10 py-1" /></label>
              <button type="submit" className="knop knop-primair" disabled={s.regels.length === 0}>Definitief maken</button>
              <span className="text-xs text-muted">Krijgt het volgende nummer uit de reeks; daarna ligt alles vast.</span>
            </form>
            <form action={conceptWeg} className="ml-auto"><input type="hidden" name="factuurId" value={f.id} /><button type="submit" className="knop knop-kaal text-danger">Concept verwijderen</button></form>
          </div>
        </>
      ) : (
        <>
          <div className="tabel-omhulsel">
            <table className="w-full text-sm">
              <thead><tr><Th>Omschrijving</Th><Th r>Aantal</Th><Th r>Prijs</Th><Th r>Btw</Th><Th>Grootboek</Th><Th r>Bedrag</Th></tr></thead>
              <tbody>
                {s.regels.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{r.omschrijving}</td>
                    <td className="cijfers px-3 py-2 text-right whitespace-nowrap">{getal(r.aantal, r.eenheid === "stuk" ? 0 : 2)} {r.eenheid === "stuk" ? "" : r.eenheid}</td>
                    <td className="cijfers px-3 py-2 text-right">{euro(r.prijs)}</td>
                    <td className="cijfers px-3 py-2 text-right">{getal(r.btwPercentage, 0)}%</td>
                    <td className="cijfers px-3 py-2 text-xs text-muted">{r.grootboekNummer ?? "—"}</td>
                    <td className="cijfers px-3 py-2 text-right">{euro(r.bedrag)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-2"><td colSpan={5} className="px-3 py-1.5 text-right text-muted">Subtotaal</td><td className="cijfers px-3 py-1.5 text-right">{euro(f.subtotaal)}</td></tr>
                <tr><td colSpan={5} className="px-3 py-1.5 text-right text-muted">Btw</td><td className="cijfers px-3 py-1.5 text-right">{euro(f.btwBedrag)}</td></tr>
                <tr className="bg-surface-2 font-semibold"><td colSpan={5} className="px-3 py-2 text-right">Totaal</td><td className="cijfers px-3 py-2 text-right">{euro(f.totaal)}</td></tr>
              </tfoot>
            </table>
          </div>

          {f.status !== "gecrediteerd" && !f.creditVanId && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-accent-ink">Crediteren</summary>
              <form action={crediteren} className="kaart mt-2 flex flex-wrap items-end gap-2 p-3">
                <input type="hidden" name="factuurId" value={f.id} />
                <label className="flex flex-1 flex-col gap-1"><span className="label">Reden</span><input name="reden" required maxLength={200} className="veld min-h-10 py-1" placeholder="Komt op de creditfactuur" /></label>
                <button type="submit" className="knop knop-stil">Maak creditfactuur</button>
                <p className="w-full text-xs text-muted">Maakt een nieuwe, definitieve factuur met dezelfde regels met een min ervoor. De uren blijven gefactureerd; klopt een aantal uren niet, gebruik dan de correctie hieronder.</p>
              </form>
            </details>
          )}
        </>
      )}

      {(s.uren.length > 0 || s.ritten.length > 0 || s.termijnen.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Wat eraan hangt</h2>
          <div className="tabel-omhulsel">
            <table className="w-full text-sm">
              <thead><tr><Th>Datum</Th><Th>{vast ? "Verantwoorde uren en termijnen" : "Uren, ritten en termijnen"}</Th><Th r>Aantal</Th><Th r></Th></tr></thead>
              <tbody>
                {s.termijnen.map((t) => (
                  <tr key={t.id} className="border-b border-line"><td className="cijfers px-3 py-2 whitespace-nowrap">{t.geplandOp ? korteDatum(t.geplandOp) : "—"}</td><td className="px-3 py-2"><span className="font-medium">Termijn · {t.omschrijving}</span></td><td className="cijfers px-3 py-2 text-right">{euro(t.bedrag)}</td><td></td></tr>
                ))}
                {s.uren.map((u) => (
                  <tr key={u.id} className={`border-b border-line ${u.minuten < 0 ? "text-muted" : ""}`}>
                    <td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(u.datum)}</td>
                    <td className="px-3 py-2"><span className="block font-medium">{u.onderdeel} <span className="font-normal text-muted">· {u.medewerker}</span></span><span className="block text-xs text-muted">{u.omschrijving ?? ""}{u.declarabel ? "" : " · niet declarabel"}</span></td>
                    <td className="cijfers px-3 py-2 text-right">{minutenAlsTijd(u.minuten)}</td>
                    <td className="px-3 py-2 text-right">
                      {!vast && !concept && u.status === "gefactureerd" && !u.gecorrigeerd && u.minuten > 0 && u.declarabel && (
                        <details className="inline-block text-left">
                          <summary className="knop knop-kaal knop-klein cursor-pointer list-none">Corrigeren</summary>
                          <form action={corrigeer} className="kaart absolute z-10 mt-1 flex w-72 flex-col gap-2 p-3 shadow-lg">
                            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="factuurId" value={f.id} />
                            <p className="text-xs text-muted">Het origineel blijft staan; er komt een tegenboeking van {minutenAlsTijd(-u.minuten)} bij en, als je een nieuwe tijd invult, een nieuwe regel — voor de volgende factuur.</p>
                            <label className="flex flex-col gap-1"><span className="label">Nieuwe tijd (leeg = crediteren)</span><input name="nieuweTijd" placeholder="bijv. 2:30" className="veld cijfers min-h-9 py-1" /></label>
                            <label className="flex flex-col gap-1"><span className="label">Waarom</span><input name="toelichting" required maxLength={200} className="veld min-h-9 py-1" /></label>
                            <button type="submit" className="knop knop-primair knop-klein">Boek correctie</button>
                          </form>
                        </details>
                      )}
                      {u.gecorrigeerd && <span className="label">gecorrigeerd</span>}
                    </td>
                  </tr>
                ))}
                {s.ritten.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0"><td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(r.datum)}</td><td className="px-3 py-2"><span className="block font-medium">Rit · {r.medewerker}</span><span className="block text-xs text-muted">{r.doel}{r.omschrijving ? ` · ${r.omschrijving}` : ""}</span></td><td className="cijfers px-3 py-2 text-right">{getal(r.totaalKm, 0)} km</td><td></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// Een bestaande regel: eigen formulier per rij, met opslaan en verwijderen.
function RegelRij<R extends { id: string; bedrag: number; bron: string }>({ r, factuurId, Velden }: { r: R; factuurId: string; Velden: (p: { r?: R; formId: string }) => React.ReactNode }) {
  const opslaanId = `opslaan-${r.id}`, wegId = `weg-${r.id}`;
  return (
    <>
      <Velden r={r} formId={opslaanId} />
      <td className="cijfers px-3 py-1.5 text-right whitespace-nowrap">{euro(r.bedrag)}<span className="block text-[0.625rem] text-muted">{r.bron}</span></td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <form id={opslaanId} action={regelOpslaan} className="hidden"><input type="hidden" name="factuurId" value={factuurId} /><input type="hidden" name="regelId" value={r.id} /></form>
        <form id={wegId} action={regelWeg} className="hidden"><input type="hidden" name="factuurId" value={factuurId} /><input type="hidden" name="regelId" value={r.id} /></form>
        <button type="submit" form={opslaanId} className="knop knop-stil knop-klein">Opslaan</button>
        <button type="submit" form={wegId} className="knop knop-kaal knop-klein text-danger">×</button>
      </td>
    </>
  );
}

function NieuweRegel({ factuurId, Velden }: { factuurId: string; Velden: (p: { formId: string }) => React.ReactNode }) {
  const id = `nieuw-${factuurId}`;
  return (
    <>
      <Velden formId={id} />
      <td className="px-3 py-1.5 text-right text-xs text-muted">nieuw</td>
      <td className="px-2 py-1.5">
        <form id={id} action={regelErbij} className="hidden"><input type="hidden" name="factuurId" value={factuurId} /></form>
        <button type="submit" form={id} className="knop knop-primair knop-klein">Toevoegen</button>
      </td>
    </>
  );
}
