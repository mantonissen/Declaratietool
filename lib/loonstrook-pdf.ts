import "server-only";
import { A4, M, INK, GRIJS, LIJN, Tabel, tekenVoet, nieuwDoc } from "./pdf";
import type { Bedrijf } from "./facturatie";
import type { Loonstrook, Dienstverband } from "./loon";
import { MAANDEN } from "./loon";
import { euro, korteDatum } from "./datum";

export type LoonstrookInvoer = {
  bedrijf: Bedrijf; loonheffingennummer: string | null;
  strook: Loonstrook; dienstverband: Dienstverband; jaar: number; maand: number; concept: boolean;
  cumulatief: { bruto: number; vakantiegeld: number; loonLh: number; loonheffing: number; netto: number; vakantiegeldSaldo: number };
};

export async function loonstrookPdf(inv: LoonstrookInvoer): Promise<Buffer> {
  const { strook: s, dienstverband: dv } = inv;
  const periode = `${MAANDEN[inv.maand - 1]} ${inv.jaar}`;
  const { doc, klaar } = nieuwDoc(`Loonstrook ${periode} ${s.naam}`, inv.bedrijf.naam);
  const breed = A4.b - 2 * M;

  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(inv.concept ? "Loonstrook (concept)" : "Loonstrook", M, M);
  doc.font("Helvetica").fontSize(9).fillColor(GRIJS).text(periode, M, M + 22);
  const rechts = [inv.bedrijf.naam, inv.bedrijf.adres, [inv.bedrijf.postcode, inv.bedrijf.plaats].filter(Boolean).join(" "),
    inv.loonheffingennummer ? `Loonheffingennummer ${inv.loonheffingennummer}` : null].filter(Boolean) as string[];
  doc.fontSize(8);
  rechts.forEach((r, i) => doc.text(r, M + breed / 2, M + i * 11, { width: breed / 2, align: "right" }));
  doc.moveTo(M, M + 50).lineTo(M + breed, M + 50).strokeColor(LIJN).lineWidth(0.6).stroke();

  let y = M + 62;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(s.naam, M, y);
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  const links = [
    dv.geboortedatum ? `Geboren ${korteDatum(dv.geboortedatum)} ${dv.geboortedatum.slice(0, 4)}` : null,
    dv.bsn ? `BSN ${dv.bsn}` : null,
    dv.iban ? `IBAN ${dv.iban}` : null,
  ].filter(Boolean) as string[];
  links.forEach((r, i) => doc.text(r, M, y + 14 + i * 11));
  const meta: [string, string][] = [
    ["In dienst", `${korteDatum(dv.inDienst)} ${dv.inDienst.slice(0, 4)}`],
    ["Contract", dv.dga ? "directeur-grootaandeelhouder" : dv.onbepaaldeTijd ? "onbepaalde tijd" : "bepaalde tijd"],
    ["Uren per week", String(dv.urenPerWeek).replace(".", ",")],
    ["Loonheffingskorting", dv.loonheffingskorting ? "ja" : "nee"],
    ["Deel van de maand", s.fractie < 1 ? `${Math.round(s.fractie * 100)}%` : "volledig"],
  ];
  doc.fillColor(GRIJS);
  meta.forEach(([l, w], i) => {
    doc.fillColor(GRIJS).text(l, M + breed * 0.45, y + i * 11, { width: breed * 0.2, align: "right", lineBreak: false });
    doc.fillColor(INK).text(w, M + breed * 0.67, y + i * 11, { width: breed * 0.33, align: "right" });
  });
  y += Math.max(links.length + 1, meta.length) * 11 + 18;

  const t = new Tabel(doc, [{ k: "Omschrijving", b: 260 }, { k: "Deze periode", b: 120, r: true }, { k: "Cumulatief " + inv.jaar, b: 120, r: true }],
    y, () => { doc.addPage(); return M; });
  t.kop();
  t.titel("Loon");
  t.rij(["Brutoloon", euro(s.bruto), euro(inv.cumulatief.bruto)]);
  if (s.vakantiegeldUitbetaald) t.rij(["Vakantiegeld", euro(s.vakantiegeldUitbetaald), euro(inv.cumulatief.vakantiegeld)]);
  if (s.pensioenWn) t.rij(["Pensioenpremie werknemer", euro(-s.pensioenWn), ""]);
  t.scheiding();
  t.rij(["Loon voor loonheffing", euro(s.loonLh + s.vakantiegeldUitbetaald), euro(inv.cumulatief.loonLh)], { vet: true });
  t.wit(4);
  t.titel("Inhoudingen");
  t.rij(["Loonheffing (tabel)", euro(-s.loonheffing), euro(-inv.cumulatief.loonheffing)]);
  if (s.loonheffingBijzonder) t.rij(["Loonheffing bijzondere beloning", euro(-s.loonheffingBijzonder), ""]);
  if (s.zvwWn) t.rij(["Bijdrage Zvw", euro(-s.zvwWn), ""]);
  t.scheiding(0.8, INK);
  t.rij(["Netto uit te betalen", euro(s.netto), euro(inv.cumulatief.netto)], { vet: true });
  t.wit(8);
  t.titel("Reserveringen en werkgeverslasten", "Ter informatie; niet in het netto.");
  t.rij(["Opbouw vakantiegeld", euro(s.vakantiegeldOpbouw), euro(inv.cumulatief.vakantiegeldSaldo) + " saldo"]);
  if (s.awf || s.aof || s.whk) t.rij(["Premies werknemersverzekeringen (Awf, Aof, Whk)", euro(s.awf + s.aof + s.whk), ""]);
  if (s.zvwWg) t.rij(["Werkgeversheffing Zvw", euro(s.zvwWg), ""]);
  if (s.pensioenWg) t.rij(["Pensioenpremie werkgever", euro(s.pensioenWg), ""]);
  t.scheiding();
  t.rij(["Totale loonkosten werkgever", euro(s.totaleKosten), ""], { vet: true });

  doc.font("Helvetica").fontSize(7.5).fillColor(GRIJS).text(
    "Berekend met de jaarloonmethode op basis van de tarieven en heffingskortingen van het jaar; de maandtabel van de Belastingdienst kan op enkele euro's afwijken.",
    M, t.positie + 14, { width: breed });

  tekenVoet(doc, `${inv.bedrijf.naam} · Loonstrook ${periode} · ${s.naam}`);
  doc.end();
  return klaar;
}
