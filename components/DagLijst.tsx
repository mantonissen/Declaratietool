import Link from "next/link";
import type { Urenregel } from "@/lib/data";
import { dagNaam, isWeekend, korteDatum, minutenAlsTijd, type Datum } from "@/lib/datum";
import { verwijderRegel } from "@/app/(werk)/uren/acties";

/**
 * De mobiele weergave (keuze C1a): per dag een kaart. Werkt met gewone
 * formulieren, dus ook zonder javascript.
 */
export function DagLijst({
  dagen,
  regels,
  vandaagDatum,
  vergrendeld,
}: {
  dagen: Datum[];
  regels: Urenregel[];
  vandaagDatum: Datum;
  vergrendeld: boolean;
}) {
  const perDag = new Map<Datum, Urenregel[]>();
  for (const d of dagen) perDag.set(d, []);
  for (const r of regels) perDag.get(r.datum)?.push(r);

  return (
    <div className="flex flex-col gap-3">
      {dagen.map((d) => {
        const dagRegels = perDag.get(d) ?? [];
        const totaal = dagRegels.reduce((s, r) => s + r.minuten, 0);
        const isVandaag = d === vandaagDatum;

        // Lege weekenddagen zijn ruis op een klein scherm.
        if (dagRegels.length === 0 && isWeekend(d) && !isVandaag) return null;

        return (
          <section
            key={d}
            className={`kaart overflow-hidden ${
              isVandaag ? "border-accent" : ""
            }`}
          >
            <header
              className={`flex items-baseline gap-2 border-b border-line px-4 py-2.5 ${
                isVandaag ? "bg-accent-bg" : "bg-surface-2"
              }`}
            >
              <h3 className="text-sm font-semibold capitalize">{dagNaam(d)}</h3>
              <span className="text-xs text-muted">{korteDatum(d)}</span>
              {isVandaag && <span className="label text-accent-ink">vandaag</span>}
              <span className="cijfers ml-auto text-sm font-semibold">
                {totaal ? minutenAlsTijd(totaal) : "—"}
              </span>
            </header>

            <ul>
              {dagRegels.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.onderdeel}</p>
                    <p className="truncate text-xs text-muted">
                      {r.klant} · {r.project}
                    </p>
                    {r.omschrijving && (
                      <p className="mt-1 text-xs text-ink-2">{r.omschrijving}</p>
                    )}
                    {!r.declarabel && (
                      <span className="label mt-1 inline-block">niet declarabel</span>
                    )}
                  </div>
                  <span className="cijfers shrink-0 text-sm font-semibold">
                    {minutenAlsTijd(r.minuten)}
                  </span>
                  {!vergrendeld && r.status === "concept" && (
                    <form action={verwijderRegel} className="shrink-0">
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        aria-label={`${r.onderdeel} van ${korteDatum(d)} verwijderen`}
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

              {dagRegels.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted">Niets geschreven.</li>
              )}
            </ul>

            {!vergrendeld && (
              <div className="border-t border-line bg-surface p-2">
                <Link
                  href={`/uren/nieuw?datum=${d}`}
                  className="knop knop-kaal w-full justify-center"
                >
                  + Uren toevoegen
                </Link>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
