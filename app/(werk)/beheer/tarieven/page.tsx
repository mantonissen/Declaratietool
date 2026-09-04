import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { tariefregels, functies, kmTarieven, NIVEAU_NAAM } from "@/lib/fase2";
import { euro, getal, korteDatum, vandaag } from "@/lib/datum";
import {
  tariefToevoegen, tariefBeeindigen, tariefVerwijderen,
  functieToevoegen, kmTariefToevoegen,
} from "../fase2-acties";

export const dynamic = "force-dynamic";

export default async function TarievenPagina() {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const eigenaar = sessie.rechten === "eigenaar";

  const [regels, fl, km, klanten, projecten, onderdelen] = await Promise.all([
    tariefregels(sessie),
    functies(sessie),
    kmTarieven(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select id, naam from klant where actief order by naam`),
    alsGebruiker(sessie.authUserId, (tx) => tx`
      select p.id, p.naam, k.naam as klant from project p join klant k on k.id = p.klant_id
      where p.status in ('concept','actief') order by k.naam, p.naam`),
    alsGebruiker(sessie.authUserId, (tx) => tx`
      select o.id, o.naam, p.naam as project from projectonderdeel o join project p on p.id = o.project_id
      where o.actief and p.status in ('concept','actief') order by p.naam, o.sortering, o.naam`),
  ]);

  const nu = vandaag();
  const perNiveau = new Map<number, typeof regels>();
  for (const r of regels) (perNiveau.get(r.niveau) ?? perNiveau.set(r.niveau, []).get(r.niveau)!).push(r);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Tarieven</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
        Bij het berekenen van een urenregel wordt van boven naar beneden gezocht en
        de eerste treffer telt: onderdeel, dan project × functie, project, klant ×
        functie, klant, en als laatste het standaardtarief van de functie. Elke regel
        geldt vanaf een datum, dus oude uren blijven wat ze waren.
      </p>

      {[2, 3, 4, 5, 6, 7].map((n) => {
        const lijst = perNiveau.get(n) ?? [];
        if (!lijst.length) return null;
        return (
          <section key={n} className="mb-5">
            <h2 className="mb-1 flex items-baseline gap-2 text-base font-semibold">
              <span className="cijfers text-xs text-muted">{n}</span>{NIVEAU_NAAM[n]}
            </h2>
            <div className="tabel-omhulsel">
              <table className="w-full text-sm">
                <tbody>
                  {lijst.map((r) => {
                    const actief = r.geldigVanaf <= nu && (!r.geldigTot || r.geldigTot >= nu);
                    return (
                      <tr key={r.id} className={`border-b border-line last:border-0 ${actief ? "" : "text-muted"}`}>
                        <td className="px-3 py-2">
                          <span className="block font-medium">{r.anker}{r.functie ? ` · ${r.functie}` : ""}</span>
                          <span className="block text-xs text-muted">
                            {korteDatum(r.geldigVanaf)} — {r.geldigTot ? korteDatum(r.geldigTot) : "open"}
                            {r.toelichting ? ` · ${r.toelichting}` : ""}
                          </span>
                        </td>
                        <td className="cijfers px-3 py-2 text-right font-semibold whitespace-nowrap">{euro(r.bedrag)} / u</td>
                        {eigenaar && (
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {!r.geldigTot && (
                              <form action={tariefBeeindigen} className="inline-flex items-center gap-1">
                                <input type="hidden" name="id" value={r.id} />
                                <input type="date" name="geldigTot" required aria-label="Beëindigen per" className="veld min-h-9 w-36 py-1 text-xs" />
                                <button type="submit" className="knop knop-kaal knop-klein">Beëindigen</button>
                              </form>
                            )}
                            <form action={tariefVerwijderen} className="inline">
                              <input type="hidden" name="id" value={r.id} />
                              <button type="submit" className="knop knop-kaal knop-klein text-danger">Verwijderen</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {regels.length === 0 && <p className="mb-6 text-sm text-muted">Nog geen tarieven. Zonder tarieven blijft de omzet leeg.</p>}

      {eigenaar && (
        <form action={tariefToevoegen} className="kaart mb-8 flex flex-col gap-4 p-4">
          <h2 className="text-lg font-semibold">Tarief toevoegen</h2>
          <p className="text-sm text-muted">
            Vul in waar het tarief aan hangt. Het meest specifieke telt: een onderdeel
            gaat vóór een project, een project vóór een klant. Een functie erbij maakt
            het een tarief voor die functie op dat project of die klant.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2"><span className="label">Klant</span>
              <select name="klantId" className="veld" defaultValue=""><option value="">—</option>
                {klanten.map((k) => <option key={k.id as string} value={k.id as string}>{k.naam as string}</option>)}</select></label>
            <label className="flex flex-col gap-2"><span className="label">Project</span>
              <select name="projectId" className="veld" defaultValue=""><option value="">—</option>
                {projecten.map((p) => <option key={p.id as string} value={p.id as string}>{p.klant as string} · {p.naam as string}</option>)}</select></label>
            <label className="flex flex-col gap-2"><span className="label">Projectonderdeel</span>
              <select name="onderdeelId" className="veld" defaultValue=""><option value="">—</option>
                {onderdelen.map((o) => <option key={o.id as string} value={o.id as string}>{o.project as string} · {o.naam as string}</option>)}</select></label>
            <label className="flex flex-col gap-2"><span className="label">Functie</span>
              <select name="functieId" className="veld" defaultValue=""><option value="">— (alle functies)</option>
                {fl.filter((f) => f.actief).map((f) => <option key={f.id} value={f.id}>{f.naam}</option>)}</select></label>
            <label className="flex flex-col gap-2"><span className="label">Tarief per uur</span>
              <input name="bedrag" inputMode="decimal" required className="veld cijfers" placeholder="145,00" /></label>
            <label className="flex flex-col gap-2"><span className="label">Geldig vanaf</span>
              <input name="geldigVanaf" type="date" required defaultValue={nu.slice(0, 8) + "01"} className="veld" /></label>
            <label className="flex flex-col gap-2"><span className="label">Geldig tot en met <span className="normal-case tracking-normal">(optioneel)</span></span>
              <input name="geldigTot" type="date" className="veld" /></label>
            <label className="flex flex-col gap-2"><span className="label">Toelichting</span>
              <input name="toelichting" maxLength={120} className="veld" /></label>
          </div>
          <button type="submit" className="knop knop-primair self-start">Tarief opslaan</button>
        </form>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Functies</h2>
          <ul className="kaart divide-y divide-line">
            {fl.map((f) => (
              <li key={f.id} className={`px-4 py-2 text-sm ${f.actief ? "" : "text-muted"}`}>{f.naam}</li>
            ))}
          </ul>
          {eigenaar && (
            <form action={functieToevoegen} className="mt-3 flex gap-2">
              <input name="naam" required maxLength={60} className="veld" placeholder="Nieuwe functie" />
              <button type="submit" className="knop knop-stil">Toevoegen</button>
            </form>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Kilometervergoeding</h2>
          <ul className="kaart divide-y divide-line">
            {km.map((k) => (
              <li key={k.id} className="flex items-baseline gap-3 px-4 py-2 text-sm">
                <span className="cijfers font-semibold">{euro(k.bedrag)}</span>
                <span className="text-xs text-muted">
                  per km · {korteDatum(k.geldigVanaf)} — {k.geldigTot ? korteDatum(k.geldigTot) : "open"}
                  {k.toelichting ? ` · ${k.toelichting}` : ""}
                </span>
              </li>
            ))}
            {km.length === 0 && <li className="px-4 py-2 text-sm text-warn">Geen bedrag ingesteld; ritten krijgen geen waarde.</li>}
          </ul>
          {eigenaar && (
            <form action={kmTariefToevoegen} className="mt-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input name="bedrag" inputMode="decimal" required className="veld cijfers" placeholder="0,23" aria-label="Bedrag per km" />
                <input name="geldigVanaf" type="date" required className="veld" aria-label="Geldig vanaf" />
              </div>
              <div className="flex gap-2">
                <input name="toelichting" maxLength={120} className="veld" placeholder="Bijvoorbeeld: onbelaste vergoeding 2027" />
                <button type="submit" className="knop knop-stil">Toevoegen</button>
              </div>
              <p className="text-xs text-muted">De lopende periode wordt automatisch de dag ervoor afgesloten. Controleer het bedrag per jaar — het is {getal(km[0]?.bedrag ?? 0, 2)} nu.</p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
