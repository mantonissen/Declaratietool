"use server";

import { revalidatePath } from "next/cache";
import { vereisteSessie, magBeheren } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";

async function beheerSessie() {
  const sessie = await vereisteSessie();
  if (!magBeheren(sessie.rechten)) {
    throw new Error("Je hebt geen rechten om dit te beheren.");
  }
  return sessie;
}

function tekst(fd: FormData, naam: string): string | null {
  const w = String(fd.get(naam) ?? "").trim();
  return w === "" ? null : w;
}

function getal(fd: FormData, naam: string): number | null {
  const ruw = String(fd.get(naam) ?? "").trim().replace(",", ".");
  if (ruw === "") return null;
  const n = Number(ruw);
  return Number.isFinite(n) ? n : null;
}

export async function nieuweKlant(formData: FormData) {
  const sessie = await beheerSessie();
  const naam = tekst(formData, "naam");
  if (!naam) throw new Error("Een klant heeft een naam nodig.");

  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into klant (naam, code, plaats, adres, postcode, afstand_km)
    values (${naam}, ${tekst(formData, "code")}, ${tekst(formData, "plaats")},
            ${tekst(formData, "adres")}, ${tekst(formData, "postcode")},
            ${getal(formData, "afstandKm")})
  `);
  revalidatePath("/beheer");
}

export async function werkKlantBij(formData: FormData) {
  const sessie = await beheerSessie();
  const id = String(formData.get("id") ?? "");
  const naam = tekst(formData, "naam");
  if (!id || !naam) throw new Error("Ontbrekende gegevens.");

  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update klant set
      naam = ${naam},
      code = ${tekst(formData, "code")},
      plaats = ${tekst(formData, "plaats")},
      adres = ${tekst(formData, "adres")},
      postcode = ${tekst(formData, "postcode")},
      afstand_km = ${getal(formData, "afstandKm")},
      actief = ${formData.get("actief") === "aan"}
    where id = ${id}
  `);
  revalidatePath("/beheer");
  revalidatePath(`/beheer/klant/${id}`);
}

export async function nieuwProject(formData: FormData) {
  const sessie = await beheerSessie();
  const klantId = String(formData.get("klantId") ?? "");
  const naam = tekst(formData, "naam");
  if (!klantId || !naam) throw new Error("Een project heeft een klant en een naam nodig.");

  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into project (klant_id, naam, code, budget_uren, budget_bedrag)
    values (${klantId}, ${naam}, ${tekst(formData, "code")},
            ${getal(formData, "budgetUren")}, ${getal(formData, "budgetBedrag")})
  `);
  revalidatePath(`/beheer/klant/${klantId}`);
}

export async function nieuwOnderdeel(formData: FormData) {
  const sessie = await beheerSessie();
  const projectId = String(formData.get("projectId") ?? "");
  const naam = tekst(formData, "naam");
  if (!projectId || !naam) throw new Error("Een onderdeel heeft een project en een naam nodig.");

  await alsGebruiker(sessie.authUserId, (tx) => tx`
    insert into projectonderdeel (project_id, naam, declarabel, budget_uren, sortering)
    values (${projectId}, ${naam}, ${formData.get("declarabel") === "aan"},
            ${getal(formData, "budgetUren")},
            coalesce((select max(sortering) + 1 from projectonderdeel
                      where project_id = ${projectId}), 1))
  `);
  revalidatePath(`/beheer/project/${projectId}`);
}

export async function wisselOnderdeel(formData: FormData) {
  const sessie = await beheerSessie();
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!id) return;

  await alsGebruiker(sessie.authUserId, (tx) => tx`
    update projectonderdeel set actief = not actief where id = ${id}
  `);
  revalidatePath(`/beheer/project/${projectId}`);
}
