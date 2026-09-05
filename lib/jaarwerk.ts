import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { vandaag, type Datum } from "./datum";
import { saldi, type Saldo, type Rubriek, RUBRIEK_LABEL } from "./boekhouding";

// Jaarwerk: vaste activa en afschrijving, vennootschapsbelasting, de
// jaarrekening in de indeling van de publicatiestukken, en de kalender met
// alles wat een bv moet indienen.

const n = (v: unknown) => Number(v ?? 0);
const d = (v: unknown) => (v ? (String(v) as Datum) : null);

// --------------------------------------------------------------- activa ---

export type Activum = {
  id: string; omschrijving: string; aanschafdatum: Datum; aanschafwaarde: number; restwaarde: number;
  afschrijvingsmaanden: number; grootboekActiva: string; grootboekAfschrijving: string; grootboekKosten: string;
  inkoopId: string | null; afgeschrevenTot: Datum | null; buitenGebruikOp: Datum | null;
  afgeschreven: number; boekwaarde: number;
};

export async function activa(sessie: Sessie): Promise<Activum[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select a.*, a.aanschafwaarde::float8 as aanschaf_f, a.restwaarde::float8 as rest_f,
           coalesce((select sum(r.credit - r.debet) from boekingsregel r join boeking b on b.id = r.boeking_id
                      where b.activum_id = a.id and r.grootboek_id = a.grootboek_afschrijving), 0)::float8 as afgeschreven
    from activum a order by a.aanschafdatum desc
  `);
  return rijen.map((r) => ({
    id: r.id as string, omschrijving: r.omschrijving as string, aanschafdatum: r.aanschafdatum as Datum,
    aanschafwaarde: n(r.aanschaf_f), restwaarde: n(r.rest_f), afschrijvingsmaanden: Number(r.afschrijvingsmaanden),
    grootboekActiva: r.grootboek_activa as string, grootboekAfschrijving: r.grootboek_afschrijving as string,
    grootboekKosten: r.grootboek_kosten as string, inkoopId: (r.inkoop_id as string) ?? null,
    afgeschrevenTot: d(r.afgeschreven_tot), buitenGebruikOp: d(r.buiten_gebruik_op),
    afgeschreven: n(r.afgeschreven), boekwaarde: n(r.aanschaf_f) - n(r.afgeschreven),
  }));
}

export type ActivumInvoer = {
  omschrijving: string; aanschafdatum: Datum; aanschafwaarde: number; restwaarde: number; afschrijvingsmaanden: number;
  grootboekActiva: string; grootboekAfschrijving: string; grootboekKosten: string; inkoopId: string | null;
};

export async function nieuwActivum(sessie: Sessie, a: ActivumInvoer): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into activum (omschrijving, aanschafdatum, aanschafwaarde, restwaarde, afschrijvingsmaanden,
                         grootboek_activa, grootboek_afschrijving, grootboek_kosten, inkoop_id)
    values (${a.omschrijving}, ${a.aanschafdatum}, ${a.aanschafwaarde}, ${a.restwaarde}, ${a.afschrijvingsmaanden},
            ${a.grootboekActiva}, ${a.grootboekAfschrijving}, ${a.grootboekKosten}, ${a.inkoopId})
    returning id
  `);
  return r.id as string;
}

export async function zetBuitenGebruik(sessie: Sessie, id: string, datum: Datum | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`update activum set buiten_gebruik_op = ${datum} where id = ${id}`);
}

/** Alleen zolang er nog niets op is afgeschreven. */
export async function verwijderActivum(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from activum where id = ${id} and not exists (select 1 from boeking where activum_id = ${id})
  `);
}

export async function boekAfschrijvingen(sessie: Sessie, tot: Datum): Promise<number> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select boek_afschrijvingen(${tot}) as n`);
  return Number(r.n);
}

// ------------------------------------------------------------- boekjaar ---

