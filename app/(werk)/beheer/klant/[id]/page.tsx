import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { getal } from "@/lib/datum";
import { werkKlantBij, nieuwProject } from "../../acties";

export const dynamic = "force-dynamic";

export default async function KlantPagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const { id } = await params;

  const [klanten, projecten] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`
      select id, naam, code, plaats, adres, postcode, contactpersoon,
             factuur_referentie, specificatie_omschrijving, specificatie_tarieven,
             afstand_km::float8 as afstand_km, actief
      from klant where id = ${id}
    `,
    await tx`
      select p.id, p.naam, p.code, p.status,
             p.budget_uren::float8 as budget_uren,
             (select count(*) from projectonderdeel o
               where o.project_id = p.id and o.actief) as onderdelen
      from project p
      where p.klant_id = ${id}
      order by p.status, p.naam
    `,
  ]);

  const klant = klanten[0];
  if (!klant) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">
        ← Beheer
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
        {klant.naam as string}
      </h1>

      <form action={werkKlantBij} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="id" value={id} />
        <h2 className="text-lg font-semibold">Gegevens</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">Naam</span>
            <input
              name="naam"
              required
              defaultValue={klant.naam as string}
              className="veld"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Code</span>
            <input
              name="code"
              defaultValue={(klant.code as string) ?? ""}
              className="veld cijfers"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Adres</span>
            <input
              name="adres"
              defaultValue={(klant.adres as string) ?? ""}
              className="veld"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Postcode</span>
            <input
              name="postcode"
              defaultValue={(klant.postcode as string) ?? ""}
              className="veld"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Plaats</span>
            <input
              name="plaats"
              defaultValue={(klant.plaats as string) ?? ""}
              className="veld"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Afstand enkele reis (km)</span>
            <input
              name="afstandKm"
              inputMode="decimal"
              defaultValue={
                klant.afstand_km === null ? "" : String(klant.afstand_km)
              }
              className="veld cijfers"
            />
            <span className="text-xs text-muted">
              Hiermee vult een bezoek zichzelf in. Woont een collega elders, dan
              kan hij zijn eigen afstand aanpassen bij het invoeren.
            </span>
          </label>
        </div>
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">Contactpersoon</span>
            <input name="contactpersoon" defaultValue={(klant.contactpersoon as string) ?? ""} className="veld" placeholder="Komt op de specificatie" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Referentie van de klant</span>
            <input name="factuurReferentie" defaultValue={(klant.factuur_referentie as string) ?? ""} className="veld" placeholder="Inkoopnummer of PO" />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
          <legend className="label mb-1">Urenspecificatie voor deze klant</legend>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="specOmschrijving" value="aan" defaultChecked={klant.specificatie_omschrijving as boolean} className="size-5 accent-[var(--accent)]" />
            Met omschrijvingen van de urenregels
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="specTarieven" value="aan" defaultChecked={klant.specificatie_tarieven as boolean} className="size-5 accent-[var(--accent)]" />
            Met uurtarieven en bedragen
          </label>
        </fieldset>
        <label className="flex items-center gap-3 border-t border-line pt-4 text-sm">
          <input
            type="checkbox"
            name="actief"
            value="aan"
            defaultChecked={klant.actief as boolean}
            className="size-5 accent-[var(--accent)]"
          />
          Actief
        </label>
        <button type="submit" className="knop knop-primair self-start">
          Opslaan
        </button>
      </form>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Projecten</h2>
      <div className="tabel-omhulsel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                Project
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                Status
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Budget
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Onderdelen
              </th>
            </tr>
          </thead>
          <tbody>
            {projecten.map((p) => (
              <tr key={p.id as string} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/beheer/project/${p.id as string}`}
                    className="font-medium text-accent-ink hover:underline"
                  >
                    {p.naam as string}
                  </Link>
                  {p.code ? (
                    <span className="cijfers ml-2 text-xs text-muted">
                      {p.code as string}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-muted">{p.status as string}</td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {p.budget_uren === null ? "—" : `${getal(Number(p.budget_uren), 0)} u`}
                </td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {String(p.onderdelen)}
                </td>
              </tr>
            ))}
            {projecten.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Nog geen projecten voor deze klant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={nieuwProject} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="klantId" value={id} />
        <h2 className="text-lg font-semibold">Project toevoegen</h2>
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
            <span className="label">Budget in uren</span>
            <input name="budgetUren" inputMode="decimal" className="veld cijfers" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Budget in euro</span>
            <input name="budgetBedrag" inputMode="decimal" className="veld cijfers" />
          </label>
        </div>
        <button type="submit" className="knop knop-primair self-start">
          Project opslaan
        </button>
      </form>
    </div>
  );
}
