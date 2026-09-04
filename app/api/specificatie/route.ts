import { NextResponse } from "next/server";
import { huidigeSessie, zietBedragen } from "@/lib/auth";
import { specificatie } from "@/lib/facturatie";
import { specificatiePdf } from "@/lib/pdf";
import { isGeldigeDatum } from "@/lib/datum";

/**
 * Urenspecificatie als PDF (keuze E3a).
 *
 *   /api/specificatie?factuur=2026-014
 *   /api/specificatie?project=<id>&van=2026-08-01&tot=2026-08-31
 *
 * Met `detail=vol` staan omschrijvingen en tarieven er altijd op, ongeacht
 * de instelling van de klant — voor intern gebruik.
 */
export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  if (!zietBedragen(sessie.rechten)) {
    return new NextResponse("Geen toegang.", { status: 403 });
  }

  const q = new URL(request.url).searchParams;
  const factuur = q.get("factuur");
  const projectId = q.get("project");
  const van = q.get("van");
  const tot = q.get("tot");
  const vol = q.get("detail") === "vol";

  let sel;
  if (factuur) sel = { factuur };
  else if (projectId && isGeldigeDatum(van) && isGeldigeDatum(tot) && van <= tot)
    sel = { projectId, van, tot };
  else
    return new NextResponse("Geef een factuur, of een project met een periode op.", { status: 400 });

  const s = await specificatie(sessie, sel);
  if (!s.klant || !s.project) return new NextResponse("Niets gevonden.", { status: 404 });

  const alleDatums = [...s.uren.map((u) => u.datum), ...s.ritten.map((r) => r.datum)].sort();
  const periodeVan = "factuur" in sel ? (alleDatums[0] ?? "") : sel.van;
  const periodeTot = "factuur" in sel ? (alleDatums[alleDatums.length - 1] ?? "") : sel.tot;

  const pdf = await specificatiePdf({
    bedrijf: s.bedrijf,
    klant: s.klant,
    project: s.project,
    uren: s.uren,
    ritten: s.ritten,
    termijnen: s.termijnen,
    van: periodeVan,
    tot: periodeTot,
    referentie: factuur,
    metOmschrijving: vol || s.klant.metOmschrijving,
    metTarieven: vol || s.klant.metTarieven,
  });

  const naam = factuur
    ? `specificatie-${factuur}.pdf`
    : `specificatie-${(s.project.code ?? s.project.naam).replace(/[^\w-]+/g, "_")}-${periodeVan}-${periodeTot}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${naam}"`,
      "cache-control": "no-store",
    },
  });
}
