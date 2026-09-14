import "server-only";
import { alsGebruiker } from "./db";
import type { Sessie } from "./auth";
import type { Datum } from "./datum";

// Verkoop: prospects door een pipeline, onderwerpen per prospect, en
// gesprekken met transcript. De regels (kans per fase, logboek, winnen maakt
// een klant) zitten in de database; hier het lezen en schrijven.

const n = (v: unknown) => Number(v ?? 0);
const d = (v: unknown) => (v ? (String(v) as Datum) : null);
const t = (v: unknown) => ((v as string) ?? null);

export type Fase = "lead" | "contact" | "afspraak" | "offerte" | "gewonnen" | "verloren";
export const FASEN: Fase[] = ["lead", "contact", "afspraak", "offerte", "gewonnen", "verloren"];
export const OPEN_FASEN: Fase[] = ["lead", "contact", "afspraak", "offerte"];
export const FASE_LABEL: Record<Fase, string> = {
  lead: "Lead", contact: "Contact", afspraak: "Afspraak", offerte: "Offerte", gewonnen: "Gewonnen", verloren: "Verloren",
};
export type OnderwerpStatus = "interesse" | "besproken" | "offerte" | "akkoord" | "afgewezen";
export const ONDERWERP_STATUSSEN: OnderwerpStatus[] = ["interesse", "besproken", "offerte", "akkoord", "afgewezen"];
export const STATUS_LABEL: Record<OnderwerpStatus, string> = {
  interesse: "interesse", besproken: "besproken", offerte: "offerte", akkoord: "akkoord", afgewezen: "afgewezen",
};
export type GesprekSoort = "telefoon" | "bezoek" | "video" | "overig";
export const SOORT_LABEL: Record<GesprekSoort, string> = { telefoon: "telefoon", bezoek: "bezoek", video: "video", overig: "overig" };
export const BRONNEN = ["website", "netwerk", "verwijzing", "bestaande klant", "koud", "overig"];

// ------------------------------------------------------------- prospect ---

export type ProspectOnderwerp = { id: string; naam: string; status: OnderwerpStatus; notitie: string | null };
export type Prospect = {
  id: string; naam: string; contactpersoon: string | null; email: string | null; telefoon: string | null;
  plaats: string | null; bron: string | null; fase: Fase; waarde: number | null; kans: number;
  verwachtOp: Datum | null; volgendeActie: string | null; volgendeActieOp: Datum | null;
  eigenaarId: string | null; eigenaar: string | null; klantId: string | null; klant: string | null;
  verlorenReden: string | null; notities: string | null; geslotenOp: Datum | null; aangemaaktOp: string;
  onderwerpen: ProspectOnderwerp[]; gesprekken: number;
};

const naarProspect = (r: Record<string, unknown>): Prospect => ({
  id: r.id as string, naam: r.naam as string, contactpersoon: t(r.contactpersoon), email: t(r.email), telefoon: t(r.telefoon),
  plaats: t(r.plaats), bron: t(r.bron), fase: r.fase as Fase, waarde: r.waarde === null ? null : n(r.waarde_f), kans: Number(r.kans),
  verwachtOp: d(r.verwacht_op), volgendeActie: t(r.volgende_actie), volgendeActieOp: d(r.volgende_actie_op),
  eigenaarId: t(r.eigenaar_id), eigenaar: t(r.eigenaar), klantId: t(r.klant_id), klant: t(r.klant),
  verlorenReden: t(r.verloren_reden), notities: t(r.notities), geslotenOp: d(r.gesloten_op), aangemaaktOp: String(r.aangemaakt_op),
  onderwerpen: ((r.onderwerpen as ProspectOnderwerp[] | null) ?? []), gesprekken: Number(r.gesprekken ?? 0),
});

