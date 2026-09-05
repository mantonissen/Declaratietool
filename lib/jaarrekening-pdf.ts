import "server-only";
import { A4, M, INK, GRIJS, LIJN, Tabel, tekenVoet, nieuwDoc, type Doc } from "./pdf";
import type { Bedrijf } from "./facturatie";
import type { Jaarrekening, Boekjaar } from "./jaarwerk";
import { euro, korteDatum } from "./datum";

// De jaarrekening als PDF: balans, winst-en-verlies, toelichting en de
// publicatiestukken voor de KvK (micro). Zelfde raster als factuur en
// specificatie.

export type JaarrekeningInvoer = { bedrijf: Bedrijf; jr: Jaarrekening; bj: Boekjaar; rechtsvorm: string; bestuurder: string };

const b0 = (x: number) => (Math.abs(x) < 0.005 ? "—" : euro(x));

function kop(doc: Doc, inv: JaarrekeningInvoer, titel: string): number {
  const breed = A4.b - 2 * M;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(titel, M, M);
  doc.font("Helvetica").fontSize(9).fillColor(GRIJS).text(`${inv.bedrijf.naam} · boekjaar ${inv.jr.jaar}`, M, M + 22);
  doc.fontSize(8).text([inv.bedrijf.kvk ? `KvK ${inv.bedrijf.kvk}` : null, [inv.bedrijf.postcode, inv.bedrijf.plaats].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    M + breed / 2, M + 4, { width: breed / 2, align: "right" });
  doc.moveTo(M, M + 40).lineTo(M + breed, M + 40).strokeColor(LIJN).lineWidth(0.6).stroke();
  return M + 56;
}

export async function jaarrekeningPdf(inv: JaarrekeningInvoer): Promise<Buffer> {
  const { jr, bj } = inv;
  const { doc, klaar } = nieuwDoc(`Jaarrekening ${jr.jaar} ${inv.bedrijf.naam}`, inv.bedrijf.naam);
  const breed = A4.b - 2 * M;

  // Titelblad
  doc.font("Helvetica-Bold").fontSize(26).fillColor(INK).text(`Jaarrekening ${jr.jaar}`, M, 200);
  doc.font("Helvetica").fontSize(14).fillColor(INK).text(inv.bedrijf.naam, M, 240);
  doc.fontSize(10).fillColor(GRIJS);
  const regels = [
    [inv.bedrijf.adres, [inv.bedrijf.postcode, inv.bedrijf.plaats].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    inv.bedrijf.kvk ? `Kamer van Koophandel ${inv.bedrijf.kvk}` : null,
    `Rechtsvorm: ${inv.rechtsvorm === "bv" ? "besloten vennootschap" : inv.rechtsvorm}`,
    `Boekjaar: 1 januari ${jr.jaar} tot en met 31 december ${jr.jaar}`,
    bj.opgemaaktOp ? `Opgemaakt op ${korteDatum(bj.opgemaaktOp)} ${bj.opgemaaktOp.slice(0, 4)}` : "Nog niet opgemaakt (concept)",
    bj.vastgesteldOp ? `Vastgesteld door de algemene vergadering op ${korteDatum(bj.vastgesteldOp)} ${bj.vastgesteldOp.slice(0, 4)}` : null,
  ].filter(Boolean) as string[];
  regels.forEach((r, i) => doc.text(r, M, 270 + i * 15));
  doc.fontSize(9).text("Inhoud: balans per 31 december, winst-en-verliesrekening, toelichting, publicatiestukken.", M, 270 + regels.length * 15 + 20);
  doc.fontSize(8).fillColor(GRIJS).text(
    "Deze jaarrekening is opgesteld uit de eigen administratie, op basis van de grondslagen in de toelichting. " +
    "Zij is niet gecontroleerd door een accountant.", M, A4.h - M - 60, { width: breed });

  // Balans
  doc.addPage();
  const kolommen = [{ k: "", b: 300 }, { k: `31-12-${jr.jaar}`, b: 100, r: true }, { k: `31-12-${jr.jaar - 1}`, b: 100, r: true }];
  let t = new Tabel(doc, kolommen.map((c) => ({ ...c })), kop(doc, inv, "Balans per 31 december"), () => { doc.addPage(); return kop(doc, inv, "Balans (vervolg)"); });
  t.kop();
  const groepen = (lijst: typeof jr.activa, totaalLabel: string, totaal: number, vorig: number) => {
    for (const g of lijst) {
      t.titel(g.naam);
      for (const p of g.posten) t.rij([p.naam, b0(p.bedrag), b0(p.vorig)]);
      t.scheiding();
      t.rij([`Totaal ${g.naam.toLowerCase()}`, euro(g.totaal), euro(g.vorig)], { vet: true });
      t.wit();
    }
    t.scheiding(0.8, INK);
    t.rij([totaalLabel, euro(totaal), euro(vorig)], { vet: true });
    t.wit(14);
  };
  t.rij(["ACTIVA", "", ""], { vet: true });
  groepen(jr.activa, "Totaal activa", jr.totaalActiva, jr.totaalActivaVorig);
  t.rij(["PASSIVA", "", ""], { vet: true });
  groepen(jr.passiva, "Totaal passiva", jr.totaalPassiva, jr.totaalPassivaVorig);

  // Winst-en-verlies
  doc.addPage();
  const wvKol = [{ k: "", b: 300 }, { k: String(jr.jaar), b: 100, r: true }, { k: String(jr.jaar - 1), b: 100, r: true }];
  t = new Tabel(doc, wvKol, kop(doc, inv, "Winst-en-verliesrekening"), () => { doc.addPage(); return kop(doc, inv, "Winst-en-verliesrekening (vervolg)"); });
  t.kop();
  const wv = (rubriek: string) => jr.wv.find((g) => g.rubriek === rubriek);
  const blok = (rubriek: string, label: string) => {
    const g = wv(rubriek);
    t.titel(label);
    if (g) for (const p of g.posten) t.rij([p.naam, b0(p.bedrag), b0(p.vorig)]);
    t.scheiding();
    t.rij([`Totaal ${label.toLowerCase()}`, euro(g?.totaal ?? 0), euro(g?.vorig ?? 0)], { vet: true });
    t.wit(4);
  };
  blok("netto_omzet", "Netto-omzet");
  blok("personeelskosten", "Personeelskosten");
  blok("afschrijvingen", "Afschrijvingen op vaste activa");
  blok("overige_bedrijfskosten", "Overige bedrijfskosten");
  t.scheiding(0.8, INK);
  t.rij(["Som der bedrijfskosten", euro(jr.somKosten), euro(jr.somKostenVorig)], { vet: true });
  t.rij(["Bedrijfsresultaat", euro(jr.bedrijfsresultaat), euro(jr.bedrijfsresultaatVorig)], { vet: true });
  t.rij(["Financiële baten en lasten", euro(jr.financieel), euro(jr.financieelVorig)]);
  t.rij(["Resultaat vóór belastingen", euro(jr.resultaatVoor), euro(jr.resultaatVoorVorig)], { vet: true });
  t.rij(["Belastingen over het resultaat", euro(-jr.belastingen), euro(-jr.belastingenVorig)]);
  t.scheiding(0.8, INK);
  t.rij(["Resultaat na belastingen", euro(jr.resultaatNa), euro(jr.resultaatNaVorig)], { vet: true });

  // Toelichting
  doc.addPage();
  let y = kop(doc, inv, "Toelichting");
  const alinea = (titel: string, tekst: string) => {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(titel, M, y); y += 14;
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    const h = doc.heightOfString(tekst, { width: breed });
    if (y + h > A4.h - M - 30) { doc.addPage(); y = kop(doc, inv, "Toelichting (vervolg)"); }
    doc.text(tekst, M, y, { width: breed }); y += h + 10;
  };
  alinea("Algemeen", `${inv.bedrijf.naam} is een ${inv.rechtsvorm === "bv" ? "besloten vennootschap" : inv.rechtsvorm}${inv.bedrijf.plaats ? ` gevestigd te ${inv.bedrijf.plaats}` : ""}. De activiteiten bestaan uit advies- en projectwerkzaamheden. De jaarrekening is opgesteld volgens de wettelijke bepalingen van Titel 9 Boek 2 BW voor micro- en kleine rechtspersonen. Het boekjaar is gelijk aan het kalenderjaar.`);
  alinea("Grondslagen voor waardering", "Activa en passiva zijn gewaardeerd tegen nominale waarde, tenzij anders vermeld. Materiële vaste activa zijn gewaardeerd tegen aanschafwaarde verminderd met lineaire afschrijvingen op basis van de verwachte gebruiksduur. Vorderingen zijn opgenomen tegen nominale waarde; er is geen voorziening voor oninbaarheid gevormd tenzij een vordering aantoonbaar oninbaar is. Schulden zijn opgenomen tegen nominale waarde.");
  alinea("Grondslagen voor resultaatbepaling", "De netto-omzet betreft de aan opdrachtgevers in rekening gebrachte bedragen voor geleverde diensten, exclusief omzetbelasting, toegerekend aan het jaar waarin de diensten zijn verricht. Kosten worden toegerekend aan het jaar waarop zij betrekking hebben. De vennootschapsbelasting is berekend over het resultaat vóór belastingen, rekening houdend met fiscaal niet-aftrekbare kosten en verrekenbare verliezen.");
  alinea("Materiële vaste activa", `Aanschafwaarde ${euro(jr.vasteActiva.aanschaf)}, cumulatieve afschrijvingen ${euro(jr.vasteActiva.afgeschreven)}, boekwaarde per 31 december ${euro(jr.vasteActiva.boekwaarde)}. Afschrijving in het boekjaar: ${euro(jr.vasteActiva.afschrijvingJaar)}.`);
  alinea("Eigen vermogen", `Stand per 1 januari ${euro(jr.eigenVermogenBegin)}; resultaat boekjaar ${euro(jr.resultaatNa)}; stand per 31 december ${euro(jr.eigenVermogenEind)}. Het resultaat is onverdeeld in afwachting van het besluit van de algemene vergadering.`);
  alinea("Werknemers", `Gemiddeld aantal werknemers gedurende het boekjaar: ${bj.gemiddeldWerknemers ?? "niet opgegeven"}.`);
  if (bj.toelichting) alinea("Overige toelichting", bj.toelichting);
  alinea("Ondertekening", `${inv.bedrijf.plaats ?? ""}${bj.opgemaaktOp ? `, ${korteDatum(bj.opgemaaktOp)} ${bj.opgemaaktOp.slice(0, 4)}` : ""}\n\n${inv.bestuurder}, bestuurder`);

  // Publicatiestukken
  doc.addPage();
  t = new Tabel(doc, [{ k: "Post (KvK, micro-onderneming)", b: 380 }, { k: `31-12-${jr.jaar}`, b: 120, r: true }],
    kop(doc, inv, "Publicatiestukken"), () => { doc.addPage(); return kop(doc, inv, "Publicatiestukken (vervolg)"); });
  t.kop();
  for (const v of jr.kvk) t.rij([v.naam, euro(v.waarde)], { vet: v.naam.startsWith("Totaal") });
  t.wit(10);
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIJS).text(
    "Een micro-onderneming deponeert alleen een beperkte balans met toelichting; deze bedragen zijn wat de KvK-dienst " +
    "\"Zelf deponeren jaarrekening\" vraagt. Deponeren binnen acht dagen na vaststelling en uiterlijk twaalf maanden na afloop van het boekjaar.",
    M, t.positie, { width: breed });

  tekenVoet(doc, `${inv.bedrijf.naam} · Jaarrekening ${jr.jaar}`);
  doc.end();
  return klaar;
}
