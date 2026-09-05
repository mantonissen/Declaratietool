import { NextResponse } from "next/server";
import { huidigeSessie } from "@/lib/auth";
import { bedrijf } from "@/lib/facturatie";
import { loonstrook, dienstverbanden, cumulatief } from "@/lib/loon";
import { loonstrookPdf } from "@/lib/loonstrook-pdf";
import { alsGebruiker } from "@/lib/db";

/**
 * /api/loonstrook?run=<id>&medewerker=<id> — één loonstrook als PDF.
 * De eigenaar mag alles; een medewerker alleen zijn eigen strook.
 */
export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  const q = new URL(request.url).searchParams;
  const runId = q.get("run") ?? "", medewerkerId = q.get("medewerker") ?? sessie.medewerkerId;
  if (!runId) return new NextResponse("Geef een loonrun op.", { status: 400 });
  if (sessie.rechten !== "eigenaar" && medewerkerId !== sessie.medewerkerId) return new NextResponse("Geen toegang.", { status: 403 });

  const gevonden = await loonstrook(sessie, runId, medewerkerId);
  if (!gevonden) return new NextResponse("Loonstrook niet gevonden.", { status: 404 });
  const { strook } = gevonden;
  const [b, [inst], dvs] = await Promise.all([
    bedrijf(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select loonheffingennummer from instellingen`),
    sessie.rechten === "eigenaar" ? dienstverbanden(sessie) : Promise.resolve([]),
  ]);
  // Voor de medewerker zijn dienstverband en run afgeschermd; toon dan wat
  // de strook zelf weet.
  const dv = dvs.find((x) => x.id === strook.dienstverbandId) ?? {
    id: strook.dienstverbandId, medewerkerId, naam: strook.naam, inDienst: `${new Date().getFullYear()}-01-01`, uitDienst: null,
    brutoMaandloon: strook.bruto, urenPerWeek: 40, vakantiegeldPct: 8, pensioenWnPct: 0, pensioenWgPct: 0,
    loonheffingskorting: true, onbepaaldeTijd: true, dga: false, geboortedatum: null, bsn: null, iban: null, stroken: 0,
  };
  const jm = gevonden.run ?? { jaar: new Date().getFullYear(), maand: new Date().getMonth() + 1, status: "definitief" };
  const cum = await cumulatief(sessie, strook.dienstverbandId, jm.jaar, jm.maand, runId);
  const pdf = await loonstrookPdf({
    bedrijf: b, loonheffingennummer: (inst.loonheffingennummer as string) ?? null, strook, dienstverband: dv,
    jaar: jm.jaar, maand: jm.maand, concept: jm.status !== "definitief", cumulatief: cum,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="loonstrook-${jm.jaar}-${String(jm.maand).padStart(2, "0")}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
