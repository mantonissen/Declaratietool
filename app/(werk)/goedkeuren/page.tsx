import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { weekstaten } from "@/lib/fase2";
import { euro, getal, korteDatum, minutenAlsTijd, verschuif } from "@/lib/datum";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  ingediend: "Wacht op jou",
  goedgekeurd: "Goedgekeurd",
  afgekeurd: "Teruggestuurd",
};

export default async function GoedkeurenPagina() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");

  const alle = await weekstaten(sessie);
  const open = alle.filter((w) => w.status === "ingediend");
  const afgehandeld = alle.filter((w) => w.status !== "ingediend");

  const Rij = ({ w }: { w: (typeof alle)[number] }) => (
    <li className="kaart">
      <Link
        href={`/goedkeuren/${w.id}`}
        className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{w.medewerker}</p>
          <p className="text-xs text-muted">
            Week {w.week} · {korteDatum(w.maandag)} — {korteDatum(verschuif(w.maandag, 6))}
          </p>
          {w.opmerking && w.status === "afgekeurd" && (
            <p className="mt-1 text-xs text-ink-2">{w.opmerking}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="cijfers text-sm font-semibold">{minutenAlsTijd(w.minuten)}</p>
          <p className="cijfers text-xs text-muted">
            {w.km > 0 ? `${getal(w.km, 0)} km · ` : ""}
            {euro(w.omzet)}
          </p>
        </div>
        <span
          className={`label shrink-0 rounded px-1.5 py-0.5 ${
            w.status === "ingediend"
              ? "bg-warn-bg text-warn"
              : w.status === "goedgekeurd"
                ? "bg-accent-bg text-accent-ink"
                : "bg-surface-2"
          }`}
        >
          {STATUS[w.status]}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">
        ← Beheer
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
        Weekstaten goedkeuren
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Bij goedkeuren worden de bedragen van die week vastgezet. Wat je
        terugstuurt gaat weer naar concept, met jouw opmerking erbij.
      </p>

      <h2 className="mb-2 text-lg font-semibold">
        Te beoordelen{" "}
        <span className="cijfers text-sm font-normal text-muted">({open.length})</span>
      </h2>
      {open.length ? (
        <ul className="mb-8 flex flex-col gap-2">
          {open.map((w) => <Rij key={w.id} w={w} />)}
        </ul>
      ) : (
        <p className="mb-8 text-sm text-muted">Niets dat op je wacht.</p>
      )}

      {afgehandeld.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-semibold">Afgehandeld</h2>
          <ul className="flex flex-col gap-2">
            {afgehandeld.map((w) => <Rij key={w.id} w={w} />)}
          </ul>
        </>
      )}
    </div>
  );
}
