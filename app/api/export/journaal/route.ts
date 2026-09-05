import { NextResponse } from "next/server";
import { huidigeSessie } from "@/lib/auth";
import { boekingen } from "@/lib/boekhouding";
import { isGeldigeDatum } from "@/lib/datum";

/**
 * Het journaal als CSV, per boekingsregel één rij — voor de accountant of
 * om zelf verder te rekenen. Puntkomma's en een BOM, zodat een Nederlandse
 * Excel hem goed opent.
 *
 *   /api/export/journaal?van=2026-01-01&tot=2026-12-31
 */
const veld = (w: unknown) => {
  if (w === null || w === undefined) return "";
  const t = String(w);
  return /["\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const bedrag = (x: number) => (x ? x.toFixed(2).replace(".", ",") : "");

export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  if (sessie.rechten !== "eigenaar") return new NextResponse("Geen toegang.", { status: 403 });

  const q = new URL(request.url).searchParams;
  const van = q.get("van"), tot = q.get("tot");
  if (!isGeldigeDatum(van) || !isGeldigeDatum(tot) || van > tot) {
    return new NextResponse("Geef een geldige periode op.", { status: 400 });
  }
  const lijst = await boekingen(sessie, van, tot);
  const kop = ["Nr", "Datum", "Soort", "Boeking", "Factuur", "Grootboek", "Rekening", "Debet", "Credit", "Toelichting"];
  const rijen: unknown[][] = [];
  for (const b of [...lijst].reverse()) {
    for (const r of b.regels) {
      rijen.push([b.volgnummer, b.datum, b.soort, b.omschrijving, b.factuurnummer, r.nummer, r.naam, bedrag(r.debet), bedrag(r.credit), r.omschrijving]);
    }
  }
  const csv = "﻿" + [kop, ...rijen].map((r) => r.map(veld).join(";")).join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="journaal-${van}-tot-${tot}.csv"`,
      "cache-control": "no-store",
    },
  });
}
