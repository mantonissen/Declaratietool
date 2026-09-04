import "server-only";
import PDFDocument from "pdfkit";
import type { Bedrijf, KlantKop, SpecUur, SpecRit } from "./facturatie";
import { euro, getal, korteDatum, minutenAlsUren, type Datum } from "./datum";

// Urenspecificatie als PDF (keuze E3a). Gewone Helvetica, A4, één kolomraster
// dat per project herhaalt. Geen huisstijl-lettertype: die zou mee moeten
// in de bundel, en een specificatie is een bijlage, geen brochure.

type Invoer = {
  bedrijf: Bedrijf;
  klant: KlantKop;
  uren: SpecUur[];
  ritten: SpecRit[];
  van: Datum;
  tot: Datum;
  referentie: string | null;
  metOmschrijving: boolean;
  metTarieven: boolean;
};

const DOEL: Record<string, string> = {
  klantbezoek: "Klantbezoek",
  locatiebezoek: "Locatiebezoek",
  overleg: "Overleg",
  opleiding: "Opleiding",
  overig: "Overig",
};

const A4 = { b: 595.28, h: 841.89 };
const M = 48;
const INK = "#111716";
const GRIJS = "#6c7873";
const LIJN = "#d5dad2";

export async function specificatiePdf(inv: Invoer): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: M,
    info: {
      Title: `Urenspecificatie ${inv.klant.naam} ${inv.van} — ${inv.tot}`,
      Author: inv.bedrijf.naam,
    },
  });
  const delen: Buffer[] = [];
  doc.on("data", (d: Buffer) => delen.push(d));
  const klaar = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(delen))));

  const breed = A4.b - 2 * M;
  const geld = inv.metTarieven;
  const oms = inv.metOmschrijving;

  // Kolommen: datum, wie, onderdeel, [omschrijving], uren, [tarief, bedrag]
  const kol: { k: string; b: number; r?: boolean }[] = [
    { k: "Datum", b: 58 },
    { k: "Medewerker", b: 82 },
    { k: "Onderdeel", b: oms ? 92 : 160 },
    ...(oms ? [{ k: "Omschrijving", b: geld ? 132 : 200 }] : []),
    { k: "Uren", b: 40, r: true },
    ...(geld ? [{ k: "Tarief", b: 46, r: true }, { k: "Bedrag", b: 60, r: true }] : []),
  ];
  const kolBreed = kol.reduce((s, c) => s + c.b, 0);
  const schaal = breed / kolBreed;
  for (const c of kol) c.b = Math.floor(c.b * schaal);

  let y = M;

  const kop = () => {
    y = M;
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK)
      .text("Urenspecificatie", M, y);
    doc.font("Helvetica").fontSize(9).fillColor(GRIJS)
      .text(inv.bedrijf.naam, M, y + 22);
    const rechts = [
      inv.bedrijf.adres,
      [inv.bedrijf.postcode, inv.bedrijf.plaats].filter(Boolean).join(" "),
      inv.bedrijf.kvk ? `KvK ${inv.bedrijf.kvk}` : null,
      inv.bedrijf.btw ? `Btw ${inv.bedrijf.btw}` : null,
      inv.bedrijf.email, inv.bedrijf.telefoon,
    ].filter(Boolean) as string[];
    doc.fontSize(8).fillColor(GRIJS);
    rechts.forEach((t, i) => doc.text(t, M + breed / 2, y + i * 11, { width: breed / 2, align: "right" }));
    y += Math.max(40, rechts.length * 11 + 4);

    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.6).stroke();
    y += 12;

    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(inv.klant.naam, M, y);
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    const adres = [
      inv.klant.contactpersoon ? `t.a.v. ${inv.klant.contactpersoon}` : null,
      inv.klant.adres,
      [inv.klant.postcode, inv.klant.plaats].filter(Boolean).join(" "),
    ].filter(Boolean) as string[];
    adres.forEach((t, i) => doc.text(t, M, y + 13 + i * 11));

    const meta = [
      ["Periode", `${korteDatum(inv.van)} — ${korteDatum(inv.tot)}`],
      ...(inv.referentie ? [["Factuur", inv.referentie]] : []),
      ...(inv.klant.factuurReferentie ? [["Uw referentie", inv.klant.factuurReferentie]] : []),
      ["Datum", korteDatum(new Date().toISOString().slice(0, 10))],
    ];
    meta.forEach(([l, w], i) => {
      doc.fillColor(GRIJS).text(l, M + breed / 2, y + i * 11, { width: breed / 4, align: "right" });
      doc.fillColor(INK).text(w, M + (breed * 3) / 4 + 6, y + i * 11, { width: breed / 4 - 6, align: "right" });
    });
    y += Math.max(adres.length + 1, meta.length) * 11 + 18;
  };

  const tabelKop = () => {
    let x = M;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRIJS);
    for (const c of kol) {
      doc.text(c.k.toUpperCase(), x + 2, y, { width: c.b - 4, align: c.r ? "right" : "left", characterSpacing: 0.4 });
      x += c.b;
    }
    y += 12;
    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.6).stroke();
    y += 4;
  };

  const nieuwePaginaAlsNodig = (hoogte: number) => {
    if (y + hoogte > A4.h - M - 24) {
      doc.addPage();
      kop();
      tabelKop();
    }
  };

  const rij = (cellen: string[], opties?: { vet?: boolean; grijs?: boolean }) => {
    doc.font(opties?.vet ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
      .fillColor(opties?.grijs ? GRIJS : INK);
    // Hoogte op basis van de hoogste cel, zodat lange omschrijvingen wikkelen.
    let h = 0;
    kol.forEach((c, i) => {
      h = Math.max(h, doc.heightOfString(cellen[i] ?? "", { width: c.b - 4 }));
    });
    nieuwePaginaAlsNodig(h + 6);
    let x = M;
    kol.forEach((c, i) => {
      doc.text(cellen[i] ?? "", x + 2, y, { width: c.b - 4, align: c.r ? "right" : "left" });
      x += c.b;
    });
    y += h + 5;
  };

  kop();
  tabelKop();

  // Per project een blok met eigen subtotaal.
  const projecten = new Map<string, SpecUur[]>();
  for (const u of inv.uren) (projecten.get(u.project) ?? projecten.set(u.project, []).get(u.project)!).push(u);

  let totMin = 0, totOmzet = 0;
  for (const [project, regels] of projecten) {
    nieuwePaginaAlsNodig(40);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(project, M + 2, y + 4);
    y += 20;
    let subMin = 0, subOmzet = 0;
    for (const u of regels) {
      subMin += u.minuten; subOmzet += u.omzet ?? 0;
      rij([
        korteDatum(u.datum),
        u.medewerker,
        u.onderdeel + (u.declarabel ? "" : " — niet declarabel"),
        ...(oms ? [u.omschrijving ?? ""] : []),
        minutenAlsUren(u.minuten),
        ...(geld ? [u.declarabel ? euro(u.verkooptarief) : "", euro(u.omzet)] : []),
      ], { grijs: u.correctieVanId !== null });
    }
    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.4).stroke();
    y += 3;
    rij([
      "", "", "Subtotaal",
      ...(oms ? [""] : []),
      minutenAlsUren(subMin),
      ...(geld ? ["", euro(subOmzet)] : []),
    ], { vet: true });
    y += 6;
    totMin += subMin; totOmzet += subOmzet;
  }

  let kmTot = 0, kmBedrag = 0;
  if (inv.ritten.length) {
    nieuwePaginaAlsNodig(40);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Reiskosten", M + 2, y + 4);
    y += 20;
    for (const r of inv.ritten) {
      kmTot += r.totaalKm; kmBedrag += r.kmBedrag ?? 0;
      rij([
        korteDatum(r.datum),
        r.medewerker,
        DOEL[r.doel] ?? r.doel,
        ...(oms ? [r.omschrijving ?? ""] : []),
        `${getal(r.totaalKm, 0)} km`,
        ...(geld ? [r.kmTarief === null ? "" : `${euro(r.kmTarief)}/km`, euro(r.kmBedrag)] : []),
      ]);
    }
    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.4).stroke();
    y += 3;
    rij(["", "", "Subtotaal", ...(oms ? [""] : []), `${getal(kmTot, 0)} km`, ...(geld ? ["", euro(kmBedrag)] : [])], { vet: true });
    y += 6;
  }

  nieuwePaginaAlsNodig(40);
  doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(INK).lineWidth(0.8).stroke();
  y += 6;
  rij(["", "", "Totaal uren", ...(oms ? [""] : []), minutenAlsUren(totMin), ...(geld ? ["", euro(totOmzet)] : [])], { vet: true });
  if (geld && inv.ritten.length) {
    rij(["", "", "Totaal reiskosten", ...(oms ? [""] : []), "", "", euro(kmBedrag)], { vet: true });
    rij(["", "", "Totaal exclusief btw", ...(oms ? [""] : []), "", "", euro(totOmzet + kmBedrag)], { vet: true });
  }

  // Voettekst op elke pagina.
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIJS)
      .text(`${inv.bedrijf.naam} · Urenspecificatie ${inv.klant.naam} · pagina ${i + 1} van ${paginas.count}`,
        M, A4.h - M + 10, { width: breed, align: "center" });
  }

  doc.end();
  return klaar;
}
