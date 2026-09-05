import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { vandaag, type Datum } from "./datum";

// Facturatie. Een factuur is een eigen document met regels, elk met btw en
// grootboekrekening. De opbouw en de overgang naar definitief zitten in
// databasefuncties (maak_factuur, maak_definitief, crediteer_factuur), zodat
// de app en de abonnementsverwerking precies hetzelfde doen.
//
// Alles via alsGebruiker(): alleen de eigenaar mag facturen maken; vanaf
// projectleider zijn ze te lezen; een medewerker ziet niets.

const nr = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type Facturatiemodel = "nacalculatie" | "vaste_prijs" | "abonnement";
export type FactuurStatus = "concept" | "definitief" | "betaald" | "gecrediteerd";

export type SpecUur = {
  id: string; datum: Datum; medewerker: string; project: string; projectId: string;
  onderdeel: string; omschrijving: string | null; minuten: number; declarabel: boolean;
  status: string; verkooptarief: number | null; omzet: number | null;
  correctieVanId: string | null; gecorrigeerd: boolean;
};
export type SpecRit = {
  id: string; datum: Datum; medewerker: string; doel: string; omschrijving: string | null;
  totaalKm: number; kmTarief: number | null; kmBedrag: number | null; status: string;
};
export type SpecTermijn = {
  id: string; volgorde: number; omschrijving: string; bedrag: number;
  geplandOp: Datum | null; factuurReferentie: string | null;
};
export type Bedrijf = {
  naam: string; adres: string | null; postcode: string | null; plaats: string | null;
  kvk: string | null; btw: string | null; iban: string | null; email: string | null;
  telefoon: string | null; voettekst: string | null;
};
export type KlantKop = {
  id: string; naam: string; contactpersoon: string | null; adres: string | null;
  postcode: string | null; plaats: string | null; factuurReferentie: string | null;
  metOmschrijving: boolean; metTarieven: boolean; btwCode: string;
};
export type ProjectKop = {
  id: string; naam: string; code: string | null; facturatiemodel: Facturatiemodel;
  vastePrijs: number | null;
};
export type FactuurRegel = {
  id: string; volgorde: number; omschrijving: string; aantal: number; eenheid: string;
  prijs: number; bedrag: number; btwCode: string; btwPercentage: number;
  grootboekId: string | null; grootboekNummer: string | null; bron: string;
};
export type FactuurKop = {
  id: string; nummer: string | null; status: FactuurStatus; datum: Datum | null;
  vervaldatum: Datum | null; periodeVan: Datum | null; periodeTot: Datum | null;
  referentieKlant: string | null; opmerking: string | null;
  subtotaal: number; btwBedrag: number; totaal: number; betaaldOp: Datum | null;
  creditVanId: string | null; automatisch: boolean; verwerktOp: string | null;
  geexporteerdOp: string | null;
};

export type Selectie =
  | { factuurId: string }
  | { projectId: string; van: Datum; tot: Datum };

// ----------------------------------------------------------------- lezen ---

async function bedrijfsgegevens(tx: Parameters<Parameters<typeof alsGebruiker>[1]>[0]): Promise<Bedrijf> {
  const [b] = await tx`
    select bedrijfsnaam, adres, postcode, plaats, kvk_nummer, btw_nummer,
           iban, email, telefoon, factuur_voettekst
    from instellingen
  `;
  return {
    naam: (b?.bedrijfsnaam as string) || "Declaratietool",
    adres: (b?.adres as string) ?? null, postcode: (b?.postcode as string) ?? null,
    plaats: (b?.plaats as string) ?? null, kvk: (b?.kvk_nummer as string) ?? null,
    btw: (b?.btw_nummer as string) ?? null, iban: (b?.iban as string) ?? null,
    email: (b?.email as string) ?? null, telefoon: (b?.telefoon as string) ?? null,
    voettekst: (b?.factuur_voettekst as string) ?? null,
  };
}

/**
 * Alles wat voor een specificatie of factuur nodig is: óf de inhoud van een
 * bestaande factuur, óf het voorstel voor een project in een periode.
 */
