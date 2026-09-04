import { NextResponse } from "next/server";
import { alsSysteem } from "@/lib/db";

/**
 * Dagelijkse verwerking van abonnementen. Vercel Cron roept dit aan (zie
 * vercel.json) met `Authorization: Bearer <CRON_SECRET>`; elke andere
 * planner kan hetzelfde doen. Zonder CRON_SECRET in de omgeving is de route
 * dicht — beter niets dan een onbeveiligde knop.
 *
 * De functie in de database is idempotent, dus dubbel draaien kan geen kwaad.
 */
export async function GET(request: Request) {
  const geheim = process.env.CRON_SECRET;
  if (!geheim) {
    return NextResponse.json({ fout: "CRON_SECRET niet ingesteld" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${geheim}`) {
    return NextResponse.json({ fout: "Geen toegang" }, { status: 401 });
  }

  const rijen = await alsSysteem((tx) => tx`select * from verwerk_periodieke_facturen()`);
  return NextResponse.json({
    verwerkt: rijen.length,
    facturen: rijen.map((r) => ({
      project: r.uit_project_id,
      periode: r.uit_periode_start,
      referentie: r.uit_referentie ?? null,
    })),
  });
}
