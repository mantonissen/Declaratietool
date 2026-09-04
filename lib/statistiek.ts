import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import type { Datum } from "./datum";

// Inzicht (keuze E1a). Alle cijfers komen uit de afgeschermde views: een
// medewerker krijgt hier dus zijn eigen uren en lege bedragen, een
// projectleider zijn projecten met omzet, de eigenaar alles inclusief kosten.

const nr = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type Kerncijfers = {
  minuten: number;
  declarabeleMinuten: number;
  omzet: number | null;
  kosten: number | null;
  km: number;
  kmBedrag: number | null;
  medewerkers: number;
  projecten: number;
};

export async function kerncijfers(sessie: Sessie, van: Datum, tot: Datum): Promise<Kerncijfers> {
  return alsGebruiker(sessie.authUserId, async (tx) => {
    const [u] = await tx`
      select coalesce(sum(minuten), 0) as minuten,
             coalesce(sum(minuten) filter (where declarabel), 0) as decl,
             sum(omzet)::float8 as omzet,
             sum(kosten)::float8 as kosten,
             count(distinct medewerker_id) as medewerkers,
             count(distinct project_id) as projecten
      from v_urenregel where datum between ${van} and ${tot}
    `;
    const [r] = await tx`
      select coalesce(sum(totaal_km), 0)::float8 as km,
             sum(km_bedrag)::float8 as km_bedrag
      from v_rit where datum between ${van} and ${tot}
    `;
    return {
      minuten: Number(u.minuten),
      declarabeleMinuten: Number(u.decl),
      omzet: nr(u.omzet),
      kosten: nr(u.kosten),
      km: Number(r.km),
      kmBedrag: nr(r.km_bedrag),
      medewerkers: Number(u.medewerkers),
      projecten: Number(u.projecten),
    };
  });
}

export type MaandRij = {
  maand: Datum;          // eerste van de maand
  minuten: number;
  declarabeleMinuten: number;
  omzet: number | null;
  kosten: number | null;
};

/**
 * Per maand of per week over de periode, ook vakken zonder regels. Een
 * korte periode krijgt weken; anders is het één staaf en dat zegt niets.
 */
export async function perPeriode(
  sessie: Sessie,
  van: Datum,
  tot: Datum,
  eenheid: "month" | "week",
): Promise<MaandRij[]> {
  const stap = eenheid === "week" ? "1 week" : "1 month";
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    with vakken as (
      select generate_series(date_trunc(${eenheid}, ${van}::date),
                             date_trunc(${eenheid}, ${tot}::date),
                             ${stap}::interval)::date as maand
    )
    select m.maand,
           coalesce(sum(v.minuten), 0) as minuten,
           coalesce(sum(v.minuten) filter (where v.declarabel), 0) as decl,
           sum(v.omzet)::float8 as omzet,
           sum(v.kosten)::float8 as kosten
    from vakken m
    left join v_urenregel v
      on date_trunc(${eenheid}, v.datum)::date = m.maand
     and v.datum between ${van} and ${tot}
    group by m.maand
    order by m.maand
  `);
  return rijen.map((r) => ({
    maand: r.maand as Datum,
    minuten: Number(r.minuten),
    declarabeleMinuten: Number(r.decl),
    omzet: nr(r.omzet),
    kosten: nr(r.kosten),
  }));
}

export type ProjectRij = {
  projectId: string;
  project: string;
  klant: string;
  status: string;
  minuten: number;               // in de periode
  omzet: number | null;
  kosten: number | null;
  budgetUren: number | null;
  besteedTotaal: number;         // uren, over de hele looptijd
  budgetVerbruiktPct: number | null;
  effectiefUurtarief: number | null;
};

export async function perProject(sessie: Sessie, van: Datum, tot: Datum): Promise<ProjectRij[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select p.id, p.naam as project, k.naam as klant, p.status,
           p.budget_uren::float8 as budget_uren,
           coalesce(per.minuten, 0) as minuten,
           per.omzet::float8 as omzet,
           per.kosten::float8 as kosten,
           coalesce(tot.uren, 0)::float8 as besteed_totaal
    from project p
    join klant k on k.id = p.klant_id
    left join (
      select project_id, sum(minuten) as minuten, sum(omzet) as omzet, sum(kosten) as kosten
      from v_urenregel where datum between ${van} and ${tot}
      group by project_id
    ) per on per.project_id = p.id
    left join (
      select project_id, sum(minuten) / 60.0 as uren
      from v_urenregel group by project_id
    ) tot on tot.project_id = p.id
    where per.minuten is not null or p.status = 'actief'
    order by coalesce(per.minuten, 0) desc, p.naam
  `);
  return rijen.map((r) => {
    const budget = nr(r.budget_uren);
    const besteed = Number(r.besteed_totaal);
    const minuten = Number(r.minuten);
    const omzet = nr(r.omzet);
    return {
      projectId: r.id as string,
      project: r.project as string,
      klant: r.klant as string,
      status: r.status as string,
      minuten,
      omzet,
      kosten: nr(r.kosten),
      budgetUren: budget,
      besteedTotaal: besteed,
      budgetVerbruiktPct: budget && budget > 0 ? (besteed / budget) * 100 : null,
      effectiefUurtarief: omzet !== null && minuten > 0 ? omzet / (minuten / 60) : null,
    };
  });
}

