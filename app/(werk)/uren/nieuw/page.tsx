import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { onderdeelKeuzes, favorieteOnderdelen } from "@/lib/data";
import { isGeldigeDatum, langeDatum, vandaag } from "@/lib/datum";
import { TijdVeld } from "@/components/TijdVeld";
import { voegRegelToe } from "../acties";

export const dynamic = "force-dynamic";

export default async function NieuweUrenPagina({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string; onderdeel?: string }>;
}) {
  const sessie = await vereisteSessie();
  const params = await searchParams;
  const datum = isGeldigeDatum(params.datum) ? params.datum : vandaag();

  const [keuzes, favorieten] = await Promise.all([
    onderdeelKeuzes(sessie),
    favorieteOnderdelen(sessie),
  ]);

  const favoriet = favorieten
    .map((id) => keuzes.find((k) => k.onderdeelId === id))
    .filter((k): k is (typeof keuzes)[number] => Boolean(k));
  const overig = keuzes.filter((k) => !favorieten.includes(k.onderdeelId));

  async function opslaan(formData: FormData) {
    "use server";
    await voegRegelToe(formData);
    redirect(`/uren?datum=${String(formData.get("datum"))}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-5 md:px-8 md:py-8">
      <Link href={`/uren?datum=${datum}`} className="knop knop-kaal -ml-2">
        ← Terug
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight">Uren toevoegen</h1>
      <p className="mt-1 text-sm text-muted capitalize">{langeDatum(datum)}</p>

      <form action={opslaan} className="mt-6 flex flex-col gap-5">
        <input type="hidden" name="datum" value={datum} />

        <div className="flex flex-col gap-2">
          <label htmlFor="onderdeelId" className="label">
            Waaraan
          </label>
          <select
            id="onderdeelId"
            name="onderdeelId"
            required
            defaultValue={params.onderdeel ?? ""}
            className="veld"
          >
            <option value="" disabled>
              Kies een projectonderdeel…
            </option>
            {favoriet.length > 0 && (
              <optgroup label="Recent">
                {favoriet.map((k) => (
                  <option key={k.onderdeelId} value={k.onderdeelId}>
                    {k.klant} · {k.project} · {k.onderdeel}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Alle onderdelen">
              {overig.map((k) => (
                <option key={k.onderdeelId} value={k.onderdeelId}>
                  {k.klant} · {k.project} · {k.onderdeel}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="tijd" className="label">
            Hoelang
          </label>
          <TijdVeld />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="omschrijving" className="label">
            Waarover <span className="normal-case tracking-normal">(optioneel)</span>
          </label>
          <input
            id="omschrijving"
            name="omschrijving"
            type="text"
            maxLength={200}
            className="veld"
            placeholder="Komt op de urenspecificatie voor de klant"
          />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="knop knop-primair flex-1">
            Opslaan
          </button>
          <Link href={`/uren?datum=${datum}`} className="knop knop-stil">
            Annuleren
          </Link>
        </div>
      </form>
    </div>
  );
}
