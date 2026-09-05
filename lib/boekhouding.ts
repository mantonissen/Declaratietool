import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { isGeldigeDatum, vandaag, type Datum } from "./datum";
import type { RekeningSoort } from "./facturatie";

// Boekhouding. Het journaal, de saldi en de rapporten komen uit de database;
// hier staan alleen de vragen en het omzetten naar getallen. Alles via
// alsGebruiker(): de tabellen zijn alleen voor de eigenaar leesbaar.

const n = (v: unknown) => Number(v ?? 0);

// ------------------------------------------------------------ periodes ---

export function jaarGrenzen(jaar: number): { van: Datum; tot: Datum } {
  return { van: `${jaar}-01-01`, tot: `${jaar}-12-31` };
}

export function kwartaalGrenzen(jaar: number, kwartaal: number): { van: Datum; tot: Datum } {
  const m0 = (kwartaal - 1) * 3 + 1;
  const eind = new Date(Date.UTC(jaar, m0 + 2, 0)).getUTCDate();
  return { van: `${jaar}-${String(m0).padStart(2, "0")}-01`, tot: `${jaar}-${String(m0 + 2).padStart(2, "0")}-${eind}` };
}

export function maandGrenzen(jaar: number, maand: number): { van: Datum; tot: Datum } {
  const eind = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  const mm = String(maand).padStart(2, "0");
  return { van: `${jaar}-${mm}-01`, tot: `${jaar}-${mm}-${eind}` };
}

/** Periode uit de querystring, anders het lopende jaar of kwartaal. */
export function leesPeriode(p: { van?: string; tot?: string }, standaard: "jaar" | "kwartaal" = "jaar"): { van: Datum; tot: Datum } {
  if (isGeldigeDatum(p.van) && isGeldigeDatum(p.tot) && p.van <= p.tot) return { van: p.van, tot: p.tot };
  const d = vandaag();
  const jaar = Number(d.slice(0, 4)), maand = Number(d.slice(5, 7));
  return standaard === "jaar" ? jaarGrenzen(jaar) : kwartaalGrenzen(jaar, Math.ceil(maand / 3));
}

export function periodeLabel(van: Datum, tot: Datum): string {
  const j = van.slice(0, 4), m = Number(van.slice(5, 7)), mt = Number(tot.slice(5, 7));
  if (van.endsWith("-01-01") && tot === `${j}-12-31`) return j;
  if (mt - m === 2 && (m - 1) % 3 === 0) return `Q${(m - 1) / 3 + 1} ${j}`;
  if (m === mt) return `${["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][m - 1]} ${j}`;
  return `${van} — ${tot}`;
}

// --------------------------------------------------------------- saldi ---

export type Saldo = {
  grootboekId: string; nummer: string; naam: string; soort: RekeningSoort; actief: boolean;
  debet: number; credit: number; saldo: number;
};