const PROSPECT_SELECT = `
  select p.*, p.waarde::float8 as waarde_f, m.naam as eigenaar, k.naam as klant,
         (select coalesce(json_agg(json_build_object('id', o.id, 'naam', o.naam, 'status', po.status, 'notitie', po.notitie) order by o.sortering, o.naam), '[]'::json)
            from prospect_onderwerp po join onderwerp o on o.id = po.onderwerp_id where po.prospect_id = p.id) as onderwerpen,
         (select count(*) from gesprek g where g.prospect_id = p.id) as gesprekken
  from prospect p
  left join medewerker m on m.id = p.eigenaar_id
  left join klant k on k.id = p.klant_id`;

export async function prospects(sessie: Sessie, onderwerpId: string | null = null): Promise<Prospect[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(
    `${PROSPECT_SELECT}
     where ($1::uuid is null or exists (select 1 from prospect_onderwerp x where x.prospect_id = p.id and x.onderwerp_id = $1::uuid))
     order by p.fase, coalesce(p.volgende_actie_op, p.verwacht_op, '2999-12-31') , p.naam`, [onderwerpId]));
  return rijen.map(naarProspect);
}

export type FaseLog = { van: Fase | null; naar: Fase; door: string | null; op: string };
export async function prospect(sessie: Sessie, id: string): Promise<(Prospect & { log: FaseLog[] }) | null> {
  const [rijen, log] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx.unsafe(`${PROSPECT_SELECT} where p.id = $1`, [id]),
    await tx`
      select l.van, l.naar, m.naam as door, l.op from prospect_fase_log l left join medewerker m on m.id = l.door
      where l.prospect_id = ${id} order by l.op
    `,
  ]);
  if (!rijen[0]) return null;
  return {
    ...naarProspect(rijen[0]),
    log: log.map((l) => ({ van: (l.van as Fase) ?? null, naar: l.naar as Fase, door: t(l.door), op: String(l.op) })),
  };
}

export type ProspectInvoer = {
  naam: string; contactpersoon: string | null; email: string | null; telefoon: string | null; plaats: string | null;
  bron: string | null; fase: Fase; waarde: number | null; kans: number | null; verwachtOp: Datum | null;
  volgendeActie: string | null; volgendeActieOp: Datum | null; eigenaarId: string | null; notities: string | null;
};

export async function nieuweProspect(sessie: Sessie, p: ProspectInvoer): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into prospect (naam, contactpersoon, email, telefoon, plaats, bron, fase, waarde, kans, verwacht_op,
                          volgende_actie, volgende_actie_op, eigenaar_id, notities)
    values (${p.naam}, ${p.contactpersoon}, ${p.email}, ${p.telefoon}, ${p.plaats}, ${p.bron}, ${p.fase}::pipeline_fase,
            ${p.waarde}, coalesce(${p.kans}::smallint, kans_bij_fase(${p.fase}::pipeline_fase)), ${p.verwachtOp},
            ${p.volgendeActie}, ${p.volgendeActieOp}, ${p.eigenaarId ?? sessie.medewerkerId}, ${p.notities})
    returning id
  `);
  return r.id as string;
}

export async function werkProspectBij(sessie: Sessie, id: string, p: ProspectInvoer): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update prospect set naam = ${p.naam}, contactpersoon = ${p.contactpersoon}, email = ${p.email}, telefoon = ${p.telefoon},
      plaats = ${p.plaats}, bron = ${p.bron}, fase = ${p.fase}::pipeline_fase, waarde = ${p.waarde},
      kans = coalesce(${p.kans}::smallint, kans), verwacht_op = ${p.verwachtOp}, volgende_actie = ${p.volgendeActie},
      volgende_actie_op = ${p.volgendeActieOp}, eigenaar_id = ${p.eigenaarId}, notities = ${p.notities}
    where id = ${id}
  `);
}

export async function zetFase(sessie: Sessie, id: string, fase: Fase): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`update prospect set fase = ${fase}::pipeline_fase where id = ${id}`);
}

export async function winProspect(sessie: Sessie, id: string, klantId: string | null): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`select win_prospect(${id}, ${klantId}::uuid) as id`);
  return r.id as string;
}