export async function specificatie(sessie: Sessie, sel: Selectie) {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const bedrijf = await bedrijfsgegevens(tx);

    let factuur: FactuurKop | null = null;
    let regels: FactuurRegel[] = [];
    let projectId: string | null;
    let klantIdVanFactuur: string | null = null;

    if ("factuurId" in sel) {
      const [f] = await tx`select * from factuur where id = ${sel.factuurId}`;
      if (!f) return leeg(bedrijf);
      factuur = naarFactuurKop(f);
      projectId = (f.project_id as string) ?? null;
      klantIdVanFactuur = f.klant_id as string;
      regels = (await tx`
        select * from factuurregel where factuur_id = ${sel.factuurId} order by volgorde
      `).map(naarRegel);
    } else {
      projectId = sel.projectId;
    }

    const [p] = projectId
      ? await tx`
          select p.id, p.naam, p.code, p.facturatiemodel::text as model, p.vaste_prijs::float8 as vaste_prijs,
                 k.id as klant_id
          from project p join klant k on k.id = p.klant_id where p.id = ${projectId}
        `
      : [null];
    const klantId = (p?.klant_id as string) ?? klantIdVanFactuur;
    if (!klantId) return leeg(bedrijf);

    const [k] = await tx`
      select id, naam, contactpersoon, adres, postcode, plaats, factuur_referentie,
             specificatie_omschrijving, specificatie_tarieven, btw_code
      from klant where id = ${klantId}
    `;
    const klant: KlantKop = {
      id: k.id as string, naam: k.naam as string,
      contactpersoon: (k.contactpersoon as string) ?? null,
      adres: (k.adres as string) ?? null, postcode: (k.postcode as string) ?? null,
      plaats: (k.plaats as string) ?? null,
      factuurReferentie: (k.factuur_referentie as string) ?? null,
      metOmschrijving: k.specificatie_omschrijving as boolean,
      metTarieven: k.specificatie_tarieven as boolean,
      btwCode: k.btw_code as string,
    };
    const project: ProjectKop | null = p
      ? { id: p.id as string, naam: p.naam as string, code: (p.code as string) ?? null,
          facturatiemodel: p.model as Facturatiemodel, vastePrijs: nr(p.vaste_prijs) }
      : null;

    const uren = "factuurId" in sel
      ? await tx`
          select v.*, u.correctie_van_id,
                 exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
          from v_urenregel v join urenregel u on u.id = v.id
          where u.factuur_id = ${sel.factuurId} order by v.datum, v.medewerker`
      : await tx`
          select v.*, u.correctie_van_id,
                 exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
          from v_urenregel v join urenregel u on u.id = v.id
          where v.project_id = ${projectId} and v.datum between ${sel.van} and ${sel.tot}
            and v.status = 'goedgekeurd' and u.factuur_id is null
          order by v.datum, v.medewerker`;

    const ritten = "factuurId" in sel
      ? await tx`
          select v.* from v_rit v join rit r on r.id = v.id
          where r.factuur_id = ${sel.factuurId} order by v.datum`
      : await tx`
          select v.* from v_rit v join rit r on r.id = v.id
          where v.project_id = ${projectId} and v.datum between ${sel.van} and ${sel.tot}
            and v.status = 'goedgekeurd' and v.declarabel and r.factuur_id is null
          order by v.datum`;

    const termijnen = "factuurId" in sel
      ? await tx`
          select id, volgorde, omschrijving, bedrag::float8 as bedrag, gepland_op, factuur_referentie
          from termijn where factuur_id = ${sel.factuurId} order by volgorde`
      : await tx`
          select id, volgorde, omschrijving, bedrag::float8 as bedrag, gepland_op, factuur_referentie
          from termijn where project_id = ${projectId} and factuur_id is null order by volgorde`;

    const nietKlaar = "factuurId" in sel ? 0 : Number((await tx`
      select count(*) as n from v_urenregel
      where project_id = ${projectId} and datum between ${sel.van} and ${sel.tot}
        and status in ('concept', 'ingediend')`)[0].n);

    return {
      bedrijf, klant, project, factuur, regels, nietKlaar,
      uren: uren.map(naarUur), ritten: ritten.map(naarRit), termijnen: termijnen.map(naarTermijn),
    };
  });
}

function leeg(bedrijf: Bedrijf) {
  return {
    bedrijf, klant: null as KlantKop | null, project: null as ProjectKop | null,
    factuur: null as FactuurKop | null, regels: [] as FactuurRegel[], nietKlaar: 0,
    uren: [] as SpecUur[], ritten: [] as SpecRit[], termijnen: [] as SpecTermijn[],
  };
}

