"use client";

import { useEffect, useRef, useState } from "react";

// Live meeschrijven met de spraakherkenning van de browser (Web Speech API).
// Geen externe dienst: de browser (Chrome, Edge, Android; Safari beperkt)
// zet spraak om in tekst, de app bewaart alleen het resultaat. Werkt alleen
// over https of op localhost, en vraagt één keer om de microfoon.

type Herkenner = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: HerkenningsEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type HerkenningsEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
type HerkennerCtor = new () => Herkenner;

const TALEN: [string, string][] = [["nl-NL", "Nederlands"], ["en-GB", "Engels"], ["de-DE", "Duits"], ["fr-FR", "Frans"]];

function tijd(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Transcriber({ startTaal = "nl-NL", beginTekst = "", naam = "transcript", duurNaam = "duurMinuten", liveNaam = "live" }:
  { startTaal?: string; beginTekst?: string; naam?: string; duurNaam?: string; liveNaam?: string }) {
  const [ondersteund, setOndersteund] = useState<boolean | null>(null);
  const [taal, setTaal] = useState(startTaal);
  const [opnemend, setOpnemend] = useState(false);
  const [tekst, setTekst] = useState(beginTekst);
  const [tussen, setTussen] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [seconden, setSeconden] = useState(0);
  const [live, setLive] = useState(false);
  const herkenner = useRef<Herkenner | null>(null);
  const wil = useRef(false);
  const klok = useRef<ReturnType<typeof setInterval> | null>(null);
  const tekstRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: HerkennerCtor; webkitSpeechRecognition?: HerkennerCtor };
    setOndersteund(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => { wil.current = false; herkenner.current?.stop(); if (klok.current) clearInterval(klok.current); };
  }, []);

  const start = () => {
    const w = window as unknown as { SpeechRecognition?: HerkennerCtor; webkitSpeechRecognition?: HerkennerCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    setFout(null);
    const r = new Ctor();
    r.lang = taal; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let klaar = "", voorlopig = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const zin = res[0]?.transcript?.trim() ?? "";
        if (!zin) continue;
        if (res.isFinal) klaar += zin.charAt(0).toUpperCase() + zin.slice(1) + (/[.!?]$/.test(zin) ? "" : ".") + " ";
        else voorlopig += zin + " ";
      }
      if (klaar) setTekst((t) => (t ? t.replace(/\s+$/, "") + " " : "") + klaar.trim());
      setTussen(voorlopig.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setFout("De browser mag de microfoon niet gebruiken. Geef toestemming in de adresbalk en probeer opnieuw.");
        wil.current = false; setOpnemend(false);
      } else if (e.error === "no-speech" || e.error === "aborted") {
        // Chrome stopt na stilte; onend start hem opnieuw.
      } else {
        setFout(`Spraakherkenning gaf een fout (${e.error}). Je kunt gewoon doortypen.`);
      }
    };
    r.onend = () => {
      // Chrome beëindigt de sessie na een tijdje stilte; zolang de knop
      // aanstaat beginnen we opnieuw.
      if (wil.current) { try { r.start(); } catch { /* al gestart */ } }
      else { setOpnemend(false); setTussen(""); }
    };
    herkenner.current = r;
    wil.current = true;
    r.start();
    setOpnemend(true); setLive(true);
    if (!klok.current) klok.current = setInterval(() => setSeconden((s) => s + 1), 1000);
  };

  const stop = () => {
    wil.current = false;
    herkenner.current?.stop();
    setOpnemend(false); setTussen("");
    if (klok.current) { clearInterval(klok.current); klok.current = null; }
  };

  const alinea = () => setTekst((t) => t.replace(/\s+$/, "") + "\n\n");
  const minuten = Math.max(1, Math.round(seconden / 60));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ondersteund === false ? (
          <p className="rounded border border-warn bg-warn-bg px-3 py-2 text-sm">Deze browser heeft geen spraakherkenning (Chrome, Edge en Android wel; Safari beperkt). Typ of plak het transcript hieronder.</p>
        ) : (
          <>
            <button type="button" onClick={opnemend ? stop : start} disabled={ondersteund === null}
              className={`knop ${opnemend ? "knop-stil" : "knop-primair"}`} aria-pressed={opnemend}>
              <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${opnemend ? "animate-pulse bg-danger" : "bg-current opacity-60"}`} />
              {opnemend ? "Stop met meeschrijven" : seconden ? "Verder meeschrijven" : "Begin met meeschrijven"}
            </button>
            <select value={taal} onChange={(e) => setTaal(e.target.value)} disabled={opnemend} className="veld min-h-10 w-40 py-1" aria-label="Taal">
              {TALEN.map(([code, l]) => <option key={code} value={code}>{l}</option>)}
            </select>
            <span className="cijfers text-sm text-muted" aria-live="off">{tijd(seconden)}</span>
            {opnemend && <button type="button" onClick={alinea} className="knop knop-kaal knop-klein">Nieuwe alinea</button>}
          </>
        )}
      </div>
      {fout && <p className="rounded border border-warn bg-warn-bg px-3 py-2 text-sm">{fout}</p>}
      <div className="relative">
        <textarea ref={tekstRef} name={naam} value={tekst} onChange={(e) => setTekst(e.target.value)} rows={12}
          className="veld min-h-64 w-full py-2 font-[inherit] text-sm leading-relaxed" placeholder="Het transcript verschijnt hier terwijl er gesproken wordt. Je kunt tussendoor typen en corrigeren." />
        {tussen && <p className="pointer-events-none absolute right-3 bottom-2 left-3 truncate text-sm text-muted italic" aria-live="polite">{tussen}…</p>}
      </div>
      <input type="hidden" name={duurNaam} value={seconden ? String(minuten) : ""} readOnly />
      <input type="hidden" name={liveNaam} value={live ? "ja" : "nee"} readOnly />
      <input type="hidden" name="taal" value={taal} readOnly />
      <p className="text-xs text-muted">
        Leg de telefoon op de luidspreker of zet de laptop bij het gesprek; de herkenning loopt in de browser en er gaat niets naar een externe dienst.
        Zeg vooraf tegen je gesprekspartner dat je meeschrijft. Woorden die verkeerd verstaan zijn, verbeter je gewoon in de tekst.
      </p>
    </div>
  );
}