export async function saldi(sessie: Sessie, van: Datum, tot: Datum): Promise<Saldo[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select grootboek_id, nummer, naam, soort::text as soort, actief,
           debet::float8 as debet, credit::float8 as credit, saldo::float8 as saldo
    from grootboek_saldi(${van}, ${tot})
  `);
  return rijen.map((r) => ({
    grootboekId: r.grootboek_id as string, nummer: r.nummer as string, naam: r.naam as string,
    soort: r.soort as RekeningSoort, actief: Boolean(r.actief),
    debet: n(r.debet), credit: n(r.credit), saldo: n(r.saldo),
  }));
}

/** Getoond bedrag: activa en kosten als debetsaldo, de rest als creditsaldo. */
export const getoond = (s: { soort: RekeningSoort; saldo: number }) =>
  s.soort === "activa" || s.soort === "kosten" ? s.saldo : -s.saldo;

export type Rapport = {
  van: Datum; tot: Datum;
  omzet: Saldo[]; kosten: Saldo[]; resultaat: number;
  activa: Saldo[]; passiva: Saldo[]; eigenVermogen: Saldo[];
  resultaatCumulatief: number;          // winst van het begin tot en met `tot`, op de balans
  balansTotaal: number;
};

/** Winst-en-verlies over de periode en de balans per einddatum. */
export async function rapport(sessie: Sessie, van: Datum, tot: Datum): Promise<Rapport> {
  const [periode, cumulatief] = await Promise.all([saldi(sessie, van, tot), saldi(sessie, "1900-01-01", tot)]);
  const met = (lijst: Saldo[], soort: RekeningSoort) => lijst.filter((s) => s.soort === soort && (s.saldo !== 0 || s.debet !== 0));
  const omzet = met(periode, "omzet"), kosten = met(periode, "kosten");
  const resultaat = -omzet.reduce((a, s) => a + s.saldo, 0) - kosten.reduce((a, s) => a + s.saldo, 0);
  const resultaatCumulatief = -cumulatief.filter((s) => s.soort === "omzet" || s.soort === "kosten").reduce((a, s) => a + s.saldo, 0);
  const activa = met(cumulatief, "activa"), passiva = met(cumulatief, "passiva"), eigenVermogen = met(cumulatief, "eigen_vermogen");
  return {
    van, tot, omzet, kosten, resultaat, activa, passiva, eigenVermogen, resultaatCumulatief,
    balansTotaal: activa.reduce((a, s) => a + s.saldo, 0),
  };
}

// ------------------------------------------------------------ journaal ---

export type BoekingSoort = "verkoop" | "inkoop" | "bank" | "memoriaal" | "btw";
export const BOEKING_SOORT_LABEL: Record<BoekingSoort, string> = {
  verkoop: "verkoop", inkoop: "inkoop", bank: "bank", memoriaal: "memoriaal", btw: "btw",
};

export type Boeking = {
  id: string; volgnummer: number; datum: Datum; soort: BoekingSoort; omschrijving: string;
  factuurId: string | null; factuurnummer: string | null; inkoopId: string | null; aangifteId: string | null;
  bedrag: number; regels: BoekingRegel[];
};
export type BoekingRegel = {
  id: string; volgorde: number; grootboekId: string; nummer: string; naam: string;
  debet: number; credit: number; omschrijving: string | null;
};

export async function boekingen(sessie: Sessie, van: Datum, tot: Datum, soort: BoekingSoort | null = null): Promise<Boeking[]> {
  const [koppen, regels] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`
      select * , bedrag::float8 as bedrag_f from v_boeking
      where datum between ${van} and ${tot} and (${soort}::text is null or soort::text = ${soort})
      order by datum desc, volgnummer desc
      limit 500
    `,
    await tx`
      select r.id, r.boeking_id, r.volgorde, r.grootboek_id, g.nummer, g.naam,
             r.debet::float8 as debet, r.credit::float8 as credit, r.omschrijving
      from boekingsregel r
      join boeking b on b.id = r.boeking_id
      join grootboekrekening g on g.id = r.grootboek_id
      where b.datum between ${van} and ${tot} and (${soort}::text is null or b.soort::text = ${soort})
      order by r.volgorde
    `,
  ]);
  const per = new Map<string, BoekingRegel[]>();
  for (const r of regels) {
    const lijst = per.get(r.boeking_id as string) ?? [];
    lijst.push({
      id: r.id as string, volgorde: Number(r.volgorde), grootboekId: r.grootboek_id as string,
      nummer: r.nummer as string, naam: r.naam as string, debet: n(r.debet), credit: n(r.credit),
      omschrijving: (r.omschrijving as string) ?? null,
    });
    per.set(r.boeking_id as string, lijst);
  }
  return koppen.map((k) => ({
    id: k.id as string, volgnummer: Number(k.volgnummer), datum: k.datum as Datum, soort: k.soort as BoekingSoort,
    omschrijving: k.omschrijving as string, factuurId: (k.factuur_id as string) ?? null,
    factuurnummer: (k.factuurnummer as string) ?? null, inkoopId: (k.inkoop_id as string) ?? null,
    aangifteId: (k.aangifte_id as string) ?? null, bedrag: n(k.bedrag_f), regels: per.get(k.id as string) ?? [],
  }));
}

export type KaartRegel = {
  boekingId: string; volgnummer: number; datum: Datum; soort: BoekingSoort; omschrijving: string;
  regelOmschrijving: string | null; factuurId: string | null; factuurnummer: string | null;
  debet: number; credit: number; saldo: number;
};

/** Grootboekkaart: alle mutaties op één rekening in de periode, met lopend saldo. */
export async function grootboekkaart(sessie: Sessie, grootboekId: string, van: Datum, tot: Datum) {
  const [[begin], rijen] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`
      select coalesce(sum(r.debet - r.credit), 0)::float8 as saldo
      from boekingsregel r join boeking b on b.id = r.boeking_id
      where r.grootboek_id = ${grootboekId} and b.datum < ${van}
    `,
    await tx`
      select b.id as boeking_id, b.volgnummer, b.datum, b.soort::text as soort, b.omschrijving,
             r.omschrijving as regel_omschrijving, b.factuur_id, f.nummer as factuurnummer,
             r.debet::float8 as debet, r.credit::float8 as credit
      from boekingsregel r
      join boeking b on b.id = r.boeking_id
      left join factuur f on f.id = b.factuur_id
      where r.grootboek_id = ${grootboekId} and b.datum between ${van} and ${tot}
      order by b.datum, b.volgnummer, r.volgorde
    `,
  ]);
  let lopend = n(begin?.saldo);
  const regels: KaartRegel[] = rijen.map((r) => {
    lopend += n(r.debet) - n(r.credit);
    return {
      boekingId: r.boeking_id as string, volgnummer: Number(r.volgnummer), datum: r.datum as Datum,
      soort: r.soort as BoekingSoort, omschrijving: r.omschrijving as string,
      regelOmschrijving: (r.regel_omschrijving as string) ?? null,
      factuurId: (r.factuur_id as string) ?? null, factuurnummer: (r.factuurnummer as string) ?? null,
      debet: n(r.debet), credit: n(r.credit), saldo: lopend,
    };
  });
  return { beginsaldo: n(begin?.saldo), regels, eindsaldo: lopend };
}

export type MemoriaalRegel = { grootboekId: string; debet: number; credit: number; omschrijving: string | null };

export async function boekMemoriaal(sessie: Sessie, datum: Datum, omschrijving: string, regels: MemoriaalRegel[]): Promise<string> {
  // tx.json: een string met ::jsonb zou als json-tekst (scalar) aankomen.
  const regelsJson = regels.map((x) => ({
    grootboek_id: x.grootboekId, debet: x.debet, credit: x.credit, omschrijving: x.omschrijving,
  }));
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select boek_memoriaal(${datum}, ${omschrijving}, ${tx.json(regelsJson)}, ${sessie.medewerkerId}) as id
  `);
  return r.id as string;
}