const naarUur = (r: Record<string, unknown>): SpecUur => ({
  id: r.id as string, datum: r.datum as Datum, medewerker: r.medewerker as string,
  project: r.project as string, projectId: r.project_id as string, onderdeel: r.onderdeel as string,
  omschrijving: (r.omschrijving as string) ?? null, minuten: Number(r.minuten),
  declarabel: r.declarabel as boolean, status: r.status as string,
  verkooptarief: nr(r.verkooptarief), omzet: nr(r.omzet),
  correctieVanId: (r.correctie_van_id as string) ?? null, gecorrigeerd: Boolean(r.gecorrigeerd),
});
const naarRit = (r: Record<string, unknown>): SpecRit => ({
  id: r.id as string, datum: r.datum as Datum, medewerker: r.medewerker as string,
  doel: r.doel as string, omschrijving: (r.omschrijving as string) ?? null,
  totaalKm: Number(r.totaal_km), kmTarief: nr(r.km_tarief), kmBedrag: nr(r.km_bedrag),
  status: r.status as string,
});
const naarTermijn = (r: Record<string, unknown>): SpecTermijn => ({
  id: r.id as string, volgorde: Number(r.volgorde), omschrijving: r.omschrijving as string,
  bedrag: Number(r.bedrag), geplandOp: (r.gepland_op as Datum) ?? null,
  factuurReferentie: (r.factuur_referentie as string) ?? null,
});
const naarRegel = (r: Record<string, unknown>): FactuurRegel => ({
  id: r.id as string, volgorde: Number(r.volgorde), omschrijving: r.omschrijving as string,
  aantal: Number(r.aantal), eenheid: r.eenheid as string, prijs: Number(r.prijs),
  bedrag: Number(r.bedrag), btwCode: r.btw_code as string, btwPercentage: Number(r.btw_percentage),
  grootboekId: (r.grootboek_id as string) ?? null, grootboekNummer: (r.grootboek_nummer as string) ?? null,
  bron: r.bron as string,
});
const naarFactuurKop = (f: Record<string, unknown>): FactuurKop => ({
  id: f.id as string, nummer: (f.nummer as string) ?? null, status: f.status as FactuurStatus,
  datum: (f.datum as Datum) ?? null, vervaldatum: (f.vervaldatum as Datum) ?? null,
  periodeVan: (f.periode_van as Datum) ?? null, periodeTot: (f.periode_tot as Datum) ?? null,
  referentieKlant: (f.referentie_klant as string) ?? null, opmerking: (f.opmerking as string) ?? null,
  subtotaal: Number(f.subtotaal), btwBedrag: Number(f.btw_bedrag), totaal: Number(f.totaal),
  betaaldOp: (f.betaald_op as Datum) ?? null, creditVanId: (f.credit_van_id as string) ?? null,
  automatisch: Boolean(f.automatisch), verwerktOp: f.verwerkt_op ? String(f.verwerkt_op) : null,
  geexporteerdOp: f.geexporteerd_op ? String(f.geexporteerd_op) : null,
});

// ------------------------------------------------------------- lijsten ---

export type Factuur = {
  id: string; nummer: string | null; status: FactuurStatus; klantId: string; klant: string;
  projectId: string | null; project: string | null; facturatiemodel: Facturatiemodel | null;
  datum: Datum | null; vervaldatum: Datum | null; periodeVan: Datum | null; periodeTot: Datum | null;
  subtotaal: number; btwBedrag: number; totaal: number; openstaand: number; vervallen: boolean;
  betaaldOp: Datum | null; creditVanId: string | null; automatisch: boolean;
  verwerktOp: string | null; geexporteerdOp: string | null; minuten: number; km: number; regels: number;
};

