import "server-only";
import PDFDocument from "pdfkit";
import type {
  Bedrijf, KlantKop, ProjectKop, SpecUur, SpecRit, SpecTermijn, FactuurKop, FactuurRegel,
} from "./facturatie";
import { euro, getal, korteDatum, minutenAlsUren, type Datum } from "./datum";

// Factuur en urenspecificatie als PDF. Gewone Helvetica, A4. De factuur is
// het document dat de klant betaalt; de specificatie is de bijlage die
// uitlegt waar het bedrag vandaan komt. Ze delen kop, voet en kolomraster.

export type Doc = InstanceType<typeof PDFDocument>;

export const A4 = { b: 595.28, h: 841.89 };
export const M = 48;
export const INK = "#111716";
export const GRIJS = "#6c7873";
export const LIJN = "#d5dad2";

const DOEL: Record<string, string> = {
  klantbezoek: "Klantbezoek", locatiebezoek: "Locatiebezoek", overleg: "Overleg",
  opleiding: "Opleiding", overig: "Overig",
};

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
  "september", "oktober", "november", "december"];
function volleDatum(d: Datum): string {
  const t = new Date(d + "T00:00:00Z");
  return `${t.getUTCDate()} ${MAANDEN[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

type Kop = { bedrijf: Bedrijf; klant: KlantKop; titel: string; meta: [string, string][] };

/** Kop met bedrijf rechts, klant links en een metablok. Geeft de nieuwe y. */
export function tekenKop(doc: Doc, k: Kop): number {
  const breed = A4.b - 2 * M;
  let y = M;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(k.titel, M, y);
  doc.font("Helvetica").fontSize(9).fillColor(GRIJS).text(k.bedrijf.naam, M, y + 22);
  const rechts = [
    k.bedrijf.adres,
    [k.bedrijf.postcode, k.bedrijf.plaats].filter(Boolean).join(" "),
    k.bedrijf.kvk ? `KvK ${k.bedrijf.kvk}` : null,
    k.bedrijf.btw ? `Btw ${k.bedrijf.btw}` : null,
    k.bedrijf.email, k.bedrijf.telefoon,
  ].filter(Boolean) as string[];
  doc.fontSize(8).fillColor(GRIJS);
  rechts.forEach((t, i) => doc.text(t, M + breed / 2, y + i * 11, { width: breed / 2, align: "right" }));
  y += Math.max(40, rechts.length * 11 + 4);

  doc.moveTo(M, y).lineTo(M + breed, y).strokeColor(LIJN).lineWidth(0.6).stroke();
  y += 12;

  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(k.klant.naam, M, y);
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  const adres = [
    k.klant.contactpersoon ? `t.a.v. ${k.klant.contactpersoon}` : null,
    k.klant.adres,
    [k.klant.postcode, k.klant.plaats].filter(Boolean).join(" "),
  ].filter(Boolean) as string[];
  adres.forEach((t, i) => doc.text(t, M, y + 13 + i * 11));

  const labelX = M + breed * 0.4, labelB = breed * 0.21;
  const waardeX = M + breed * 0.63, waardeB = breed * 0.37;
  let my = y;
  for (const [l, w] of k.meta) {
    const h = Math.max(11, doc.heightOfString(w, { width: waardeB }) + 2);
    doc.fillColor(GRIJS).text(l, labelX, my, { width: labelB, align: "right", lineBreak: false });
    doc.fillColor(INK).text(w, waardeX, my, { width: waardeB, align: "right" });
    my += h;
  }
  return Math.max(y + (adres.length + 1) * 11, my) + 18;
}

export function tekenVoet(doc: Doc, tekst: string) {
  const breed = A4.b - 2 * M;
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    // Onder de ondermarge schrijven: pdfkit zou anders een nieuwe pagina
    // beginnen voor de voettekst zelf.
    const onder = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIJS)
      .text(`${tekst} · pagina ${i + 1} van ${paginas.count}`, M, A4.h - M + 10,
        { width: breed, align: "center", lineBreak: false });
    doc.page.margins.bottom = onder;
  }
}

/** Een tabel met kolommen op een vaste breedte; regels wikkelen en breken over pagina's. */
export class Tabel {
  private y: number;
  constructor(
    private doc: Doc,
    private kol: { k: string; b: number; r?: boolean }[],
    y: number,
    private nieuwePagina: () => number,
  ) {
    const breed = A4.b - 2 * M;
    const som = kol.reduce((s, c) => s + c.b, 0);
    for (const c of kol) c.b = Math.floor((c.b * breed) / som);
    this.y = y;
  }
  get positie() { return this.y; }
  kop() {
    let x = M;
    this.doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRIJS);
    for (const c of this.kol) {
      this.doc.text(c.k.toUpperCase(), x + 2, this.y, { width: c.b - 4, align: c.r ? "right" : "left", characterSpacing: 0.4 });
      x += c.b;
    }
    this.y += 12;
    this.lijn(0.6);
    this.y += 4;
  }
  ruimte(h: number) {
    if (this.y + h > A4.h - M - 24) {
      this.y = this.nieuwePagina();
      this.kop();
    }
  }
  lijn(dikte = 0.4, kleur = LIJN) {
    this.doc.moveTo(M, this.y).lineTo(A4.b - M, this.y).strokeColor(kleur).lineWidth(dikte).stroke();
  }
  titel(t: string, sub?: string) {
    this.ruimte(sub ? 52 : 40);
    this.doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(t, M + 2, this.y + 4);
    if (sub) {
      this.doc.font("Helvetica").fontSize(8).fillColor(GRIJS).text(sub, M + 2, this.y + 16);
      this.y += 12;
    }
    this.y += 20;
  }
  rij(cellen: string[], o?: { vet?: boolean; grijs?: boolean; span?: { van: number; tot: number } }) {
    const d = this.doc;
    d.font(o?.vet ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(o?.grijs ? GRIJS : INK);
    const breedte = (i: number) =>
      o?.span && i === o.span.van
        ? this.kol.slice(o.span.van, o.span.tot + 1).reduce((s, c) => s + c.b, 0)
        : this.kol[i].b;
    const skip = (i: number) => !!o?.span && i > o.span.van && i <= o.span.tot;
    let h = 0;
    this.kol.forEach((_, i) => { if (!skip(i)) h = Math.max(h, d.heightOfString(cellen[i] ?? "", { width: breedte(i) - 4 })); });
    this.ruimte(h + 6);
    let x = M;
    this.kol.forEach((c, i) => {
      if (!skip(i)) d.text(cellen[i] ?? "", x + 2, this.y, { width: breedte(i) - 4, align: c.r ? "right" : "left" });
      x += c.b;
    });
    this.y += h + 5;
  }
  scheiding(dikte = 0.4, kleur = LIJN) { this.lijn(dikte, kleur); this.y += 3; }
  wit(h = 6) { this.y += h; }
  get aantalKolommen() { return this.kol.length; }
}

// ------------------------------------------------------------ factuur ----

export type FactuurInvoer = {
  bedrijf: Bedrijf;
  klant: KlantKop;
  project: ProjectKop | null;
  factuur: FactuurKop;
  regels: FactuurRegel[];
};

/** De factuur zelf: regels met btw, totalen, betaalinstructie. */
export function tekenFactuur(doc: Doc, inv: FactuurInvoer) {
  const f = inv.factuur;
  const concept = f.status === "concept";
  const credit = f.totaal < 0 || !!f.creditVanId;
  const titel = concept ? "Conceptfactuur" : credit ? "Creditfactuur" : "Factuur";

  const meta: [string, string][] = [
    ["Factuurnummer", f.nummer ?? "concept"],
    ["Factuurdatum", f.datum ? volleDatum(f.datum) : "—"],
    ...(f.vervaldatum && !credit ? [["Vervaldatum", volleDatum(f.vervaldatum)] as [string, string]] : []),
    ...(inv.project ? [["Project", inv.project.code ? `${inv.project.code} · ${inv.project.naam}` : inv.project.naam] as [string, string]] : []),
    ...(f.referentieKlant ? [["Uw referentie", f.referentieKlant] as [string, string]] : []),
    ...(f.periodeVan && f.periodeTot ? [["Periode", `${korteDatum(f.periodeVan)} — ${korteDatum(f.periodeTot)}`] as [string, string]] : []),
  ];

  const kop = () => tekenKop(doc, { bedrijf: inv.bedrijf, klant: inv.klant, titel, meta });
  const t = new Tabel(doc, [
    { k: "Omschrijving", b: 250 },
    { k: "Aantal", b: 60, r: true },
    { k: "Prijs", b: 70, r: true },
    { k: "Btw", b: 40, r: true },
    { k: "Bedrag", b: 80, r: true },
  ], kop(), () => { doc.addPage(); return kop(); });
  t.kop();

  const eenheid = (e: string, n: number) => e === "uur" ? "u" : e === "km" ? "km" : n === 1 ? "" : "st";
  for (const r of inv.regels) {
    t.rij([
      r.omschrijving,
      `${getal(r.aantal, r.eenheid === "stuk" ? 0 : 2)} ${eenheid(r.eenheid, r.aantal)}`.trim(),
      euro(r.prijs),
      `${getal(r.btwPercentage, 0)}%`,
      euro(r.bedrag),
    ]);
  }

  // Totalen: subtotaal, btw per tarief, totaal.
  const perBtw = new Map<number, number>();
  for (const r of inv.regels) perBtw.set(r.btwPercentage, (perBtw.get(r.btwPercentage) ?? 0) + Math.round(r.bedrag * r.btwPercentage) / 100);
  const verlegd = inv.regels.some((r) => r.btwCode === "verlegd");

  t.wit(4);
  t.scheiding(0.8, INK);
  const totaalRij = (label: string, bedrag: number, vet = false) =>
    t.rij(["", "", label, "", euro(bedrag)], { vet, span: { van: 2, tot: 3 } });
  totaalRij("Subtotaal", f.subtotaal);
  for (const [pct, bedrag] of [...perBtw.entries()].sort((a, b) => b[0] - a[0])) {
    totaalRij(`Btw ${getal(pct, 0)}%`, bedrag);
  }
  totaalRij("Totaal", f.totaal, true);

  t.wit(14);
  const tekst: string[] = [];
  if (verlegd) tekst.push("Btw verlegd naar de afnemer.");
  if (!concept && !credit && f.vervaldatum) {
    tekst.push(
      `Wij verzoeken u het bedrag van ${euro(f.totaal)} vóór ${volleDatum(f.vervaldatum)} over te maken` +
      (inv.bedrijf.iban ? ` op ${inv.bedrijf.iban} ten name van ${inv.bedrijf.naam}` : "") +
      `, onder vermelding van factuurnummer ${f.nummer}.`,
    );
  }
  if (credit && f.creditVanId) tekst.push("Dit bedrag wordt verrekend of teruggestort.");
  if (f.opmerking) tekst.push(f.opmerking);
  if (inv.bedrijf.voettekst) tekst.push(inv.bedrijf.voettekst);
  if (concept) tekst.push("Concept — dit is nog geen factuur en heeft geen nummer.");

  doc.font("Helvetica").fontSize(9).fillColor(INK);
  let y = t.positie;
  for (const regel of tekst) {
    const h = doc.heightOfString(regel, { width: A4.b - 2 * M });
    if (y + h > A4.h - M - 24) { doc.addPage(); y = kop(); }
    doc.text(regel, M, y, { width: A4.b - 2 * M });
    y += h + 6;
  }
}

// ------------------------------------------------------- specificatie ----

export type SpecInvoer = {
  bedrijf: Bedrijf;
  klant: KlantKop;
  project: ProjectKop | null;
  uren: SpecUur[];
  ritten: SpecRit[];
  termijnen: SpecTermijn[];
  van: Datum;
  tot: Datum;
  referentie: string | null;
  metOmschrijving: boolean;
  metTarieven: boolean;
};

/** De urenspecificatie: uren per project(onderdeel), reiskosten, termijnen. */
export function tekenSpecificatie(doc: Doc, inv: SpecInvoer) {
  const vast = !!inv.project && inv.project.facturatiemodel !== "nacalculatie";
  const geld = inv.metTarieven || inv.termijnen.length > 0;
  const oms = inv.metOmschrijving;

  const meta: [string, string][] = [
    ...(inv.project ? [["Project", inv.project.code ? `${inv.project.code} · ${inv.project.naam}` : inv.project.naam] as [string, string]] : []),
    ...(inv.van ? [["Periode", `${korteDatum(inv.van)} — ${korteDatum(inv.tot)}`] as [string, string]] : []),
    ...(inv.referentie ? [["Factuur", inv.referentie] as [string, string]] : []),
    ...(inv.klant.factuurReferentie ? [["Uw referentie", inv.klant.factuurReferentie] as [string, string]] : []),
    ["Datum", korteDatum(new Date().toISOString().slice(0, 10))],
  ];
  const kop = () => tekenKop(doc, { bedrijf: inv.bedrijf, klant: inv.klant, titel: "Urenspecificatie", meta });

  const kol = [
    { k: "Datum", b: 58 },
    { k: "Medewerker", b: 82 },
    { k: "Onderdeel", b: oms ? 92 : 160 },
    ...(oms ? [{ k: "Omschrijving", b: geld ? 132 : 200 }] : []),
    { k: "Uren", b: 40, r: true },
    ...(geld ? [{ k: "Tarief", b: 46, r: true }, { k: "Bedrag", b: 60, r: true }] : []),
  ];
  const t = new Tabel(doc, kol, kop(), () => { doc.addPage(); return kop(); });
  t.kop();
  const leegOms = oms ? [""] : [];

  let termijnTot = 0;
  if (inv.termijnen.length) {
    t.titel("Termijnen");
    for (const tr of inv.termijnen) {
      termijnTot += tr.bedrag;
      t.rij([tr.geplandOp ? korteDatum(tr.geplandOp) : "", "", tr.omschrijving, ...leegOms, "", "", euro(tr.bedrag)],
        { span: { van: 2, tot: t.aantalKolommen - 2 } });
    }
    t.scheiding();
    t.rij(["", "", "Subtotaal termijnen", ...leegOms, "", "", euro(termijnTot)], { vet: true });
    t.wit();
  }

  const blokken = new Map<string, SpecUur[]>();
  for (const u of inv.uren) {
    const k = vast ? "Verantwoording uren" : u.project;
    (blokken.get(k) ?? blokken.set(k, []).get(k)!).push(u);
  }
  let totMin = 0, totOmzet = 0;
  for (const [titel, regels] of blokken) {
    t.titel(titel, vast ? "Niet in rekening gebracht; de vaste prijs wordt in termijnen gefactureerd." : undefined);
    let subMin = 0, subOmzet = 0;
    for (const u of regels) {
      subMin += u.minuten; subOmzet += u.omzet ?? 0;
      t.rij([
        korteDatum(u.datum), u.medewerker,
        u.onderdeel + (u.declarabel ? "" : " — niet declarabel"),
        ...(oms ? [u.omschrijving ?? ""] : []),
        minutenAlsUren(u.minuten),
        ...(geld ? (vast ? ["", ""] : [u.declarabel ? euro(u.verkooptarief) : "", euro(u.omzet)]) : []),
      ], { grijs: u.correctieVanId !== null });
    }
    t.scheiding();
    t.rij(["", "", "Subtotaal", ...leegOms, minutenAlsUren(subMin), ...(geld ? (vast ? ["", ""] : ["", euro(subOmzet)]) : [])], { vet: true });
    t.wit();
    totMin += subMin; totOmzet += subOmzet;
  }

  let kmTot = 0, kmBedrag = 0;
  if (inv.ritten.length) {
    t.titel("Reiskosten");
    for (const r of inv.ritten) {
      kmTot += r.totaalKm; kmBedrag += r.kmBedrag ?? 0;
      t.rij([
        korteDatum(r.datum), r.medewerker, DOEL[r.doel] ?? r.doel,
        ...(oms ? [r.omschrijving ?? ""] : []),
        `${getal(r.totaalKm, 0)} km`,
        ...(geld ? [r.kmTarief === null ? "" : `${euro(r.kmTarief)}/km`, euro(r.kmBedrag)] : []),
      ]);
    }
    t.scheiding();
    t.rij(["", "", "Subtotaal", ...leegOms, `${getal(kmTot, 0)} km`, ...(geld ? ["", euro(kmBedrag)] : [])], { vet: true });
    t.wit();
  }

  t.ruimte(40);
  t.scheiding(0.8, INK);
  if (inv.uren.length) {
    t.rij(["", "", "Totaal uren", ...leegOms, minutenAlsUren(totMin), ...(geld ? (vast ? ["", ""] : ["", euro(totOmzet)]) : [])], { vet: true });
  }
  if (geld) {
    if (inv.termijnen.length) t.rij(["", "", "Totaal termijnen", ...leegOms, "", "", euro(termijnTot)], { vet: true });
    if (inv.ritten.length) t.rij(["", "", "Totaal reiskosten", ...leegOms, "", "", euro(kmBedrag)], { vet: true });
    t.rij(["", "", "Totaal exclusief btw", ...leegOms, "", "", euro((vast ? 0 : totOmzet) + termijnTot + kmBedrag)], { vet: true });
  }
}

// ------------------------------------------------------------ uitvoer ----

export function nieuwDoc(titel: string, auteur: string): { doc: Doc; klaar: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: titel, Author: auteur } });
  const delen: Buffer[] = [];
  doc.on("data", (d: Buffer) => delen.push(d));
  const klaar = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(delen))));
  return { doc, klaar };
}

export async function specificatiePdf(inv: SpecInvoer): Promise<Buffer> {
  const { doc, klaar } = nieuwDoc(`Urenspecificatie ${inv.klant.naam} ${inv.van} — ${inv.tot}`, inv.bedrijf.naam);
  tekenSpecificatie(doc, inv);
  tekenVoet(doc, `${inv.bedrijf.naam} · Urenspecificatie ${inv.klant.naam}`);
  doc.end();
  return klaar;
}

/** Factuur, met de specificatie als bijlage erachter als die is meegegeven. */
export async function factuurPdf(inv: FactuurInvoer, bijlage: SpecInvoer | null): Promise<Buffer> {
  const naam = inv.factuur.nummer ?? "concept";
  const { doc, klaar } = nieuwDoc(`Factuur ${naam} ${inv.klant.naam}`, inv.bedrijf.naam);
  tekenFactuur(doc, inv);
  if (bijlage && (bijlage.uren.length || bijlage.ritten.length || bijlage.termijnen.length)) {
    doc.addPage();
    tekenSpecificatie(doc, bijlage);
  }
  tekenVoet(doc, `${inv.bedrijf.naam} · Factuur ${naam} · ${inv.klant.naam}`);
  doc.end();
  return klaar;
}
