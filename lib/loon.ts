import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import type { Datum } from "./datum";

// Loonadministratie: dienstverbanden, de parameters per jaar, loonruns met
// loonstroken. De berekening zit in de database (maak_loonrun,
// loonheffing_jaar); hier het lezen, schrijven en samenvatten.

const n = (v: unknown) => Number(v ?? 0);
const d = (v: unknown) => (v ? (String(v) as Datum) : null);

export const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

// ----------------------------------------------------------- parameters ---

export type Schijf = { tot: number | null; tarief: number };
export type AkSchijf = { tot: number; pct: number };
export type Loonparameters = {
  jaar: number; gecontroleerd: boolean; schijven: Schijf[];
  ahkMax: number; ahkAfbouwVanaf: number; ahkAfbouwPct: number;
  akSchijven: AkSchijf[]; akMax: number; akAfbouwVanaf: number; akAfbouwPct: number;
  awfLaag: number; awfHoog: number; aof: number; whk: number; zvwWg: number; zvwWn: number;
  maxPremieloon: number; gebruikelijkLoon: number; minimumloonUur: number;
};

const naarParameters = (r: Record<string, unknown>): Loonparameters => ({
  jaar: Number(r.jaar), gecontroleerd: Boolean(r.gecontroleerd),
  schijven: r.schijven as Schijf[], ahkMax: n(r.ahk_max), ahkAfbouwVanaf: n(r.ahk_afbouw_vanaf), ahkAfbouwPct: n(r.ahk_afbouw_pct),
  akSchijven: r.ak_schijven as AkSchijf[], akMax: n(r.ak_max), akAfbouwVanaf: n(r.ak_afbouw_vanaf), akAfbouwPct: n(r.ak_afbouw_pct),
  awfLaag: n(r.awf_laag), awfHoog: n(r.awf_hoog), aof: n(r.aof), whk: n(r.whk), zvwWg: n(r.zvw_wg), zvwWn: n(r.zvw_wn),
  maxPremieloon: n(r.max_premieloon), gebruikelijkLoon: n(r.gebruikelijk_loon), minimumloonUur: n(r.minimumloon_uur),
});

export async function loonparameters(sessie: Sessie): Promise<Loonparameters[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`select * from loonparameters order by jaar desc`);
  return rijen.map(naarParameters);
}

export async function werkLoonparametersBij(sessie: Sessie, p: Loonparameters): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into loonparameters (jaar, gecontroleerd, schijven, ahk_max, ahk_afbouw_vanaf, ahk_afbouw_pct, ak_schijven, ak_max,
      ak_afbouw_vanaf, ak_afbouw_pct, awf_laag, awf_hoog, aof, whk, zvw_wg, zvw_wn, max_premieloon, gebruikelijk_loon, minimumloon_uur)
    values (${p.jaar}, ${p.gecontroleerd}, ${tx.json(p.schijven)}, ${p.ahkMax}, ${p.ahkAfbouwVanaf}, ${p.ahkAfbouwPct},
      ${tx.json(p.akSchijven)}, ${p.akMax}, ${p.akAfbouwVanaf}, ${p.akAfbouwPct}, ${p.awfLaag}, ${p.awfHoog}, ${p.aof}, ${p.whk},
      ${p.zvwWg}, ${p.zvwWn}, ${p.maxPremieloon}, ${p.gebruikelijkLoon}, ${p.minimumloonUur})
    on conflict (jaar) do update set
      gecontroleerd = excluded.gecontroleerd, schijven = excluded.schijven, ahk_max = excluded.ahk_max,
      ahk_afbouw_vanaf = excluded.ahk_afbouw_vanaf, ahk_afbouw_pct = excluded.ahk_afbouw_pct, ak_schijven = excluded.ak_schijven,
      ak_max = excluded.ak_max, ak_afbouw_vanaf = excluded.ak_afbouw_vanaf, ak_afbouw_pct = excluded.ak_afbouw_pct,
      awf_laag = excluded.awf_laag, awf_hoog = excluded.awf_hoog, aof = excluded.aof, whk = excluded.whk, zvw_wg = excluded.zvw_wg,
      zvw_wn = excluded.zvw_wn, max_premieloon = excluded.max_premieloon, gebruikelijk_loon = excluded.gebruikelijk_loon,
      minimumloon_uur = excluded.minimumloon_uur
  `);
}

export async function loonheffingProef(sessie: Sessie, jaarloon: number, jaar: number, korting: boolean): Promise<number> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select loonheffing_jaar(${jaarloon}, ${jaar}, ${korting})::float8 as lh`);
  return n(r.lh);
}

