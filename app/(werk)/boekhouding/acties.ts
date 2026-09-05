"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, vandaag } from "@/lib/datum";
import { btwTarieven } from "@/lib/facturatie";
import {
  boekMemoriaal, verwijderBoeking, sluitAf, nieuweInkoop, werkInkoopBij, verwijderInkoop, betaalInkoop,
  maakAangifte, verwijderAangifte, dienAangifteIn, betaalAangifte, type MemoriaalRegel,
} from "@/lib/boekhouding";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar voert de boekhouding.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const datum = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? ""); return isGeldigeDatum(w) ? w : null; };
const ververs = () => {
  for (const p of ["/boekhouding", "/boekhouding/journaal", "/boekhouding/inkoop", "/boekhouding/btw", "/facturen", "/inzicht"]) revalidatePath(p);
};

// ----------------------------------------------------------- memoriaal ---

export async function memoriaalBoeken(formData: FormData) {
  const sessie = await eigenaarSessie();
  const d = datum(formData, "datum");
  const omschrijving = tekst(formData, "omschrijving");
  if (!d || !omschrijving) throw new Error("Een boeking heeft een datum en een omschrijving nodig.");
  const gbs = formData.getAll("gb").map(String);
  const debets = formData.getAll("debet").map(String);
  const credits = formData.getAll("credit").map(String);
  const omss = formData.getAll("oms").map(String);
  const regels: MemoriaalRegel[] = [];
  gbs.forEach((gb, i) => {
    const deb = Number(debets[i]?.replace(",", ".") || 0), cre = Number(credits[i]?.replace(",", ".") || 0);
    if (!gb || (!deb && !cre)) return;
    if (!Number.isFinite(deb) || !Number.isFinite(cre) || deb < 0 || cre < 0) throw new Error("Bedragen zijn positieve getallen; kies debet óf credit.");
    regels.push({ grootboekId: gb, debet: deb, credit: cre, omschrijving: omss[i]?.trim() || null });
  });
  if (regels.length < 2) throw new Error("Een boeking heeft minstens twee regels.");
  const debet = regels.reduce((s, r) => s + r.debet, 0), credit = regels.reduce((s, r) => s + r.credit, 0);
  if (Math.abs(debet - credit) > 0.004) throw new Error(`De boeking sluit niet: debet ${debet.toFixed(2)} tegenover credit ${credit.toFixed(2)}.`);
  await boekMemoriaal(sessie, d, omschrijving, regels);
  ververs();
}

export async function boekingWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  if (id) await verwijderBoeking(sessie, id);
  ververs();
}

export async function afsluiten(formData: FormData) {
  const sessie = await eigenaarSessie();
  const tot = formData.get("heropen") === "ja" ? null : datum(formData, "afsluitenTot");
  if (formData.get("heropen") !== "ja" && !tot) throw new Error("Kies een datum tot en met wanneer je afsluit.");
  await sluitAf(sessie, tot);
  ververs();
}

// ---------------------------------------------------------------- inkoop ---

async function inkoopUitFormulier(fd: FormData) {
  const leverancier = tekst(fd, "leverancier");
  const omschrijving = tekst(fd, "omschrijving");
  const d = datum(fd, "datum");
  const grootboekId = tekst(fd, "grootboekId");
  const bedragExcl = getal(fd, "bedragExcl");
  const btwCode = tekst(fd, "btwCode") ?? "hoog";
  if (!leverancier || !omschrijving || !d || !grootboekId) throw new Error("Leverancier, omschrijving, datum en rekening zijn nodig.");
  if (bedragExcl === null) throw new Error("Vul het bedrag exclusief btw in.");
  let btwBedrag = getal(fd, "btwBedrag");
  if (btwBedrag === null) {
    const tarief = (await btwTarieven(await vereisteSessie())).find((t) => t.code === btwCode);
    btwBedrag = Math.round(bedragExcl * (tarief?.percentage ?? 0)) / 100;
  }
  return {
    leverancier, omschrijving, kenmerk: tekst(fd, "kenmerk"), datum: d, vervaldatum: datum(fd, "vervaldatum"),
    grootboekId, bedragExcl, btwCode, btwBedrag,
  };
}

export async function inkoopErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  const i = await inkoopUitFormulier(formData);
  const betaaldOp = datum(formData, "betaaldOp");
  const via = tekst(formData, "betaaldVia");
  if (betaaldOp && !via) throw new Error("Kies waarvan je betaald hebt (bank, kas of privé).");
  await nieuweInkoop(sessie, { ...i, betaaldOp, betaaldVia: betaaldOp ? via : null });
  ververs();
  redirect("/boekhouding/inkoop");
}

export async function inkoopOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  await werkInkoopBij(sessie, id, await inkoopUitFormulier(formData));
  ververs(); revalidatePath(`/boekhouding/inkoop/${id}`);
  redirect("/boekhouding/inkoop");
}

export async function inkoopWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderInkoop(sessie, String(formData.get("id") ?? ""));
  ververs();
  redirect("/boekhouding/inkoop");
}

export async function inkoopBetaald(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  if (formData.get("ongedaan") === "ja") {
    await betaalInkoop(sessie, id, null, null);
  } else {
    const via = tekst(formData, "via");
    if (!via) throw new Error("Kies waarvan je betaald hebt.");
    await betaalInkoop(sessie, id, datum(formData, "datum") ?? vandaag(), via);
  }
  ververs(); revalidatePath(`/boekhouding/inkoop/${id}`);
}

// ------------------------------------------------------------------ btw ---

export async function aangifteVastleggen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const van = datum(formData, "van"), tot = datum(formData, "tot");
  if (!van || !tot || van > tot) throw new Error("Kies een geldige periode.");
  await maakAangifte(sessie, van, tot);
  ververs();
  redirect(`/boekhouding/btw?van=${van}&tot=${tot}`);
}

export async function aangifteWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderAangifte(sessie, String(formData.get("id") ?? ""));
  ververs();
}

export async function aangifteIngediend(formData: FormData) {
  const sessie = await eigenaarSessie();
  await dienAangifteIn(sessie, String(formData.get("id") ?? ""), datum(formData, "datum") ?? vandaag());
  ververs();
}

export async function aangifteBetaald(formData: FormData) {
  const sessie = await eigenaarSessie();
  const via = tekst(formData, "via");
  if (!via) throw new Error("Kies waarvan je betaald hebt.");
  await betaalAangifte(sessie, String(formData.get("id") ?? ""), datum(formData, "datum") ?? vandaag(), via);
  ververs();
}
