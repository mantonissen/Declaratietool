import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { medewerkers, functies } from "@/lib/fase2";
import { euro } from "@/lib/datum";
import { medewerkerToevoegen } from "../fase2-acties";

export const dynamic = "force-dynamic";

export default async function MedewerkersPagina() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");

  const [lijst, fl] = await Promise.all([medewerkers(sessie), functies(sessie)]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Medewerkers</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">
        Iemand die je hier toevoegt kan inloggen zodra hij dat doet met het
        e-mailadres dat hier staat; het account wordt dan vanzelf gekoppeld. De
        kostprijs is wat een uur van iemand jou kost — alleen jij ziet die.
      </p>

      <div className="tabel-omhulsel">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Naam</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Functie</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Rechten</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right">Kostprijs</th>
              <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left">Account</th>
            </tr>
          </thead>
          <tbody>
            {lijst.map((m) => (
              <tr key={m.id} className={`border-b border-line last:border-0 ${m.actief ? "" : "text-muted"}`}>
                <td className="px-3 py-2">
                  <Link href={`/beheer/medewerkers/${m.id}`} className="font-medium text-accent-ink hover:underline">{m.naam}</Link>
                  <span className="block text-xs text-muted">{m.email}{m.standplaats ? ` · ${m.standplaats}` : ""}</span>
                </td>
                <td className="px-3 py-2">{m.functie ?? <span className="text-warn">geen</span>}</td>
                <td className="px-3 py-2 capitalize">{m.rechten}</td>
                <td className="cijfers px-3 py-2 text-right">
                  {m.kostprijs === null ? <span className="text-warn">niet ingesteld</span> : `${euro(m.kostprijs)} / u`}
                </td>
                <td className="px-3 py-2 text-xs">{m.gekoppeld ? "gekoppeld" : "wacht op eerste login"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Zonder functie valt iemand buiten de tarieven per functie; zonder kostprijs
        blijft de marge op zijn uren leeg.
      </p>

      <form action={medewerkerToevoegen} className="kaart mt-6 flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Medewerker toevoegen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2"><span className="label">Naam</span><input name="naam" required maxLength={120} className="veld" /></label>
          <label className="flex flex-col gap-2"><span className="label">E-mailadres</span><input name="email" type="email" required className="veld" placeholder="waarmee hij inlogt" /></label>
          <label className="flex flex-col gap-2"><span className="label">Functie</span>
            <select name="functieId" className="veld" defaultValue=""><option value="">—</option>
              {fl.filter((f) => f.actief).map((f) => <option key={f.id} value={f.id}>{f.naam}</option>)}</select></label>
          <label className="flex flex-col gap-2"><span className="label">Rechten</span>
            <select name="rechten" className="veld" defaultValue="medewerker">
              <option value="medewerker">Medewerker</option>
              <option value="projectleider">Projectleider</option>
              <option value="eigenaar">Eigenaar</option>
            </select></label>
          <label className="flex flex-col gap-2"><span className="label">Standplaats</span><input name="standplaats" maxLength={80} className="veld" placeholder="Voor de afstand naar klanten" /></label>
        </div>
        <button type="submit" className="knop knop-primair self-start">Toevoegen</button>
      </form>
    </div>
  );
}
