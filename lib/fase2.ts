import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import { weekStart, verschuif, type Datum } from "./datum";

// Fase 2: goedkeuren, tarieven, kostprijzen en medewerkers.
// Alles loopt via alsGebruiker(), dus het beleid uit de migraties bepaalt wie
// wat mag. Een medewerker die deze functies aanroept krijgt lege lijsten of
// een geweigerde schrijfactie terug, geen data.

const nr = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ----------------------------------------------------------- goedkeuren ----

export type WeekstaatRij = {
  id: string;
  medewerkerId: string;
  medewerker: string;
  jaar: number;
  week: number;
  maandag: Datum;
  status: "concept" | "ingediend" | "goedgekeurd" | "afgekeurd";
  ingediendOp: string | null;
  beoordeeldOp: string | null;
  opmerking: string | null;
  minuten: number;
  km: number;
  omzet: number | null;
};

export async function weekstaten(sessie: Sessie): Promise<WeekstaatRij[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select w.id, w.medewerker_id, m.naam as medewerker, w.jaar, w.week, w.status,
           w.ingediend_op, w.beoordeeld_op, w.opmerking,
           coalesce((select sum(u.minuten) from urenregel u
                      where u.weekstaat_id = w.id and u.status <> 'vervallen'), 0) as minuten,
           coalesce((select sum(r.totaal_km) from rit r
                      where r.weekstaat_id = w.id and r.status <> 'vervallen'), 0)::float8 as km,
           (select sum(v.omzet) from v_urenregel v join urenregel u on u.id = v.id
             where u.weekstaat_id = w.id)::float8 as omzet
    from weekstaat w
    join medewerker m on m.id = w.medewerker_id
    where w.status <> 'concept'
    order by (w.status = 'ingediend') desc, w.jaar desc, w.week desc, m.naam
    limit 60
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    medewerkerId: r.medewerker_id as string,
    medewerker: r.medewerker as string,
    jaar: Number(r.jaar),
    week: Number(r.week),
    maandag: weekStart(Number(r.jaar), Number(r.week)),
    status: r.status as WeekstaatRij["status"],
    ingediendOp: r.ingediend_op ? String(r.ingediend_op) : null,
    beoordeeldOp: r.beoordeeld_op ? String(r.beoordeeld_op) : null,
    opmerking: (r.opmerking as string) ?? null,
    minuten: Number(r.minuten),
    km: Number(r.km),
    omzet: nr(r.omzet),
  }));
}

export async function weekstaatDetail(sessie: Sessie, id: string) {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const staat = await tx`
      select w.id, w.medewerker_id, m.naam as medewerker, w.jaar, w.week,
             w.status, w.opmerking, w.ingediend_op
      from weekstaat w join medewerker m on m.id = w.medewerker_id
      where w.id = ${id}
    `;
    const w = staat[0];
    if (!w) return null;

    const uren = await tx`
      select v.id, v.datum, v.onderdeel, v.project, v.klant, v.minuten,
             v.omschrijving, v.declarabel, v.status,
             v.verkooptarief::float8 as verkooptarief,
             v.omzet::float8 as omzet, v.kosten::float8 as kosten
      from v_urenregel v join urenregel u on u.id = v.id
      where u.weekstaat_id = ${id}
      order by v.datum, v.klant, v.project
    `;
    const ritten = await tx`
      select v.id, v.datum, v.klant, v.doel, v.omschrijving,
             v.totaal_km::float8 as totaal_km, v.retour,
             v.km_bedrag::float8 as km_bedrag, v.status
      from v_rit v join rit r on r.id = v.id
      where r.weekstaat_id = ${id}
      order by v.datum
    `;

    return {
      id: w.id as string,
      medewerkerId: w.medewerker_id as string,
      medewerker: w.medewerker as string,
      jaar: Number(w.jaar),
      week: Number(w.week),
      maandag: weekStart(Number(w.jaar), Number(w.week)),
      status: w.status as WeekstaatRij["status"],
      opmerking: (w.opmerking as string) ?? null,
      uren: uren.map((r) => ({
        id: r.id as string,
        datum: r.datum as Datum,
        onderdeel: r.onderdeel as string,
        project: r.project as string,
        klant: r.klant as string,
        minuten: Number(r.minuten),
        omschrijving: (r.omschrijving as string) ?? null,
        declarabel: r.declarabel as boolean,
        status: r.status as string,
        verkooptarief: nr(r.verkooptarief),
        omzet: nr(r.omzet),
        kosten: nr(r.kosten),
      })),
      ritten: ritten.map((r) => ({
        id: r.id as string,
        datum: r.datum as Datum,
        klant: (r.klant as string) ?? null,
        doel: r.doel as string,
        omschrijving: (r.omschrijving as string) ?? null,
        totaalKm: Number(r.totaal_km),
        retour: r.retour as boolean,
        kmBedrag: nr(r.km_bedrag),
        status: r.status as string,
      })),
    };
  });
}

