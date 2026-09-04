import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie, magBeheren, zietBedragen } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { euro, getal } from "@/lib/datum";
import { nieuwOnderdeel, wisselOnderdeel } from "../../acties";

export const dynamic = "force-dynamic";

export default async function ProjectPagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const { id } = await params;

  const [projecten, onderdelen, uitputting] = await alsGebruiker(
    sessie.authUserId,
    async (tx) => [
      await tx`
        select p.id, p.naam, p.code, p.status, p.klant_id,
               k.naam as klant, p.budget_uren::float8 as budget_uren
        from project p join klant k on k.id = p.klant_id
        where p.id = ${id}
      `,
      await tx`
        select o.id, o.naam, o.declarabel, o.actief,
               o.budget_uren::float8 as budget_uren,
               coalesce((select sum(minuten) from urenregel u
                          where u.onderdeel_id = o.id
                            and u.status <> 'vervallen'), 0) as minuten
        from projectonderdeel o
        where o.project_id = ${id}
        order by o.sortering, o.naam
      `,
      await tx`
        select bestede_uren::float8 as bestede_uren,
               omzet::float8 as omzet,
               marge::float8 as marge,
               budget_uren_verbruikt_pct::float8 as verbruikt_pct
        from v_project_uitputting where project_id = ${id}
      `,
    ],
  );

  const project = projecten[0];
  if (!project) notFound();
  const cijfers = uitputting[0];

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link
        href={`/beheer/klant/${project.klant_id as string}`}
        className="knop knop-kaal -ml-2"
      >
        ← {project.klant as string}
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
        {project.naam as string}
      </h1>

      {cijfers && (
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <dt className="label">Besteed</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">
              {getal(Number(cijfers.bestede_uren))} u
            </dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="label">Van budget</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">
              {cijfers.verbruikt_pct === null
                ? "—"
                : `${getal(Number(cijfers.verbruikt_pct))}%`}
            </dd>
          </div>
          {zietBedragen(sessie.rechten) && (
            <>
              <div className="bg-surface px-4 py-3">
                <dt className="label">Omzet</dt>
                <dd className="cijfers mt-0.5 text-lg font-semibold">
                  {euro(cijfers.omzet === null ? null : Number(cijfers.omzet))}
                </dd>
              </div>
              <div className="bg-surface px-4 py-3">
                <dt className="label">Marge</dt>
                <dd className="cijfers mt-0.5 text-lg font-semibold">
                  {sessie.rechten === "eigenaar"
                    ? euro(cijfers.marge === null ? null : Number(cijfers.marge))
                    : "—"}
                </dd>
              </div>
            </>
          )}
        </dl>
      )}

      <h2 className="mt-8 mb-2 text-lg font-semibold">Onderdelen</h2>
      <p className="mb-3 text-sm text-muted">
        Uren worden hierop geschreven. Een onderdeel dat niet declarabel is telt
        wel mee in de kosten en niet in de omzet.
      </p>
      <div className="tabel-omhulsel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">
                Onderdeel
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Geschreven
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Budget
              </th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">
                Actief
              </th>
            </tr>
          </thead>
          <tbody>
            {onderdelen.map((o) => (
              <tr key={o.id as string} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{o.naam as string}</span>
                  {!(o.declarabel as boolean) && (
                    <span className="label ml-2">niet declarabel</span>
                  )}
                </td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {getal(Number(o.minuten) / 60)} u
                </td>
                <td className="cijfers px-4 py-2.5 text-right">
                  {o.budget_uren === null
                    ? "—"
                    : `${getal(Number(o.budget_uren), 0)} u`}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <form action={wisselOnderdeel}>
                    <input type="hidden" name="id" value={o.id as string} />
                    <input type="hidden" name="projectId" value={id} />
                    <button type="submit" className="knop knop-kaal text-sm">
                      {(o.actief as boolean) ? "Actief" : "Inactief"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {onderdelen.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Nog geen onderdelen. Zonder onderdeel kan er niet op dit
                  project geschreven worden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={nieuwOnderdeel} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="projectId" value={id} />
        <h2 className="text-lg font-semibold">Onderdeel toevoegen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">Naam</span>
            <input
              name="naam"
              required
              maxLength={120}
              className="veld"
              placeholder="Bijvoorbeeld: Ontwerp"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Budget in uren</span>
            <input name="budgetUren" inputMode="decimal" className="veld cijfers" />
          </label>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="declarabel"
            value="aan"
            defaultChecked
            className="size-5 accent-[var(--accent)]"
          />
          Declarabel
        </label>
        <button type="submit" className="knop knop-primair self-start">
          Onderdeel opslaan
        </button>
      </form>
    </div>
  );
}