export async function verwijderBoeking(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from boeking where id = ${id} and soort = 'memoriaal'
  `);
}

// -------------------------------------------------------------- inkoop ---

export type Inkoop = {
  id: string; leverancier: string; omschrijving: string; kenmerk: string | null; datum: Datum;
  vervaldatum: Datum | null; grootboekId: string; grootboekNummer: string; grootboekNaam: string;
  bedragExcl: number; btwCode: string; btwBedrag: number; bedragIncl: number;
  betaaldOp: Datum | null; betaaldVia: string | null; vervallen: boolean;
};

const naarInkoop = (r: Record<string, unknown>): Inkoop => ({
  id: r.id as string, leverancier: r.leverancier as string, omschrijving: r.omschrijving as string,
  kenmerk: (r.kenmerk as string) ?? null, datum: r.datum as Datum, vervaldatum: (r.vervaldatum as Datum) ?? null,
  grootboekId: r.grootboek_id as string, grootboekNummer: r.nummer as string, grootboekNaam: r.naam as string,
  bedragExcl: n(r.excl), btwCode: r.btw_code as string, btwBedrag: n(r.btw), bedragIncl: n(r.incl),
  betaaldOp: (r.betaald_op as Datum) ?? null, betaaldVia: (r.betaald_via as string) ?? null,
  vervallen: !r.betaald_op && !!r.vervaldatum && String(r.vervaldatum) < vandaag(),
});

const INKOOP_SELECT = `
  select k.*, g.nummer, g.naam, k.bedrag_excl::float8 as excl, k.btw_bedrag::float8 as btw,
         k.bedrag_incl::float8 as incl
  from inkoopfactuur k join grootboekrekening g on g.id = k.grootboek_id`;

export async function inkoopfacturen(sessie: Sessie, van: Datum, tot: Datum): Promise<Inkoop[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(
    `${INKOOP_SELECT} where k.betaald_op is null or k.datum between $1 and $2
     order by (k.betaald_op is null) desc, k.datum desc, k.aangemaakt_op desc limit 500`, [van, tot]));
  return rijen.map(naarInkoop);
}

export async function inkoopfactuur(sessie: Sessie, id: string): Promise<Inkoop | null> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(`${INKOOP_SELECT} where k.id = $1`, [id]));
  return rijen[0] ? naarInkoop(rijen[0]) : null;
}

export type InkoopInvoer = {
  leverancier: string; omschrijving: string; kenmerk: string | null; datum: Datum; vervaldatum: Datum | null;
  grootboekId: string; bedragExcl: number; btwCode: string; btwBedrag: number;
  betaaldOp: Datum | null; betaaldVia: string | null;
};

export async function nieuweInkoop(sessie: Sessie, i: InkoopInvoer): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select maak_inkoopfactuur(${i.leverancier}, ${i.omschrijving}, ${i.kenmerk}, ${i.datum}, ${i.vervaldatum},
      ${i.grootboekId}, ${i.bedragExcl}, ${i.btwCode}, ${i.btwBedrag}, ${i.betaaldOp}, ${i.betaaldVia}::uuid,
      ${sessie.medewerkerId}) as id
  `);
  return r.id as string;
}

