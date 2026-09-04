import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { getal } from "@/lib/datum";
import { nieuweKlant } from "./acties";

export const dynamic = "force-dynamic";

export default async function BeheerPagina() {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");

  const klanten = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select k.id, k.naam, k.code, k.plaats, k.afstand_km::float8 as afstand_km,
           k.actief,
           (select count(*) from project p
             where p.klant_id = k.id and p.status in ('concept','actief')) as projecten
    from klant k
    order by k.actief desc, k.naam
  `);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Beheer</h1>
      <p className="mt-1 text-sm text-muted">
        Klanten, projecten en projectonderdelen. De afstand per klant vult
        straks je ritten in.
      </p>

      <nav className="mt-4 flex flex-wrap gap-2">
        <Link href="/export" className="knop knop-stil">
          Uren exporteren
        </Link>
      </nav>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Klanten</h2>
      <div className="tabel-omhulsel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                Klant
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                Plaats
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Afstand
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Projecten
              </th>
            </tr>
          </thead>
          <tbody>
            {klanten.map((k) => (
              <tr key={k.id as string} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/beheer/klant/${k.id as string}`}
                    className="font-medium text-accent-ink hover:underline"
                  >
                    {k.naam as string}
                  </Link>
                  {k.code ? (
                    <span className="cijfers ml-2 text-xs text-muted">
                      {k.code as string}
                    </span>
                  ) : null}
                  {!(k.actief as boolean) && (
                    <span className="label ml-2">inactief</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {(k.plaats as string) ?? "—"}
                </td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {k.afstand_km === null ? (
                    <span className="text-warn">niet ingesteld</span>
                  ) : (
                    `${getal(Number(k.afstand_km))} km`
                  )}
                </td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {String(k.projecten)}
                </td>
              </tr>
            ))}
            {klanten.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Nog geen klanten.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={nieuweKlant} className="kaart mt-6 flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Klant toevoegen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">Naam</span>
            <input name="naam" required maxLength={120} className="veld" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Code</span>
            <input name="code" maxLength={20} className="veld cijfers" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Adres</span>
            <input name="adres" maxLength={120} className="veld" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Postcode</span>
            <input name="postcode" maxLength={12} className="veld" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Plaats</span>
            <input name="plaats" maxLength={80} className="veld" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Afstand enkele reis (km)</span>
            <input
              name="afstandKm"
              inputMode="decimal"
              className="veld cijfers"
              placeholder="vanaf kantoor"
            />
          </label>
        </div>
        <button type="submit" className="knop knop-primair self-start">
          Klant opslaan
        </button>
      </form>
    </div>
  );
}
