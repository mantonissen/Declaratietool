import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { vandaag, type Datum } from "./datum";

// Fase 3: van goedgekeurde uren en termijnen naar een factuur, per project.
// Alles via alsGebruiker(), dus de rechten uit de migraties gelden: alleen de
// eigenaar kan regels en termijnen op 'gefactureerd' zetten.
//
// Twee facturatiemodellen (keuze B5b):
//   nacalculatie  de goedgekeurde uren en ritten in een periode
//   vaste_prijs   termijnen bij tussenopleveringen; de uren gaan als
//                 verantwoording mee op de specificatie, zonder bedrag

const nr = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type SpecUur = {
  id: string;
  datum: Datum;
  medewerker: string;
  project: string;
  projectId: string;
  onderdeel: string;
  omschrijving: string | null;
  minuten: number;
  declarabel: boolean;
  status: string;
  verkooptarief: number | null;
  omzet: number | null;
  correctieVanId: string | null;
  gecorrigeerd: boolean;
};

export type SpecRit = {
  id: string;
  datum: Datum;
  medewerker: string;
  doel: string;
  omschrijving: string | null;
  totaalKm: number;
  kmTarief: number | null;
  kmBedrag: number | null;
  status: string;
};

export type SpecTermijn = {
  id: string;
  volgorde: number;
  omschrijving: string;
  bedrag: number;
  geplandOp: Datum | null;
  factuurReferentie: string | null;
};

export type Bedrijf = {
  naam: string;
  adres: string | null;
  postcode: string | null;
  plaats: string | null;
  kvk: string | null;
  btw: string | null;
  iban: string | null;
  email: string | null;
  telefoon: string | null;
};

export type KlantKop = {
  id: string;
  naam: string;
  contactpersoon: string | null;
  adres: string | null;
  postcode: string | null;
  plaats: string | null;
  factuurReferentie: string | null;
  metOmschrijving: boolean;
  metTarieven: boolean;
};

export type ProjectKop = {
  id: string;
  naam: string;
  code: string | null;
  facturatiemodel: "nacalculatie" | "vaste_prijs";
  vastePrijs: number | null;
};

export type Selectie =
  | { factuur: string }
  | { projectId: string; van: Datum; tot: Datum };