export async function verliesProspect(sessie: Sessie, id: string, reden: string | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`select verlies_prospect(${id}, ${reden})`);
}

export async function verwijderProspect(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`delete from prospect where id = ${id}`);
}

export type PipelineRij = { fase: Fase; aantal: number; waarde: number; gewogen: number; achterstallig: number };
export async function pipeline(sessie: Sessie): Promise<PipelineRij[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select fase::text as fase, aantal::int as aantal, waarde::float8 as waarde, gewogen::float8 as gewogen, achterstallig::int as achterstallig
    from v_pipeline
  `);
  return rijen.map((r) => ({ fase: r.fase as Fase, aantal: Number(r.aantal), waarde: n(r.waarde), gewogen: n(r.gewogen), achterstallig: Number(r.achterstallig) }));
}

// ----------------------------------------------------------- onderwerpen ---

export type Onderwerp = {
  id: string; naam: string; omschrijving: string | null; actief: boolean; sortering: number;
  per: Record<OnderwerpStatus, number>; prospects: { id: string; naam: string; fase: Fase; status: OnderwerpStatus }[];
};

export async function onderwerpen(sessie: Sessie): Promise<Onderwerp[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select o.*,
           (select coalesce(json_agg(json_build_object('id', p.id, 'naam', p.naam, 'fase', p.fase, 'status', po.status) order by p.naam), '[]'::json)
              from prospect_onderwerp po join prospect p on p.id = po.prospect_id where po.onderwerp_id = o.id) as prospects
    from onderwerp o order by o.sortering, o.naam
  `);
  return rijen.map((r) => {
    const lijst = r.prospects as Onderwerp["prospects"];
    const per = { interesse: 0, besproken: 0, offerte: 0, akkoord: 0, afgewezen: 0 } as Record<OnderwerpStatus, number>;
    for (const p of lijst) per[p.status] += 1;
    return { id: r.id as string, naam: r.naam as string, omschrijving: t(r.omschrijving), actief: Boolean(r.actief), sortering: Number(r.sortering), per, prospects: lijst };
  });
}

export async function nieuwOnderwerp(sessie: Sessie, naam: string, omschrijving: string | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into onderwerp (naam, omschrijving, sortering)
    values (${naam}, ${omschrijving}, coalesce((select max(sortering) + 1 from onderwerp), 1))
  `);
}

export async function werkOnderwerpBij(sessie: Sessie, id: string, naam: string, omschrijving: string | null, actief: boolean): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update onderwerp set naam = ${naam}, omschrijving = ${omschrijving}, actief = ${actief} where id = ${id}
  `);
}

export async function koppelOnderwerp(sessie: Sessie, prospectId: string, onderwerpId: string, status: OnderwerpStatus, notitie: string | null): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into prospect_onderwerp (prospect_id, onderwerp_id, status, notitie)
    values (${prospectId}, ${onderwerpId}, ${status}::onderwerp_status, ${notitie})
    on conflict (prospect_id, onderwerp_id) do update set status = excluded.status, notitie = excluded.notitie, gewijzigd_op = now()
  `);
}

export async function ontkoppelOnderwerp(sessie: Sessie, prospectId: string, onderwerpId: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    delete from prospect_onderwerp where prospect_id = ${prospectId} and onderwerp_id = ${onderwerpId}
  `);
}

// -------------------------------------------------------------- gesprek ---

export type Gesprek = {
  id: string; prospectId: string | null; prospect: string | null; klantId: string | null; klant: string | null;
  medewerkerId: string; medewerker: string; datum: string; titel: string; soort: GesprekSoort; duurMinuten: number | null;
  taal: string; transcript: string | null; samenvatting: string | null; afspraken: string | null; live: boolean;
};

