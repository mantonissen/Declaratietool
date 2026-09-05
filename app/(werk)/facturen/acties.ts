"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, leesMinuten, vandaag } from "@/lib/datum";
import {
  maakConceptFactuur, maakLosseFactuur, regelToevoegen, regelBijwerken, regelVerwijderen,
  factuurKopBijwerken, maakDefinitief, verwijderConcept, zetBetaald, crediteer,
  markeerVerwerkt, boekCorrectie, nieuweTermijn, verwijderTermijn,
} from "@/lib/facturatie";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar factureert.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const ververs = (id?: string) => {
  revalidatePath("/facturen"); revalidatePath("/inzicht");
  if (id) revalidatePath(`/facturen/${id}`);
};

// ------------------------------------------------------------ aanmaken ----

export async function conceptVanVoorstel(formData: FormData) {
  const sessie = await eigenaarSessie();
  const projectId = String(formData.get("projectId") ?? "");
  const van = String(formData.get("van") ?? "");
  const tot = String(formData.get("tot") ?? "");
  const termijnIds = formData.getAll("termijn").map(String).filter(Boolean);
  const metReiskosten = formData.get("reiskosten") !== "uit";
  if (!projectId || !isGeldigeDatum(van) || !isGeldigeDatum(tot) || van > tot) {
    throw new Error("Kies een project en een geldige periode.");
  }
  const id = await maakConceptFactuur(sessie, projectId, van, tot, termijnIds, metReiskosten);
  ververs(id);
  redirect(`/facturen/${id}`);
}

export async function losseFactuur(formData: FormData) {
  const sessie = await eigenaarSessie();
  const klantId = String(formData.get("klantId") ?? "");
  const projectId = tekst(formData, "projectId");
  if (!klantId) throw new Error("Kies een klant.");
  const id = await maakLosseFactuur(sessie, klantId, projectId);
  ververs(id);
  redirect(`/facturen/${id}`);
}

// -------------------------------------------------------------- regels ----

function regelUitFormulier(fd: FormData) {
  const omschrijving = tekst(fd, "omschrijving");
  const aantal = getal(fd, "aantal");
  const prijs = getal(fd, "prijs");
  if (!omschrijving) throw new Error("Een regel heeft een omschrijving nodig.");
  if (aantal === null || prijs === null) throw new Error("Vul aantal en prijs in.");
  return {
    omschrijving, aantal, prijs,
    eenheid: tekst(fd, "eenheid") ?? "stuk",
    btwCode: tekst(fd, "btwCode"),
    grootboekId: tekst(fd, "grootboekId"),
  };
}

export async function regelErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  const factuurId = String(formData.get("factuurId") ?? "");
  await regelToevoegen(sessie, factuurId, regelUitFormulier(formData));
  ververs(factuurId);
}

export async function regelOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const factuurId = String(formData.get("factuurId") ?? "");
  const regelId = String(formData.get("regelId") ?? "");
  await regelBijwerken(sessie, regelId, regelUitFormulier(formData));
  ververs(factuurId);
}

export async function regelWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  const factuurId = String(formData.get("factuurId") ?? "");
  await regelVerwijderen(sessie, String(formData.get("regelId") ?? ""));
  ververs(factuurId);
}

export async function kopOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("factuurId") ?? "");
  await factuurKopBijwerken(sessie, id, {
    referentieKlant: tekst(formData, "referentieKlant"),
    opmerking: tekst(formData, "opmerking"),
  });
  ververs(id);
}

// -------------------------------------------------------------- status ----

export async function definitiefMaken(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("factuurId") ?? "");
  const datum = String(formData.get("datum") ?? "");
  await maakDefinitief(sessie, id, isGeldigeDatum(datum) ? datum : vandaag());
  ververs(id);
}

export async function conceptWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderConcept(sessie, String(formData.get("factuurId") ?? ""));
  ververs();
  redirect("/facturen");
}

export async function betaald(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("factuurId") ?? "");
  const datum = String(formData.get("datum") ?? "");
  await zetBetaald(sessie, id, formData.get("ongedaan") === "ja" ? null : (isGeldigeDatum(datum) ? datum : vandaag()));
  ververs(id);
}

export async function crediteren(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("factuurId") ?? "");
  const reden = tekst(formData, "reden");
  if (!reden) throw new Error("Zeg erbij waarom je crediteert; dat komt op de creditfactuur.");
  const nieuw = await crediteer(sessie, id, reden);
  ververs(id);
  redirect(`/facturen/${nieuw}`);
}

export async function verwerktInBoekhouding(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("factuurId") ?? "");
  if (id) await markeerVerwerkt(sessie, id);
  ververs(id);
}

// ---------------------------------------------------- correctie, termijn ---

export async function corrigeer(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const factuurId = String(formData.get("factuurId") ?? "");
  const toelichting = tekst(formData, "toelichting");
  const nieuw = String(formData.get("nieuweTijd") ?? "").trim();
  if (!id) return;
  if (!toelichting) throw new Error("Zeg erbij waarom je corrigeert; dat komt op de specificatie.");
  const minuten = nieuw === "" ? 0 : leesMinuten(nieuw);
  if (minuten === null) throw new Error("Ongeldige tijd. Laat leeg om de regel helemaal te crediteren.");
  await boekCorrectie(sessie, id, minuten, toelichting);
  ververs(factuurId);
}

export async function termijnToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const projectId = String(formData.get("projectId") ?? "");
  const omschrijving = tekst(formData, "omschrijving");
  const bedrag = getal(formData, "bedrag");
  const gepland = String(formData.get("geplandOp") ?? "");
  if (!projectId || !omschrijving) throw new Error("Een termijn heeft een omschrijving nodig.");
  if (bedrag === null || bedrag < 0) throw new Error("Vul een bedrag in.");
  await nieuweTermijn(sessie, projectId, { omschrijving, bedrag, geplandOp: isGeldigeDatum(gepland) ? gepland : null });
  revalidatePath("/facturen"); revalidatePath(`/beheer/project/${projectId}`);
  const terug = String(formData.get("terug") ?? "");
  if (terug.startsWith("/")) redirect(terug);
}

export async function termijnVerwijderen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (id) await verwijderTermijn(sessie, id);
  revalidatePath("/facturen"); revalidatePath(`/beheer/project/${projectId}`);
}
