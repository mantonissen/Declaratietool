"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, vandaag } from "@/lib/datum";
import {
  nieuwActivum, zetBuitenGebruik, verwijderActivum, boekAfschrijvingen, werkBoekjaarBij, reserveerVpb, betaalVpb,
  werkVpbParametersBij,
} from "@/lib/jaarwerk";
import { boekMemoriaal } from "@/lib/boekhouding";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar doet het jaarwerk.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const datum = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? ""); return isGeldigeDatum(w) ? w : null; };
const jaarVan = (fd: FormData) => { const j = Number(fd.get("jaar")); if (!Number.isInteger(j) || j < 2000 || j > 2100) throw new Error("Onbekend jaar."); return j; };
const ververs = (jaar?: number) => {
  for (const p of ["/boekhouding", "/boekhouding/journaal", "/boekhouding/activa", "/boekhouding/jaarrekening", "/boekhouding/aangiften"]) revalidatePath(p);
  void jaar;
};

// --------------------------------------------------------------- activa ---

export async function activumErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  const omschrijving = tekst(formData, "omschrijving");
  const aanschafdatum = datum(formData, "aanschafdatum");
  const aanschafwaarde = getal(formData, "aanschafwaarde");
  const restwaarde = getal(formData, "restwaarde") ?? 0;
  const maanden = getal(formData, "maanden");
  if (!omschrijving || !aanschafdatum || aanschafwaarde === null || maanden === null) throw new Error("Omschrijving, datum, aanschafwaarde en afschrijvingsduur zijn nodig.");
  if (restwaarde >= aanschafwaarde) throw new Error("De restwaarde moet lager zijn dan de aanschafwaarde.");
  const grootboekActiva = tekst(formData, "grootboekActiva"), grootboekAfschrijving = tekst(formData, "grootboekAfschrijving"), grootboekKosten = tekst(formData, "grootboekKosten");
  if (!grootboekActiva || !grootboekAfschrijving || !grootboekKosten) throw new Error("Kies de drie rekeningen.");
  await nieuwActivum(sessie, {
    omschrijving, aanschafdatum, aanschafwaarde, restwaarde, afschrijvingsmaanden: Math.round(maanden),
    grootboekActiva, grootboekAfschrijving, grootboekKosten, inkoopId: tekst(formData, "inkoopId"),
  });
  // De aanschaf zelf op de balans zetten, als dat nog niet via een inkoop
  // is gebeurd: activarekening debet, het gekozen betaalmiddel credit.
  const tegen = tekst(formData, "tegenrekening");
  if (tegen) {
    await boekMemoriaal(sessie, aanschafdatum, `Aanschaf ${omschrijving}`, [
      { grootboekId: grootboekActiva, debet: aanschafwaarde, credit: 0, omschrijving: null },
      { grootboekId: tegen, debet: 0, credit: aanschafwaarde, omschrijving: null },
    ]);
  }
  ververs();
}

export async function activumBuitenGebruik(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  await zetBuitenGebruik(sessie, id, formData.get("ongedaan") === "ja" ? null : (datum(formData, "datum") ?? vandaag()));
  ververs();
}

export async function activumWeg(formData: FormData) {
  const sessie = await eigenaarSessie();
  await verwijderActivum(sessie, String(formData.get("id") ?? ""));
  ververs();
}

export async function afschrijven(formData: FormData) {
  const sessie = await eigenaarSessie();
  const tot = datum(formData, "tot");
  if (!tot) throw new Error("Kies tot en met welke datum je afschrijft.");
  await boekAfschrijvingen(sessie, tot);
  ververs();
}

// ------------------------------------------------------------- boekjaar ---

export async function boekjaarOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = jaarVan(formData);
  await werkBoekjaarBij(sessie, jaar, {
    vpbCorrecties: getal(formData, "vpbCorrecties") ?? 0,
    vpbVerliesVerrekend: getal(formData, "vpbVerlies") ?? 0,
    gemiddeldWerknemers: getal(formData, "gemiddeldWerknemers"),
    toelichting: tekst(formData, "toelichting"),
  });
  ververs(jaar);
}

export async function jaarstapOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = jaarVan(formData);
  const stap = String(formData.get("stap") ?? "");
  const d = formData.get("ongedaan") === "ja" ? null : (datum(formData, "datum") ?? vandaag());
  const velden: Record<string, object> = {
    opgemaakt: { opgemaaktOp: d }, vastgesteld: { vastgesteldOp: d }, gedeponeerd: { gedeponeerdOp: d }, vpbAangifte: { vpbAangifteIngediendOp: d },
  };
  if (!velden[stap]) throw new Error("Onbekende stap.");
  await werkBoekjaarBij(sessie, jaar, velden[stap]);
  ververs(jaar);
}

export async function vpbReserveren(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = jaarVan(formData);
  await reserveerVpb(sessie, jaar);
  ververs(jaar);
}

export async function vpbBetalen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = jaarVan(formData);
  const via = tekst(formData, "via");
  if (!via) throw new Error("Kies waarvan je betaalt.");
  await betaalVpb(sessie, jaar, datum(formData, "datum") ?? vandaag(), via);
  ververs(jaar);
}

export async function vpbParametersOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const jaar = jaarVan(formData);
  const grens = getal(formData, "grens"), laag = getal(formData, "tariefLaag"), hoog = getal(formData, "tariefHoog");
  if (grens === null || laag === null || hoog === null) throw new Error("Vul grens en beide tarieven in.");
  await werkVpbParametersBij(sessie, { jaar, grens, tariefLaag: laag, tariefHoog: hoog, gecontroleerd: formData.get("gecontroleerd") === "aan" });
  ververs(jaar);
  redirect(`/boekhouding/jaarrekening?jaar=${jaar}`);
}