const naarGesprek = (r: Record<string, unknown>): Gesprek => ({
  id: r.id as string, prospectId: t(r.prospect_id), prospect: t(r.prospect), klantId: t(r.klant_id), klant: t(r.klant),
  medewerkerId: r.medewerker_id as string, medewerker: r.medewerker as string, datum: String(r.datum), titel: r.titel as string,
  soort: r.soort as GesprekSoort, duurMinuten: r.duur_minuten === null ? null : Number(r.duur_minuten), taal: r.taal as string,
  transcript: t(r.transcript), samenvatting: t(r.samenvatting), afspraken: t(r.afspraken), live: Boolean(r.live),
});

const GESPREK_SELECT = `
  select g.*, p.naam as prospect, k.naam as klant, m.naam as medewerker
  from gesprek g
  left join prospect p on p.id = g.prospect_id
  left join klant k on k.id = g.klant_id
  join medewerker m on m.id = g.medewerker_id`;

export async function gesprekken(sessie: Sessie, filter: { prospectId?: string; klantId?: string } = {}): Promise<Gesprek[]> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(
    `${GESPREK_SELECT}
     where ($1::uuid is null or g.prospect_id = $1::uuid)
       and ($2::uuid is null or g.klant_id = $2::uuid or p.klant_id = $2::uuid)
     order by g.datum desc limit 200`, [filter.prospectId ?? null, filter.klantId ?? null]));
  return rijen.map(naarGesprek);
}

export async function gesprek(sessie: Sessie, id: string): Promise<Gesprek | null> {
  const rijen = await alsGebruiker(sessie.authUserId, (tx) => tx.unsafe(`${GESPREK_SELECT} where g.id = $1`, [id]));
  return rijen[0] ? naarGesprek(rijen[0]) : null;
}

export type GesprekInvoer = {
  prospectId: string | null; klantId: string | null; datum: string; titel: string; soort: GesprekSoort;
  duurMinuten: number | null; taal: string; transcript: string | null; samenvatting: string | null; afspraken: string | null; live: boolean;
};

export async function nieuwGesprek(sessie: Sessie, g: GesprekInvoer): Promise<string> {
  const [r] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into gesprek (prospect_id, klant_id, medewerker_id, datum, titel, soort, duur_minuten, taal, transcript, samenvatting, afspraken, live)
    values (${g.prospectId}, ${g.klantId}, ${sessie.medewerkerId}, ${g.datum}, ${g.titel}, ${g.soort}::gesprek_soort, ${g.duurMinuten},
            ${g.taal}, ${g.transcript}, ${g.samenvatting}, ${g.afspraken}, ${g.live})
    returning id
  `);
  return r.id as string;
}

export async function werkGesprekBij(sessie: Sessie, id: string, g: Omit<GesprekInvoer, "prospectId" | "klantId" | "live">): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update gesprek set datum = ${g.datum}, titel = ${g.titel}, soort = ${g.soort}::gesprek_soort, duur_minuten = ${g.duurMinuten},
      taal = ${g.taal}, transcript = ${g.transcript}, samenvatting = ${g.samenvatting}, afspraken = ${g.afspraken}, gewijzigd_op = now()
    where id = ${id}
  `);
}

export async function verwijderGesprek(sessie: Sessie, id: string): Promise<void> {
  await alsGebruiker(sessie.authUserId, (tx) => tx`delete from gesprek where id = ${id}`);
}

/** Keuzelijsten voor het gespreksformulier: prospects (vanaf projectleider) en klanten. */
export async function relaties(sessie: Sessie): Promise<{ prospects: { id: string; naam: string }[]; klanten: { id: string; naam: string }[] }> {
  const [ps, ks] = await alsGebruiker(sessie.authUserId, async (tx) => [
    await tx`select id, naam from prospect where fase not in ('gewonnen', 'verloren') order by naam`,
    await tx`select id, naam from klant where actief order by naam`,
  ]);
  const m = (l: Record<string, unknown>[]) => l.map((x) => ({ id: x.id as string, naam: x.naam as string }));
  return { prospects: m(ps), klanten: m(ks) };
}
