import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { grootboekrekeningen } from "@/lib/facturatie";
import { boekhoudInstellingen } from "@/lib/boekhouding";
import { loonrun, loonaangifte, loonparameters, MAANDEN } from "@/lib/loon";
import { loonrunDefinitief, loonrunWeg, loonrunBetalen, loonaangifteIngediend, loonrunMaken } from "../acties";

export const dynamic = "force-dynamic";

export default async function LoonrunPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { id } = await params;
  const [run, inst, rekeningen, pars] = await Promise.all([loonrun(sessie, id), boekhoudInstellingen(sessie), grootboekrekeningen(sessie), loonparameters(sessie)]);
  if (!run) notFound();
  const a = loonaangifte(run);
  const concept = run.status === "concept";
  const betaalmiddelen = rekeningen.filter((g) => g.actief && g.betaalmiddel);
  const par = pars.find((x) => x.jaar === run.jaar);
  const mEind = new Date(Date.UTC(run.jaar, run.maand, 0)).toISOString().slice(0, 10);
  const Th = ({ children, r }: { children: React.ReactNode; r?: boolean }) => <th className={`label border-b border-line bg-surface-2 px-2 py-2 ${r ? "text-right" : "text-left"}`}>{children}</th>;
  const Td = ({ v, sterk }: { v: number; sterk?: boolean }) => <td className={`cijfers px-2 py-1.5 text-right whitespace-nowrap ${sterk ? "font-semibold" : ""}`}>{v ? euro(v) : <span className="text-muted">—</span>}</td>;

  const Betaling = ({ wat, label, datum, bedrag }: { wat: "netto" | "loonheffing" | "pensioen"; label: string; datum: string | null; bedrag: number }) => (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-40 flex-1"><span className="block font-medium">{label}</span><span className="cijfers block text-xs text-muted">{euro(bedrag)}</span></span>
      {datum ? <span className="cijfers text-xs text-accent-ink">betaald {korteDatum(datum)}</span> : bedrag === 0 ? <span className="text-xs text-muted">niets te betalen</span> : (
        <form action={loonrunBetalen} className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="id" value={run.id} /><input type="hidden" name="wat" value={wat} />
          <input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-36 py-1 text-sm" />
          <select name="via" defaultValue={inst.rekeningBank ?? ""} className="veld min-h-9 py-1 text-sm">{betaalmiddelen.map((g) => <option key={g.id} value={g.id}>{g.naam}</option>)}</select>
          <button type="submit" className="knop knop-stil knop-klein">Betaald</button>
        </form>
      )}
    </li>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
      <Link href={`/boekhouding/loon?jaar=${run.jaar}`} className="knop knop-kaal -ml-2">← Loon</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Loonrun · {concept ? "concept" : "definitief"}{run.vakantiegeldUitbetalen ? " · met vakantiegeld" : ""}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{MAANDEN[run.maand - 1]} {run.jaar}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {concept ? (
            <>
              <form action={loonrunMaken} className="flex items-center gap-2">
                <input type="hidden" name="jaar" value={run.jaar} /><input type="hidden" name="maand" value={run.maand} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="vakantiegeld" value="aan" defaultChecked={run.vakantiegeldUitbetalen} className="size-5 accent-[var(--accent)]" />vakantiegeld</label>
                <button type="submit" className="knop knop-stil">Herbereken</button>
              </form>
              <form action={loonrunDefinitief}><input type="hidden" name="id" value={run.id} /><button type="submit" className="knop knop-primair" disabled={run.stroken.length === 0}>Definitief maken</button></form>
              <form action={loonrunWeg}><input type="hidden" name="id" value={run.id} /><button type="submit" className="knop knop-kaal text-danger">Verwijderen</button></form>
            </>
          ) : (
            <Link href={`/boekhouding/journaal?van=${mEind}&tot=${mEind}&soort=memoriaal`} className="knop knop-stil">Journaalpost</Link>
          )}
        </div>
      </div>
      {par && !par.gecontroleerd && <p className="mt-3 rounded border border-warn bg-warn-bg px-3 py-2 text-xs">Berekend met parameters {run.jaar} die nog niet gecontroleerd zijn tegen de tabellen van de Belastingdienst.</p>}

      <div className="tabel-omhulsel mt-5">
        <table className="w-full text-sm">
          <thead><tr><Th>Werknemer</Th><Th r>Bruto</Th><Th r>Vakantiegeld</Th><Th r>Pensioen wn</Th><Th r>Loonheffing</Th><Th r>Zvw wn</Th><Th r>Netto</Th><Th r>Wg-lasten</Th><Th r>Totale kosten</Th><Th>{""}</Th></tr></thead>
          <tbody>
            {run.stroken.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-2 py-1.5"><span className="font-medium">{s.naam}</span>{s.fractie < 1 && <span className="block text-xs text-muted">{Math.round(s.fractie * 100)}% van de maand</span>}</td>
                <Td v={s.bruto} /><Td v={s.vakantiegeldUitbetaald} /><Td v={-s.pensioenWn} /><Td v={-(s.loonheffing + s.loonheffingBijzonder)} /><Td v={-s.zvwWn} /><Td v={s.netto} sterk /><Td v={s.werkgeverslasten} /><Td v={s.totaleKosten} />
                <td className="px-2 py-1.5 text-right whitespace-nowrap"><a href={`/api/loonstrook?run=${run.id}&medewerker=${s.medewerkerId}`} className="knop knop-kaal knop-klein">Strook</a></td>
              </tr>
            ))}
            {run.stroken.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted">Geen dienstverband dat in deze maand loopt.</td></tr>}
          </tbody>
          {run.stroken.length > 0 && (
            <tfoot><tr className="bg-surface-2 font-semibold">
              <td className="px-2 py-2">Totaal</td>
              <Td v={run.stroken.reduce((x, s) => x + s.bruto, 0)} /><Td v={run.stroken.reduce((x, s) => x + s.vakantiegeldUitbetaald, 0)} /><Td v={-run.stroken.reduce((x, s) => x + s.pensioenWn, 0)} /><Td v={-a.loonheffing} /><Td v={-a.zvwWn} /><Td v={a.netto} sterk /><Td v={run.stroken.reduce((x, s) => x + s.werkgeverslasten, 0)} /><Td v={a.kosten} /><td></td>
            </tr></tfoot>
          )}
        </table>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Loonaangifte {String(run.maand).padStart(2, "0")}-{run.jaar}</h2>
          <p className="mb-3 text-sm text-muted">Het collectieve deel, om over te nemen in Mijn Belastingdienst Zakelijk. Per werknemer staan de bedragen op de loonstrook.</p>
          <div className="tabel-omhulsel"><table className="w-full text-sm"><tbody>
            {a.rubrieken.map(([l, v], i) => (
              <tr key={l} className={`border-b border-line last:border-0 ${i === a.rubrieken.length - 1 ? "bg-surface-2 font-semibold" : ""}`}><td className="px-3 py-1.5">{l}</td><td className="cijfers px-3 py-1.5 text-right">{euro(v)}</td></tr>
            ))}
          </tbody></table></div>
          {!concept && (
            <form action={loonaangifteIngediend} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="id" value={run.id} />
              {run.aangifteIngediendOp ? <span className="text-accent-ink">Ingediend op {korteDatum(run.aangifteIngediendOp)} {run.aangifteIngediendOp.slice(0, 4)}</span> : (
                <><input type="date" name="datum" defaultValue={vandaag()} className="veld min-h-9 w-40 py-1 text-sm" /><button type="submit" className="knop knop-stil knop-klein">Aangifte ingediend</button><span className="text-xs text-muted">uiterlijk de laatste dag van de volgende maand</span></>
              )}
            </form>
          )}
        </section>
        <section>
          <h2 className="mb-1 text-lg font-semibold">Betalingen</h2>
          <p className="mb-3 text-sm text-muted">{concept ? "Na definitief maken." : "Elke betaling boekt van het gekozen betaalmiddel tegen de schuld uit de loonjournaalpost."}</p>
          {!concept && (
            <ul className="kaart divide-y divide-line">
              <Betaling wat="netto" label="Netto lonen aan de werknemers" datum={run.nettoBetaaldOp} bedrag={a.netto} />
              <Betaling wat="loonheffing" label="Loonheffingen aan de Belastingdienst" datum={run.loonheffingBetaaldOp} bedrag={a.totaal} />
              <Betaling wat="pensioen" label="Pensioenpremie aan het fonds" datum={run.pensioenBetaaldOp} bedrag={a.pensioen} />
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
