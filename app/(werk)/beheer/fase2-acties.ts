"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum } from "@/lib/datum";
import {
  beoordeelWeekstaat,
  nieuweTariefregel,
  beeindigTariefregel,
  verwijderTariefregel,
  nieuweFunctie,
  nieuwKmTarief,
  nieuweMedewerker,
  werkMedewerkerBij,
  nieuweKostprijs,
} from "@/lib/fase2";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") {
    throw new Error("Alleen de eigenaar mag dit.");
  }
  return sessie;
}

const tekst = (fd: FormData, n: string) => {
  const w = String(fd.get(n) ?? "").trim();
  return w === "" ? null : w;
};
const bedrag = (fd: FormData, n: string) => {
  const w = String(fd.get(n) ?? "").trim().replace(",", ".");
  const x = Number(w);
  return w !== "" && Number.isFinite(x) ? x : null;
};

// ------------------------------------------------------------ goedkeuren --

export async function beoordeel(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const besluit = String(formData.get("besluit") ?? "");
  const opmerking = tekst(formData, "opmerking");
  if (!id || (besluit !== "goedgekeurd" && besluit !== "afgekeurd")) return;
  if (besluit === "afgekeurd" && !opmerking) {
    throw new Error("Zeg er bij het terugsturen bij wat er niet klopt.");
  }
  await beoordeelWeekstaat(sessie, id, besluit, opmerking);
  revalidatePath("/goedkeuren");
  revalidatePath("/beheer");
  redirect("/goedkeuren");
}

// -------------------------------------------------------------- tarieven --

export async function tariefToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const b = bedrag(formData, "bedrag");
  const vanaf = String(formData.get("geldigVanaf") ?? "");
  const tot = tekst(formData, "geldigTot");
  if (b === null || b < 0) throw new Error("Vul een tarief in.");
  if (!isGeldigeDatum(vanaf)) throw new Error("Vul een ingangsdatum in.");
  if (tot && !isGeldigeDatum(tot)) throw new Error("Ongeldige einddatum.");

  // Het meest specifieke anker wint; de rest wordt genegeerd. Zo kan het
  // formulier één set keuzelijsten hebben in plaats van zes varianten.
  const onderdeelId = tekst(formData, "onderdeelId");
  const projectId = tekst(formData, "projectId");
  const klantId = tekst(formData, "klantId");
  const functieId = tekst(formData, "functieId");

  const invoer = onderdeelId
    ? { onderdeelId }
    : projectId
      ? { projectId, functieId }
      : klantId
        ? { klantId, functieId }
        : functieId
          ? { functieId }
          : null;
  if (!invoer) {
    throw new Error("Kies waar het tarief aan hangt: een functie, klant, project of onderdeel.");
  }

  await nieuweTariefregel(sessie, {
    ...invoer,
    bedrag: b,
    geldigVanaf: vanaf,
    geldigTot: tot,
    toelichting: tekst(formData, "toelichting"),
  });
  revalidatePath("/beheer/tarieven");
}

export async function tariefBeeindigen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const tot = String(formData.get("geldigTot") ?? "");
  if (!id || !isGeldigeDatum(tot)) throw new Error("Vul een einddatum in.");
  await beeindigTariefregel(sessie, id, tot);
  revalidatePath("/beheer/tarieven");
}

export async function tariefVerwijderen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  if (id) await verwijderTariefregel(sessie, id);
  revalidatePath("/beheer/tarieven");
}

export async function functieToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const naam = tekst(formData, "naam");
  if (!naam) throw new Error("Een functie heeft een naam nodig.");
  await nieuweFunctie(sessie, naam);
  revalidatePath("/beheer/tarieven");
}

export async function kmTariefToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const b = bedrag(formData, "bedrag");
  const vanaf = String(formData.get("geldigVanaf") ?? "");
  if (b === null || b < 0) throw new Error("Vul een bedrag per kilometer in.");
  if (!isGeldigeDatum(vanaf)) throw new Error("Vul een ingangsdatum in.");
  await nieuwKmTarief(sessie, b, vanaf, tekst(formData, "toelichting"));
  revalidatePath("/beheer/tarieven");
}

// ----------------------------------------------------------- medewerkers --

const RECHTEN = ["medewerker", "projectleider", "eigenaar"];

export async function medewerkerToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const naam = tekst(formData, "naam");
  const email = tekst(formData, "email");
  const rechten = String(formData.get("rechten") ?? "medewerker");
  if (!naam || !email) throw new Error("Naam en e-mailadres zijn nodig.");
  if (!RECHTEN.includes(rechten)) throw new Error("Onbekend rechtenniveau.");
  await nieuweMedewerker(sessie, {
    naam,
    email,
    functieId: tekst(formData, "functieId"),
    rechten,
    standplaats: tekst(formData, "standplaats"),
  });
  revalidatePath("/beheer/medewerkers");
}

export async function medewerkerBijwerken(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const naam = tekst(formData, "naam");
  const rechten = String(formData.get("rechten") ?? "medewerker");
  if (!id || !naam) throw new Error("Ontbrekende gegevens.");
  if (!RECHTEN.includes(rechten)) throw new Error("Onbekend rechtenniveau.");
  if (id === sessie.medewerkerId && rechten !== "eigenaar") {
    throw new Error("Je kunt je eigen eigenaarsrechten niet weghalen.");
  }
  await werkMedewerkerBij(sessie, id, {
    naam,
    functieId: tekst(formData, "functieId"),
    rechten,
    standplaats: tekst(formData, "standplaats"),
    actief: formData.get("actief") === "aan",
  });
  revalidatePath("/beheer/medewerkers");
  revalidatePath(`/beheer/medewerkers/${id}`);
}

export async function kostprijsToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("medewerkerId") ?? "");
  const b = bedrag(formData, "bedrag");
  const vanaf = String(formData.get("geldigVanaf") ?? "");
  if (!id) return;
  if (b === null || b < 0) throw new Error("Vul een kostprijs per uur in.");
  if (!isGeldigeDatum(vanaf)) throw new Error("Vul een ingangsdatum in.");
  await nieuweKostprijs(sessie, id, b, vanaf, tekst(formData, "toelichting"));
  revalidatePath(`/beheer/medewerkers/${id}`);
  revalidatePath("/beheer/medewerkers");
}