// -------------------------------------------------------- dienstverband ---

export type Dienstverband = {
  id: string; medewerkerId: string; naam: string; inDienst: Datum; uitDienst: Datum | null; brutoMaandloon: number;
  urenPerWeek: number; vakantiegeldPct: number; pensioenWnPct: number; pensioenWgPct: number; loonheffingskorting: boolean;
  onbepaaldeTijd: boolean; dga: boolean; geboortedatum: Datum | null; bsn: string | null; iban: string | null; stroken: number;
};

const naarDienstverband = (r: Record<string, unknown>): Dienstverband => ({
  id: r.id as string, medewerkerId: r.medewerker_id as string, naam: r.naam as string, inDienst: r.in_dienst as Datum,
  uitDienst: d(r.uit_dienst), brutoMaandloon: n(r.bruto_f), urenPerWeek: n(r.uren_per_week), vakantiegeldPct: n(r.vakantiegeld_pct),
  pensioenWnPct: n(r.pensioen_wn_pct), pensioenWgPct: n(r.pensioen_wg_pct), loonheffingskorting: Boolean(r.loonheffingskorting),
  onbepaaldeTijd: Boolean(r.onbepaalde_tijd), dga: Boolean(r.dga), geboortedatum: d(r.geboortedatum),
  bsn: (r.bsn as string) ?? null, iban: (r.iban as string) ?? null, stroken: Number(r.stroken ?? 0),
});

const DIENSTVERBAND_SELECT = `
  select dv.*, m.naam, dv.bruto_maandloon::float8 as bruto_f,
         (select count(*) from loonstrook s where s.dienstverband_id = dv.id) as stroken
  from dienstverband dv join medewerker m on m.id = dv.medewerker_id`;

export async function dienstverbanden(sessie: Sessie): Promise<Dienstverband[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(`${DIENSTVERBAND_SELECT} order by (dv.uit_dienst is null) desc, m.naam, dv.in_dienst desc`));
  return rijen.map(naarDienstverband);
}

export type DienstverbandInvoer = Omit<Dienstverband, "id" | "naam" | "stroken">;

export async function nieuwDienstverband(sessie: Sessie, v: DienstverbandInvoer): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into dienstverband (medewerker_id, in_dienst, uit_dienst, bruto_maandloon, uren_per_week, vakantiegeld_pct,
      pensioen_wn_pct, pensioen_wg_pct, loonheffingskorting, onbepaalde_tijd, dga, geboortedatum, bsn, iban)
    values (${v.medewerkerId}, ${v.inDienst}, ${v.uitDienst}, ${v.brutoMaandloon}, ${v.urenPerWeek}, ${v.vakantiegeldPct},
      ${v.pensioenWnPct}, ${v.pensioenWgPct}, ${v.loonheffingskorting}, ${v.onbepaaldeTijd}, ${v.dga}, ${v.geboortedatum}, ${v.bsn}, ${v.iban})
    returning id
  `);
  return r.id as string;
}

export async function werkDienstverbandBij(sessie: Sessie, id: string, v: DienstverbandInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update dienstverband set medewerker_id = ${v.medewerkerId}, in_dienst = ${v.inDienst}, uit_dienst = ${v.uitDienst},
      bruto_maandloon = ${v.brutoMaandloon}, uren_per_week = ${v.urenPerWeek}, vakantiegeld_pct = ${v.vakantiegeldPct},
      pensioen_wn_pct = ${v.pensioenWnPct}, pensioen_wg_pct = ${v.pensioenWgPct}, loonheffingskorting = ${v.loonheffingskorting},
      onbepaalde_tijd = ${v.onbepaaldeTijd}, dga = ${v.dga}, geboortedatum = ${v.geboortedatum}, bsn = ${v.bsn}, iban = ${v.iban}
    where id = ${id}
  `);
}

