"use client";

import { useState } from "react";
import type { KlantKeuze } from "@/lib/data";
import { getal, vandaag, type Datum } from "@/lib/datum";
import { bewaarRit } from "@/app/(werk)/ritten/acties";

type ProjectKeuze = { id: string; naam: string; klantId: string };

const DOELEN = [
  { waarde: "klantbezoek", label: "Klantbezoek" },
  { waarde: "locatiebezoek", label: "Locatiebezoek" },
  { waarde: "overleg", label: "Overleg" },
  { waarde: "opleiding", label: "Opleiding" },
  { waarde: "overig", label: "Overig" },
];

/**
 * Keuze C3a: de afstand komt van de klant, dus een bezoek registreren is
 * klant kiezen en opslaan. Wijkt de rit af, dan pas je het getal aan.
 */
export function RitFormulier({
  klanten,
  projecten,
  standaardDatum,
}: {
  klanten: KlantKeuze[];
  projecten: ProjectKeuze[];
  standaardDatum?: Datum;
}) {
  const [klantId, setKlantId] = useState("");
  const [afstand, setAfstand] = useState("");
  const [handmatig, setHandmatig] = useState(false);
  const [retour, setRetour] = useState(true);
  const [bezig, setBezig] = useState(false);

  const klant = klanten.find((k) => k.id === klantId);
  const projectenVanKlant = projecten.filter((p) => p.klantId === klantId);
  const enkeleReis = Number(afstand.replace(",", ".")) || 0;

  function kiesKlant(id: string) {
    setKlantId(id);
    const gekozen = klanten.find((k) => k.id === id);
    // Alleen automatisch invullen zolang de gebruiker het veld niet zelf
    // heeft aangeraakt; anders overschrijf je zijn correctie.
    if (!handmatig) {
      setAfstand(
        gekozen?.afstandKm != null
          ? String(gekozen.afstandKm).replace(".", ",")
          : "",
      );
    }
  }

  return (
    <form
      action={async (fd) => {
        setBezig(true);
        try {
          await bewaarRit(fd);
          setKlantId("");
          setAfstand("");
          setHandmatig(false);
          setRetour(true);
        } finally {
          setBezig(false);
        }
      }}
      className="kaart flex flex-col gap-4 p-4"
    >
      <h2 className="text-lg font-semibold">Rit toevoegen</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="klantId" className="label">
            Klant
          </label>
          <select
            id="klantId"
            name="klantId"
            required
            value={klantId}
            onChange={(e) => kiesKlant(e.target.value)}
            className="veld"
          >
            <option value="" disabled>
              Kies een klant…
            </option>
            {klanten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.naam}
                {k.plaats ? ` · ${k.plaats}` : ""}
                {k.afstandKm != null ? ` · ${getal(k.afstandKm)} km` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="datum" className="label">
            Datum
          </label>
          <input
            id="datum"
            name="datum"
            type="date"
            required
            defaultValue={standaardDatum ?? vandaag()}
            className="veld"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="afstandKm" className="label">
            Enkele reis (km)
          </label>
          <input
            id="afstandKm"
            name="afstandKm"
            type="text"
            inputMode="decimal"
            required
            value={afstand}
            onChange={(e) => {
              setAfstand(e.target.value);
              setHandmatig(true);
            }}
            placeholder={klant ? "0" : "kies eerst een klant"}
            className="veld cijfers"
          />
          {klant && klant.afstandKm == null && (
            <p className="text-xs text-warn">
              Voor deze klant staat nog geen afstand ingesteld. Vul hem hier in
              en leg hem bij Beheer vast, dan gaat het de volgende keer vanzelf.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="doel" className="label">
            Doel
          </label>
          <select id="doel" name="doel" className="veld" defaultValue="klantbezoek">
            {DOELEN.map((d) => (
              <option key={d.waarde} value={d.waarde}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {projectenVanKlant.length > 0 && (
          <div className="flex flex-col gap-2">
            <label htmlFor="projectId" className="label">
              Project <span className="normal-case tracking-normal">(optioneel)</span>
            </label>
            <select id="projectId" name="projectId" className="veld" defaultValue="">
              <option value="">Geen project</option>
              {projectenVanKlant.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="omschrijving" className="label">
            Toelichting <span className="normal-case tracking-normal">(optioneel)</span>
          </label>
          <input
            id="omschrijving"
            name="omschrijving"
            type="text"
            maxLength={200}
            className="veld"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="retour"
          value="aan"
          checked={retour}
          onChange={(e) => setRetour(e.target.checked)}
          className="size-5 accent-[var(--accent)]"
        />
        Retour
        <span className="cijfers ml-auto text-sm font-semibold">
          {enkeleReis > 0 ? `${getal(enkeleReis * (retour ? 2 : 1))} km` : "—"}
        </span>
      </label>

      <button
        type="submit"
        className="knop knop-primair"
        disabled={bezig || !klantId || enkeleReis <= 0}
      >
        {bezig ? "Bezig…" : "Rit opslaan"}
      </button>
    </form>
  );
}
