import "server-only";
import PDFDocument from "pdfkit";
import type { Bedrijf, KlantKop, ProjectKop, SpecUur, SpecRit, SpecTermijn } from "./facturatie";
import { euro, getal, korteDatum, minutenAlsUren, type Datum } from "./datum";

// Urenspecificatie als PDF (keuze E3a). Gewone Helvetica, A4, één kolomraster
// dat per project herhaalt. Geen huisstijl-lettertype: die zou mee moeten
// in de bundel, en een specificatie is een bijlage, geen brochure.

type Invoer = {
  bedrijf: Bedrijf;
  klant: KlantKop;
  project: ProjectKop;
  uren: SpecUur[];
  ritten: SpecRit[];
  termijnen: SpecTermijn[];
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
  const vast = inv.project.facturatiemodel !== "nacalculatie";
  // Termijnbedragen zijn de factuur zelf; die staan er altijd op.
  const geld = inv.metTarieven || inv.termijnen.length > 0;
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
      ["Project", inv.project.code ? `${inv.project.code} · ${inv.project.naam}` : inv.project.naam],
      ...(inv.van ? [["Periode", `${korteDatum(inv.van)} — ${korteDatum(inv.tot)}`]] : []),
      ...(inv.referentie ? [["Factuur", inv.referentie]] : []),
      ...(inv.klant.factuurReferentie ? [["Uw referentie", inv.klant.factuurReferentie]] : []),
      ["Datum", korteDatum(new Date().toISOString().slice(0, 10))],
    ];
    // Labels smal, waarden breed; een lange projectnaam mag wikkelen en de
    // regels eronder schuiven dan mee in plaats van erdoorheen te lopen.
    const labelX = M + breed * 0.5, labelB = breed * 0.12;
    const waardeX = M + breed * 0.63, waardeB = breed * 0.37;
    let my = y;
    for (const [l, w] of meta) {
      const h = Math.max(11, doc.heightOfString(w, { width: waardeB }) + 2);
      doc.fillColor(GRIJS).text(l, labelX, my, { width: labelB, align: "right" });
      doc.fillColor(INK).text(w, waardeX, my, { width: waardeB, align: "right" });
      my += h;
    }
    y = Math.max(y + (adres.length + 1) * 11, my) + 18;
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

  // `span` laat één cel over meerdere kolommen lopen (van..tot, inclusief);
  // de kolommen erbinnen worden overgeslagen. Voor termijnregels, die geen
  // medewerker of uren hebben maar wel een lange omschrijving.
  const rij = (
    cellen: string[],
    opties?: { vet?: boolean; grijs?: boolean; span?: { van: number; tot: number } },
  ) => {
    doc.font(opties?.vet ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
      .fillColor(opties?.grijs ? GRIJS : INK);
    const breedteVan = (i: number) => {
      if (opties?.span && i === opties.span.van) {
        return kol.slice(opties.span.van, opties.span.tot + 1).reduce((s, c) => s + c.b, 0);
      }
      return kol[i].b;
    };
    const overgeslagen = (i: number) =>
      !!opties?.span && i > opties.span.van && i <= opties.span.tot;

    // Hoogte op basis van de hoogste cel, zodat lange omschrijvingen wikkelen.
    let h = 0;
    kol.forEach((_, i) => {
      if (overgeslagen(i)) return;
      h = Math.max(h, doc.heightOfString(cellen[i] ?? "", { width: breedteVan(i) - 4 }));
    });
    nieuwePaginaAlsNodig(h + 6);
    let x = M;
    kol.forEach((c, i) => {
      if (!overgeslagen(i)) {
        doc.text(cellen[i] ?? "", x + 2, y, { width: breedteVan(i) - 4, align: c.r ? "right" : "left" });
      }
      x += c.b;
    });
    y += h + 5;
  };

  kop();
  tabelKop();

  let termijnTot = 0;
  if (inv.termijnen.length) {
    nieuwePaginaAlsNodig(40);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Termijnen", M + 2, y + 4);
    y += 20;
    for (const t of inv.termijnen) {
      termijnTot += t.bedrag;
      rij([
        t.geplandOp ? korteDatum(t.geplandOp) : "",
        "",
        t.omschrijving,
        ...(oms ? [""] : []),
        "",
        "",
        euro(t.bedrag),
      ], { span: { van: 2, tot: kol.length - 2 } });
    }
    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.4).stroke();
    y += 3;
    rij(["", "", "Subtotaal termijnen", ...(oms ? [""] : []), "", "", euro(termijnTot)], { vet: true });
    y += 6;
  }

  // Per onderdeel-blok de uren; bij een vaste prijs als verantwoording,
  // zonder tarief of bedrag.
  const blokken = new Map<string, SpecUur[]>();
  for (const u of inv.uren) {
    const k = vast ? "Verantwoording uren" : u.project;
    (blokken.get(k) ?? blokken.set(k, []).get(k)!).push(u);
  }

  let totMin = 0, totOmzet = 0;
  for (const [titel, regels] of blokken) {
    nieuwePaginaAlsNodig(40);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(titel, M + 2, y + 4);
    if (vast) {
      doc.font("Helvetica").fontSize(8).fillColor(GRIJS)
        .text("Niet in rekening gebracht; de vaste prijs wordt in termijnen gefactureerd.", M + 2, y + 16);
      y += 12;
    }
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
        ...(geld ? (vast ? ["", ""] : [u.declarabel ? euro(u.verkooptarief) : "", euro(u.omzet)]) : []),
      ], { grijs: u.correctieVanId !== null });
    }
    doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.4).stroke();
    y += 3;
    rij([
      "", "", "Subtotaal",
      ...(oms ? [""] : []),
      minutenAlsUren(subMin),
      ...(geld ? (vast ? ["", ""] : ["", euro(subOmzet)]) : []),
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
  if (inv.uren.length) {
    rij(["", "", "Totaal uren", ...(oms ? [""] : []), minutenAlsUren(totMin), ...(geld ? (vast ? ["", ""] : ["", euro(totOmzet)]) : [])], { vet: true });
  }
  if (geld) {
    if (inv.termijnen.length) rij(["", "", "Totaal termijnen", ...(oms ? [""] : []), "", "", euro(termijnTot)], { vet: true });
    if (inv.ritten.length) rij(["", "", "Totaal reiskosten", ...(oms ? [""] : []), "", "", euro(kmBedrag)], { vet: true });
    rij(["", "", "Totaal exclusief btw", ...(oms ? [""] : []), "", "",
         euro((vast ? 0 : totOmzet) + termijnTot + kmBedrag)], { vet: true });
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
