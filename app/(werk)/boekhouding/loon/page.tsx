import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { euro, getal, korteDatum, vandaag } from "@/lib/datum";
import { loonruns, dienstverbanden, loonparameters, loonaangifte, MAANDEN, type Dienstverband } from "@/lib/loon";
import { dienstverbandErbij, dienstverbandOpslaan, dienstverbandWeg, loonrunMaken } from "./acties";

export const dynamic = "force-dynamic";

export default async function LoonPagina({ searchParams }: { searchParams: Promise<{ jaar?: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const d = vandaag();
  const dit = Number(d.slice(0, 4));
  const p = await searchParams;
  const jaar = Number.isInteger(Number(p.jaar)) && Number(p.jaar) >= 2000 ? Number(p.jaar) : dit;
  const [runs, dvs, params, medewerkers] = await Promise.all([
    loonruns(sessie, jaar), dienstverbanden(sessie), loonparameters(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select id, naam from medewerker where actief order by naam`),
  ]);
  const mw = medewerkers.map((m) => ({ id: m.id as string, naam: m.naam as string }));
  const par = params.find((x) => x.jaar === jaar);
  const volgendeMaand = runs.length ? Math.min(12, Math.max(...runs.map((r) => r.maand)) + 1) : Number(d.slice(5, 7));
  const actief = dvs.filter((v) => !v.uitDienst || v.uitDienst >= d);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/boekhouding" className="knop knop-kaal -ml-2">← Boekhouding</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Loon</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Per maand een loonrun: loonstroken, de journaalpost en de bedragen voor de loonaangifte. De berekening volgt de tarieven en premies van het jaar; leg die eerst naast de tabellen van de Belastingdienst.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[dit - 1, dit].map((j) => <Link key={j} href={`/boekhouding/loon?jaar=${j}`} className={`rounded px-2 py-1 text-sm ${j === jaar ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{j}</Link>)}
          <Link href={`/boekhouding/loon/parameters?jaar=${jaar}`} className="knop knop-stil">Parameters {jaar}</Link>
        </div>
      </div>

      {!par ? (
        <p className="mt-4 rounded border border-warn bg-warn-bg px-3 py-2 text-sm">Er zijn nog geen loonparameters voor {jaar}. <Link href={`/boekhouding/loon/parameters?jaar=${jaar}`} className="underline">Maak ze aan</Link> op basis van een eerder jaar.</p>
      ) : !par.gecontroleerd ? (
        <p className="mt-4 rounded border border-warn bg-warn-bg px-3 py-2 text-sm">De parameters van {jaar} zijn vooraf ingevuld maar nog niet door jou gecontroleerd tegen de tabellen van de Belastingdienst. <Link href={`/boekhouding/loon/parameters?jaar=${jaar}`} className="underline">Controleer ze</Link> voordat je een loonrun definitief maakt.</p>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Loonruns {jaar}</h2>
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Maand</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Werknemers</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Bruto</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Netto</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Loonheffingen</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Stand</th>
            </tr></thead>
            <tbody>
              {runs.map((r) => {
                const a = loonaangifte(r);
                const stappen = r.status !== "definitief" ? ["concept"] : [
                  r.nettoBetaaldOp ? "netto betaald" : "netto open",
                  r.aangifteIngediendOp ? "aangifte ingediend" : "aangifte open",
                  r.loonheffingBetaaldOp ? "loonheffing betaald" : "loonheffing open",
                ];
                return (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><Link href={`/boekhouding/loon/${r.id}`} className="font-medium text-accent-ink hover:underline">{MAANDEN[r.maand - 1]} {r.jaar}</Link>{r.vakantiegeldUitbetalen && <span className="label ml-2">+ vakantiegeld</span>}</td>
                    <td className="cijfers px-3 py-2 text-right">{a.werknemers}</td>
                    <td className="cijfers px-3 py-2 text-right">{euro(r.stroken.reduce((s, x) => s + x.bruto + x.vakantiegeldUitbetaald, 0))}</td>
                    <td className="cijfers px-3 py-2 text-right">{euro(a.netto)}</td>
                    <td className="cijfers px-3 py-2 text-right">{euro(a.totaal)}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{stappen.map((s) => <span key={s} className={`label rounded px-1.5 py-0.5 ${s.endsWith("open") || s === "concept" ? "bg-warn-bg text-warn" : "bg-accent-bg text-accent-ink"}`}>{s}</span>)}</span></td>
                  </tr>
                );
              })}
              {runs.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">Nog geen loonrun in {jaar}.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={loonrunMaken} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="jaar" value={jaar} />
          <label className="flex flex-col gap-1"><span className="label">Maand</span>
            <select name="maand" defaultValue={String(volgendeMaand)} className="veld min-h-10 py-1">{MAANDEN.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="vakantiegeld" value="aan" className="size-5 accent-[var(--accent)]" />Vakantiegeld uitbetalen (meestal mei)</label>
          <button type="submit" className="knop knop-primair" disabled={!par || actief.length === 0}>Loonrun maken</button>
          <span className="text-xs text-muted">Een bestaand concept wordt opnieuw berekend.</span>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">Dienstverbanden</h2>
        <ul className="kaart divide-y divide-line">
          {dvs.map((v) => (
            <li key={v.id}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-40 flex-1">
                    <span className="block font-medium">{v.naam}{v.dga && <span className="label ml-2">dga</span>}{v.uitDienst && v.uitDienst < d && <span className="label ml-2">uit dienst</span>}</span>
                    <span className="block text-xs text-muted">vanaf {korteDatum(v.inDienst)} {v.inDienst.slice(0, 4)}{v.uitDienst ? ` t/m ${korteDatum(v.uitDienst)} ${v.uitDienst.slice(0, 4)}` : ""} · {getal(v.urenPerWeek, 0)} u/wk · {v.onbepaaldeTijd ? "onbepaalde tijd" : "bepaalde tijd"}{v.loonheffingskorting ? "" : " · zonder loonheffingskorting"}</span>
                  </span>
                  <span className="cijfers font-semibold">{euro(v.brutoMaandloon)} <span className="text-xs font-normal text-muted">bruto/mnd</span></span>
                </summary>
                <div className="border-t border-line bg-surface-2/40 px-4 py-3"><DienstverbandForm v={v} medewerkers={mw} /></div>
              </details>
            </li>
          ))}
          {dvs.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nog geen dienstverbanden. Ook de dga heeft er een (met gebruikelijk loon{par ? `, ${euro(par.gebruikelijkLoon)} per jaar` : ""}).</li>}
        </ul>
        <details className="kaart mt-3">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Dienstverband toevoegen</summary>
          <div className="border-t border-line px-4 py-3"><DienstverbandForm medewerkers={mw} /></div>
        </details>
        <p className="mt-2 text-xs text-muted">Medewerkers komen uit Beheer → Medewerkers. BSN en IBAN zijn nodig voor de loonaangifte en de betaling; ze staan alleen op de loonstrook en zijn alleen voor de eigenaar zichtbaar.</p>
      </section>
    </div>
  );
}

function DienstverbandForm({ v, medewerkers }: { v?: Dienstverband; medewerkers: { id: string; naam: string }[] }) {
  const s = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x).replace(".", ","));
  return (
    <form action={v ? dienstverbandOpslaan : dienstverbandErbij} className="flex flex-col gap-3">
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1"><span className="label">Medewerker</span>
          <select key={v?.medewerkerId ?? ""} name="medewerkerId" required defaultValue={v?.medewerkerId ?? ""} className="veld min-h-10 py-1 text-sm"><option value="" disabled>Kies…</option>{medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="label">In dienst</span><input type="date" name="inDienst" required defaultValue={v?.inDienst ?? ""} className="veld min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Uit dienst</span><input type="date" name="uitDienst" defaultValue={v?.uitDienst ?? ""} className="veld min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Bruto per maand</span><input name="brutoMaandloon" required inputMode="decimal" defaultValue={s(v?.brutoMaandloon)} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Uren per week</span><input name="urenPerWeek" inputMode="decimal" defaultValue={s(v?.urenPerWeek ?? 40)} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Vakantiegeld %</span><input name="vakantiegeldPct" inputMode="decimal" defaultValue={s(v?.vakantiegeldPct ?? 8)} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Pensioen werknemer %</span><input name="pensioenWnPct" inputMode="decimal" defaultValue={s(v?.pensioenWnPct ?? 0)} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Pensioen werkgever %</span><input name="pensioenWgPct" inputMode="decimal" defaultValue={s(v?.pensioenWgPct ?? 0)} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">Geboortedatum</span><input type="date" name="geboortedatum" defaultValue={v?.geboortedatum ?? ""} className="veld min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1"><span className="label">BSN</span><input name="bsn" inputMode="numeric" defaultValue={v?.bsn ?? ""} className="veld cijfers min-h-10 py-1 text-sm" /></label>
        <label className="flex flex-col gap-1 lg:col-span-2"><span className="label">IBAN</span><input name="iban" defaultValue={v?.iban ?? ""} className="veld cijfers min-h-10 py-1 text-sm" /></label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="loonheffingskorting" value="aan" defaultChecked={v?.loonheffingskorting ?? true} className="size-5 accent-[var(--accent)]" />Loonheffingskorting toepassen</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="onbepaaldeTijd" value="aan" defaultChecked={v?.onbepaaldeTijd ?? true} className="size-5 accent-[var(--accent)]" />Contract voor onbepaalde tijd (lage Awf)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="dga" value="aan" defaultChecked={v?.dga ?? false} className="size-5 accent-[var(--accent)]" />Dga (geen werknemersverzekeringen, Zvw ingehouden)</label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="knop knop-primair knop-klein">{v ? "Opslaan" : "Toevoegen"}</button>
        {v && v.stroken === 0 && <button type="submit" formAction={dienstverbandWeg} className="knop knop-kaal knop-klein text-danger">Verwijderen</button>}
        {v && v.stroken > 0 && <span className="text-xs text-muted">{v.stroken} loonstroken; beëindigen doe je met een datum uit dienst.</span>}
      </div>
    </form>
  );
}
