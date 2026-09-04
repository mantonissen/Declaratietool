"use server";

import { revalidatePath } from "next/cache";
import { vereisteSessie } from "@/lib/auth";
import { zetUren, voegUurToe, verwijderUur } from "@/lib/data";
import { isGeldigeDatum, leesMinuten } from "@/lib/datum";

/**
 * Het weekraster stuurt alleen de cellen die veranderd zijn. Zonder dat zou
 * elke opslag zeven dagen maal het aantal regels aan schrijfacties kosten.
 */
export async function bewaarRaster(formData: FormData) {
  const sessie = await vereisteSessie();
  const ruw = String(formData.get("wijzigingen") ?? "[]");

  let wijzigingen: unknown;
  try {
    wijzigingen = JSON.parse(ruw);
  } catch {
    throw new Error("Kon de wijzigingen niet lezen.");
  }
  if (!Array.isArray(wijzigingen)) return;

  for (const w of wijzigingen) {
    if (typeof w !== "object" || w === null) continue;
    const { onderdeelId, datum, minuten } = w as Record<string, unknown>;
    if (typeof onderdeelId !== "string" || !isGeldigeDatum(String(datum))) continue;
    const m = Number(minuten);
    if (!Number.isFinite(m) || m < 0 || m % 15 !== 0) continue;
    await zetUren(sessie, { onderdeelId, datum: String(datum), minuten: m });
  }

  revalidatePath("/uren");
  revalidatePath("/week");
}

export async function voegRegelToe(formData: FormData) {
  const sessie = await vereisteSessie();

  const onderdeelId = String(formData.get("onderdeelId") ?? "");
  const datum = String(formData.get("datum") ?? "");
  const tijd = String(formData.get("tijd") ?? "");
  const omschrijving = String(formData.get("omschrijving") ?? "").trim();

  if (!onderdeelId) throw new Error("Kies een projectonderdeel.");
  if (!isGeldigeDatum(datum)) throw new Error("Ongeldige datum.");

  const minuten = leesMinuten(tijd);
  if (minuten === null || minuten <= 0) {
    throw new Error(
      "Vul een tijd in, bijvoorbeeld 1:30, 1,5 of 90m. Er wordt afgerond op kwartieren.",
    );
  }

  await voegUurToe(sessie, {
    onderdeelId,
    datum,
    minuten,
    omschrijving: omschrijving || null,
  });

  revalidatePath("/uren");
  revalidatePath("/week");
}

export async function verwijderRegel(formData: FormData) {
  const sessie = await vereisteSessie();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await verwijderUur(sessie, id);
  revalidatePath("/uren");
  revalidatePath("/week");
}