export async function verwijderDienstverband(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from dienstverband where id = ${id} and not exists (select 1 from loonstrook where dienstverband_id = ${id})
  `);
}

// ------------------------------------------------------------- loonrun ---

export type Loonstrook = {
  id: string; loonrunId: string; medewerkerId: string; dienstverbandId: string; naam: string; fractie: number;
  bruto: number; vakantiegeldOpbouw: number; vakantiegeldUitbetaald: number; pensioenWn: number; loonLh: number;
  loonheffing: number; loonheffingBijzonder: number; zvwWn: number; netto: number; premieloon: number;
  awf: number; aof: number; whk: number; zvwWg: number; pensioenWg: number; werkgeverslasten: number; totaleKosten: number;
};
export type Loonrun = {
  id: string; jaar: number; maand: number; status: "concept" | "definitief"; vakantiegeldUitbetalen: boolean;
  boekingId: string | null; aangifteIngediendOp: Datum | null; loonheffingBetaaldOp: Datum | null;
  nettoBetaaldOp: Datum | null; pensioenBetaaldOp: Datum | null; stroken: Loonstrook[];
};

const naarStrook = (r: Record<string, unknown>): Loonstrook => ({
  id: r.id as string, loonrunId: r.loonrun_id as string, medewerkerId: r.medewerker_id as string,
  dienstverbandId: r.dienstverband_id as string, naam: r.naam as string, fractie: n(r.fractie),
  bruto: n(r.bruto), vakantiegeldOpbouw: n(r.vakantiegeld_opbouw), vakantiegeldUitbetaald: n(r.vakantiegeld_uitbetaald),
  pensioenWn: n(r.pensioen_wn), loonLh: n(r.loon_lh), loonheffing: n(r.loonheffing), loonheffingBijzonder: n(r.loonheffing_bijzonder),
  zvwWn: n(r.zvw_wn), netto: n(r.netto), premieloon: n(r.premieloon), awf: n(r.awf), aof: n(r.aof), whk: n(r.whk),
  zvwWg: n(r.zvw_wg), pensioenWg: n(r.pensioen_wg), werkgeverslasten: n(r.werkgeverslasten), totaleKosten: n(r.totale_kosten),
});
const naarRun = (r: Record<string, unknown>, stroken: Loonstrook[]): Loonrun => ({
  id: r.id as string, jaar: Number(r.jaar), maand: Number(r.maand), status: r.status as Loonrun["status"],
  vakantiegeldUitbetalen: Boolean(r.vakantiegeld_uitbetalen), boekingId: (r.boeking_id as string) ?? null,
  aangifteIngediendOp: d(r.aangifte_ingediend_op), loonheffingBetaaldOp: d(r.loonheffing_betaald_op),
  nettoBetaaldOp: d(r.netto_betaald_op), pensioenBetaaldOp: d(r.pensioen_betaald_op), stroken,
});

const STROOK_SELECT = `
  select s.*, m.naam, s.fractie::float8 as fractie, s.bruto::float8 as bruto, s.vakantiegeld_opbouw::float8 as vakantiegeld_opbouw,
         s.vakantiegeld_uitbetaald::float8 as vakantiegeld_uitbetaald, s.pensioen_wn::float8 as pensioen_wn, s.loon_lh::float8 as loon_lh,
         s.loonheffing::float8 as loonheffing, s.loonheffing_bijzonder::float8 as loonheffing_bijzonder, s.zvw_wn::float8 as zvw_wn,
         s.netto::float8 as netto, s.premieloon::float8 as premieloon, s.awf::float8 as awf, s.aof::float8 as aof, s.whk::float8 as whk,
         s.zvw_wg::float8 as zvw_wg, s.pensioen_wg::float8 as pensioen_wg, s.werkgeverslasten::float8 as werkgeverslasten,
         s.totale_kosten::float8 as totale_kosten
  from loonstrook s join medewerker m on m.id = s.medewerker_id`;

export async function loonruns(sessie: Sessie, jaar: number): Promise<Loonrun[]> {
  const [runs, stroken] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`select * from loonrun where jaar = ${jaar} order by maand desc`,
    await tx.unsafe(`${STROOK_SELECT} join loonrun r on r.id = s.loonrun_id where r.jaar = $1 order by m.naam`, [jaar]),
  ]);
  const per = new Map<string, Loonstrook[]>();
  for (const s of stroken.map(naarStrook)) per.set(s.loonrunId, [...(per.get(s.loonrunId) ?? []), s]);
  return runs.map((r) => naarRun(r, per.get(r.id as string) ?? []));
}

export async function loonrun(sessie: Sessie, id: string): Promise<Loonrun | null> {
  const [runs, stroken] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`select * from loonrun where id = ${id}`,
    await tx.unsafe(`${STROOK_SELECT} where s.loonrun_id = $1 order by m.naam`, [id]),
  ]);
  return runs[0] ? naarRun(runs[0], stroken.map(naarStrook)) : null;
}

/** Eén strook, ook leesbaar voor de medewerker zelf (rechten in de database). */
export async function loonstrook(sessie: Sessie, runId: string, medewerkerId: string) {
  const [stroken, runs] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx.unsafe(`${STROOK_SELECT} where s.loonrun_id = $1 and s.medewerker_id = $2`, [runId, medewerkerId]),
    await tx`select jaar, maand, status from loonrun where id = ${runId}`,
  ]);
  if (!stroken[0]) return null;
  const s = naarStrook(stroken[0]);
  // Voor een medewerker is de run zelf onzichtbaar; het jaar en de maand
  // staan dan alleen via de strook vast.
  const jm = runs[0] ? { jaar: Number(runs[0].jaar), maand: Number(runs[0].maand), status: String(runs[0].status) } : null;
  return { strook: s, run: jm };
}

export async function maakLoonrun(sessie: Sessie, jaar: number, maand: number, vakantiegeld: boolean): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select maak_loonrun(${jaar}, ${maand}, ${vakantiegeld}, ${sessie.medewerkerId}) as id`);
  return r.id as string;
}