export async function facturen(sessie: Sessie): Promise<Factuur[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select *, subtotaal::float8 as subtotaal_f, btw_bedrag::float8 as btw_f, totaal::float8 as totaal_f,
           openstaand::float8 as open_f, km::float8 as km_f
    from v_factuur
    order by (status = 'concept') desc, definitief_op desc nulls first, aangemaakt_op desc
    limit 300
  `);
  return rijen.map((r) => ({
    id: r.id as string, nummer: (r.nummer as string) ?? null, status: r.status as FactuurStatus,
    klantId: r.klant_id as string, klant: r.klant as string,
    projectId: (r.project_id as string) ?? null, project: (r.project as string) ?? null,
    facturatiemodel: (r.facturatiemodel as Facturatiemodel) ?? null,
    datum: (r.datum as Datum) ?? null, vervaldatum: (r.vervaldatum as Datum) ?? null,
    periodeVan: (r.periode_van as Datum) ?? null, periodeTot: (r.periode_tot as Datum) ?? null,
    subtotaal: Number(r.subtotaal_f), btwBedrag: Number(r.btw_f), totaal: Number(r.totaal_f),
    openstaand: Number(r.open_f), vervallen: Boolean(r.vervallen),
    betaaldOp: (r.betaald_op as Datum) ?? null, creditVanId: (r.credit_van_id as string) ?? null,
    automatisch: Boolean(r.automatisch), verwerktOp: r.verwerkt_op ? String(r.verwerkt_op) : null,
    geexporteerdOp: r.geexporteerd_op ? String(r.geexporteerd_op) : null,
    minuten: Number(r.minuten), km: Number(r.km_f), regels: Number(r.regels),
  }));
}

export type TeFactureren = {
  projectId: string; project: string; klant: string; facturatiemodel: Facturatiemodel;
  vastePrijs: number | null; regels: number; minuten: number; omzet: number | null;
  van: Datum | null; tot: Datum | null; termijnenOpen: number; termijnBedrag: number | null;
};

/** Projecten met iets te factureren: goedgekeurde regels of open termijnen. */
export async function teFactureren(sessie: Sessie): Promise<TeFactureren[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    with u as (
      select v.project_id, count(*) as regels, sum(v.minuten) as minuten,
             sum(v.omzet) as omzet, min(v.datum) as van, max(v.datum) as tot
      from v_urenregel v join urenregel r on r.id = v.id
      where v.status = 'goedgekeurd' and r.factuur_id is null
      group by v.project_id
    ),
    t as (
      select project_id, count(*) as n, sum(bedrag) as bedrag
      from termijn where factuur_id is null group by project_id
    )
    select p.id, p.naam as project, k.naam as klant,
           p.facturatiemodel::text as model, p.vaste_prijs::float8 as vaste_prijs,
           coalesce(u.regels, 0) as regels, coalesce(u.minuten, 0) as minuten,
           u.omzet::float8 as omzet, u.van, u.tot,
           coalesce(t.n, 0) as termijnen_open, t.bedrag::float8 as termijn_bedrag
    from project p
    join klant k on k.id = p.klant_id
    left join u on u.project_id = p.id
    left join t on t.project_id = p.id
    where u.project_id is not null or t.project_id is not null
    order by k.naam, p.naam
  `);
  return rijen.map((r) => ({
    projectId: r.id as string, project: r.project as string, klant: r.klant as string,
    facturatiemodel: r.model as Facturatiemodel, vastePrijs: nr(r.vaste_prijs),
    regels: Number(r.regels), minuten: Number(r.minuten), omzet: nr(r.omzet),
    van: (r.van as Datum) ?? null, tot: (r.tot as Datum) ?? null,
    termijnenOpen: Number(r.termijnen_open), termijnBedrag: nr(r.termijn_bedrag),
  }));
}

// ------------------------------------------------------------ schrijven --

export async function maakConceptFactuur(
  sessie: Sessie, projectId: string, van: Datum, tot: Datum,
  termijnIds: string[], metReiskosten: boolean,
): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select maak_factuur(${projectId}, ${van}, ${tot}, ${termijnIds}::uuid[],
                        ${metReiskosten}, ${sessie.medewerkerId}) as id
  `);
  return r.id as string;
}

/** Een lege conceptfactuur voor een klant, om met de hand regels op te zetten. */
export async function maakLosseFactuur(sessie: Sessie, klantId: string, projectId: string | null): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into factuur (klant_id, project_id, referentie_klant, aangemaakt_door)
    values (${klantId}, ${projectId},
            (select factuur_referentie from klant where id = ${klantId}), ${sessie.medewerkerId})
    returning id
  `);
  return r.id as string;
}

export type RegelInvoer = {
  omschrijving: string; aantal: number; eenheid: string; prijs: number;
  btwCode: string | null; grootboekId: string | null;
};

