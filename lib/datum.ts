// Datumgereedschap. Alles werkt op 'JJJJ-MM-DD'-tekst en rekent in UTC, zodat
// er nooit een dag verschuift door de tijdzone van de server.

export type Datum = string; // JJJJ-MM-DD

const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const DAGEN_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

export function vandaag(): Datum {
  return new Date().toISOString().slice(0, 10);
}

export function naarDatum(d: Datum): Date {
  return new Date(d + "T00:00:00Z");
}

export function naarTekst(d: Date): Datum {
  return d.toISOString().slice(0, 10);
}

export function isGeldigeDatum(d: string | undefined | null): d is Datum {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = naarDatum(d);
  return !Number.isNaN(t.getTime()) && naarTekst(t) === d;
}

export function verschuif(d: Datum, dagen: number): Datum {
  const t = naarDatum(d);
  t.setUTCDate(t.getUTCDate() + dagen);
  return naarTekst(t);
}

/** ISO-weeknummer en bijbehorend jaar. Dat jaar wijkt rond de jaarwisseling af. */
export function isoWeek(d: Datum): { jaar: number; week: number } {
  const t = naarDatum(d);
  // Naar de donderdag van deze week: die bepaalt bij ISO het weeknummer.
  const dag = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dag + 3);
  const jaar = t.getUTCFullYear();
  const eersteDonderdag = new Date(Date.UTC(jaar, 0, 4));
  const offset = (eersteDonderdag.getUTCDay() + 6) % 7;
  eersteDonderdag.setUTCDate(eersteDonderdag.getUTCDate() - offset + 3);
  const week =
    1 + Math.round((t.getTime() - eersteDonderdag.getTime()) / (7 * 24 * 3600 * 1000));
  return { jaar, week };
}

/** De maandag van een ISO-week. */
export function weekStart(jaar: number, week: number): Datum {
  const vierJanuari = new Date(Date.UTC(jaar, 0, 4));
  const dag = (vierJanuari.getUTCDay() + 6) % 7;
  const maandagWeek1 = new Date(vierJanuari);
  maandagWeek1.setUTCDate(vierJanuari.getUTCDate() - dag);
  maandagWeek1.setUTCDate(maandagWeek1.getUTCDate() + (week - 1) * 7);
  return naarTekst(maandagWeek1);
}

export function maandagVan(d: Datum): Datum {
  const t = naarDatum(d);
  const dag = (t.getUTCDay() + 6) % 7;
  return verschuif(d, -dag);
}

export function weekDagen(maandag: Datum): Datum[] {
  return Array.from({ length: 7 }, (_, i) => verschuif(maandag, i));
}

export function dagNaam(d: Datum, kort = false): string {
  const i = (naarDatum(d).getUTCDay() + 6) % 7;
  return kort ? DAGEN_KORT[i] : DAGEN[i];
}

export function isWeekend(d: Datum): boolean {
  const i = (naarDatum(d).getUTCDay() + 6) % 7;
  return i >= 5;
}

/** '12 maart', of '12 maart 2025' als het een ander jaar is dan nu. */
export function korteDatum(d: Datum): string {
  const t = naarDatum(d);
  const nu = new Date().getUTCFullYear();
  const jaar = t.getUTCFullYear();
  return `${t.getUTCDate()} ${MAANDEN[t.getUTCMonth()]}${jaar === nu ? "" : ` ${jaar}`}`;
}

export function langeDatum(d: Datum): string {
  return `${dagNaam(d)} ${korteDatum(d)}`;
}

// ------------------------------------------------------------------ tijd ----

/** 210 -> '3:30'. De vorm waarin uren op een urenbriefje staan. */
export function minutenAlsTijd(minuten: number): string {
  const teken = minuten < 0 ? "-" : "";
  const m = Math.abs(minuten);
  return `${teken}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** 210 -> '3,5'. Voor optellingen en export. */
export function minutenAlsUren(minuten: number): string {
  return (minuten / 60).toFixed(2).replace(".", ",");
}

/**
 * Leest '3:30', '3,5', '3.5', '3u30' en '90m' als minuten, en rondt af op het
 * kwartier (keuze C2a). Geeft null bij onzin.
 */
export function leesMinuten(invoer: string, stap = 15): number | null {
  const tekst = invoer.trim().toLowerCase().replace(",", ".");
  if (!tekst) return null;

  let minuten: number | null = null;

  const tijd = tekst.match(/^(\d+)\s*[:u]\s*(\d{1,2})$/);
  const alleenMinuten = tekst.match(/^(\d+)\s*m$/);
  const alleenUren = tekst.match(/^(\d+(?:\.\d+)?)\s*u?$/);

  if (tijd) {
    const m = Number(tijd[2]);
    if (m > 59) return null;
    minuten = Number(tijd[1]) * 60 + m;
  } else if (alleenMinuten) {
    minuten = Number(alleenMinuten[1]);
  } else if (alleenUren) {
    minuten = Math.round(Number(alleenUren[1]) * 60);
  }

  if (minuten === null || !Number.isFinite(minuten) || minuten < 0) return null;
  return Math.round(minuten / stap) * stap;
}

export function euro(bedrag: number | null | undefined): string {
  if (bedrag === null || bedrag === undefined) return "—";
  // Geen "-0,00" na afronden of bij een negatieve nul.
  const b = Math.abs(bedrag) < 0.005 ? 0 : bedrag;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(b);
}

export function getal(waarde: number | null | undefined, decimalen = 1): string {
  if (waarde === null || waarde === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: decimalen,
    maximumFractionDigits: decimalen,
  }).format(waarde);
}
