import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import type { Datum } from "./datum";
import { weekDagen } from "./datum";

// Bedragen komen als numeric uit Postgres en dus als tekst uit de driver.
// In de queries hieronder wordt daarom ::float8 gebruikt waar we rekenen.

export type Urenregel = {
  id: string;
  datum: Datum;
  onderdeelId: string;
  onderdeel: string;
  project: string;
  projectId: string;
  klant: string;
  minuten: number;
  omschrijving: string | null;
  declarabel: boolean;
  status: string;
  bevroren: boolean;
  omzet: number | null;
};

export type Rit = {
  id: string;
  datum: Datum;
  klantId: string | null;
  klant: string | null;
  doel: string;
  omschrijving: string | null;
  afstandKm: number;
  retour: boolean;
  totaalKm: number;
  status: string;
  kmBedrag: number | null;
};

export type OnderdeelKeuze = {
  onderdeelId: string;
  onderdeel: string;
  projectId: string;
  project: string;
  klantId: string;
  klant: string;
  declarabel: boolean;
};

export type KlantKeuze = {
  id: string;
  naam: string;
  plaats: string | null;
  afstandKm: number | null;
};

export type Weekstaat = {
  id: string;
  status: "concept" | "ingediend" | "goedgekeurd" | "afgekeurd";
  opmerking: string | null;
} | null;

// --------------------------------------------------------------- lezen -----

export async function weekOverzicht(sessie: Sessie, maandag: Datum) {
  const dagen = weekDagen(maandag);
  const zondag = dagen[6];

  return alsGebruiker(sessie.authUserId, async (tx) => {
    const uren = await tx`
      select id, datum, onderdeel_id, onderdeel, project, project_id, klant,
             minuten, omschrijving, declarabel, status, bevroren,
             omzet::float8 as omzet
      from v_urenregel
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
      order by datum, onderdeel
    `;

    const ritten = await tx`
      select id, datum, klant_id, klant, doel, omschrijving,
             afstand_km::float8 as afstand_km, retour,
             totaal_km::float8 as totaal_km, status,
             km_bedrag::float8 as km_bedrag
      from v_rit
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
      order by datum
    `;

    const staat = await tx`
      select w.id, w.status, w.opmerking
      from weekstaat w
      where w.medewerker_id = ${sessie.medewerkerId}
        and (w.jaar, w.week) = (
          select extract(isoyear from ${maandag}::date)::int,
                 extract(week    from ${maandag}::date)::int
        )
      limit 1
    `;

    return {
      uren: uren.map(naarUrenregel),
      ritten: ritten.map(naarRit),
      weekstaat: (staat[0] ?? null) as Weekstaat,
    };
  });
}

function naarUrenregel(r: Record<string, unknown>): Urenregel {
  return {
    id: r.id as string,
    datum: r.datum as Datum,
    onderdeelId: r.onderdeel_id as string,
    onderdeel: r.onderdeel as string,
    project: r.project as string,
    projectId: r.project_id as string,
    klant: r.klant as string,
    minuten: Number(r.minuten),
    omschrijving: (r.omschrijving as string) ?? null,
    declarabel: r.declarabel as boolean,
    status: r.status as string,
    bevroren: r.bevroren as boolean,
    omzet: r.omzet === null ? null : Number(r.omzet),
  };
}

function naarRit(r: Record<string, unknown>): Rit {
  return {
    id: r.id as string,
    datum: r.datum as Datum,
    klantId: (r.klant_id as string) ?? null,
    klant: (r.klant as string) ?? null,
    doel: r.doel as string,
    omschrijving: (r.omschrijving as string) ?? null,
    afstandKm: Number(r.afstand_km),
    retour: r.retour as boolean,
    totaalKm: Number(r.totaal_km),
    status: r.status as string,
    kmBedrag: r.km_bedrag === null ? null : Number(r.km_bedrag),
  };
}

/** Alle onderdelen waar op geschreven kan worden. */
export async function onderdeelKeuzes(sessie: Sessie): Promise<OnderdeelKeuze[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select o.id as onderdeel_id, o.naam as onderdeel, o.declarabel,
           p.id as project_id, p.naam as project,
           k.id as klant_id, k.naam as klant
    from projectonderdeel o
    join project p on p.id = o.project_id
    join klant   k on k.id = p.klant_id
    where o.actief and k.actief and p.status in ('concept', 'actief')
    order by k.naam, p.naam, o.sortering, o.naam
  `);
  return rijen.map((r) => ({
    onderdeelId: r.onderdeel_id as string,
    onderdeel: r.onderdeel as string,
    projectId: r.project_id as string,
    project: r.project as string,
    klantId: r.klant_id as string,
    klant: r.klant as string,
    declarabel: r.declarabel as boolean,
  }));
}

/**
 * De onderdelen waar deze medewerker het meest recent op schreef. Dit is wat
 * bovenaan de invoerlijst komt; het scheelt bij vrijwel elke boeking zoeken.
 */
export async function favorieteOnderdelen(
  sessie: Sessie,
  aantal = 6,
): Promise<string[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select onderdeel_id, max(datum) as laatst
    from urenregel
    where medewerker_id = ${sessie.medewerkerId}
      and datum > current_date - 60
    group by onderdeel_id
    order by laatst desc, count(*) desc
    limit ${aantal}
  `);
  return rijen.map((r) => r.onderdeel_id as string);
}

export async function klantKeuzes(sessie: Sessie): Promise<KlantKeuze[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select k.id, k.naam, k.plaats,
           afstand_voor(k.id, ${sessie.medewerkerId})::float8 as afstand_km
    from klant k
    where k.actief
    order by k.naam
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    naam: r.naam as string,
    plaats: (r.plaats as string) ?? null,
    afstandKm: r.afstand_km === null ? null : Number(r.afstand_km),
  }));
}