/**
 * Goedkeuren zet de regels op 'goedgekeurd'; de trigger in de database
 * bevriest dan de bedragen (keuze B4a). Terugsturen zet alles terug naar
 * concept, met een opmerking voor de medewerker.
 */
export async function beoordeelWeekstaat(
  sessie: Sessie,
  id: string,
  besluit: "goedgekeurd" | "afgekeurd",
  opmerking: string | null,
): Promise<void> {
  const regelStatus = besluit === "goedgekeurd" ? "goedgekeurd" : "concept";
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`
      update weekstaat
      set status = ${besluit}::weekstaat_status,
          beoordeeld_door = ${sessie.medewerkerId},
          beoordeeld_op = now(),
          opmerking = ${opmerking}
      where id = ${id} and status = 'ingediend'
    `;
    await tx`
      update urenregel set status = ${regelStatus}::regel_status
      where weekstaat_id = ${id} and status = 'ingediend'
    `;
    await tx`
      update rit set status = ${regelStatus}::regel_status
      where weekstaat_id = ${id} and status = 'ingediend'
    `;
  });
}

// ------------------------------------------------------------- tarieven ----

export type Tariefregel = {
  id: string;
  niveau: number;
  anker: string;        // leesbare beschrijving van waar de regel aan hangt
  functie: string | null;
  bedrag: number;
  geldigVanaf: Datum;
  geldigTot: Datum | null;
  toelichting: string | null;
};

export const NIVEAU_NAAM: Record<number, string> = {
  2: "Projectonderdeel",
  3: "Project × functie",
  4: "Project",
  5: "Klant × functie",
  6: "Klant",
  7: "Functie (standaard)",
};

export async function tariefregels(sessie: Sessie): Promise<Tariefregel[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select t.id, t.niveau, t.bedrag_per_uur::float8 as bedrag,
           t.geldig_vanaf, t.geldig_tot, t.toelichting,
           f.naam as functie,
           case
             when t.onderdeel_id is not null then
               k3.naam || ' · ' || p3.naam || ' · ' || o.naam
             when t.project_id is not null then k2.naam || ' · ' || p2.naam
             when t.klant_id is not null then k1.naam
             else 'Hele organisatie'
           end as anker
    from tariefregel t
    left join functie f on f.id = t.functie_id
    left join klant k1 on k1.id = t.klant_id
    left join project p2 on p2.id = t.project_id
    left join klant k2 on k2.id = p2.klant_id
    left join projectonderdeel o on o.id = t.onderdeel_id
    left join project p3 on p3.id = o.project_id
    left join klant k3 on k3.id = p3.klant_id
    order by t.niveau, anker, f.naam nulls first, t.geldig_vanaf desc
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    niveau: Number(r.niveau),
    anker: r.anker as string,
    functie: (r.functie as string) ?? null,
    bedrag: Number(r.bedrag),
    geldigVanaf: r.geldig_vanaf as Datum,
    geldigTot: (r.geldig_tot as Datum) ?? null,
    toelichting: (r.toelichting as string) ?? null,
  }));
}

export type TariefInvoer = {
  onderdeelId?: string | null;
  projectId?: string | null;
  klantId?: string | null;
  functieId?: string | null;
  bedrag: number;
  geldigVanaf: Datum;
  geldigTot?: Datum | null;
  toelichting?: string | null;
};

export async function nieuweTariefregel(sessie: Sessie, t: TariefInvoer) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into tariefregel
      (onderdeel_id, project_id, klant_id, functie_id, bedrag_per_uur,
       geldig_vanaf, geldig_tot, toelichting)
    values (${t.onderdeelId ?? null}, ${t.projectId ?? null}, ${t.klantId ?? null},
            ${t.functieId ?? null}, ${t.bedrag}, ${t.geldigVanaf},
            ${t.geldigTot ?? null}, ${t.toelichting ?? null})
  `);
}

/** Sluit een lopende regel af per een datum, zodat een nieuwe kan beginnen. */
export async function beeindigTariefregel(sessie: Sessie, id: string, tot: Datum) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update tariefregel set geldig_tot = ${tot}
    where id = ${id} and geldig_vanaf <= ${tot}
  `);
}

export async function verwijderTariefregel(sessie: Sessie, id: string) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from tariefregel where id = ${id}
  `);
}

// ------------------------------------------------------------- functies ----

export async function functies(sessie: Sessie) {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, naam, sortering, actief from functie order by sortering, naam
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    naam: r.naam as string,
    sortering: Number(r.sortering),
    actief: r.actief as boolean,
  }));
}

export async function nieuweFunctie(sessie: Sessie, naam: string) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into functie (naam, sortering)
    values (${naam}, coalesce((select max(sortering) + 1 from functie), 1))
  `);
}

