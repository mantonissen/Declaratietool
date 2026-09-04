import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { medewerkers, functies, kostprijzenVan } from "@/lib/fase2";
import { euro, korteDatum, vandaag } from "@/lib/datum";
import { medewerkerBijwerken, kostprijsToevoegen } from "../../fase2-acties";

export const dynamic = "force-dynamic";

export default async function MedewerkerPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const { id } = await params;

  const [lijst, fl, kp] = await Promise.all([medewerkers(sessie), functies(sessie), kostprijzenVan(sessie, id)]);
  const m = lijst.find((x) => x.id === id);
  if (!m) notFound();
  const nu = vandaag();

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer/medewerkers" className="knop knop-kaal -ml-2">← Medewerkers</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">{m.naam}</h1>
      <p className="mt-1 text-sm text-muted">{m.email} · {m.gekoppeld ? "account gekoppeld" : "wacht op eerste login"}</p>

      <form action={medewerkerBijwerken} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="id" value={m.id} />
        <h2 className="text-lg font-semibold">Gegevens</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2"><span className="label">Naam</span><input name="naam" required defaultValue={m.naam} className="veld" /></label>
          <label className="flex flex-col gap-2"><span className="label">Standplaats</span><input name="standplaats" defaultValue={m.standplaats ?? ""} className="veld" /></label>
          <label className="flex flex-col gap-2"><span className="label">Functie</span>
            <select name="functieId" className="veld" defaultValue={m.functieId ?? ""}><option value="">—</option>
              {fl.map((f) => <option key={f.id} value={f.id}>{f.naam}</option>)}</select></label>
          <label className="flex flex-col gap-2"><span className="label">Rechten</span>
            <select name="rechten" className="veld" defaultValue={m.rechten} disabled={m.id === sessie.medewerkerId}>
              <option value="medewerker">Medewerker</option>
              <option value="projectleider">Projectleider</option>
              <option value="eigenaar">Eigenaar</option>
            </select>
            {m.id === sessie.medewerkerId && <input type="hidden" name="rechten" value="eigenaar" />}
          </label>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="actief" value="aan" defaultChecked={m.actief} className="size-5 accent-[var(--accent)]" />
          Actief
          <span className="text-xs text-muted">— uit dienst? Zet dit uit; de uren blijven bewaard.</span>
        </label>
        <button type="submit" className="knop knop-primair self-start">Opslaan</button>
      </form>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Kostprijs</h2>
        <p className="mb-3 text-sm text-muted">
          Wat een uur van {m.naam.split(" ")[0]} kost, inclusief werkgeverslasten en
          overhead. Een schatting is genoeg om te sturen. Een nieuwe periode sluit
          de vorige automatisch af, zodat oude uren hun oude kostprijs houden.
        </p>
        <ul className="kaart divide-y divide-line">
          {kp.map((k) => {
            const actief = k.geldigVanaf <= nu && (!k.geldigTot || k.geldigTot >= nu);
            return (
              <li key={k.id} className={`flex items-baseline gap-3 px-4 py-2 text-sm ${actief ? "" : "text-muted"}`}>
                <span className="cijfers font-semibold">{euro(k.bedrag)} / u</span>
                <span className="text-xs text-muted">
                  {korteDatum(k.geldigVanaf)} — {k.geldigTot ? korteDatum(k.geldigTot) : "open"}
                  {k.toelichting ? ` · ${k.toelichting}` : ""}
                </span>
                {actief && <span className="label ml-auto text-accent-ink">nu</span>}
              </li>
            );
          })}
          {kp.length === 0 && <li className="px-4 py-2 text-sm text-warn">Nog geen kostprijs; de marge op deze uren blijft leeg.</li>}
        </ul>
        <form action={kostprijsToevoegen} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="medewerkerId" value={m.id} />
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
            <input name="bedrag" inputMode="decimal" required className="veld cijfers" placeholder="62,00" aria-label="Kostprijs per uur" />
            <input name="geldigVanaf" type="date" required defaultValue={nu.slice(0, 4) + "-01-01"} className="veld" aria-label="Geldig vanaf" />
            <input name="toelichting" maxLength={120} className="veld" placeholder="Bijvoorbeeld: na salarisronde" />
            <button type="submit" className="knop knop-stil">Toevoegen</button>
          </div>
        </form>
      </section>
    </div>
  );
}
