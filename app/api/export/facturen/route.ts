import { NextResponse } from "next/server";
import { huidigeSessie } from "@/lib/auth";
import { journaal, markeerGeexporteerd } from "@/lib/facturatie";
import { isGeldigeDatum } from "@/lib/datum";

/**
 * Journaalexport voor de boekhouding: per factuurregel één rij, met
 * grootboekrekening en btw. Puntkomma's en een BOM, zodat een Nederlandse
 * Excel hem goed opent; dezelfde kolommen zijn wat een API-koppeling straks
 * doorstuurt.
 *
 *   /api/export/facturen?van=2026-09-01&tot=2026-09-30
 *   &alleen_nieuw=ja      alleen facturen die nog niet geëxporteerd zijn
 *   &markeer=ja           markeer de geëxporteerde facturen (eigenaar)
 */
const SCHEIDING = ";";
const veld = (w: unknown) => {
  if (w === null || w === undefined) return "";
  const t = String(w);
  return /["\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const bedrag = (n: number) => n.toFixed(2).replace(".", ",");

export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  if (sessie.rechten !== "eigenaar") return new NextResponse("Geen toegang.", { status: 403 });

  const q = new URL(request.url).searchParams;
  const van = q.get("van"), tot = q.get("tot");
  if (!isGeldigeDatum(van) || !isGeldigeDatum(tot) || van > tot) {
    return new NextResponse("Geef een geldige periode op.", { status: 400 });
  }
  const alleenNieuw = q.get("alleen_nieuw") === "ja";
  const markeer = q.get("markeer") === "ja";

  const regels = await journaal(sessie, van, tot, alleenNieuw);

  const kop = [
    "Factuurnummer", "Factuurdatum", "Vervaldatum", "Status", "Klant", "Klantcode", "Klant e-mail",
    "Referentie klant", "Projectcode", "Project", "Regel", "Omschrijving", "Aantal", "Eenheid",
    "Prijs", "Bedrag excl", "Btw-code", "Btw %", "Btw-bedrag", "Bedrag incl",
    "Grootboek", "Grootboek naam", "Bron",
  ];
  const rijen = regels.map((r) => [
    r.nummer, r.datum, r.vervaldatum, r.status, r.klant, r.klantcode, r.klantEmail,
    r.referentieKlant, r.projectcode, r.project, r.volgorde, r.omschrijving,
    String(r.aantal).replace(".", ","), r.eenheid, bedrag(r.prijs), bedrag(r.bedrag),
    r.btwCode, String(r.btwPercentage).replace(".", ","), bedrag(r.btwBedrag), bedrag(r.bedragIncl),
    r.grootboekNummer, r.grootboekNaam, r.bron,
  ]);

  if (markeer && regels.length) {
    const kenmerk = `export-${new Date().toISOString().slice(0, 10)}`;
    await markeerGeexporteerd(sessie, [...new Set(regels.map((r) => r.factuurId))], kenmerk);
  }

  const csv = "﻿" + [kop, ...rijen].map((r) => r.map(veld).join(SCHEIDING)).join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="facturen-journaal-${van}-tot-${tot}.csv"`,
      "cache-control": "no-store",
    },
  });
}