export async function specificatie(sessie: Sessie, sel: Selectie) {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const [b] = await tx`
      select bedrijfsnaam, adres, postcode, plaats, kvk_nummer, btw_nummer,
             iban, email, telefoon
      from instellingen
    `;
    const bedrijf: Bedrijf = {
      naam: (b?.bedrijfsnaam as string) || "Declaratietool",
      adres: (b?.adres as string) ?? null,
      postcode: (b?.postcode as string) ?? null,
      plaats: (b?.plaats as string) ?? null,
      kvk: (b?.kvk_nummer as string) ?? null,
      btw: (b?.btw_nummer as string) ?? null,
      iban: (b?.iban as string) ?? null,
      email: (b?.email as string) ?? null,
      telefoon: (b?.telefoon as string) ?? null,
    };

    // Het project: uit de selectie, of via de factuur.
    let projectId: string | null;
    if ("factuur" in sel) {
      const f = await tx`select project_id from v_factuur where referentie = ${sel.factuur}`;
      projectId = (f[0]?.project_id as string) ?? null;
    } else {
      projectId = sel.projectId;
    }
    if (!projectId) return leeg(bedrijf);

    const [p] = await tx`
      select p.id, p.naam, p.code, p.facturatiemodel::text as model, p.vaste_prijs::float8 as vaste_prijs,
             k.id as klant_id, k.naam as klant, k.contactpersoon, k.adres, k.postcode, k.plaats,
             k.factuur_referentie, k.specificatie_omschrijving, k.specificatie_tarieven
      from project p join klant k on k.id = p.klant_id
      where p.id = ${projectId}
    `;
    if (!p) return leeg(bedrijf);

    const project: ProjectKop = {
      id: p.id as string,
      naam: p.naam as string,
      code: (p.code as string) ?? null,
      facturatiemodel: p.model as ProjectKop["facturatiemodel"],
      vastePrijs: nr(p.vaste_prijs),
    };
    const klant: KlantKop = {
      id: p.klant_id as string,
      naam: p.klant as string,
      contactpersoon: (p.contactpersoon as string) ?? null,
      adres: (p.adres as string) ?? null,
      postcode: (p.postcode as string) ?? null,
      plaats: (p.plaats as string) ?? null,
      factuurReferentie: (p.factuur_referentie as string) ?? null,
      metOmschrijving: p.specificatie_omschrijving as boolean,
      metTarieven: p.specificatie_tarieven as boolean,
    };

    // De tegenboeking op een gefactureerde regel hangt niet aan die factuur
    // maar aan de volgende; daarom wordt apart gekeken of hij bestaat.
    const uren =
      "factuur" in sel
        ? await tx`
            select v.*, u.correctie_van_id,
                   exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
            from v_urenregel v join urenregel u on u.id = v.id
            where u.factuur_referentie = ${sel.factuur}
            order by v.datum, v.medewerker
          `
        : await tx`
            select v.*, u.correctie_van_id,
                   exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
            from v_urenregel v join urenregel u on u.id = v.id
            where v.project_id = ${projectId}
              and v.datum between ${sel.van} and ${sel.tot}
              and v.status = 'goedgekeurd'
              and u.factuur_referentie is null
            order by v.datum, v.medewerker
          `;

    const ritten =
      "factuur" in sel
        ? await tx`
            select v.* from v_rit v join rit r on r.id = v.id
            where r.factuur_referentie = ${sel.factuur}
            order by v.datum
          `
        : await tx`
            select v.* from v_rit v join rit r on r.id = v.id
            where v.project_id = ${projectId}
              and v.datum between ${sel.van} and ${sel.tot}
              and v.status = 'goedgekeurd' and v.declarabel
              and r.factuur_referentie is null
            order by v.datum
          `;

    const termijnen =
      "factuur" in sel
        ? await tx`
            select id, volgorde, omschrijving, bedrag::float8 as bedrag, gepland_op, factuur_referentie
            from termijn where factuur_referentie = ${sel.factuur}
            order by volgorde
          `
        : await tx`
            select id, volgorde, omschrijving, bedrag::float8 as bedrag, gepland_op, factuur_referentie
            from termijn where project_id = ${projectId} and factuur_referentie is null
            order by volgorde
          `;

    const nietKlaar =
      "factuur" in sel
        ? 0
        : Number(
            (
              await tx`
                select count(*) as n from v_urenregel
                where project_id = ${projectId}
                  and datum between ${sel.van} and ${sel.tot}
                  and status in ('concept', 'ingediend')
              `
            )[0].n,
          );

    return {
      bedrijf,
      klant,
      project,
      nietKlaar,
      uren: uren.map(naarUur),
      ritten: ritten.map(naarRit),
      termijnen: termijnen.map(naarTermijn),
    };
  });
}

function leeg(bedrijf: Bedrijf) {
  return {
    bedrijf,
    klant: null as KlantKop | null,
    project: null as ProjectKop | null,
    nietKlaar: 0,
    uren: [] as SpecUur[],
    ritten: [] as SpecRit[],
    termijnen: [] as SpecTermijn[],
  };
}

const naarUur = (r: Record<string, unknown>): SpecUur => ({
  id: r.id as string,
  datum: r.datum as Datum,
  medewerker: r.medewerker as string,
  project: r.project as string,
  projectId: r.project_id as string,
  onderdeel: r.onderdeel as string,
  omschrijving: (r.omschrijving as string) ?? null,
  minuten: Number(r.minuten),
  declarabel: r.declarabel as boolean,
  status: r.status as string,
  verkooptarief: nr(r.verkooptarief),
  omzet: nr(r.omzet),
  correctieVanId: (r.correctie_van_id as string) ?? null,
  gecorrigeerd: Boolean(r.gecorrigeerd),
});

