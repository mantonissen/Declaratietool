"use server";

import { revalidatePath } from "next/cache";
import { vereisteSessie } from "@/lib/auth";
import { voegRitToe, verwijderRit } from "@/lib/data";
import { isGeldigeDatum } from "@/lib/datum";

const DOELEN = ["klantbezoek", "locatiebezoek", "overleg", "opleiding", "overig"];

export async function bewaarRit(formData: FormData) {
  const sessie = await vereisteSessie();

  const klantId = String(formData.get("klantId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const datum = String(formData.get("datum") ?? "");
  const doel = String(formData.get("doel") ?? "klantbezoek");
  const afstand = Number(String(formData.get("afstandKm") ?? "").replace(",", "."));
  const retour = formData.get("retour") === "aan";
  const omschrijving = String(formData.get("omschrijving") ?? "").trim();

  if (!klantId) throw new Error("Kies een klant.");
  if (!isGeldigeDatum(datum)) throw new Error("Ongeldige datum.");
  if (!DOELEN.includes(doel)) throw new Error("Onbekend doel.");
  if (!Number.isFinite(afstand) || afstand <= 0) {
    throw new Error("Vul een afstand in kilometers in.");
  }

  await voegRitToe(sessie, {
    klantId,
    projectId: projectId || null,
    datum,
    doel,
    afstandKm: afstand,
    retour,
    omschrijving: omschrijving || null,
  });

  revalidatePath("/ritten");
  revalidatePath("/week");
}

export async function schrapRit(formData: FormData) {
  const sessie = await vereisteSessie();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await verwijderRit(sessie, id);
  revalidatePath("/ritten");
  revalidatePath("/week");
}