export async function regelToevoegen(sessie: Sessie, factuurId: string, r: RegelInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    select voeg_factuurregel_toe(${factuurId}, ${r.omschrijving}, ${r.aantal}, ${r.eenheid},
                                 ${r.prijs}, ${r.aantal * r.prijs}, 'handmatig', null, null,
                                 ${r.btwCode}, ${r.grootboekId})
  `);
}

export async function regelBijwerken(sessie: Sessie, regelId: string, r: RegelInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`
      update factuurregel set
        omschrijving = ${r.omschrijving}, aantal = ${r.aantal}, eenheid = ${r.eenheid},
        prijs = ${r.prijs}, bedrag = round((${r.aantal}::numeric * ${r.prijs}::numeric), 2),
        btw_code = coalesce(${r.btwCode}, btw_code),
        btw_percentage = (select percentage from btw_tarief where code = coalesce(${r.btwCode}, factuurregel.btw_code)),
        grootboek_id = coalesce(${r.grootboekId}, grootboek_id),
        grootboek_nummer = (select nummer from grootboekrekening where id = coalesce(${r.grootboekId}, factuurregel.grootboek_id))
      where id = ${regelId}
    `;
    await tx`select herbereken_factuur((select factuur_id from factuurregel where id = ${regelId}))`;
  });
}

export async function regelVerwijderen(sessie: Sessie, regelId: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    const [r] = await tx`delete from factuurregel where id = ${regelId} returning factuur_id`;
    if (r) await tx`select herbereken_factuur(${r.factuur_id as string})`;
  });
}

export async function factuurKopBijwerken(
  sessie: Sessie, id: string, k: { referentieKlant: string | null; opmerking: string | null },
): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update factuur set referentie_klant = ${k.referentieKlant}, opmerking = ${k.opmerking}
    where id = ${id} and status = 'concept'
  `);
}

export async function maakDefinitief(sessie: Sessie, id: string, datum: Datum): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select maak_definitief(${id}, ${datum}) as nummer
  `);
  return r.nummer as string;
}

export async function verwijderConcept(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select verwijder_concept(${id})`);
}

export async function zetBetaald(sessie: Sessie, id: string, datum: Datum | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => datum
    ? tx`update factuur set status = 'betaald', betaald_op = ${datum} where id = ${id} and status = 'definitief'`
    : tx`update factuur set status = 'definitief', betaald_op = null where id = ${id} and status = 'betaald'`);
}

export async function crediteer(sessie: Sessie, id: string, reden: string): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select crediteer_factuur(${id}, ${reden}, ${sessie.medewerkerId}) as id
  `);
  return r.id as string;
}

export async function markeerVerwerkt(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update factuur set verwerkt_op = now() where id = ${id} and status <> 'concept'
  `);
}

// --------------------------------------------------- grootboek en btw ----

export type Grootboek = { id: string; nummer: string; naam: string; soort: string; actief: boolean };
export type BtwTarief = { code: string; omschrijving: string; percentage: number; actief: boolean };

export async function grootboekrekeningen(sessie: Sessie): Promise<Grootboek[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, nummer, naam, soort::text as soort, actief from grootboekrekening order by nummer
  `);
  return rijen.map((r) => ({ id: r.id as string, nummer: r.nummer as string, naam: r.naam as string, soort: r.soort as string, actief: r.actief as boolean }));
}

export async function btwTarieven(sessie: Sessie): Promise<BtwTarief[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select code, omschrijving, percentage::float8 as percentage, actief from btw_tarief order by sortering, code
  `);
  return rijen.map((r) => ({ code: r.code as string, omschrijving: r.omschrijving as string, percentage: Number(r.percentage), actief: r.actief as boolean }));
}

export async function nieuweGrootboekrekening(sessie: Sessie, nummer: string, naam: string, soort: string) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into grootboekrekening (nummer, naam, soort) values (${nummer}, ${naam}, ${soort}::grootboek_soort)
  `);
}

export async function werkGrootboekBij(sessie: Sessie, id: string, nummer: string, naam: string, actief: boolean) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update grootboekrekening set nummer = ${nummer}, naam = ${naam}, actief = ${actief} where id = ${id}
  `);
}

