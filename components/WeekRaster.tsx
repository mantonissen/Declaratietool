"use client";

import { useMemo, useRef, useState } from "react";
import type { OnderdeelKeuze, Urenregel } from "@/lib/data";
import {
  dagNaam,
  isWeekend,
  leesMinuten,
  minutenAlsTijd,
  naarDatum,
  type Datum,
} from "@/lib/datum";
import { bewaarRaster } from "@/app/(werk)/uren/acties";

type Cel = Record<string, number>; // "onderdeelId|datum" -> minuten

function sleutel(onderdeelId: string, datum: Datum) {
  return `${onderdeelId}|${datum}`;
}

export function WeekRaster({
  dagen,
  regels,
  keuzes,
  vergrendeld,
}: {
  dagen: Datum[];
  regels: Urenregel[];
  keuzes: OnderdeelKeuze[];
  vergrendeld: boolean;
}) {
  // De uitgangsstand: wat er nu in de database staat.
  const beginstand = useMemo<Cel>(() => {
    const cel: Cel = {};
    for (const r of regels) {
      cel[sleutel(r.onderdeelId, r.datum)] =
        (cel[sleutel(r.onderdeelId, r.datum)] ?? 0) + r.minuten;
    }
    return cel;
  }, [regels]);

  const beginRegels = useMemo(() => {
    const gezien = new Set<string>();
    const uit: string[] = [];
    for (const r of regels) {
      if (!gezien.has(r.onderdeelId)) {
        gezien.add(r.onderdeelId);
        uit.push(r.onderdeelId);
      }
    }
    return uit;
  }, [regels]);

  const [rijen, setRijen] = useState<string[]>(beginRegels);
  const [stand, setStand] = useState<Cel>(beginstand);
  const [bezig, setBezig] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const opzoeken = useMemo(() => {
    const m = new Map<string, OnderdeelKeuze>();
    for (const k of keuzes) m.set(k.onderdeelId, k);
    return m;
  }, [keuzes]);

  const beschikbaar = keuzes.filter((k) => !rijen.includes(k.onderdeelId));

  const wijzigingen = useMemo(() => {
    const uit: { onderdeelId: string; datum: Datum; minuten: number }[] = [];
    const alle = new Set([...Object.keys(beginstand), ...Object.keys(stand)]);
    for (const s of alle) {
      const nu = stand[s] ?? 0;
      const was = beginstand[s] ?? 0;
      if (nu !== was) {
        const [onderdeelId, datum] = s.split("|");
        uit.push({ onderdeelId, datum, minuten: nu });
      }
    }
    return uit;
  }, [stand, beginstand]);

  const dagTotaal = (d: Datum) =>
    rijen.reduce((som, o) => som + (stand[sleutel(o, d)] ?? 0), 0);
  const rijTotaal = (o: string) =>
    dagen.reduce((som, d) => som + (stand[sleutel(o, d)] ?? 0), 0);
  const weekTotaal = dagen.reduce((som, d) => som + dagTotaal(d), 0);

  function zetCel(onderdeelId: string, datum: Datum, invoer: string) {
    const minuten = invoer.trim() === "" ? 0 : leesMinuten(invoer);
    setStand((vorige) => ({
      ...vorige,
      [sleutel(onderdeelId, datum)]: minuten ?? vorige[sleutel(onderdeelId, datum)] ?? 0,
    }));
  }

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        setBezig(true);
        try {
          await bewaarRaster(fd);
        } finally {
          setBezig(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <input
        type="hidden"
        name="wijzigingen"
        value={JSON.stringify(wijzigingen)}
      />

      <div className="tabel-omhulsel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="label sticky left-0 z-10 min-w-64 border-b border-line bg-surface-2 px-3 py-2 text-left">
                Project en onderdeel
              </th>
              {dagen.map((d) => (
                <th
                  key={d}
                  className={`label w-20 border-b border-line px-2 py-2 text-center ${
                    isWeekend(d) ? "bg-surface-2/60" : "bg-surface-2"
                  }`}
                >
                  <span className="block">{dagNaam(d, true)}</span>
                  <span className="block text-[0.625rem] font-normal tracking-normal normal-case">
                    {naarDatum(d).getUTCDate()}
                  </span>
                </th>
              ))}
              <th className="label w-20 border-b border-line bg-surface-2 px-2 py-2 text-right">
                Totaal
              </th>
            </tr>
          </thead>
          <tbody>
            {rijen.map((o) => {
              const k = opzoeken.get(o);
              return (
                <tr key={o} className="border-b border-line last:border-0">
                  <th className="sticky left-0 z-10 border-r border-line bg-surface px-3 py-2 text-left font-normal">
                    <span className="block truncate text-[0.8125rem] font-semibold">
                      {k?.onderdeel ?? "Onbekend onderdeel"}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {k?.klant} · {k?.project}
                      {k && !k.declarabel ? " · niet declarabel" : ""}
                    </span>
                  </th>
                  {dagen.map((d) => {
                    const waarde = stand[sleutel(o, d)] ?? 0;
                    return (
                      <td
                        key={d}
                        className={`border-l border-line p-0 ${
                          isWeekend(d) ? "bg-surface-2/40" : ""
                        }`}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={vergrendeld}
                          aria-label={`${k?.onderdeel ?? ""} op ${d}`}
                          defaultValue={waarde ? minutenAlsTijd(waarde) : ""}
                          onChange={(e) => zetCel(o, d, e.target.value)}
                          onBlur={(e) => {
                            const m = stand[sleutel(o, d)] ?? 0;
                            e.target.value = m ? minutenAlsTijd(m) : "";
                          }}
                          placeholder="—"
                          className="cijfers h-11 w-full border-0 bg-transparent px-1 text-center text-[0.875rem] text-ink placeholder:text-line-2 focus:bg-accent-bg focus:outline-2 focus:-outline-offset-2 focus:outline-accent disabled:text-muted"
                        />
                      </td>
                    );
                  })}
                  <td className="cijfers border-l border-line px-2 text-right text-[0.875rem] font-semibold">
                    {rijTotaal(o) ? minutenAlsTijd(rijTotaal(o)) : "—"}
                  </td>
                </tr>
              );
            })}

            {rijen.length === 0 && (
              <tr>
                <td
                  colSpan={dagen.length + 2}
                  className="px-3 py-6 text-center text-sm text-muted"
                >
                  Nog geen regels deze week. Voeg hieronder een onderdeel toe.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-2 bg-surface-2">
              <td className="label px-3 py-2 text-left">Totaal</td>
              {dagen.map((d) => (
                <td
                  key={d}
                  className="cijfers border-l border-line px-2 py-2 text-center text-[0.875rem] font-semibold"
                >
                  {dagTotaal(d) ? minutenAlsTijd(dagTotaal(d)) : "—"}
                </td>
              ))}
              <td className="cijfers border-l border-line px-2 py-2 text-right text-[0.875rem] font-bold">
                {minutenAlsTijd(weekTotaal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!vergrendeld && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="regel-toevoegen">
            Onderdeel toevoegen
          </label>
          <select
            id="regel-toevoegen"
            className="veld max-w-md"
            value=""
            onChange={(e) => {
              if (e.target.value) setRijen((r) => [...r, e.target.value]);
            }}
          >
            <option value="">Onderdeel toevoegen…</option>
            {beschikbaar.map((k) => (
              <option key={k.onderdeelId} value={k.onderdeelId}>
                {k.klant} · {k.project} · {k.onderdeel}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-3">
            {wijzigingen.length > 0 && (
              <span className="text-sm text-muted">
                {wijzigingen.length}{" "}
                {wijzigingen.length === 1 ? "wijziging" : "wijzigingen"}
              </span>
            )}
            <button
              type="submit"
              className="knop knop-primair"
              disabled={bezig || wijzigingen.length === 0}
            >
              {bezig ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
