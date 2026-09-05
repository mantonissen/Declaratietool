import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie, magBeheren, zietBedragen } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { termijnenVan, grootboekrekeningen } from "@/lib/facturatie";
import { euro, getal, korteDatum } from "@/lib/datum";
import { nieuwOnderdeel, wisselOnderdeel, werkProjectBij } from "../../acties";
import { termijnToevoegen, termijnVerwijderen } from "../../../facturen/acties";

export const dynamic = "force-dynamic";

export default async function ProjectPagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) redirect("/uren");
  const { id } = await params;
  const eigenaar = sessie.rechten === "eigenaar";

  const [projecten, onderdelen, uitputting] = await alsGebruiker(
    sessie.authUserId,
    async (tx) => [
      await tx`
        select p.id, p.naam, p.code, p.status, p.klant_id, p.facturatiemodel::text as model,
               p.vaste_prijs::float8 as vaste_prijs, p.budget_bedrag::float8 as budget_bedrag,
               p.herhaal_interval::text as herhaal_interval, p.herhaal_bedrag::float8 as herhaal_bedrag,
               p.herhaal_omschrijving, p.herhaal_start, p.herhaal_einde, p.herhaal_volgende,
               p.automatisch_factureren, p.grootboek_id,
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
               budget_uren_verbruikt_pct::float8 as verbruikt_pct,
               effectief_uurtarief::float8 as effectief,
               termijn_gefactureerd::float8 as termijn_gefactureerd,
               termijn_open::float8 as termijn_open
        from v_project_uitputting where project_id = ${id}
      `,
    ],
  );

  const project = projecten[0];
  if (!project) notFound();
  const cijfers = uitputting[0];
  const vast = project.model === "vaste_prijs";
  const abonnement = project.model === "abonnement";
  const termijnen = zietBedragen(sessie.rechten) ? await termijnenVan(sessie, id) : [];
  const rekeningen = eigenaar ? (await grootboekrekeningen(sessie)).filter((r) => r.actief || r.id === project.grootboek_id) : [];
  const termijnTotaal = termijnen.reduce((s, t) => s + t.bedrag, 0);

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
        {(vast || abonnement) && <span className="label ml-3 rounded bg-accent-bg px-1.5 py-0.5 align-middle text-accent-ink">{abonnement ? "abonnement" : "vaste prijs"}</span>}
      </h1>

      {cijfers && (
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <dt className="label">Besteed</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">{getal(Number(cijfers.bestede_uren))} u</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="label">Van budget</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">
              {cijfers.verbruikt_pct === null ? "—" : `${getal(Number(cijfers.verbruikt_pct))}%`}
            </dd>
          </div>
          {zietBedragen(sessie.rechten) && (
            <>
              <div className="bg-surface px-4 py-3">
                <dt className="label">{vast ? "Gefactureerd" : "Omzet"}</dt>
                <dd className="cijfers mt-0.5 text-lg font-semibold">{euro(cijfers.omzet === null ? null : Number(cijfers.omzet))}</dd>
                {vast && <dd className="cijfers text-xs text-muted">effectief {cijfers.effectief === null ? "—" : euro(Number(cijfers.effectief)) + "/u"}</dd>}
              </div>
              <div className="bg-surface px-4 py-3">
                <dt className="label">Marge</dt>
                <dd className="cijfers mt-0.5 text-lg font-semibold">
                  {eigenaar ? euro(cijfers.marge === null ? null : Number(cijfers.marge)) : "—"}
                </dd>
              </div>
            </>
          )}
        </dl>
      )}

      <form action={werkProjectBij} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="id" value={id} />
        <h2 className="text-lg font-semibold">Project</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2"><span className="label">Naam</span><input name="naam" required defaultValue={project.naam as string} className="veld" /></label>
          <label className="flex flex-col gap-2"><span className="label">Code</span><input name="code" defaultValue={(project.code as string) ?? ""} className="veld cijfers" /></label>
          <label className="flex flex-col gap-2"><span className="label">Status</span>
            <select key={project.status as string} name="status" defaultValue={project.status as string} className="veld">
              <option value="concept">Concept</option><option value="actief">Actief</option>
              <option value="afgerond">Afgerond</option><option value="gearchiveerd">Gearchiveerd</option>
            </select></label>
          <label className="flex flex-col gap-2"><span className="label">Budget in uren</span><input name="budgetUren" inputMode="decimal" defaultValue={project.budget_uren === null ? "" : String(project.budget_uren)} className="veld cijfers" /></label>
          <label className="flex flex-col gap-2"><span className="label">Facturatie</span>
            <select key={project.model as string} name="facturatiemodel" defaultValue={project.model as string} className="veld" disabled={!eigenaar}>
              <option value="nacalculatie">Nacalculatie — uren × tarief</option>
              <option value="vaste_prijs">Vaste prijs — in termijnen</option>
              <option value="abonnement">Abonnement — vast bedrag per periode</option>
            </select>
            {!eigenaar && <input type="hidden" name="facturatiemodel" value={project.model as string} />}
          </label>
          <label className="flex flex-col gap-2"><span className="label">Vaste prijs (bij dat model)</span>
            <input name="vastePrijs" inputMode="decimal" defaultValue={project.vaste_prijs === null ? "" : String(project.vaste_prijs)} className="veld cijfers" placeholder="afgesproken som excl. btw" /></label>
          {eigenaar && (
            <label className="flex flex-col gap-2 sm:col-span-2"><span className="label">Grootboekrekening voor de omzet</span>
              {/* key op de waarde: na een server-actie zet React het formulier terug,
                  en een select zou anders de oude keuze tonen */}
              <select key={(project.grootboek_id as string) ?? "geen"} name="grootboekId" defaultValue={(project.grootboek_id as string) ?? ""} className="veld">
                <option value="">Standaard voor dit soort project</option>
                {rekeningen.map((r) => <option key={r.id} value={r.id}>{r.nummer} · {r.naam}</option>)}
              </select>
              <span className="text-xs text-muted">Waar de uren of termijnen van dit project in de boekhouding landen. Reiskosten houden hun eigen rekening.</span>
            </label>
          )}
        </div>

        {eigenaar && (
          <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <legend className="label mb-1">Abonnement (bij dat model)</legend>
            <label className="flex flex-col gap-2"><span className="label">Elke</span>
              <select key={(project.herhaal_interval as string) ?? "maand"} name="herhaalInterval" defaultValue={(project.herhaal_interval as string) ?? "maand"} className="veld">
                <option value="maand">Maand</option><option value="kwartaal">Kwartaal</option><option value="jaar">Jaar</option>
              </select></label>
            <label className="flex flex-col gap-2"><span className="label">Bedrag per periode</span>
              <input name="herhaalBedrag" inputMode="decimal" defaultValue={project.herhaal_bedrag === null ? "" : String(project.herhaal_bedrag)} className="veld cijfers" placeholder="excl. btw" /></label>
            <label className="flex flex-col gap-2"><span className="label">Omschrijving op de factuur</span>
              <input name="herhaalOmschrijving" defaultValue={(project.herhaal_omschrijving as string) ?? ""} className="veld" placeholder="Bijvoorbeeld: Beheer en monitoring" /></label>
            <label className="flex flex-col gap-2"><span className="label">Eerste periode begint op</span>
              <input name="herhaalStart" type="date" defaultValue={(project.herhaal_start as string) ?? ""} className="veld" /></label>
            <label className="flex flex-col gap-2"><span className="label">Laatste periode <span className="normal-case tracking-normal">(optioneel)</span></span>
              <input name="herhaalEinde" type="date" defaultValue={(project.herhaal_einde as string) ?? ""} className="veld" /></label>
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <input type="checkbox" name="automatisch" value="aan" defaultChecked={project.automatisch_factureren as boolean} className="size-5 accent-[var(--accent)]" />
              Automatisch factureren met een nummer uit de reeks
            </label>
            {abonnement && project.herhaal_volgende && (
              <p className="text-xs text-muted sm:col-span-2">
                Volgende periode die wordt aangemaakt: {korteDatum(project.herhaal_volgende as string)}.
                Zonder vinkje verschijnt elke periode als open termijn in het factuurvoorstel.
              </p>
            )}
          </fieldset>
        )}
        <button type="submit" className="knop knop-primair self-start">Opslaan</button>
      </form>

      {(vast || abonnement) && zietBedragen(sessie.rechten) && (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold">Termijnen</h2>
          <p className="mb-3 text-sm text-muted">
            {abonnement ? (
              <>Per periode automatisch aangemaakt; wat hier staat is de historie.</>
            ) : (
              <>Bij welke opleveringen je factureert. Vaste prijs {euro(Number(project.vaste_prijs ?? 0))}
              {termijnTotaal !== Number(project.vaste_prijs ?? 0) && (
                <span className="text-warn"> — termijnen tellen op tot {euro(termijnTotaal)}</span>
              )}.</>
            )}
          </p>
          <ul className="kaart divide-y divide-line">
            {termijnen.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="cijfers w-6 text-xs text-muted">{t.volgorde}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.omschrijving}</span>
                  <span className="block text-xs text-muted">
                    {t.geplandOp ? `gepland ${korteDatum(t.geplandOp)}` : "geen datum"}
                    {t.factuurReferentie ? ` · gefactureerd als ${t.factuurReferentie}` : " · open"}
                  </span>
                </span>
                <span className="cijfers font-semibold">{euro(t.bedrag)}</span>
                {eigenaar && !t.factuurReferentie && (
                  <form action={termijnVerwijderen}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="projectId" value={id} />
                    <button type="submit" className="knop knop-kaal knop-klein text-danger">Verwijderen</button>
                  </form>
                )}
              </li>
            ))}
            {termijnen.length === 0 && <li className="px-4 py-2 text-sm text-warn">Nog geen termijnen; zonder termijnen valt er niets te factureren.</li>}
          </ul>
          {eigenaar && (
            <form action={termijnToevoegen} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={id} />
              <input name="omschrijving" required maxLength={120} placeholder="Bijvoorbeeld: bij opdracht (30%)" className="veld min-h-10 flex-1 py-1" />
              <input name="bedrag" required inputMode="decimal" placeholder="bedrag" className="veld cijfers min-h-10 w-32 py-1" />
              <input name="geplandOp" type="date" className="veld min-h-10 w-40 py-1" aria-label="Gepland op" />
              <button type="submit" className="knop knop-stil">Termijn toevoegen</button>
            </form>
          )}
        </section>
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
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-left">Onderdeel</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Geschreven</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Budget</th>
              <th className="label border-b border-line bg-surface-2 px-4 py-2 text-right">Actief</th>
            </tr>
          </thead>
          <tbody>
            {onderdelen.map((o) => (
              <tr key={o.id as string} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{o.naam as string}</span>
                  {!(o.declarabel as boolean) && <span className="label ml-2">niet declarabel</span>}
                </td>
                <td className="cijfers px-4 py-2.5 text-right">{getal(Number(o.minuten) / 60)} u</td>
                <td className="cijfers px-4 py-2.5 text-right">{o.budget_uren === null ? "—" : `${getal(Number(o.budget_uren), 0)} u`}</td>
                <td className="px-4 py-2.5 text-right">
                  <form action={wisselOnderdeel}>
                    <input type="hidden" name="id" value={o.id as string} />
                    <input type="hidden" name="projectId" value={id} />
                    <button type="submit" className="knop knop-kaal text-sm">{(o.actief as boolean) ? "Actief" : "Inactief"}</button>
                  </form>
                </td>
              </tr>
            ))}
            {onderdelen.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">Nog geen onderdelen. Zonder onderdeel kan er niet op dit project geschreven worden.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={nieuwOnderdeel} className="kaart mt-6 flex flex-col gap-4 p-4">
        <input type="hidden" name="projectId" value={id} />
        <h2 className="text-lg font-semibold">Onderdeel toevoegen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2"><span className="label">Naam</span><input name="naam" required maxLength={120} className="veld" placeholder="Bijvoorbeeld: Ontwerp" /></label>
          <label className="flex flex-col gap-2"><span className="label">Budget in uren</span><input name="budgetUren" inputMode="decimal" className="veld cijfers" /></label>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="declarabel" value="aan" defaultChecked className="size-5 accent-[var(--accent)]" />
          Declarabel
        </label>
        <button type="submit" className="knop knop-primair self-start">Onderdeel opslaan</button>
      </form>
    </div>
  );
}
