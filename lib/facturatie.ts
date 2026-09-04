import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { vandaag, type Datum } from "./datum";

// Fase 3: van goedgekeurde uren naar een factuur, en weer terug als er iets
// niet klopte. Alles via alsGebruiker(), dus de rechten uit de migraties
// gelden: alleen de eigenaar kan regels op 'gefactureerd' zetten.

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

/**
 * Selectie voor voorstel en specificatie: óf alles wat aan een factuur hangt,
 * óf de goedgekeurde, nog niet gefactureerde regels van een klant in een
 * periode.
 */
export type Selectie =
  | { factuur: string }
  | { klantId: string; van: Datum; tot: Datum };

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

    // De tegenboeking op een gefactureerde regel hangt niet aan die factuur
    // maar aan de volgende; daarom wordt apart gekeken of hij bestaat.
    const uren =
      "factuur" in sel
        ? await tx`
            select v.*, u.correctie_van_id,
                   exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
            from v_urenregel v join urenregel u on u.id = v.id
            where u.factuur_referentie = ${sel.factuur}
            order by v.project, v.datum, v.medewerker
          `
        : await tx`
            select v.*, u.correctie_van_id,
                   exists (select 1 from urenregel c where c.correctie_van_id = u.id) as gecorrigeerd
            from v_urenregel v join urenregel u on u.id = v.id
            where v.klant_id = ${sel.klantId}
              and v.datum between ${sel.van} and ${sel.tot}
              and v.status = 'goedgekeurd'
              and u.factuur_referentie is null
            order by v.project, v.datum, v.medewerker
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
            where v.klant_id = ${sel.klantId}
              and v.datum between ${sel.van} and ${sel.tot}
              and v.status = 'goedgekeurd' and v.declarabel
              and r.factuur_referentie is null
            order by v.datum
          `;

    const klantId =
      "factuur" in sel ? ((uren[0]?.klant_id as string) ?? null) : sel.klantId;
    const k = klantId
      ? (await tx`
          select id, naam, contactpersoon, adres, postcode, plaats,
                 factuur_referentie, specificatie_omschrijving, specificatie_tarieven
          from klant where id = ${klantId}
        `)[0]
      : null;
    const klant: KlantKop | null = k
      ? {
          id: k.id as string,
          naam: k.naam as string,
          contactpersoon: (k.contactpersoon as string) ?? null,
          adres: (k.adres as string) ?? null,
          postcode: (k.postcode as string) ?? null,
          plaats: (k.plaats as string) ?? null,
          factuurReferentie: (k.factuur_referentie as string) ?? null,
          metOmschrijving: k.specificatie_omschrijving as boolean,
          metTarieven: k.specificatie_tarieven as boolean,
        }
      : null;

    // Wat er in de periode nog níet goedgekeurd is, hoort de eigenaar te
    // weten voordat hij factureert.
    const nietKlaar =
      "factuur" in sel
        ? 0
        : Number(
            (
              await tx`
                select count(*) as n from v_urenregel
                where klant_id = ${sel.klantId}
                  and datum between ${sel.van} and ${sel.tot}
                  and status in ('concept', 'ingediend')
              `
            )[0].n,
          );

    return {
      bedrijf,
      klant,
      nietKlaar,
      uren: uren.map(
        (r): SpecUur => ({
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
        }),
      ),
      ritten: ritten.map(
        (r): SpecRit => ({
          id: r.id as string,
          datum: r.datum as Datum,
          medewerker: r.medewerker as string,
          doel: r.doel as string,
          omschrijving: (r.omschrijving as string) ?? null,
          totaalKm: Number(r.totaal_km),
          kmTarief: nr(r.km_tarief),
          kmBedrag: nr(r.km_bedrag),
          status: r.status as string,
        }),
      ),
    };
  });
}

/**
 * Zet de goedgekeurde regels van een klant in een periode op 'gefactureerd'
 * onder één referentie. Daarna zijn ze op slot (trigger uit de migraties).
 */
export async function markeerGefactureerd(
  sessie: Sessie,
  klantId: string,
  van: Datum,
  tot: Datum,
  referentie: string,
): Promise<{ uren: number; ritten: number }> {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const bestaat = await tx`
      select 1 from urenregel where factuur_referentie = ${referentie} limit 1
    `;
    if (bestaat.length) {
      throw new Error(`Referentie ${referentie} is al gebruikt.`);
    }
    const u = await tx`
      update urenregel u
      set status = 'gefactureerd', factuur_referentie = ${referentie}
      from projectonderdeel o join project p on p.id = o.project_id
      where o.id = u.onderdeel_id
        and p.klant_id = ${klantId}
        and u.datum between ${van} and ${tot}
        and u.status = 'goedgekeurd'
        and u.factuur_referentie is null
      returning u.id
    `;
    const r = await tx`
      update rit
      set status = 'gefactureerd', factuur_referentie = ${referentie}
      where klant_id = ${klantId}
        and datum between ${van} and ${tot}
        and status = 'goedgekeurd' and declarabel
        and factuur_referentie is null
      returning id
    `;
    return { uren: u.length, ritten: r.length };
  });
}

export type Factuur = {
  referentie: string;
  klantId: string;
  klant: string;
  van: Datum;
  tot: Datum;
  minuten: number;
  omzet: number | null;
  km: number;
  kmBedrag: number | null;
  totaal: number | null;
  gefactureerdOp: string;
};

export async function facturen(sessie: Sessie): Promise<Factuur[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select referentie, klant_id, klant, van, tot, minuten,
           omzet::float8 as omzet, km::float8 as km,
           km_bedrag::float8 as km_bedrag, totaal::float8 as totaal,
           gefactureerd_op
    from v_factuur order by gefactureerd_op desc, referentie desc
  `);
  return rijen.map((r) => ({
    referentie: r.referentie as string,
    klantId: r.klant_id as string,
    klant: r.klant as string,
    van: r.van as Datum,
    tot: r.tot as Datum,
    minuten: Number(r.minuten),
    omzet: nr(r.omzet),
    km: Number(r.km),
    kmBedrag: nr(r.km_bedrag),
    totaal: nr(r.totaal),
    gefactureerdOp: String(r.gefactureerd_op),
  }));
}

/** Klanten met goedgekeurde, nog niet gefactureerde regels. */
export async function teFactureren(sessie: Sessie) {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select v.klant_id, v.klant,
           count(*) as regels, sum(v.minuten) as minuten,
           sum(v.omzet)::float8 as omzet,
           min(v.datum) as van, max(v.datum) as tot
    from v_urenregel v join urenregel u on u.id = v.id
    where v.status = 'goedgekeurd' and u.factuur_referentie is null
    group by v.klant_id, v.klant
    order by v.klant
  `);
  return rijen.map((r) => ({
    klantId: r.klant_id as string,
    klant: r.klant as string,
    regels: Number(r.regels),
    minuten: Number(r.minuten),
    omzet: nr(r.omzet),
    van: r.van as Datum,
    tot: r.tot as Datum,
  }));
}

/**
 * Correctie op een gefactureerde regel (keuze D3a). Het origineel blijft
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
    if (alGecorrigeerd.length) {
      throw new Error("Deze regel is al gecorrigeerd.");
    }

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
