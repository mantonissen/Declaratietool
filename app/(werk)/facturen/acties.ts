"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, leesMinuten } from "@/lib/datum";
import { markeerGefactureerd, boekCorrectie, nieuweTermijn, verwijderTermijn } from "@/lib/facturatie";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar factureert.");
  return sessie;
}

export async function factureer(formData: FormData) {
  const sessie = await eigenaarSessie();
  const projectId = String(formData.get("projectId") ?? "");
  const van = String(formData.get("van") ?? "");
  const tot = String(formData.get("tot") ?? "");
  const referentie = String(formData.get("referentie") ?? "").trim();
  const termijnIds = formData.getAll("termijn").map(String).filter(Boolean);
  const metReiskosten = formData.get("reiskosten") !== "uit";

  if (!projectId || !isGeldigeDatum(van) || !isGeldigeDatum(tot) || van > tot) {
    throw new Error("Kies een project en een geldige periode.");
  }
  if (!referentie || !/^[\w./-]{1,40}$/.test(referentie)) {
    throw new Error("Vul een factuurnummer in (letters, cijfers, - . /).");
  }

  const n = await markeerGefactureerd(sessie, projectId, van, tot, referentie, termijnIds, metReiskosten);
  if (n.uren === 0 && n.ritten === 0 && n.termijnen === 0) {
    throw new Error("Er stond niets te factureren in deze selectie.");
  }
  revalidatePath("/facturen");
  revalidatePath("/inzicht");
  redirect(`/facturen/${encodeURIComponent(referentie)}`);
}

export async function termijnToevoegen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const projectId = String(formData.get("projectId") ?? "");
  const omschrijving = String(formData.get("omschrijving") ?? "").trim();
  const bedrag = Number(String(formData.get("bedrag") ?? "").replace(",", "."));
  const gepland = String(formData.get("geplandOp") ?? "");
  if (!projectId || !omschrijving) throw new Error("Een termijn heeft een omschrijving nodig.");
  if (!Number.isFinite(bedrag) || bedrag < 0) throw new Error("Vul een bedrag in.");
  await nieuweTermijn(sessie, projectId, {
    omschrijving,
    bedrag,
    geplandOp: isGeldigeDatum(gepland) ? gepland : null,
  });
  revalidatePath("/facturen");
  revalidatePath(`/beheer/project/${projectId}`);
  const terug = String(formData.get("terug") ?? "");
  if (terug.startsWith("/")) redirect(terug);
}

export async function termijnVerwijderen(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (id) await verwijderTermijn(sessie, id);
  revalidatePath("/facturen");
  revalidatePath(`/beheer/project/${projectId}`);
}

export async function corrigeer(formData: FormData) {
  const sessie = await eigenaarSessie();
  const id = String(formData.get("id") ?? "");
  const referentie = String(formData.get("referentie") ?? "");
  const toelichting = String(formData.get("toelichting") ?? "").trim();
  const nieuw = String(formData.get("nieuweTijd") ?? "").trim();

  if (!id) return;
  if (!toelichting) throw new Error("Zeg erbij waarom je corrigeert; dat komt op de specificatie.");
  const minuten = nieuw === "" ? 0 : leesMinuten(nieuw);
  if (minuten === null) throw new Error("Ongeldige tijd. Laat leeg om de regel helemaal te crediteren.");

  await boekCorrectie(sessie, id, minuten, toelichting);
  revalidatePath("/facturen");
  revalidatePath(`/facturen/${encodeURIComponent(referentie)}`);
  revalidatePath("/inzicht");
}