// ------------------------------------------------------------ km-tarief ----

export async function kmTarieven(sessie: Sessie) {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, bedrag_per_km::float8 as bedrag, geldig_vanaf, geldig_tot, toelichting
    from km_tarief order by geldig_vanaf desc
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    bedrag: Number(r.bedrag),
    geldigVanaf: r.geldig_vanaf as Datum,
    geldigTot: (r.geldig_tot as Datum) ?? null,
    toelichting: (r.toelichting as string) ?? null,
  }));
}

/**
 * Een nieuw bedrag per een datum. De lopende periode wordt de dag ervoor
 * afgesloten, zodat de exclusion constraint niet klaagt.
 */
export async function nieuwKmTarief(
  sessie: Sessie,
  bedrag: number,
  vanaf: Datum,
  toelichting: string | null,
) {
  const dagErvoor = verschuif(vanaf, -1);
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`
      update km_tarief set geldig_tot = ${dagErvoor}
      where geldig_tot is null and geldig_vanaf < ${vanaf}
    `;
    await tx`
      insert into km_tarief (bedrag_per_km, geldig_vanaf, toelichting)
      values (${bedrag}, ${vanaf}, ${toelichting})
    `;
  });
}

// ---------------------------------------------------------- medewerkers ----

export type MedewerkerRij = {
  id: string;
  naam: string;
  email: string;
  functie: string | null;
  functieId: string | null;
  rechten: "medewerker" | "projectleider" | "eigenaar";
  standplaats: string | null;
  actief: boolean;
  gekoppeld: boolean;          // heeft al een account
  kostprijs: number | null;    // huidige; null zonder leesrecht of zonder regel
};

export async function medewerkers(sessie: Sessie): Promise<MedewerkerRij[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select m.id, m.naam, m.email, m.rechten, m.standplaats, m.actief,
           m.auth_user_id is not null as gekoppeld,
           f.id as functie_id, f.naam as functie,
           kostprijs_voor(m.id, current_date)::float8 as kostprijs
    from medewerker m
    left join functie f on f.id = m.functie_id
    order by m.actief desc, m.naam
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    naam: r.naam as string,
    email: r.email as string,
    functie: (r.functie as string) ?? null,
    functieId: (r.functie_id as string) ?? null,
    rechten: r.rechten as MedewerkerRij["rechten"],
    standplaats: (r.standplaats as string) ?? null,
    actief: r.actief as boolean,
    gekoppeld: r.gekoppeld as boolean,
    kostprijs: nr(r.kostprijs),
  }));
}

export async function kostprijzenVan(sessie: Sessie, medewerkerId: string) {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select id, bedrag_per_uur::float8 as bedrag, geldig_vanaf, geldig_tot, toelichting
    from kostprijs where medewerker_id = ${medewerkerId}
    order by geldig_vanaf desc
  `);
  return rijen.map((r) => ({
    id: r.id as string,
    bedrag: Number(r.bedrag),
    geldigVanaf: r.geldig_vanaf as Datum,
    geldigTot: (r.geldig_tot as Datum) ?? null,
    toelichting: (r.toelichting as string) ?? null,
  }));
}

export async function nieuweKostprijs(
  sessie: Sessie,
  medewerkerId: string,
  bedrag: number,
  vanaf: Datum,
  toelichting: string | null,
) {
  const dagErvoor = verschuif(vanaf, -1);
  await alsGebruiker(sessie.authUserId, async (tx) => {
    await tx`
      update kostprijs set geldig_tot = ${dagErvoor}
      where medewerker_id = ${medewerkerId}
        and geldig_tot is null and geldig_vanaf < ${vanaf}
    `;
    await tx`
      insert into kostprijs (medewerker_id, bedrag_per_uur, geldig_vanaf, toelichting)
      values (${medewerkerId}, ${bedrag}, ${vanaf}, ${toelichting})
    `;
  });
}

export async function nieuweMedewerker(
  sessie: Sessie,
  m: { naam: string; email: string; functieId: string | null; rechten: string; standplaats: string | null },
) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into medewerker (naam, email, functie_id, rechten, standplaats, in_dienst_vanaf)
    values (${m.naam}, ${m.email}, ${m.functieId}, ${m.rechten}::rechten_niveau,
            ${m.standplaats}, current_date)
  `);
}

export async function werkMedewerkerBij(
  sessie: Sessie,
  id: string,
  m: { naam: string; functieId: string | null; rechten: string; standplaats: string | null; actief: boolean },
) {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update medewerker set
      naam = ${m.naam},
      functie_id = ${m.functieId},
      rechten = ${m.rechten}::rechten_niveau,
      standplaats = ${m.standplaats},
      actief = ${m.actief}
    where id = ${id}
  `);
}
