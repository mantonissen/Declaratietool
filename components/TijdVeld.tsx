"use client";

import { useState } from "react";
import { leesMinuten, minutenAlsTijd } from "@/lib/datum";

const SNEL = [15, 30, 60, 90, 120, 240, 480];

/**
 * Tijdveld met snelkeuzes. Op een telefoon is 'anderhalf uur' één tik in
 * plaats van een getal intypen. Accepteert 1:30, 1,5, 90m of 1u30.
 */
export function TijdVeld({ naam = "tijd" }: { naam?: string }) {
  const [waarde, setWaarde] = useState("");
  const minuten = leesMinuten(waarde);

  return (
    <div className="flex flex-col gap-2">
      <input
        id={naam}
        name={naam}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required
        value={waarde}
        onChange={(e) => setWaarde(e.target.value)}
        placeholder="1:30"
        className="veld cijfers text-lg"
        aria-describedby={`${naam}-hulp`}
      />
      <div className="flex flex-wrap gap-1.5">
        {SNEL.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setWaarde(minutenAlsTijd(m))}
            className="knop knop-stil cijfers min-h-9 px-2.5 text-sm"
          >
            {minutenAlsTijd(m)}
          </button>
        ))}
      </div>
      <p id={`${naam}-hulp`} className="text-xs text-muted">
        {waarde && minuten !== null && minuten > 0
          ? `Wordt ${minutenAlsTijd(minuten)} — afgerond op het kwartier.`
          : "1:30, 1,5 of 90m. Er wordt afgerond op kwartieren."}
      </p>
    </div>
  );
}