export async function werkBtwBij(sessie: Sessie, code: string, percentage: number, actief: boolean) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update btw_tarief set percentage = ${percentage}, actief = ${actief} where code = ${code}
  `);
}

export type FactuurInstellingen = {
  grootboekUren: string | null; grootboekReiskosten: string | null; grootboekTermijn: string | null;
  grootboekAbonnement: string | null; grootboekOverig: string | null;
  betaaltermijnDagen: number; voettekst: string | null; prefix: string;
};

export async function factuurInstellingen(sessie: Sessie): Promise<FactuurInstellingen> {
  const [i] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select grootboek_uren, grootboek_reiskosten, grootboek_termijn, grootboek_abonnement,
           grootboek_overig, betaaltermijn_dagen, factuur_voettekst, factuur_prefix
    from instellingen
  `);
  return {
    grootboekUren: (i.grootboek_uren as string) ?? null,
    grootboekReiskosten: (i.grootboek_reiskosten as string) ?? null,
    grootboekTermijn: (i.grootboek_termijn as string) ?? null,
    grootboekAbonnement: (i.grootboek_abonnement as string) ?? null,
    grootboekOverig: (i.grootboek_overig as string) ?? null,
    betaaltermijnDagen: Number(i.betaaltermijn_dagen),
    voettekst: (i.factuur_voettekst as string) ?? null,
    prefix: (i.factuur_prefix as string) ?? "",
  };
}

export async function werkFactuurInstellingenBij(sessie: Sessie, f: FactuurInstellingen) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update instellingen set
      grootboek_uren = ${f.grootboekUren}, grootboek_reiskosten = ${f.grootboekReiskosten},
      grootboek_termijn = ${f.grootboekTermijn}, grootboek_abonnement = ${f.grootboekAbonnement},
      grootboek_overig = ${f.grootboekOverig}, betaaltermijn_dagen = ${f.betaaltermijnDagen},
      factuur_voettekst = ${f.voettekst}, factuur_prefix = ${f.prefix}
    where id
  `);
}

// --------------------------------------------------------- boekhouding ---

export type JournaalRegel = {
  nummer: string; datum: Datum; vervaldatum: Datum; status: string; klant: string;
  klantcode: string | null; klantEmail: string | null; referentieKlant: string | null;
  projectcode: string | null; project: string | null; volgorde: number; omschrijving: string;
  aantal: number; eenheid: string; prijs: number; bedrag: number; btwCode: string;
  btwPercentage: number; btwBedrag: number; bedragIncl: number; grootboekNummer: string | null;
  grootboekNaam: string | null; bron: string; geexporteerdOp: string | null; factuurId: string;
};

/** Journaalregels voor de boekhouding; `alleenNieuw` = nog niet geëxporteerd. */
export async function journaal(sessie: Sessie, van: Datum, tot: Datum, alleenNieuw: boolean): Promise<JournaalRegel[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select *, aantal::float8 as aantal_f, prijs::float8 as prijs_f, bedrag::float8 as bedrag_f,
           btw_percentage::float8 as pct_f, btw_bedrag::float8 as btw_f, bedrag_incl::float8 as incl_f
    from v_factuur_journaal
    where datum between ${van} and ${tot}
      and (${!alleenNieuw} or geexporteerd_op is null)
    order by datum, nummer, volgorde
  `);
  return rijen.map((r) => ({
    nummer: r.nummer as string, datum: r.datum as Datum, vervaldatum: r.vervaldatum as Datum,
    status: r.status as string, klant: r.klant as string, klantcode: (r.klantcode as string) ?? null,
    klantEmail: (r.klant_email as string) ?? null, referentieKlant: (r.referentie_klant as string) ?? null,
    projectcode: (r.projectcode as string) ?? null, project: (r.project as string) ?? null,
    volgorde: Number(r.volgorde), omschrijving: r.omschrijving as string, aantal: Number(r.aantal_f),
    eenheid: r.eenheid as string, prijs: Number(r.prijs_f), bedrag: Number(r.bedrag_f),
    btwCode: r.btw_code as string, btwPercentage: Number(r.pct_f), btwBedrag: Number(r.btw_f),
    bedragIncl: Number(r.incl_f), grootboekNummer: (r.grootboek_nummer as string) ?? null,
    grootboekNaam: (r.grootboek_naam as string) ?? null, bron: r.bron as string,
    geexporteerdOp: r.geexporteerd_op ? String(r.geexporteerd_op) : null, factuurId: r.factuur_id as string,
  }));
}

