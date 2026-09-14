"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { isGeldigeDatum } from "@/lib/datum";
import {
  nieuweProspect, werkProspectBij, zetFase, winProspect, verliesProspect, verwijderProspect,
  nieuwOnderwerp, werkOnderwerpBij, koppelOnderwerp, ontkoppelOnderwerp,
  nieuwGesprek, werkGesprekBij, verwijderGesprek, FASEN, ONDERWERP_STATUSSEN,
  type Fase, type OnderwerpStatus, type GesprekSoort, type ProspectInvoer,
} from "@/lib/verkoop";

async function verkoopSessie() {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) throw new Error("Verkoop is voor projectleiders en de eigenaar.");
  return sessie;
}
const tekst = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim(); return w === "" ? null : w; };
const getal = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? "").trim().replace(",", "."); const x = Number(w); return w !== "" && Number.isFinite(x) ? x : null; };
const datum = (fd: FormData, n: string) => { const w = String(fd.get(n) ?? ""); return isGeldigeDatum(w) ? w : null; };
const ververs = (id?: string) => {
  for (const p of ["/verkoop", "/verkoop/onderwerpen", "/beheer"]) revalidatePath(p);
  if (id) revalidatePath(`/verkoop/${id}`);
};

// ------------------------------------------------------------- prospect ---

function prospectUit(fd: FormData): ProspectInvoer {
  const naam = tekst(fd, "naam");
  if (!naam) throw new Error("Een prospect heeft een naam nodig.");
  const fase = String(fd.get("fase") ?? "lead") as Fase;
  if (!FASEN.includes(fase)) throw new Error("Onbekende fase.");
  const kans = getal(fd, "kans");
  if (kans !== null && (kans < 0 || kans > 100)) throw new Error("De kans is een percentage van 0 tot 100.");
  return {
    naam, contactpersoon: tekst(fd, "contactpersoon"), email: tekst(fd, "email"), telefoon: tekst(fd, "telefoon"),
    plaats: tekst(fd, "plaats"), bron: tekst(fd, "bron"), fase, waarde: getal(fd, "waarde"), kans,
    verwachtOp: datum(fd, "verwachtOp"), volgendeActie: tekst(fd, "volgendeActie"), volgendeActieOp: datum(fd, "volgendeActieOp"),
    eigenaarId: tekst(fd, "eigenaarId"), notities: tekst(fd, "notities"),
  };
}

export async function prospectErbij(formData: FormData) {
  const sessie = await verkoopSessie();
  const id = await nieuweProspect(sessie, prospectUit(formData));
  ververs(id);
  redirect(`/verkoop/${id}`);
}

export async function prospectOpslaan(formData: FormData) {
  const sessie = await verkoopSessie();
  const id = String(formData.get("id") ?? "");
  await werkProspectBij(sessie, id, prospectUit(formData));
  ververs(id);
}

export async function faseZetten(formData: FormData) {
  const sessie = await verkoopSessie();
  const id = String(formData.get("id") ?? "");
  const fase = String(formData.get("fase") ?? "") as Fase;
  if (!FASEN.includes(fase)) throw new Error("Onbekende fase.");
  if (fase === "gewonnen") { await winProspect(sessie, id, tekst(formData, "klantId")); }
  else if (fase === "verloren") { await verliesProspect(sessie, id, tekst(formData, "reden")); }
  else { await zetFase(sessie, id, fase); }
  ververs(id);
}

export async function prospectWeg(formData: FormData) {
  const sessie = await verkoopSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar verwijdert een prospect; zet hem anders op verloren.");
  await verwijderProspect(sessie, String(formData.get("id") ?? ""));
  ververs();
  redirect("/verkoop");
}

// ----------------------------------------------------------- onderwerpen ---

export async function onderwerpErbij(formData: FormData) {
  const sessie = await verkoopSessie();
  const naam = tekst(formData, "naam");
  if (!naam) throw new Error("Een onderwerp heeft een naam nodig.");
  await nieuwOnderwerp(sessie, naam, tekst(formData, "omschrijving"));
  ververs();
}

