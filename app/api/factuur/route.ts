import { NextResponse } from "next/server";
import { huidigeSessie, zietBedragen } from "@/lib/auth";
import { specificatie } from "@/lib/facturatie";
import { factuurPdf } from "@/lib/pdf";

/**
 * Factuur als PDF, met de urenspecificatie als bijlage erachter.
 *
 *   /api/factuur?id=<factuur-id>
 *   /api/factuur?id=<factuur-id>&bijlage=nee     alleen de factuur
 */
export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  if (!zietBedragen(sessie.rechten)) return new NextResponse("Geen toegang.", { status: 403 });

  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (!id) return new NextResponse("Geef een factuur op.", { status: 400 });

  const s = await specificatie(sessie, { factuurId: id });
  if (!s.factuur || !s.klant) return new NextResponse("Factuur niet gevonden.", { status: 404 });

  const datums = [...s.uren.map((u) => u.datum), ...s.ritten.map((r) => r.datum)].sort();
  const bijlage =
    q.get("bijlage") === "nee"
      ? null
      : {
          bedrijf: s.bedrijf, klant: s.klant, project: s.project,
          uren: s.uren, ritten: s.ritten, termijnen: s.termijnen,
          van: s.factuur.periodeVan ?? datums[0] ?? "",
          tot: s.factuur.periodeTot ?? datums[datums.length - 1] ?? "",
          referentie: s.factuur.nummer,
          metOmschrijving: s.klant.metOmschrijving,
          metTarieven: s.klant.metTarieven,
        };

  const pdf = await factuurPdf(
    { bedrijf: s.bedrijf, klant: s.klant, project: s.project, factuur: s.factuur, regels: s.regels },
    bijlage,
  );

  const naam = `factuur-${s.factuur.nummer ?? "concept"}-${s.klant.naam.replace(/[^\w-]+/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${q.get("open") === "ja" ? "inline" : "attachment"}; filename="${naam}"`,
      "cache-control": "no-store",
    },
  });
}
