import Link from "next/link";
import { vereisteSessie } from "@/lib/auth";
import { vandaag, verschuif } from "@/lib/datum";

export const dynamic = "force-dynamic";

export default async function ExportPagina() {
  const sessie = await vereisteSessie();
  const nu = vandaag();
  const eersteVanDeMaand = nu.slice(0, 8) + "01";
  const vorigeMaand = verschuif(eersteVanDeMaand, -1).slice(0, 8) + "01";

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 md:px-8 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Exporteren</h1>
      <p className="mt-1 text-sm text-muted">
        Uren en ritten als CSV, te openen in Excel of in te lezen in je
        boekhouding (keuze E2a).
      </p>

      <form action="/api/export" method="get" className="kaart mt-6 flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">Van</span>
            <input
              type="date"
              name="van"
              required
              defaultValue={vorigeMaand}
              className="veld"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Tot en met</span>
            <input
              type="date"
              name="tot"
              required
              defaultValue={nu}
              className="veld"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-1">Wat</legend>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="soort"
              value="uren"
              defaultChecked
              className="size-4 accent-[var(--accent)]"
            />
            Uren
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="soort"
              value="ritten"
              className="size-4 accent-[var(--accent)]"
            />
            Ritten en kilometers
          </label>
        </fieldset>

        <p className="text-xs text-muted">
          {sessie.rechten === "medewerker"
            ? "Je exporteert je eigen uren, zonder bedragen."
            : "Bedragen worden meegenomen voor zover je ze mag zien."}
        </p>

        <button type="submit" className="knop knop-primair self-start">
          Downloaden
        </button>
      </form>

      <Link href="/uren" className="knop knop-kaal mt-4 -ml-2">
        ← Terug naar uren
      </Link>
    </div>
  );
}