export type Boekjaar = {
  jaar: number; vpbCorrecties: number; vpbVerliesVerrekend: number; vpbBedrag: number | null;
  vpbAangifteIngediendOp: Datum | null; vpbBetaaldOp: Datum | null; gemiddeldWerknemers: number | null;
  opgemaaktOp: Datum | null; vastgesteldOp: Datum | null; gedeponeerdOp: Datum | null; toelichting: string | null;
};

const naarBoekjaar = (r: Record<string, unknown>): Boekjaar => ({
  jaar: Number(r.jaar), vpbCorrecties: n(r.vpb_correcties), vpbVerliesVerrekend: n(r.vpb_verlies_verrekend),
  vpbBedrag: r.vpb_bedrag === null || r.vpb_bedrag === undefined ? null : n(r.vpb_bedrag),
  vpbAangifteIngediendOp: d(r.vpb_aangifte_ingediend_op), vpbBetaaldOp: d(r.vpb_betaald_op),
  gemiddeldWerknemers: r.gemiddeld_werknemers === null || r.gemiddeld_werknemers === undefined ? null : n(r.gemiddeld_werknemers),
  opgemaaktOp: d(r.opgemaakt_op), vastgesteldOp: d(r.vastgesteld_op), gedeponeerdOp: d(r.gedeponeerd_op),
  toelichting: (r.toelichting as string) ?? null,
});

export async function boekjaar(sessie: Sessie, jaar: number): Promise<Boekjaar> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`select * from boekjaar where jaar = ${jaar}`);
  return rijen[0] ? naarBoekjaar(rijen[0]) : {
    jaar, vpbCorrecties: 0, vpbVerliesVerrekend: 0, vpbBedrag: null, vpbAangifteIngediendOp: null, vpbBetaaldOp: null,
    gemiddeldWerknemers: null, opgemaaktOp: null, vastgesteldOp: null, gedeponeerdOp: null, toelichting: null,
  };
}

export async function boekjaren(sessie: Sessie): Promise<Boekjaar[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`select * from boekjaar order by jaar desc`);
  return rijen.map(naarBoekjaar);
}

export async function werkBoekjaarBij(sessie: Sessie, jaar: number, b: Partial<Omit<Boekjaar, "jaar" | "vpbBedrag">>): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`insert into boekjaar (jaar) values (${jaar}) on conflict (jaar) do nothing`;
    await tx`
      update boekjaar set
        vpb_correcties = coalesce(${b.vpbCorrecties ?? null}, vpb_correcties),
        vpb_verlies_verrekend = coalesce(${b.vpbVerliesVerrekend ?? null}, vpb_verlies_verrekend),
        gemiddeld_werknemers = case when ${b.gemiddeldWerknemers !== undefined} then ${b.gemiddeldWerknemers ?? null} else gemiddeld_werknemers end,
        toelichting = case when ${b.toelichting !== undefined} then ${b.toelichting ?? null} else toelichting end,
        opgemaakt_op = case when ${b.opgemaaktOp !== undefined} then ${b.opgemaaktOp ?? null} else opgemaakt_op end,
        vastgesteld_op = case when ${b.vastgesteldOp !== undefined} then ${b.vastgesteldOp ?? null} else vastgesteld_op end,
        gedeponeerd_op = case when ${b.gedeponeerdOp !== undefined} then ${b.gedeponeerdOp ?? null} else gedeponeerd_op end,
        vpb_aangifte_ingediend_op = case when ${b.vpbAangifteIngediendOp !== undefined} then ${b.vpbAangifteIngediendOp ?? null} else vpb_aangifte_ingediend_op end
      where jaar = ${jaar}
    `;
  });
}

export type VpbBerekening = {
  resultaat: number; correcties: number; verlies: number; belastbaar: number; grens: number;
  tariefLaag: number; tariefHoog: number; laagBedrag: number; hoogBedrag: number; vpb: number; gecontroleerd: boolean;
};

