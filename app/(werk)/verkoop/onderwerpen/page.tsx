import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { onderwerpen, ONDERWERP_STATUSSEN, STATUS_LABEL, FASE_LABEL } from "@/lib/verkoop";
import { onderwerpErbij, onderwerpOpslaan } from "../acties";

export const dynamic = "force-dynamic";

export default async function OnderwerpenPagina() {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const lijst = await onderwerpen(sessie);
  const totaal = (o: (typeof lijst)[number]) => o.prospects.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/verkoop" className="knop knop-kaal -ml-2">← Verkoop</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Onderwerpen</h1>
      <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">De diensten en thema's die je met prospects bespreekt. Per onderwerp zie je wie erin geïnteresseerd is en hoe ver het staat; zo weet je waar de vraag zit.</p>

      <div className="tabel-omhulsel">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Onderwerp</th>
            {ONDERWERP_STATUSSEN.map((s) => <th key={s} className="label border-b border-line bg-surface-2 px-2 py-2 text-right">{STATUS_LABEL[s]}</th>)}
            <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Totaal</th>
          </tr></thead>
          <tbody>
            {lijst.map((o) => (
              <tr key={o.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <span className={`font-medium ${o.actief ? "" : "text-muted line-through"}`}>{o.naam}</span>
                      {o.omschrijving && <span className="block text-xs text-muted">{o.omschrijving}</span>}
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                      {o.prospects.length > 0 && (
                        <ul className="flex flex-col gap-1 text-xs">
                          {o.prospects.map((p) => <li key={p.id}><Link href={`/verkoop/${p.id}`} className="text-accent-ink hover:underline">{p.naam}</Link> <span className="text-muted">· {FASE_LABEL[p.fase]} · {STATUS_LABEL[p.status]}</span></li>)}
                        </ul>
                      )}
                      <form action={onderwerpOpslaan} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <input name="naam" required defaultValue={o.naam} maxLength={80} className="veld min-h-9 w-48 py-1 text-sm" aria-label="Naam" />
                        <input name="omschrijving" defaultValue={o.omschrijving ?? ""} maxLength={200} placeholder="omschrijving" className="veld min-h-9 min-w-48 flex-1 py-1 text-sm" aria-label="Omschrijving" />
                        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="actief" value="aan" defaultChecked={o.actief} className="size-5 accent-[var(--accent)]" />Actief</label>
                        <button type="submit" className="knop knop-stil knop-klein">Opslaan</button>
                      </form>
                    </div>
                  </details>
                </td>
                {ONDERWERP_STATUSSEN.map((s) => <td key={s} className={`cijfers px-2 py-2 text-right ${o.per[s] ? "" : "text-muted"}`}>{o.per[s] || "—"}</td>)}
                <td className="cijfers px-3 py-2 text-right font-semibold">{totaal(o)}</td>
              </tr>
            ))}
            {lijst.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">Nog geen onderwerpen.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Klik een onderwerp open voor de prospects en om het te bewerken. Een onderwerp dat je niet meer aanbiedt, zet je inactief; het blijft staan bij prospects die het hadden.</p>

      <form action={onderwerpErbij} className="kaart mt-6 flex flex-wrap items-end gap-3 p-4">
        <h2 className="w-full text-lg font-semibold">Onderwerp toevoegen</h2>
        <label className="flex flex-col gap-1"><span className="label">Naam</span><input name="naam" required maxLength={80} className="veld min-h-10 w-56 py-1" placeholder="Bijvoorbeeld: Participatie" /></label>
        <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="label">Omschrijving</span><input name="omschrijving" maxLength={200} className="veld min-h-10 py-1" /></label>
        <button type="submit" className="knop knop-primair">Toevoegen</button>
      </form>
    </div>
  );
}