const naarRit = (r: Record<string, unknown>): SpecRit => ({
  id: r.id as string,
  datum: r.datum as Datum,
  medewerker: r.medewerker as string,
  doel: r.doel as string,
  omschrijving: (r.omschrijving as string) ?? null,
  totaalKm: Number(r.totaal_km),
  kmTarief: nr(r.km_tarief),
  kmBedrag: nr(r.km_bedrag),
  status: r.status as string,
});

const naarTermijn = (r: Record<string, unknown>): SpecTermijn => ({
  id: r.id as string,
  volgorde: Number(r.volgorde),
  omschrijving: r.omschrijving as string,
  bedrag: Number(r.bedrag),
  geplandOp: (r.gepland_op as Datum) ?? null,
  factuurReferentie: (r.factuur_referentie as string) ?? null,
});

/**
 * Zet de goedgekeurde regels van een project in een periode, plus de gekozen
 * termijnen, op 'gefactureerd' onder één referentie. Daarna zijn ze op slot
 * (triggers uit de migraties). Bij een vaste prijs gaan de uren mee als
 * verantwoording; hun omzet is nul, dus ze tellen niet dubbel.
 */
export async function markeerGefactureerd(
  sessie: Sessie,
  projectId: string,
  van: Datum,
  tot: Datum,
  referentie: string,
  termijnIds: string[],
  metReiskosten: boolean,
): Promise<{ uren: number; ritten: number; termijnen: number }> {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const bestaat = await tx`
      select 1 from v_factuur where referentie = ${referentie} limit 1
    `;
    if (bestaat.length) throw new Error(`Referentie ${referentie} is al gebruikt.`);

    const u = await tx`
      update urenregel u
      set status = 'gefactureerd', factuur_referentie = ${referentie}
      from projectonderdeel o
      where o.id = u.onderdeel_id
        and o.project_id = ${projectId}
        and u.datum between ${van} and ${tot}
        and u.status = 'goedgekeurd'
        and u.factuur_referentie is null
      returning u.id
    `;
    const r = metReiskosten
      ? await tx`
          update rit
          set status = 'gefactureerd', factuur_referentie = ${referentie}
          where project_id = ${projectId}
            and datum between ${van} and ${tot}
            and status = 'goedgekeurd' and declarabel
            and factuur_referentie is null
          returning id
        `
      : [];
    const t = termijnIds.length
      ? await tx`
          update termijn
          set factuur_referentie = ${referentie}, gefactureerd_op = now()
          where project_id = ${projectId}
            and id = any(${termijnIds}::uuid[])
            and factuur_referentie is null
          returning id
        `
      : [];
    return { uren: u.length, ritten: r.length, termijnen: t.length };
  });
}

export type Factuur = {
  referentie: string;
  klantId: string;
  klant: string;
  projectId: string;
  project: string;
  van: Datum | null;
  tot: Datum | null;
  minuten: number;
  omzet: number | null;
  km: number;
  kmBedrag: number | null;
  termijnBedrag: number | null;
  totaal: number | null;
  gefactureerdOp: string;
};