export async function vpbBerekening(sessie: Sessie, jaar: number): Promise<VpbBerekening> {
  const [[r], [p]] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`select * from vpb_berekening(${jaar})`,
    await tx`select gecontroleerd from vpb_parameters where jaar = ${jaar}`,
  ]);
  return {
    resultaat: n(r.resultaat), correcties: n(r.correcties), verlies: n(r.verlies), belastbaar: n(r.belastbaar),
    grens: n(r.grens), tariefLaag: n(r.tarief_laag), tariefHoog: n(r.tarief_hoog),
    laagBedrag: n(r.laag_bedrag), hoogBedrag: n(r.hoog_bedrag), vpb: n(r.vpb), gecontroleerd: Boolean(p?.gecontroleerd),
  };
}

export async function reserveerVpb(sessie: Sessie, jaar: number): Promise<number> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select reserveer_vpb(${jaar}) as bedrag`);
  return n(r.bedrag);
}

export async function betaalVpb(sessie: Sessie, jaar: number, datum: Datum, via: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select boek_betaling_vpb(${jaar}, ${datum}, ${via}::uuid)`);
}

export type VpbParameters = { jaar: number; grens: number; tariefLaag: number; tariefHoog: number; gecontroleerd: boolean };

export async function vpbParameters(sessie: Sessie): Promise<VpbParameters[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`select * from vpb_parameters order by jaar desc`);
  return rijen.map((r) => ({ jaar: Number(r.jaar), grens: n(r.grens), tariefLaag: n(r.tarief_laag), tariefHoog: n(r.tarief_hoog), gecontroleerd: Boolean(r.gecontroleerd) }));
}