export async function maakLoonrunDefinitief(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select maak_loonrun_definitief(${id})`);
}

export async function verwijderLoonrun(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`delete from loonrun where id = ${id} and status = 'concept'`);
}

export async function betaalLoonrun(sessie: Sessie, id: string, wat: "netto" | "loonheffing" | "pensioen", datum: Datum, via: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select boek_betaling_loonrun(${id}, ${wat}, ${datum}, ${via}::uuid)`);
}

export async function markeerLoonaangifteIngediend(sessie: Sessie, id: string, datum: Datum): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`update loonrun set aangifte_ingediend_op = ${datum} where id = ${id} and status = 'definitief'`);
}

/**
 * Cumulatieven van een dienstverband over het jaar tot en met een maand:
 * de definitieve runs plus de run waar het om gaat (die mag nog concept zijn).
 */
export async function cumulatief(sessie: Sessie, dienstverbandId: string, jaar: number, totMaand: number, runId: string) {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select coalesce(sum(s.bruto), 0)::float8 as bruto, coalesce(sum(s.vakantiegeld_uitbetaald), 0)::float8 as vakantiegeld,
           coalesce(sum(s.loon_lh + s.vakantiegeld_uitbetaald), 0)::float8 as loon_lh,
           coalesce(sum(s.loonheffing + s.loonheffing_bijzonder), 0)::float8 as loonheffing,
           coalesce(sum(s.netto), 0)::float8 as netto,
           coalesce(sum(s.vakantiegeld_opbouw - s.vakantiegeld_uitbetaald), 0)::float8 as vakantiegeld_saldo
    from loonstrook s join loonrun r on r.id = s.loonrun_id
    where s.dienstverband_id = ${dienstverbandId} and r.jaar = ${jaar} and r.maand <= ${totMaand}
      and (r.status = 'definitief' or r.id = ${runId})
  `);
  return { bruto: n(r.bruto), vakantiegeld: n(r.vakantiegeld), loonLh: n(r.loon_lh), loonheffing: n(r.loonheffing), netto: n(r.netto), vakantiegeldSaldo: n(r.vakantiegeld_saldo) };
}

/** De rubrieken van de loonaangifte (collectief deel) voor een run. */
export function loonaangifte(run: Loonrun) {
  const som = (f: (s: Loonstrook) => number) => run.stroken.reduce((a, s) => a + f(s), 0);
  const loonLh = som((s) => s.loonLh + s.vakantiegeldUitbetaald);
  const loonheffing = som((s) => s.loonheffing + s.loonheffingBijzonder);
  const awf = som((s) => s.awf), aof = som((s) => s.aof), whk = som((s) => s.whk);
  const zvwWg = som((s) => s.zvwWg), zvwWn = som((s) => s.zvwWn);
  return {
    werknemers: run.stroken.length,
    loonLh, loonheffing, awf, aof, whk, zvwWg, zvwWn,
    premiesWnv: awf + aof + whk,
    totaal: loonheffing + awf + aof + whk + zvwWg + zvwWn,
    netto: som((s) => s.netto), pensioen: som((s) => s.pensioenWn + s.pensioenWg),
    kosten: som((s) => s.totaleKosten),
    rubrieken: [
      ["Totaal loon voor de loonheffing (kolom 14)", loonLh],
      ["Ingehouden loonbelasting/premie volksverzekeringen", loonheffing],
      ["Premie Awf (WW), laag en hoog", awf],
      ["Premie Aof (WIA/WAO)", aof],
      ["Premie Whk (Werkhervattingskas)", whk],
      ["Werkgeversheffing Zvw", zvwWg],
      ["Ingehouden bijdrage Zvw (dga)", zvwWn],
      ["Totaal te betalen loonheffingen", loonheffing + awf + aof + whk + zvwWg + zvwWn],
    ] as [string, number][],
  };
}
