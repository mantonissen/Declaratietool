import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { weekstaatDetail } from "@/lib/fase2";
import { euro, getal, korteDatum, minutenAlsTijd, verschuif } from "@/lib/datum";
import { beoordeel } from "../../beheer/fase2-acties";

export const dynamic = "force-dynamic";

const DOEL: Record<string, string> = {
  klantbezoek: "Klantbezoek", locatiebezoek: "Locatiebezoek",
  overleg: "Overleg", opleiding: "Opleiding", overig: "Overig",
};

export default async function WeekstaatPagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/uren");
  const { id } = await params;

  const w = await weekstaatDetail(sessie, id);
  if (!w) notFound();

  const totaal = w.uren.reduce((s, u) => s + u.minuten, 0);
  const decl = w.uren.filter((u) => u.declarabel).reduce((s, u) => s + u.minuten, 0);
  const omzet = w.uren.reduce((s, u) => s + (u.omzet ?? 0), 0);
  const kosten = w.uren.reduce((s, u) => s + (u.kosten ?? 0), 0);
  const km = w.ritten.reduce((s, r) => s + r.totaalKm, 0);
  const kmBedrag = w.ritten.reduce((s, r) => s + (r.kmBedrag ?? 0), 0);

  // Per dag gegroepeerd: zo kijkt een eigenaar een week na.
  const dagen = new Map<string, typeof w.uren>();
  for (const u of w.uren) (dagen.get(u.datum) ?? dagen.set(u.datum, []).get(u.datum)!).push(u);

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/goedkeuren" className="knop knop-kaal -ml-2">
        ← Alle weekstaten
      </Link>
      <p className="label mt-2">
        Week {w.week} · {korteDatum(w.maandag)} — {korteDatum(verschuif(w.maandag, 6))}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{w.medewerker}</h1>

      <dl className="mt-5 mb-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {[
          { t: "Geschreven", v: minutenAlsTijd(totaal) },
          { t: "Declarabel", v: minutenAlsTijd(decl) },
          { t: "Omzet", v: euro(omzet + kmBedrag) },
          { t: "Marge", v: euro(omzet - kosten) },
        ].map((x) => (
          <div key={x.t} className="bg-surface px-4 py-3">
            <dt className="label">{x.t}</dt>
            <dd className="cijfers mt-0.5 text-lg font-semibold">{x.v}</dd>
          </div>
        ))}
      </dl>

      {[...dagen.entries()].map(([datum, regels]) => (
        <section key={datum} className="kaart mb-3 overflow-hidden">
          <header className="flex items-baseline gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h2 className="text-sm font-semibold">{korteDatum(datum)}</h2>
            <span className="cijfers ml-auto text-sm font-semibold">
              {minutenAlsTijd(regels.reduce((s, u) => s + u.minuten, 0))}
            </span>
          </header>
          <ul>
            {regels.map((u) => (
              <li key={u.id} className="flex items-start gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.onderdeel}</p>
                  <p className="text-xs text-muted">{u.klant} · {u.project}</p>
                  {u.omschrijving && <p className="mt-0.5 text-xs text-ink-2">{u.omschrijving}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="cijfers font-semibold">{minutenAlsTijd(u.minuten)}</p>
                  <p className="cijfers text-xs text-muted">
                    {u.declarabel ? `${euro(u.verkooptarief)}/u` : "niet declarabel"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {w.ritten.length > 0 && (
        <section className="kaart mb-3 overflow-hidden">
          <header className="flex items-baseline gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h2 className="text-sm font-semibold">Ritten</h2>
            <span className="cijfers ml-auto text-sm font-semibold">{getal(km, 0)} km</span>
          </header>
          <ul>
            {w.ritten.map((r) => (
              <li key={r.id} className="flex items-start gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.klant ?? "Zonder klant"}</p>
                  <p className="text-xs text-muted">
                    {korteDatum(r.datum)} · {DOEL[r.doel] ?? r.doel} · {r.retour ? "retour" : "enkele reis"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="cijfers font-semibold">{getal(r.totaalKm, 0)} km</p>
                  <p className="cijfers text-xs text-muted">{euro(r.kmBedrag)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {w.status === "ingediend" ? (
        <div className="kaart mt-6 flex flex-col gap-4 p-4">
          <form action={beoordeel}>
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="besluit" value="goedgekeurd" />
            <button type="submit" className="knop knop-primair w-full sm:w-auto">
              Goedkeuren
            </button>
            <p className="mt-2 text-xs text-muted">
              Zet de tarieven en kostprijzen van deze week vast.
            </p>
          </form>
          <form action={beoordeel} className="flex flex-col gap-2 border-t border-line pt-4">
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="besluit" value="afgekeurd" />
            <label htmlFor="opmerking" className="label">Terugsturen met opmerking</label>
            <input
              id="opmerking"
              name="opmerking"
              required
              maxLength={300}
              className="veld"
              placeholder="Wat klopt er niet?"
            />
            <button type="submit" className="knop knop-stil self-start">
              Terugsturen
            </button>
          </form>
        </div>
      ) : (
        <p className="mt-6 rounded border border-line bg-surface-2 px-4 py-3 text-sm">
          Deze week is <strong>{w.status}</strong>.
          {w.opmerking ? ` Opmerking: ${w.opmerking}` : ""}
        </p>
      )}
    </div>
  );
}