export async function werkInkoopBij(sessie: Sessie, id: string, i: Omit<InkoopInvoer, "betaaldOp" | "betaaldVia">): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    select werk_inkoopfactuur_bij(${id}, ${i.leverancier}, ${i.omschrijving}, ${i.kenmerk}, ${i.datum}, ${i.vervaldatum},
      ${i.grootboekId}, ${i.bedragExcl}, ${i.btwCode}, ${i.btwBedrag})
  `);
}

export async function verwijderInkoop(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`delete from inkoopfactuur where id = ${id}`);
}

export async function betaalInkoop(sessie: Sessie, id: string, datum: Datum | null, via: string | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => datum
    ? tx`select boek_betaling_inkoop(${id}, ${datum}, ${via}::uuid)`
    : tx`select maak_betaling_inkoop_ongedaan(${id})`);
}

// ----------------------------------------------------------------- btw ---

export type BtwRubriek = { rubriek: string; omschrijving: string; grondslag: number | null; btw: number };

export async function btwOverzicht(sessie: Sessie, van: Datum, tot: Datum): Promise<BtwRubriek[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select rubriek, omschrijving, grondslag::float8 as grondslag, btw::float8 as btw from btw_overzicht(${van}, ${tot})
  `);
  return rijen.map((r) => ({
    rubriek: r.rubriek as string, omschrijving: r.omschrijving as string,
    grondslag: r.grondslag === null ? null : n(r.grondslag), btw: n(r.btw),
  }));
}

export type Aangifte = {
  id: string; van: Datum; tot: Datum; omzetHoog: number; btwHoog: number; omzetLaag: number; btwLaag: number;
  omzetNul: number; voorbelasting: number; saldo: number; ingediendOp: Datum | null; betaaldOp: Datum | null;
};

export async function aangiftes(sessie: Sessie): Promise<Aangifte[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, periode_start, periode_einde, omzet_hoog::float8 as oh, btw_hoog::float8 as bh,
           omzet_laag::float8 as ol, btw_laag::float8 as bl, omzet_nul::float8 as on, voorbelasting::float8 as vb,
           saldo::float8 as saldo, ingediend_op, betaald_op
    from btw_aangifte order by periode_start desc
  `);
  return rijen.map((r) => ({
    id: r.id as string, van: r.periode_start as Datum, tot: r.periode_einde as Datum,
    omzetHoog: n(r.oh), btwHoog: n(r.bh), omzetLaag: n(r.ol), btwLaag: n(r.bl), omzetNul: n(r.on),
    voorbelasting: n(r.vb), saldo: n(r.saldo),
    ingediendOp: (r.ingediend_op as Datum) ?? null, betaaldOp: (r.betaald_op as Datum) ?? null,
  }));
}

export async function maakAangifte(sessie: Sessie, van: Datum, tot: Datum): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select maak_btw_aangifte(${van}, ${tot}) as id`);
  return r.id as string;
}