/** De projecten van een klant, om een rit aan te hangen. */
export async function projectenVanKlant(sessie: Sessie, klantId: string) {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, naam from project
    where klant_id = ${klantId} and status in ('concept', 'actief')
    order by naam
  `);
  return rijen.map((r) => ({ id: r.id as string, naam: r.naam as string }));
}

// -------------------------------------------------------------- schrijven ---

export type UurInvoer = {
  onderdeelId: string;
  datum: Datum;
  minuten: number;
  omschrijving?: string | null;
};

/**
 * Zet de uren voor één onderdeel op één dag op de opgegeven stand. Nul
 * minuten betekent: weg ermee. Dit is wat het weekraster per cel doet.
 */
export async function zetUren(sessie: Sessie, invoer: UurInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, async (tx) => {
    const bestaand = await tx`
      select id, status from urenregel
      where medewerker_id = ${sessie.medewerkerId}
        and onderdeel_id = ${invoer.onderdeelId}
        and datum = ${invoer.datum}
        and status in ('concept', 'ingediend')
        and correctie_van_id is null
      order by aangemaakt_op
      limit 1
    `;

    if (invoer.minuten <= 0) {
      if (bestaand[0]) {
        await tx`delete from urenregel where id = ${bestaand[0].id as string}`;
      }
      return;
    }

    if (bestaand[0]) {
      await tx`
        update urenregel
        set minuten = ${invoer.minuten},
            omschrijving = coalesce(${invoer.omschrijving ?? null}, omschrijving)
        where id = ${bestaand[0].id as string}
      `;
    } else {
      await tx`
        insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving)
        values (${sessie.medewerkerId}, ${invoer.onderdeelId}, ${invoer.datum},
                ${invoer.minuten}, ${invoer.omschrijving ?? null})
      `;
    }
  });
}

/** Voegt een losse regel toe zonder een bestaande te overschrijven. */
export async function voegUurToe(sessie: Sessie, invoer: UurInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into urenregel (medewerker_id, onderdeel_id, datum, minuten, omschrijving)
    values (${sessie.medewerkerId}, ${invoer.onderdeelId}, ${invoer.datum},
            ${invoer.minuten}, ${invoer.omschrijving ?? null})
  `);
}

export async function verwijderUur(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from urenregel where id = ${id}
  `);
}

export type RitInvoer = {
  klantId: string;
  projectId?: string | null;
  datum: Datum;
  doel: string;
  afstandKm: number;
  retour: boolean;
  omschrijving?: string | null;
};

export async function voegRitToe(sessie: Sessie, invoer: RitInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into rit (medewerker_id, klant_id, project_id, datum, doel,
                     afstand_km, retour, omschrijving)
    values (${sessie.medewerkerId}, ${invoer.klantId}, ${invoer.projectId ?? null},
            ${invoer.datum}, ${invoer.doel}::rit_doel, ${invoer.afstandKm},
            ${invoer.retour}, ${invoer.omschrijving ?? null})
  `);
}

export async function verwijderRit(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from rit where id = ${id}
  `);
}

/**
 * Dient een week in (keuze D1a): de weekstaat gaat naar 'ingediend' en alle
 * conceptregels van die week gaan mee. Goedkeuren doet de eigenaar.
 */
export async function dienWeekIn(sessie: Sessie, maandag: Datum): Promise<void> {
  const zondag = weekDagen(maandag)[6];
  await alsGebruiker(sessie.authUserId, async (tx) => {
    const [{ jaar, week }] = (await tx`
      select extract(isoyear from ${maandag}::date)::int as jaar,
             extract(week    from ${maandag}::date)::int as week
    `) as unknown as { jaar: number; week: number }[];

    const bestaand = await tx`
      select id from weekstaat
      where medewerker_id = ${sessie.medewerkerId}
        and jaar = ${jaar} and week = ${week}
      limit 1
    `;

    let weekstaatId: string;
    if (bestaand[0]) {
      weekstaatId = bestaand[0].id as string;
      await tx`
        update weekstaat
        set status = 'ingediend', ingediend_op = now(), opmerking = null
        where id = ${weekstaatId}
      `;
    } else {
      const nieuw = await tx`
        insert into weekstaat (medewerker_id, jaar, week, status, ingediend_op)
        values (${sessie.medewerkerId}, ${jaar}, ${week}, 'ingediend', now())
        returning id
      `;
      weekstaatId = nieuw[0].id as string;
    }

    await tx`
      update urenregel
      set status = 'ingediend', weekstaat_id = ${weekstaatId}
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
        and status = 'concept'
    `;
    await tx`
      update rit
      set status = 'ingediend', weekstaat_id = ${weekstaatId}
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
        and status = 'concept'
    `;
  });
}

export async function trekWeekTerug(sessie: Sessie, maandag: Datum): Promise<void> {
  const zondag = weekDagen(maandag)[6];
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`
      update urenregel set status = 'concept'
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
        and status = 'ingediend'
    `;
    await tx`
      update rit set status = 'concept'
      where medewerker_id = ${sessie.medewerkerId}
        and datum between ${maandag} and ${zondag}
        and status = 'ingediend'
    `;
    await tx`
      update weekstaat set status = 'concept', ingediend_op = null
      where medewerker_id = ${sessie.medewerkerId}
        and (jaar, week) = (
          select extract(isoyear from ${maandag}::date)::int,
                 extract(week    from ${maandag}::date)::int
        )
        and status = 'ingediend'
    `;
  });
}
