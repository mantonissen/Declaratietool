"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { isGeldigeDatum, leesMinuten } from "@/lib/datum";
import { markeerGefactureerd, boekCorrectie } from "@/lib/facturatie";

async function eigenaarSessie() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") throw new Error("Alleen de eigenaar factureert.");
  return sessie;
}

export async function factureer(formData: FormData) {
  const sessie = await eigenaarSessie();
  const klantId = String(formData.get("klantId") ?? "");
  const van = String(formData.get("van") ?? "");
  const tot = String(formData.get("tot") ?? "");
  const referentie = String(formData.get("referentie") ?? "").trim();

  if (!klantId || !isGeldigeDatum(van) || !isGeldigeDatum(tot) || van > tot) {
    throw new Error("Kies een klant en een geldige periode.");
  }
  if (!referentie || !/^[\w./-]{1,40}$/.test(referentie)) {
    throw new Error("Vul een factuurnummer in (letters, cijfers, - . /).");
  }

  const n = await markeerGefactureerd(sessie, klantId, van, tot, referentie);
  if (n.uren === 0 && n.ritten === 0) {
    throw new Error("Er stond niets goedgekeurds in deze periode.");
  }
  revalidatePath("/facturen");
  revalidatePath("/inzicht");
  redirect(`/facturen/${encodeURIComponent(referentie)}`);
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
