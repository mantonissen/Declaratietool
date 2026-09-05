"use server";

import { revalidatePath } from "next/cache";
import { vereisteSessie } from "@/lib/auth";
import {
  nieuweGrootboekrekening, werkGrootboekBij, werkBtwBij, werkFactuurInstellingenBij,
} from "@/lib/facturatie";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar beheert het grootboek.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const ververs = () => { revalidatePath("/beheer/grootboek"); revalidatePath("/facturen"); };

const SOORTEN = ["omzet", "kosten", "balans"];

export async function grootboekErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  const nummer = tekst(formData, "nummer");
  const naam = tekst(formData, "naam");
  const soort = String(formData.get("soort") ?? "omzet");
  if (!nummer || !naam) throw new Error("Een grootboekrekening heeft een nummer en een naam nodig.");
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(nummer)) throw new Error("Gebruik voor het nummer alleen cijfers en letters, zoals 8000.");
  if (!SOORTEN.includes(soort)) throw new Error("Onbekende soort.");
  await nieuweGrootboekrekening(sessie, nummer, naam, soort);
  ververs();
}

export async function grootboekOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const nummer = tekst(formData, "nummer");
  const naam = tekst(formData, "naam");
  if (!id || !nummer || !naam) throw new Error("Nummer en naam mogen niet leeg zijn.");
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(nummer)) throw new Error("Gebruik voor het nummer alleen cijfers en letters, zoals 8000.");
  await werkGrootboekBij(sessie, id, nummer, naam, formData.get("actief") === "aan");
  ververs();
}

export async function btwOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const code = String(formData.get("code") ?? "");
  const percentage = getal(formData, "percentage");
  if (!code || percentage === null || percentage < 0 || percentage > 100) {
    throw new Error("Vul een percentage tussen 0 en 100 in.");
  }
  await werkBtwBij(sessie, code, percentage, formData.get("actief") === "aan");
  ververs();
}

export async function factuurInstellingenOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const dagen = getal(formData, "betaaltermijn");
  if (dagen === null || !Number.isInteger(dagen) || dagen < 0 || dagen > 365) {
    throw new Error("De betaaltermijn is een heel aantal dagen, tussen 0 en 365.");
  }
  const prefix = tekst(formData, "prefix") ?? "";
  if (!/^[0-9A-Za-z\-]{0,10}$/.test(prefix)) throw new Error("Het voorvoegsel is kort en zonder spaties, zoals F of 2026-.");
  await werkFactuurInstellingenBij(sessie, {
    grootboekUren: tekst(formData, "grootboekUren"),
    grootboekReiskosten: tekst(formData, "grootboekReiskosten"),
    grootboekTermijn: tekst(formData, "grootboekTermijn"),
    grootboekAbonnement: tekst(formData, "grootboekAbonnement"),
    grootboekOverig: tekst(formData, "grootboekOverig"),
    betaaltermijnDagen: dagen,
    voettekst: tekst(formData, "voettekst"),
    prefix,
  });
  ververs();
}
