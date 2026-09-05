import { NextResponse } from "next/server";
import { huidigeSessie } from "@/lib/auth";
import { bedrijf } from "@/lib/facturatie";
import { jaarrekening, boekjaar } from "@/lib/jaarwerk";
import { boekhoudInstellingen } from "@/lib/boekhouding";
import { jaarrekeningPdf } from "@/lib/jaarrekening-pdf";
import { alsGebruiker } from "@/lib/db";

/** /api/jaarrekening?jaar=2026 — de jaarrekening als PDF (eigenaar). */
export async function GET(request: Request) {
  const sessie = await huidigeSessie();
  if (!sessie) return NextResponse.redirect(new URL("/login", request.url));
  if (sessie.rechten !== "eigenaar") return new NextResponse("Geen toegang.", { status: 403 });
  const jaar = Number(new URL(request.url).searchParams.get("jaar"));
  if (!Number.isInteger(jaar) || jaar < 2000 || jaar > 2100) return new NextResponse("Geef een jaar op.", { status: 400 });

  const [b, jr, bj, inst, [rv]] = await Promise.all([
    bedrijf(sessie), jaarrekening(sessie, jaar), boekjaar(sessie, jaar), boekhoudInstellingen(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`select rechtsvorm from instellingen`),
  ]);
  void inst;
  const pdf = await jaarrekeningPdf({ bedrijf: b, jr, bj, rechtsvorm: String(rv.rechtsvorm), bestuurder: sessie.naam });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="jaarrekening-${jaar}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