export async function werkVpbParametersBij(sessie: Sessie, p: VpbParameters): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into vpb_parameters (jaar, grens, tarief_laag, tarief_hoog, gecontroleerd)
    values (${p.jaar}, ${p.grens}, ${p.tariefLaag}, ${p.tariefHoog}, ${p.gecontroleerd})
    on conflict (jaar) do update set grens = excluded.grens, tarief_laag = excluded.tarief_laag,
      tarief_hoog = excluded.tarief_hoog, gecontroleerd = excluded.gecontroleerd
  `);
}

// --------------------------------------------------------- jaarrekening ---

export type Post = { naam: string; nummer: string | null; grootboekId: string | null; bedrag: number; vorig: number };
export type Groep = { rubriek: Rubriek | "resultaat"; naam: string; posten: Post[]; totaal: number; vorig: number };

export type Jaarrekening = {
  jaar: number;
  activa: Groep[]; passiva: Groep[];
  totaalActiva: number; totaalActivaVorig: number; totaalPassiva: number; totaalPassivaVorig: number;
  wv: Groep[];
  omzet: number; omzetVorig: number; somKosten: number; somKostenVorig: number;
  bedrijfsresultaat: number; bedrijfsresultaatVorig: number;
  financieel: number; financieelVorig: number;
  resultaatVoor: number; resultaatVoorVorig: number;
  belastingen: number; belastingenVorig: number;
  resultaatNa: number; resultaatNaVorig: number;
  eigenVermogenBegin: number; eigenVermogenEind: number;
  vasteActiva: { aanschaf: number; afgeschreven: number; boekwaarde: number; afschrijvingJaar: number };
  kvk: { naam: string; waarde: number }[];      // de velden van "Zelf deponeren" (micro)
};

/** De jaarrekening over een kalenderjaar, met het vorige jaar ernaast. */
export async function jaarrekening(sessie: Sessie, jaar: number): Promise<Jaarrekening> {
  const van = `${jaar}-01-01`, tot = `${jaar}-12-31`, vanV = `${jaar - 1}-01-01`, totV = `${jaar - 1}-12-31`;
  const [periode, cumulatief, periodeV, cumulatiefV, jaarrek] = await Promise.all([
    saldi(sessie, van, tot), saldi(sessie, "1900-01-01", tot), saldi(sessie, vanV, totV), saldi(sessie, "1900-01-01", totV),
    boekjaar(sessie, jaar),
  ]);
  void jaarrek;
  const per = (l: Saldo[]) => new Map(l.map((s) => [s.grootboekId, s]));
  const cum = per(cumulatief), cumV = per(cumulatiefV), pv = per(periodeV);
  const getoond = (s: Saldo) => (s.soort === "activa" || s.soort === "kosten" ? s.saldo : -s.saldo);
  const teken = (s: Saldo) => (s.soort === "activa" || s.soort === "kosten" ? 1 : -1);

  const groep = (bron: Map<string, Saldo>, vorig: Map<string, Saldo>, rubriek: Rubriek, alleen: RekeningFilter): Groep => {
    const posten: Post[] = [];
    for (const s of cumulatief) {
      if (s.rubriek !== rubriek || !alleen(s)) continue;
      const a = bron.get(s.grootboekId), b = vorig.get(s.grootboekId);
      const bedrag = a ? getoond(a) : 0, vorigB = b ? teken(s) * b.saldo : 0;
      if (Math.abs(bedrag) < 0.005 && Math.abs(vorigB) < 0.005) continue;
      posten.push({ naam: s.naam, nummer: s.nummer, grootboekId: s.grootboekId, bedrag, vorig: vorigB });
    }
    return { rubriek, naam: RUBRIEK_LABEL[rubriek], posten, totaal: posten.reduce((x, p) => x + p.bedrag, 0), vorig: posten.reduce((x, p) => x + p.vorig, 0) };
  };
  type RekeningFilter = (s: Saldo) => boolean;
  const balans: RekeningFilter = (s) => s.soort !== "omzet" && s.soort !== "kosten";
  const wvF: RekeningFilter = (s) => s.soort === "omzet" || s.soort === "kosten";

  // Winst-en-verlies
  const g = (r: Rubriek) => groep(per(periode), pv, r, wvF);
  const omzetG = g("netto_omzet"), persG = g("personeelskosten"), afsG = g("afschrijvingen"), overG = g("overige_bedrijfskosten"),
    finG = g("financiele_baten_lasten"), belG = g("belastingen");
  const omzet = omzetG.totaal, omzetVorig = omzetG.vorig;
  const somKosten = persG.totaal + afsG.totaal + overG.totaal, somKostenVorig = persG.vorig + afsG.vorig + overG.vorig;
  const bedrijfsresultaat = omzet - somKosten, bedrijfsresultaatVorig = omzetVorig - somKostenVorig;
  const financieel = -finG.totaal, financieelVorig = -finG.vorig;   // kosten positief → last
  const resultaatVoor = bedrijfsresultaat + financieel, resultaatVoorVorig = bedrijfsresultaatVorig + financieelVorig;
  const belastingen = belG.totaal, belastingenVorig = belG.vorig;
  const resultaatNa = resultaatVoor - belastingen, resultaatNaVorig = resultaatVoorVorig - belastingenVorig;

  // Balans: resultaat van dit jaar en van eerdere jaren als eigen vermogen.
  const resultaatCum = (m: Map<string, Saldo>) => -[...m.values()].filter((s) => s.soort === "omzet" || s.soort === "kosten").reduce((x, s) => x + s.saldo, 0);
  const cumTot = resultaatCum(cum), cumTotV = resultaatCum(cumV);
  const eerdereJaren = cumTot - resultaatNa, eerdereJarenV = cumTotV - resultaatNaVorig;

  const b = (r: Rubriek) => groep(cum, cumV, r, balans);
  const vaste = b("vaste_activa"), vord = b("vorderingen"), liq = b("liquide_middelen");
  const ev = b("eigen_vermogen"), lang = b("langlopende_schulden"), kort = b("kortlopende_schulden");
  ev.posten.push({ naam: "Resultaat eerdere jaren", nummer: null, grootboekId: null, bedrag: eerdereJaren, vorig: eerdereJarenV });
  ev.posten.push({ naam: `Onverdeeld resultaat ${jaar}`, nummer: null, grootboekId: null, bedrag: resultaatNa, vorig: resultaatNaVorig });
  ev.totaal += eerdereJaren + resultaatNa; ev.vorig += eerdereJarenV + resultaatNaVorig;

  const activaG = [vaste, vord, liq].filter((x) => x.posten.length);
  const passivaG = [ev, lang, kort].filter((x) => x.posten.length);
  const totaalActiva = activaG.reduce((x, gr) => x + gr.totaal, 0), totaalActivaVorig = activaG.reduce((x, gr) => x + gr.vorig, 0);
  const totaalPassiva = passivaG.reduce((x, gr) => x + gr.totaal, 0), totaalPassivaVorig = passivaG.reduce((x, gr) => x + gr.vorig, 0);

  const aanschaf = vaste.posten.filter((p) => p.bedrag >= 0).reduce((x, p) => x + p.bedrag, 0);
  const afgeschreven = -vaste.posten.filter((p) => p.bedrag < 0).reduce((x, p) => x + p.bedrag, 0);

  return {
    jaar, activa: activaG, passiva: passivaG, totaalActiva, totaalActivaVorig, totaalPassiva, totaalPassivaVorig,
    wv: [omzetG, persG, afsG, overG, finG, belG].filter((x) => x.posten.length),
    omzet, omzetVorig, somKosten, somKostenVorig, bedrijfsresultaat, bedrijfsresultaatVorig, financieel, financieelVorig,
    resultaatVoor, resultaatVoorVorig, belastingen, belastingenVorig, resultaatNa, resultaatNaVorig,
    eigenVermogenBegin: ev.vorig, eigenVermogenEind: ev.totaal,
    vasteActiva: { aanschaf, afgeschreven, boekwaarde: vaste.totaal, afschrijvingJaar: afsG.totaal },
    kvk: [
      { naam: "Vaste activa", waarde: vaste.totaal },
      { naam: "Vlottende activa (vorderingen en liquide middelen)", waarde: vord.totaal + liq.totaal },
      { naam: "Totaal activa", waarde: totaalActiva },
      { naam: "Eigen vermogen", waarde: ev.totaal },
      { naam: "Voorzieningen", waarde: 0 },
      { naam: "Langlopende schulden", waarde: lang.totaal },
      { naam: "Kortlopende schulden", waarde: kort.totaal },
      { naam: "Totaal passiva", waarde: totaalPassiva },
    ],
  };
}

// ------------------------------------------------------------ kalender ---

export type AangifteItem = {
  soort: "btw" | "loon" | "vpb" | "jaarrekening";
  titel: string; periode: string; deadline: Datum;
  status: "open" | "vastgelegd" | "ingediend" | "afgerond";
  toelichting: string; link: string;
};

const eindeMaand = (jaar: number, maand: number): Datum => {
  const e = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  return `${jaar}-${String(maand).padStart(2, "0")}-${e}`;
};

/** Wat een bv moet indienen, met de stand uit de eigen administratie. */
export async function aangiftenKalender(sessie: Sessie, jaar: number): Promise<AangifteItem[]> {
  const [inst, btw, runs, dienst, bj] = await alsGebruiker(sessie.authUserId, async (tx) => [
    (await tx`select btw_aangifte_interval::text as interval from instellingen`)[0],
    await tx`select periode_start, periode_einde, ingediend_op, betaald_op from btw_aangifte where extract(year from periode_start) = ${jaar}`,
    await tx`select jaar, maand, status, aangifte_ingediend_op, loonheffing_betaald_op from loonrun where jaar = ${jaar}`,
    (await tx`select count(*)::int as n from dienstverband where in_dienst <= ${`${jaar}-12-31`} and (uit_dienst is null or uit_dienst >= ${`${jaar}-01-01`})`)[0],
    (await tx`select * from boekjaar where jaar = ${jaar}`)[0],
  ]);
  const items: AangifteItem[] = [];
  const nu = vandaag();

  // Btw
  const stap = inst.interval === "maand" ? 1 : inst.interval === "jaar" ? 12 : 3;
  for (let m = 1; m <= 12; m += stap) {
    const van = `${jaar}-${String(m).padStart(2, "0")}-01`, tot = eindeMaand(jaar, m + stap - 1);
    if (van > nu) break;
    const a = btw.find((x) => String(x.periode_start) === van);
    const label = stap === 3 ? `Q${(m - 1) / 3 + 1} ${jaar}` : stap === 12 ? String(jaar) : `${String(m).padStart(2, "0")}-${jaar}`;
    const dl = m + stap - 1 === 12 ? eindeMaand(jaar + 1, 1) : eindeMaand(jaar, m + stap);
    items.push({
      soort: "btw", titel: "Btw-aangifte", periode: label, deadline: dl,
      status: !a ? "open" : a.betaald_op ? "afgerond" : a.ingediend_op ? "ingediend" : "vastgelegd",
      toelichting: "Aangifte en betaling uiterlijk de laatste dag van de maand na het tijdvak.",
      link: `/boekhouding/btw?van=${van}&tot=${tot}`,
    });
  }

  // Loonaangifte, alleen als er een dienstverband is.
  if (Number(dienst.n) > 0) {
    for (let m = 1; m <= 12; m++) {
      if (`${jaar}-${String(m).padStart(2, "0")}-01` > nu) break;
      const r = runs.find((x) => Number(x.maand) === m);
      const dl = m === 12 ? eindeMaand(jaar + 1, 1) : eindeMaand(jaar, m + 1);
      items.push({
        soort: "loon", titel: "Loonaangifte", periode: `${String(m).padStart(2, "0")}-${jaar}`, deadline: dl,
        status: !r || r.status !== "definitief" ? "open" : r.loonheffing_betaald_op ? "afgerond" : r.aangifte_ingediend_op ? "ingediend" : "vastgelegd",
        toelichting: "Per maand: aangifte en betaling van de loonheffingen uiterlijk de laatste dag van de volgende maand.",
        link: "/boekhouding/loon",
      });
    }
  }

  // Vennootschapsbelasting en jaarrekening, na afloop van het jaar.
  if (`${jaar}-12-31` <= nu) {
    items.push({
      soort: "vpb", titel: "Aangifte vennootschapsbelasting", periode: String(jaar), deadline: `${jaar + 1}-06-01`,
      status: !bj?.vpb_bedrag ? "open" : bj.vpb_betaald_op ? "afgerond" : bj.vpb_aangifte_ingediend_op ? "ingediend" : "vastgelegd",
      toelichting: "Vóór 1 juni van het volgende jaar, of later met uitstel via de Belastingdienst.",
      link: `/boekhouding/jaarrekening?jaar=${jaar}`,
    });
    items.push({
      soort: "jaarrekening", titel: "Jaarrekening opmaken en vaststellen", periode: String(jaar), deadline: `${jaar + 1}-05-31`,
      status: bj?.vastgesteld_op ? "afgerond" : bj?.opgemaakt_op ? "vastgelegd" : "open",
      toelichting: "Het bestuur maakt de jaarrekening binnen vijf maanden op (verlengbaar met vijf), de aandeelhouders stellen hem vast.",
      link: `/boekhouding/jaarrekening?jaar=${jaar}`,
    });
    items.push({
      soort: "jaarrekening", titel: "Jaarrekening deponeren bij de KvK", periode: String(jaar), deadline: `${jaar + 1}-12-31`,
      status: bj?.gedeponeerd_op ? "afgerond" : bj?.vastgesteld_op ? "vastgelegd" : "open",
      toelichting: "Binnen acht dagen na vaststelling, en uiterlijk twaalf maanden na het einde van het boekjaar.",
      link: `/boekhouding/jaarrekening?jaar=${jaar}`,
    });
  }
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}