export async function onderwerpOpslaan(formData: FormData) {
  const sessie = await verkoopSessie();
  const naam = tekst(formData, "naam");
  if (!naam) throw new Error("Een onderwerp heeft een naam nodig.");
  await werkOnderwerpBij(sessie, String(formData.get("id") ?? ""), naam, tekst(formData, "omschrijving"), formData.get("actief") === "aan");
  ververs();
}

export async function onderwerpKoppelen(formData: FormData) {
  const sessie = await verkoopSessie();
  const prospectId = String(formData.get("prospectId") ?? "");
  const onderwerpId = tekst(formData, "onderwerpId");
  const status = String(formData.get("status") ?? "interesse") as OnderwerpStatus;
  if (!onderwerpId) throw new Error("Kies een onderwerp.");
  if (!ONDERWERP_STATUSSEN.includes(status)) throw new Error("Onbekende status.");
  await koppelOnderwerp(sessie, prospectId, onderwerpId, status, tekst(formData, "notitie"));
  ververs(prospectId);
}

export async function onderwerpOntkoppelen(formData: FormData) {
  const sessie = await verkoopSessie();
  const prospectId = String(formData.get("prospectId") ?? "");
  await ontkoppelOnderwerp(sessie, prospectId, String(formData.get("onderwerpId") ?? ""));
  ververs(prospectId);
}

// -------------------------------------------------------------- gesprek ---

const SOORTEN: GesprekSoort[] = ["telefoon", "bezoek", "video", "overig"];

function gesprekVelden(fd: FormData) {
  const titel = tekst(fd, "titel");
  if (!titel) throw new Error("Geef het gesprek een titel.");
  const soort = String(fd.get("soort") ?? "telefoon") as GesprekSoort;
  if (!SOORTEN.includes(soort)) throw new Error("Onbekende soort gesprek.");
  const ruw = String(fd.get("datum") ?? "").trim();
  const dt = ruw && !Number.isNaN(Date.parse(ruw)) ? new Date(ruw).toISOString() : new Date().toISOString();
  const duur = getal(fd, "duurMinuten");
  return {
    titel, soort, datum: dt, duurMinuten: duur === null ? null : Math.max(0, Math.round(duur)),
    taal: tekst(fd, "taal") ?? "nl-NL", transcript: tekst(fd, "transcript"), samenvatting: tekst(fd, "samenvatting"),
    afspraken: tekst(fd, "afspraken"),
  };
}

export async function gesprekOpslaan(formData: FormData) {
  const sessie = await vereisteSessie();
  const prospectId = tekst(formData, "prospectId"), klantId = tekst(formData, "klantId");
  if (!prospectId && !klantId) throw new Error("Kies een prospect of een klant.");
  if (prospectId && !magBeheren(sessie.rechten)) throw new Error("Prospects zijn voor projectleiders en de eigenaar.");
  const id = await nieuwGesprek(sessie, { ...gesprekVelden(formData), prospectId, klantId, live: formData.get("live") === "ja" });
  ververs(prospectId ?? undefined);
  if (klantId) revalidatePath(`/beheer/klant/${klantId}`);
  redirect(`/verkoop/gesprek/${id}`);
}

export async function gesprekBijwerken(formData: FormData) {
  const sessie = await vereisteSessie();
  const id = String(formData.get("id") ?? "");
  await werkGesprekBij(sessie, id, gesprekVelden(formData));
  revalidatePath(`/verkoop/gesprek/${id}`); ververs(tekst(formData, "prospectId") ?? undefined);
}

export async function gesprekWeg(formData: FormData) {
  const sessie = await vereisteSessie();
  const terug = tekst(formData, "terug");
  await verwijderGesprek(sessie, String(formData.get("id") ?? ""));
  ververs();
  redirect(terug && terug.startsWith("/") ? terug : "/verkoop");
}