export async function markeerGeexporteerd(sessie: Sessie, factuurIds: string[], kenmerk: string): Promise<void> {
  if (!factuurIds.length) return;
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update factuur set geexporteerd_op = now(), export_kenmerk = ${kenmerk}
    where id = any(${factuurIds}::uuid[]) and status <> 'concept'
  `);
}

// -------------------------------------------------------------- termijnen --

export async function termijnenVan(sessie: Sessie, projectId: string): Promise<SpecTermijn[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, volgorde, omschrijving, bedrag::float8 as bedrag, gepland_op, factuur_referentie
    from termijn where project_id = ${projectId} order by volgorde, aangemaakt_op
  `);
  return rijen.map(naarTermijn);
}

export async function nieuweTermijn(
  sessie: Sessie, projectId: string,
  t: { omschrijving: string; bedrag: number; geplandOp: Datum | null },
): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into termijn (project_id, volgorde, omschrijving, bedrag, gepland_op)
    values (${projectId},
            coalesce((select max(volgorde) + 1 from termijn where project_id = ${projectId}), 1),
            ${t.omschrijving}, ${t.bedrag}, ${t.geplandOp})
  `);
}

export async function verwijderTermijn(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from termijn where id = ${id} and factuur_referentie is null and factuur_id is null
  `);
}

// ---------------------------------------------------------- abonnementen --

export type Verwerkt = { projectId: string; termijnId: string; periodeStart: Datum; referentie: string | null };

export async function verwerkPeriodiek(sessie: Sessie): Promise<Verwerkt[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`select * from verwerk_periodieke_facturen()`);
  return rijen.map((r) => ({
    projectId: r.uit_project_id as string, termijnId: r.uit_termijn_id as string,
    periodeStart: r.uit_periode_start as Datum, referentie: (r.uit_referentie as string) ?? null,
  }));
}

/** Het nummer dat de reeks als volgende zou uitgeven, zonder het te verbruiken. */
export async function volgendNummerSuggestie(sessie: Sessie): Promise<string> {
  const [i] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select factuur_prefix, factuur_jaar, factuur_volgnummer, extract(year from current_date)::int as jaar
    from instellingen
  `);
  const jaar = Number(i.jaar);
  const n = Number(i.factuur_jaar) === jaar ? Number(i.factuur_volgnummer) + 1 : 1;
  return `${(i.factuur_prefix as string) ?? ""}${jaar}-${String(n).padStart(3, "0")}`;
}

// ------------------------------------------------------------ correctie ---

/**
 * Correctie op een gefactureerde urenregel (keuze D3a). Het origineel blijft
 * staan; er komt een tegenboeking bij in de huidige periode, tegen hetzelfde
 * bevroren tarief. Wil je een ander aantal uren, dan komt er ook een nieuwe
 * regel bij. Beide komen in het volgende factuurvoorstel van het project.
 */
export async function boekCorrectie(sessie: Sessie, urenregelId: string, nieuweMinuten: number, toelichting: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    const [o] = await tx`
      select u.id, u.medewerker_id, u.onderdeel_id, u.datum, u.minuten, u.declarabel, u.status,
             u.omschrijving, bv.verkooptarief
      from urenregel u left join bevroren_verkoop bv on bv.urenregel_id = u.id
      where u.id = ${urenregelId}
    `;
    if (!o) throw new Error("Regel niet gevonden.");
    if (o.status !== "gefactureerd") throw new Error("Alleen gefactureerde regels worden met een tegenboeking gecorrigeerd.");
    const al = await tx`select 1 from urenregel where correctie_van_id = ${urenregelId} limit 1`;
    if (al.length) throw new Error("Deze regel is al gecorrigeerd.");

    const datum = vandaag();
    const tarief = nr(o.verkooptarief);
    await tx`
      insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving, declarabel,
                             status, tarief_handmatig, correctie_van_id)
      values (${o.medewerker_id as string}, ${o.onderdeel_id as string}, ${datum}, ${-Number(o.minuten)},
              ${`Correctie op ${o.datum}: ${toelichting}`}, ${o.declarabel as boolean},
              'goedgekeurd', ${tarief}, ${urenregelId})
    `;
    if (nieuweMinuten > 0) {
      await tx`
        insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving, declarabel,
                               status, tarief_handmatig)
        values (${o.medewerker_id as string}, ${o.onderdeel_id as string}, ${datum}, ${nieuweMinuten},
                ${`Vervangt ${o.datum}: ${(o.omschrijving as string) ?? ""}`.trim()},
                ${o.declarabel as boolean}, 'goedgekeurd', ${tarief})
      `;
    }
  });
}
