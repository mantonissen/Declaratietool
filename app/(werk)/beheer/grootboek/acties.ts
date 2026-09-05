"use server";

import { revalidatePath } from "next/cache";
import { vereisteSessie } from "@/lib/auth";
import {
  nieuweGrootboekrekening, werkGrootboekBij, werkBtwBij, werkFactuurInstellingenBij,
  REKENING_SOORTEN, type RekeningSoort,
} from "@/lib/facturatie";
import { boekhoudInstellingen, werkBoekhoudInstellingenBij } from "@/lib/boekhouding";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar beheert het grootboek.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const ververs = () => { for (const p of ["/beheer/grootboek", "/facturen", "/boekhouding", "/boekhouding/inkoop", "/boekhouding/btw"]) revalidatePath(p); };

export async function grootboekErbij(formData: FormData) {
  const sessie = await eigenaarSessie();
  const nummer = tekst(formData, "nummer");
  const naam = tekst(formData, "naam");
  const soort = String(formData.get("soort") ?? "kosten") as RekeningSoort;
  if (!nummer || !naam) throw new Error("Een grootboekrekening heeft een nummer en een naam nodig.");
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(nummer)) throw new Error("Gebruik voor het nummer alleen cijfers en letters, zoals 8000.");
  if (!REKENING_SOORTEN.includes(soort)) throw new Error("Onbekende soort.");
  await nieuweGrootboekrekening(sessie, nummer, naam, soort, formData.get("betaalmiddel") === "aan");
  ververs();
}

export async function grootboekOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const nummer = tekst(formData, "nummer");
  const naam = tekst(formData, "naam");
  if (!id || !nummer || !naam) throw new Error("Nummer en naam mogen niet leeg zijn.");
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(nummer)) throw new Error("Gebruik voor het nummer alleen cijfers en letters, zoals 8000.");
  await werkGrootboekBij(sessie, id, nummer, naam, formData.get("actief") === "aan", formData.get("betaalmiddel") === "aan", tekst(formData, "rubriek"));
  ververs();
}

export async function boekhoudRekeningenOpslaan(formData: FormData) {
  const sessie = await eigenaarSessie();
  const huidig = await boekhoudInstellingen(sessie);
  const interval = String(formData.get("btwInterval") ?? "kwartaal");
  if (!["maand", "kwartaal", "jaar"].includes(interval)) throw new Error("Onbekend aangifteritme.");
  const sleutels = ["rekeningDebiteuren", "rekeningCrediteuren", "rekeningBank", "rekeningBtwVerschuldigd", "rekeningBtwVoorbelasting", "rekeningBtwAangifte"] as const;
  for (const s of sleutels) if (!tekst(formData, s)) throw new Error("Elke vaste rekening moet gekozen zijn; de boekingen steunen erop.");
  await werkBoekhoudInstellingenBij(sessie, {
    ...huidig, btwInterval: interval as "maand" | "kwartaal" | "jaar",
    rekeningDebiteuren: tekst(formData, "rekeningDebiteuren"), rekeningCrediteuren: tekst(formData, "rekeningCrediteuren"),
    rekeningBank: tekst(formData, "rekeningBank"), rekeningBtwVerschuldigd: tekst(formData, "rekeningBtwVerschuldigd"),
    rekeningBtwVoorbelasting: tekst(formData, "rekeningBtwVoorbelasting"), rekeningBtwAangifte: tekst(formData, "rekeningBtwAangifte"),
  });
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
