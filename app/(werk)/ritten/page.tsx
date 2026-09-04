import Link from "next/link";
import { vereisteSessie, zietBedragen } from "@/lib/auth";
import { weekOverzicht, klantKeuzes } from "@/lib/data";
import { alsGebruiker } from "@/lib/db";
import {
  euro,
  getal,
  isGeldigeDatum,
  isoWeek,
  korteDatum,
  maandagVan,
  vandaag,
  verschuif,
  weekDagen,
} from "@/lib/datum";
import { RitFormulier } from "@/components/RitFormulier";
import { schrapRit } from "./acties";

export const dynamic = "force-dynamic";

const DOEL_LABEL: Record<string, string> = {
  klantbezoek: "Klantbezoek",
  locatiebezoek: "Locatiebezoek",
  overleg: "Overleg",
  opleiding: "Opleiding",
  overig: "Overig",
};

export default async function RittenPagina({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const sessie = await vereisteSessie();
  const params = await searchParams;

  const gekozen = isGeldigeDatum(params.datum) ? params.datum : vandaag();
  const maandag = maandagVan(gekozen);
  const dagen = weekDagen(maandag);
  const { jaar, week } = isoWeek(maandag);

  const [{ ritten, weekstaat }, klanten, projecten] = await Promise.all([
    weekOverzicht(sessie, maandag),
    klantKeuzes(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`
      select id, naam, klant_id from project
      where status in ('concept', 'actief')
      order by naam
    `),
  ]);

  const vergrendeld =
    weekstaat?.status === "ingediend" || weekstaat?.status === "goedgekeurd";
  const totaalKm = ritten.reduce((s, r) => s + r.totaalKm, 0);
  const totaalBedrag = ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);
  const bezoeken = ritten.filter(
    (r) => r.doel === "klantbezoek" || r.doel === "locatiebezoek",
  ).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            Week {week} · {jaar}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            Ritten en bezoeken
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/ritten?datum=${verschuif(maandag, -7)}`}
            aria-label="Vorige week"
            className="knop knop-stil px-3"
          >
            ←
          </Link>
          <Link href="/ritten" className="knop knop-stil">
            Deze week
          </Link>
          <Link
            href={`/ritten?datum=${verschuif(maandag, 7)}`}
            aria-label="Volgende week"
            className="knop knop-stil px-3"
          >
            →
          </Link>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-line py-3">
        <div>
          <p className="label">Kilometers</p>
          <p className="cijfers text-xl font-semibold">{getal(totaalKm)}</p>
        </div>
        <div>
          <p className="label">Bezoeken</p>
          <p className="cijfers text-xl font-semibold">{bezoeken}</p>
        </div>
        {zietBedragen(sessie.rechten) && (
          <div>
            <p className="label">Te declareren</p>
            <p className="cijfers text-xl font-semibold">{euro(totaalBedrag)}</p>
          </div>
        )}
      </div>

      {ritten.length > 0 ? (
        <ul className="mb-6 flex flex-col gap-2">
          {ritten.map((r) => (
            <li key={r.id} className="kaart flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.klant ?? "Zonder klant"}
                </p>
                <p className="text-xs text-muted">
                  {korteDatum(r.datum)} · {DOEL_LABEL[r.doel] ?? r.doel}
                  {r.retour ? " · retour" : " · enkele reis"}
                </p>
                {r.omschrijving && (
                  <p className="mt-1 text-xs text-ink-2">{r.omschrijving}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="cijfers text-sm font-semibold">
                  {getal(r.totaalKm)} km
                </p>
                {zietBedragen(sessie.rechten) && (
                  <p className="cijfers text-xs text-muted">{euro(r.kmBedrag)}</p>
                )}
              </div>
              {!vergrendeld && r.status === "concept" && (
                <form action={schrapRit} className="shrink-0">
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    aria-label={`Rit van ${korteDatum(r.datum)} verwijderen`}
                    className="knop knop-kaal text-muted hover:text-danger"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      aria-hidden="true"
                      className="size-4"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">Deze week nog geen ritten.</p>
      )}

      {vergrendeld ? (
        <p className="rounded border border-line bg-surface-2 px-4 py-3 text-sm">
          Deze week is <strong>{weekstaat?.status}</strong>; er kan niets bij.
        </p>
      ) : (
        <RitFormulier
          klanten={klanten}
          projecten={projecten.map((p) => ({
            id: p.id as string,
            naam: p.naam as string,
            klantId: p.klant_id as string,
          }))}
          standaardDatum={dagen.includes(vandaag()) ? vandaag() : maandag}
        />
      )}
    </div>
  );
}