export async function verwijderAangifte(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select verwijder_btw_aangifte(${id})`);
}

export async function dienAangifteIn(sessie: Sessie, id: string, datum: Datum): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update btw_aangifte set ingediend_op = ${datum} where id = ${id} and ingediend_op is null
  `);
}

export async function betaalAangifte(sessie: Sessie, id: string, datum: Datum, via: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select boek_betaling_btw(${id}, ${datum}, ${via}::uuid)`);
}

// --------------------------------------------------------- instellingen ---

export type BoekhoudInstellingen = {
  afgeslotenTot: Datum | null; btwInterval: "maand" | "kwartaal" | "jaar";
  rekeningDebiteuren: string | null; rekeningCrediteuren: string | null; rekeningBank: string | null;
  rekeningBtwVerschuldigd: string | null; rekeningBtwVoorbelasting: string | null; rekeningBtwAangifte: string | null;
};

export async function boekhoudInstellingen(sessie: Sessie): Promise<BoekhoudInstellingen> {
  const [i] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select afgesloten_tot, btw_aangifte_interval::text as interval, rekening_debiteuren, rekening_crediteuren,
           rekening_bank, rekening_btw_verschuldigd, rekening_btw_voorbelasting, rekening_btw_aangifte
    from instellingen
  `);
  return {
    afgeslotenTot: (i.afgesloten_tot as Datum) ?? null,
    btwInterval: (i.interval as BoekhoudInstellingen["btwInterval"]) ?? "kwartaal",
    rekeningDebiteuren: (i.rekening_debiteuren as string) ?? null,
    rekeningCrediteuren: (i.rekening_crediteuren as string) ?? null,
    rekeningBank: (i.rekening_bank as string) ?? null,
    rekeningBtwVerschuldigd: (i.rekening_btw_verschuldigd as string) ?? null,
    rekeningBtwVoorbelasting: (i.rekening_btw_voorbelasting as string) ?? null,
    rekeningBtwAangifte: (i.rekening_btw_aangifte as string) ?? null,
  };
}

export async function werkBoekhoudInstellingenBij(sessie: Sessie, b: BoekhoudInstellingen): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update instellingen set
      afgesloten_tot = ${b.afgeslotenTot}, btw_aangifte_interval = ${b.btwInterval}::herhaal_interval,
      rekening_debiteuren = ${b.rekeningDebiteuren}, rekening_crediteuren = ${b.rekeningCrediteuren},
      rekening_bank = ${b.rekeningBank}, rekening_btw_verschuldigd = ${b.rekeningBtwVerschuldigd},
      rekening_btw_voorbelasting = ${b.rekeningBtwVoorbelasting}, rekening_btw_aangifte = ${b.rekeningBtwAangifte}
    where id
  `);
}

export async function sluitAf(sessie: Sessie, tot: Datum | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`update instellingen set afgesloten_tot = ${tot} where id`);
}

/** Openstaande posten: debiteuren en crediteuren als bedrag, plus banksaldo. */
export async function kerncijfers(sessie: Sessie, tot: Datum) {
  const [[d], [c], [b]] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`select coalesce(sum(totaal), 0)::float8 as bedrag, count(*)::int as aantal from factuur where status = 'definitief'`,
    await tx`select coalesce(sum(bedrag_incl), 0)::float8 as bedrag, count(*)::int as aantal from inkoopfactuur where betaald_op is null`,
    await tx`
      select coalesce(sum(s.saldo), 0)::float8 as bedrag
      from grootboek_saldi('1900-01-01', ${tot}) s join grootboekrekening g on g.id = s.grootboek_id
      where g.betaalmiddel and g.soort = 'activa'
    `,
  ]);
  return {
    debiteuren: n(d?.bedrag), debiteurenAantal: Number(d?.aantal ?? 0),
    crediteuren: n(c?.bedrag), crediteurenAantal: Number(c?.aantal ?? 0),
    liquide: n(b?.bedrag),
  };
}
