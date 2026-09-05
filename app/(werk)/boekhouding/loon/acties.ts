"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, vandaag } from "@/lib/datum";
import {
  nieuwDienstverband, werkDienstverbandBij, verwijderDienstverband, maakLoonrun, maakLoonrunDefinitief, verwijderLoonrun,
  betaalLoonrun, markeerLoonaangifteIngediend, werkLoonparametersBij, loonparameters, type Loonparameters,
} from "@/lib/loon";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar voert de loonadministratie.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const datum = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? ""); return isGeldigeDatum(w) ? w : null; };
const ververs = (id?: string) => {
  for (const p of ["/boekhouding", "/boekhouding/loon", "/boekhouding/loon/parameters", "/boekhouding/journaal", "/boekhouding/aangiften"]) revalidatePath(p);
  if (id) revalidatePath(`/boekhouding/loon/${id}`);
};

// -------------------------------------------------------- dienstverband ---

function dienstverbandUit(fd: FormData) {
  const medewerkerId = tekst(fd, "medewerkerId");
  const inDienst = datum(fd, "inDienst");
  const bruto = getal(fd, "brutoMaandloon");
  if (!medewerkerId || !inDienst || bruto === null) throw new Error("Medewerker, datum in dienst en brutoloon zijn nodig.");
  const bsn = tekst(fd, "bsn");
  if (bsn && !/^\d{8,9}$/.test(bsn.replace(/\s/g, ""))) throw new Error("Een BSN heeft 8 of 9 cijfers.");
  return {
    medewerkerId, inDienst, uitDienst: datum(fd, "uitDienst"), brutoMaandloon: bruto,
    urenPerWeek: getal(fd, "urenPerWeek") ?? 40, vakantiegeldPct: getal(fd, "vakantiegeldPct") ?? 8,
    pensioenWnPct: getal(fd, "pensioenWnPct") ?? 0, pensioenWgPct: getal(fd, "pensioenWgPct") ?? 0,
    loonheffingskorting: fd.get("loonheffingskorting") === "aan", onbepaaldeTijd: fd.get("onbepaaldeTijd") === "aan",
    dga: fd.get("dga") === "aan", geboortedatum: datum(fd, "geboortedatum"), bsn: bsn?.replace(/\s/g, "") ?? null, iban: tekst(fd, "iban"),
  };
}

export async function dienstverbandErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  await nieuwDienstverband(sessie, dienstverbandUit(formData));
  ververs();
}

export async function dienstverbandOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  await werkDienstverbandBij(sessie, String(formData.get("id") ?? ""), dienstverbandUit(formData));
  ververs();
}

export async function dienstverbandWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderDienstverband(sessie, String(formData.get("id") ?? ""));
  ververs();
}

// ------------------------------------------------------------- loonrun ---

export async function loonrunMaken(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = Number(formData.get("jaar")), maand = Number(formData.get("maand"));
  if (!Number.isInteger(jaar) || !Number.isInteger(maand) || maand < 1 || maand > 12) throw new Error("Kies jaar en maand.");
  const id = await maakLoonrun(sessie, jaar, maand, formData.get("vakantiegeld") === "aan");
  ververs(id);
  redirect(`/boekhouding/loon/${id}`);
}

export async function loonrunDefinitief(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  await maakLoonrunDefinitief(sessie, id);
  ververs(id);
}

export async function loonrunWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderLoonrun(sessie, String(formData.get("id") ?? ""));
  ververs();
  redirect("/boekhouding/loon");
}

export async function loonrunBetalen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const wat = String(formData.get("wat") ?? "");
  const via = tekst(formData, "via");
  if (!["netto", "loonheffing", "pensioen"].includes(wat)) throw new Error("Onbekende betaling.");
  if (!via) throw new Error("Kies waarvan je betaalt.");
  await betaalLoonrun(sessie, id, wat as "netto" | "loonheffing" | "pensioen", datum(formData, "datum") ?? vandaag(), via);
  ververs(id);
}

export async function loonaangifteIngediend(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  await markeerLoonaangifteIngediend(sessie, id, datum(formData, "datum") ?? vandaag());
  ververs(id);
}

// ----------------------------------------------------------- parameters ---

export async function loonparametersOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = Number(formData.get("jaar"));
  if (!Number.isInteger(jaar) || jaar < 2000 || jaar > 2100) throw new Error("Onbekend jaar.");
  const g = (n: string) => { const x = getal(formData, n); if (x === null) throw new Error(`Vul ${n} in.`); return x; };
  const p: Loonparameters = {
    jaar, gecontroleerd: formData.get("gecontroleerd") === "aan",
    schijven: [
      { tot: g("schijf1Tot"), tarief: g("schijf1Tarief") },
      { tot: g("schijf2Tot"), tarief: g("schijf2Tarief") },
      { tot: null, tarief: g("schijf3Tarief") },
    ],
    ahkMax: g("ahkMax"), ahkAfbouwVanaf: g("ahkAfbouwVanaf"), ahkAfbouwPct: g("ahkAfbouwPct"),
    akSchijven: [
      { tot: g("ak1Tot"), pct: g("ak1Pct") }, { tot: g("ak2Tot"), pct: g("ak2Pct") }, { tot: g("ak3Tot"), pct: g("ak3Pct") },
    ],
    akMax: g("akMax"), akAfbouwVanaf: g("akAfbouwVanaf"), akAfbouwPct: g("akAfbouwPct"),
    awfLaag: g("awfLaag"), awfHoog: g("awfHoog"), aof: g("aof"), whk: g("whk"), zvwWg: g("zvwWg"), zvwWn: g("zvwWn"),
    maxPremieloon: g("maxPremieloon"), gebruikelijkLoon: g("gebruikelijkLoon"), minimumloonUur: g("minimumloonUur"),
  };
  await werkLoonparametersBij(sessie, p);
  ververs();
  redirect(`/boekhouding/loon/parameters?jaar=${jaar}`);
}

export async function loonparametersKopieren(formData: FormData) {
  const sessie = await eigenaarSessie();
  const van = Number(formData.get("van")), naar = Number(formData.get("naar"));
  const bron = (await loonparameters(sessie)).find((p) => p.jaar === van);
  if (!bron || !Number.isInteger(naar) || naar < 2000 || naar > 2100) throw new Error("Kies een bestaand bronjaar en een geldig nieuw jaar.");
  await werkLoonparametersBij(sessie, { ...bron, jaar: naar, gecontroleerd: false });
  ververs();
  redirect(`/boekhouding/loon/parameters?jaar=${naar}`);
}
