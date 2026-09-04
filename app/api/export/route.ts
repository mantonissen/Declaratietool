import { NextResponse } from "next/server";
import { huidigeSessie } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { isGeldigeDatum, minutenAlsUren } from "@/lib/datum";

/**
 * Excel in een Nederlandse Windows-installatie splitst op puntkomma, niet op
 * komma, en verwacht een BOM om UTF-8 te herkennen. Zonder die twee opent het
 * bestand als één kolom met kapotte accenten.
 */
const SCHEIDING = ";";

function veld(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "";
  const tekst = String(waarde);
  if (/["\n\r;]/.test(tekst)) return `"${tekst.replace(/"/g, '""')}"`;
  return tekst;
}

function naarCsv(kop: string[], rijen: unknown[][]): string {
  const regels = [kop, ...rijen].map((r) => r.map(veld).join(SCHEIDING));
  return "﻿" + regels.join("\r\n") + "\r\n";
}

function bedrag(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "";
  return Number(waarde).toFixed(2).replace(".", ",");
}

export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const van = url.searchParams.get("van");
  const tot = url.searchParams.get("tot");
  const soort = url.searchParams.get("soort") === "ritten" ? "ritten" : "uren";

  if (!isGeldigeDatum(van) || !isGeldigeDatum(tot)) {
    return new NextResponse("Geef een geldige periode op (van en tot).", {
      status: 400,
    });
  }
  if (van > tot) {
    return new NextResponse("De begindatum ligt na de einddatum.", { status: 400 });
  }

  // De views zijn afgeschermd, dus een medewerker krijgt hier alleen zijn
  // eigen regels en lege bedragen. Er is geen extra filter nodig.
  const rijen = await alsGebruiker(sessie.authUserId, (tx) =>
    soort === "uren"
      ? tx`
          select datum, medewerker, klant, project, onderdeel, omschrijving,
                 minuten, declarabel, status,
                 verkooptarief::float8 as verkooptarief,
                 omzet::float8 as omzet
          from v_urenregel
          where datum between ${van} and ${tot}
          order by datum, medewerker, klant, project
        `
      : tx`
          select datum, medewerker, klant, doel, omschrijving,
                 afstand_km::float8 as afstand_km, retour,
                 totaal_km::float8 as totaal_km, declarabel, status,
                 km_tarief::float8 as km_tarief,
                 km_bedrag::float8 as km_bedrag
          from v_rit
          where datum between ${van} and ${tot}
          order by datum, medewerker, klant
        `,
  );

  const csv =
    soort === "uren"
      ? naarCsv(
          [
            "Datum", "Medewerker", "Klant", "Project", "Onderdeel",
            "Omschrijving", "Uren", "Declarabel", "Status", "Tarief", "Omzet",
          ],
          rijen.map((r) => [
            r.datum,
            r.medewerker,
            r.klant,
            r.project,
            r.onderdeel,
            r.omschrijving,
            minutenAlsUren(Number(r.minuten)),
            r.declarabel ? "ja" : "nee",
            r.status,
            bedrag(r.verkooptarief),
            bedrag(r.omzet),
          ]),
        )
      : naarCsv(
          [
            "Datum", "Medewerker", "Klant", "Doel", "Omschrijving",
            "Enkele reis km", "Retour", "Totaal km", "Declarabel", "Status",
            "Tarief per km", "Bedrag",
          ],
          rijen.map((r) => [
            r.datum,
            r.medewerker,
            r.klant,
            r.doel,
            r.omschrijving,
            String(r.afstand_km).replace(".", ","),
            r.retour ? "ja" : "nee",
            String(r.totaal_km).replace(".", ","),
            r.declarabel ? "ja" : "nee",
            r.status,
            r.km_tarief === null ? "" : String(r.km_tarief).replace(".", ","),
            bedrag(r.km_bedrag),
          ]),
        );

  const naam = `${soort}-${van}-tot-${tot}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${naam}"`,
      "cache-control": "no-store",
    },
  });
}