export async function facturen(sessie: Sessie): Promise<Factuur[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select referentie, klant_id, klant, project_id, project, van, tot, minuten,
           omzet::float8 as omzet, km::float8 as km,
           km_bedrag::float8 as km_bedrag, termijn_bedrag::float8 as termijn_bedrag,
           totaal::float8 as totaal, gefactureerd_op
    from v_factuur order by gefactureerd_op desc, referentie desc
  `);
  return rijen.map((r) => ({
    referentie: r.referentie as string,
    klantId: r.klant_id as string,
    klant: r.klant as string,
    projectId: r.project_id as string,
    project: r.project as string,
    van: (r.van as Datum) ?? null,
    tot: (r.tot as Datum) ?? null,
    minuten: Number(r.minuten),
    omzet: nr(r.omzet),
    km: Number(r.km),
    kmBedrag: nr(r.km_bedrag),
    termijnBedrag: nr(r.termijn_bedrag),
    totaal: nr(r.totaal),
    gefactureerdOp: String(r.gefactureerd_op),
  }));
}

export type TeFactureren = {
  projectId: string;
  project: string;
  klant: string;
  facturatiemodel: "nacalculatie" | "vaste_prijs";
  vastePrijs: number | null;
  regels: number;
  minuten: number;
  omzet: number | null;
  van: Datum | null;
  tot: Datum | null;
  termijnenOpen: number;
  termijnBedrag: number | null;
};

/** Projecten met iets te factureren: goedgekeurde regels of open termijnen. */
export async function teFactureren(sessie: Sessie): Promise<TeFactureren[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    with u as (
      select v.project_id, count(*) as regels, sum(v.minuten) as minuten,
             sum(v.omzet) as omzet, min(v.datum) as van, max(v.datum) as tot
      from v_urenregel v join urenregel r on r.id = v.id
      where v.status = 'goedgekeurd' and r.factuur_referentie is null
      group by v.project_id
    ),
    t as (
      select project_id, count(*) as n, sum(bedrag) as bedrag
      from termijn where factuur_referentie is null
      group by project_id
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
    projectId: r.id as string,
    project: r.project as string,
    klant: r.klant as string,
    facturatiemodel: r.model as TeFactureren["facturatiemodel"],
    vastePrijs: nr(r.vaste_prijs),
    regels: Number(r.regels),
    minuten: Number(r.minuten),
    omzet: nr(r.omzet),
    van: (r.van as Datum) ?? null,
    tot: (r.tot as Datum) ?? null,
    termijnenOpen: Number(r.termijnen_open),
    termijnBedrag: nr(r.termijn_bedrag),
  }));
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
  sessie: Sessie,
  projectId: string,
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
    delete from termijn where id = ${id} and factuur_referentie is null
  `);
}

/**
 * Correctie op een gefactureerde urenregel (keuze D3a). Het origineel blijft
 * staan; er komt een tegenboeking bij in de huidige periode, tegen hetzelfde
 * bevroren tarief zodat de creditering precies het origineel opheft. Wil je
 * een ander aantal uren, dan komt er ook een nieuwe regel bij.
 */
export async function boekCorrectie(
  sessie: Sessie,
  urenregelId: string,
  nieuweMinuten: number,
  toelichting: string,
): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    const [o] = await tx`
      select u.id, u.medewerker_id, u.onderdeel_id, u.datum, u.minuten,
             u.declarabel, u.status, u.omschrijving,
             bv.verkooptarief
      from urenregel u
      left join bevroren_verkoop bv on bv.urenregel_id = u.id
      where u.id = ${urenregelId}
    `;
    if (!o) throw new Error("Regel niet gevonden.");
    if (o.status !== "gefactureerd") {
      throw new Error("Alleen gefactureerde regels worden met een tegenboeking gecorrigeerd.");
    }
    const alGecorrigeerd = await tx`
      select 1 from urenregel where correctie_van_id = ${urenregelId} limit 1
    `;
    if (alGecorrigeerd.length) throw new Error("Deze regel is al gecorrigeerd.");

    const datum = vandaag();
    const tarief = nr(o.verkooptarief);
    const oms = `Correctie op ${o.datum}: ${toelichting}`;

    await tx`
      insert into urenregel
        (medewerker_id, onderdeel_id, datum, minuten, omschrijving, declarabel,
         status, tarief_handmatig, correctie_van_id)
      values (${o.medewerker_id as string}, ${o.onderdeel_id as string}, ${datum},
              ${-Number(o.minuten)}, ${oms}, ${o.declarabel as boolean},
              'goedgekeurd', ${tarief}, ${urenregelId})
    `;
    if (nieuweMinuten > 0) {
      await tx`
        insert into urenregel
          (medewerker_id, onderdeel_id, datum, minuten, omschrijving, declarabel,
           status, tarief_handmatig)
        values (${o.medewerker_id as string}, ${o.onderdeel_id as string}, ${datum},
                ${nieuweMinuten}, ${`Vervangt ${o.datum}: ${(o.omschrijving as string) ?? ""}`.trim()},
                ${o.declarabel as boolean}, 'goedgekeurd', ${tarief})
      `;
    }
  });
}