export type KlantRij = {
  klantId: string;
  klant: string;
  projecten: number;
  minuten: number;
  omzet: number | null;
  kosten: number | null;
  km: number;
};

export async function perKlant(sessie: Sessie, van: Datum, tot: Datum): Promise<KlantRij[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select k.id, k.naam,
           count(distinct v.project_id) as projecten,
           coalesce(sum(v.minuten), 0) as minuten,
           sum(v.omzet)::float8 as omzet,
           sum(v.kosten)::float8 as kosten,
           coalesce((select sum(r.totaal_km) from v_rit r
                      where r.klant_id = k.id and r.datum between ${van} and ${tot}), 0)::float8 as km
    from klant k
    join v_urenregel v on v.klant_id = k.id and v.datum between ${van} and ${tot}
    group by k.id, k.naam
    order by sum(v.minuten) desc
  `);
  return rijen.map((r) => ({
    klantId: r.id as string,
    klant: r.naam as string,
    projecten: Number(r.projecten),
    minuten: Number(r.minuten),
    omzet: nr(r.omzet),
    kosten: nr(r.kosten),
    km: Number(r.km),
  }));
}

export type MedewerkerStat = {
  medewerkerId: string;
  medewerker: string;
  minuten: number;
  declarabeleMinuten: number;
  omzet: number | null;
  kosten: number | null;
  km: number;
};

export async function perMedewerker(sessie: Sessie, van: Datum, tot: Datum): Promise<MedewerkerStat[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select v.medewerker_id, v.medewerker,
           sum(v.minuten) as minuten,
           sum(v.minuten) filter (where v.declarabel) as decl,
           sum(v.omzet)::float8 as omzet,
           sum(v.kosten)::float8 as kosten,
           coalesce((select sum(r.totaal_km) from v_rit r
                      where r.medewerker_id = v.medewerker_id
                        and r.datum between ${van} and ${tot}), 0)::float8 as km
    from v_urenregel v
    where v.datum between ${van} and ${tot}
    group by v.medewerker_id, v.medewerker
    order by sum(v.minuten) desc
  `);
  return rijen.map((r) => ({
    medewerkerId: r.medewerker_id as string,
    medewerker: r.medewerker as string,
    minuten: Number(r.minuten),
    declarabeleMinuten: Number(r.decl ?? 0),
    omzet: nr(r.omzet),
    kosten: nr(r.kosten),
    km: Number(r.km),
  }));
}
