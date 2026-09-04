// Grafieken als inline SVG, op de server gerenderd. Geen bibliotheek: de
// vormen zijn simpel en zo blijven kleuren en tekst aan de thematokens hangen.

import { ScrollNaarEinde } from "./ScrollNaarEinde";

export type Reeks = { naam: string };
export type Vak = { label: string; waarden: (number | null)[]; titel?: string };

/** Ronde asstappen: 0 / 500 / 1.000 in plaats van 0 / 437 / 874. */
function nette_stappen(max: number, aantal = 4): number[] {
  if (max <= 0) return [0, 1];
  const ruw = max / aantal;
  const macht = Math.pow(10, Math.floor(Math.log10(ruw)));
  const kandidaat = [1, 2, 2.5, 5, 10].map((k) => k * macht);
  const stap = kandidaat.find((k) => k >= ruw) ?? kandidaat[kandidaat.length - 1];
  const top = Math.ceil(max / stap) * stap;
  const uit: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += stap) uit.push(Math.round(v * 1000) / 1000);
  return uit;
}

/** Een staaf met ronde bovenhoeken en een rechte voet op de basislijn. */
function staafPad(x: number, y: number, b: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, b / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + b - rr}`,
    `Q${x + b},${y} ${x + b},${y + rr}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/**
 * Gegroepeerde kolommen, één of twee reeksen. De hele categorie is het
 * hover-doel, met één tooltip die alle reeksen noemt; het maximum van de
 * eerste reeks krijgt een direct label, de rest draagt de as.
 */
export function Kolommen({
  vakken,
  reeksen,
  formatteer,
  hoogte = 220,
  asFormatteer,
}: {
  vakken: Vak[];
  reeksen: Reeks[];
  formatteer: (n: number) => string;
  asFormatteer?: (n: number) => string;
  hoogte?: number;
}) {
  const links = 56, rechts = 12, boven = 22, onder = 26;
  const vakBreedte = 52;
  const breedte = links + rechts + vakken.length * vakBreedte;
  const plotH = hoogte - boven - onder;

  const alle = vakken.flatMap((v) => v.waarden.map((w) => w ?? 0));
  const max = Math.max(0, ...alle);
  const stappen = nette_stappen(max);
  const top = stappen[stappen.length - 1] || 1;
  const y = (w: number) => boven + plotH - (w / top) * plotH;

  const n = reeksen.length;
  const staafB = Math.min(24, Math.floor((vakBreedte - 12 - (n - 1) * 2) / n));
  const groepB = n * staafB + (n - 1) * 2;
  const asFmt = asFormatteer ?? formatteer;

  // Direct label: alleen het hoogste punt van reeks 1.
  let maxIndex = -1, maxWaarde = -Infinity;
  vakken.forEach((v, i) => {
    const w = v.waarden[0] ?? 0;
    if (w > maxWaarde) { maxWaarde = w; maxIndex = i; }
  });

  return (
    <ScrollNaarEinde className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${breedte} ${hoogte}`}
        width={breedte}
        height={hoogte}
        role="img"
        aria-label={`${reeksen.map((r) => r.naam).join(" en ")} per periode`}
        style={{ display: "block", maxWidth: "100%", minWidth: Math.min(breedte, 640) }}
      >
        {stappen.map((s) => (
          <g key={s}>
            <line
              x1={links} x2={breedte - rechts} y1={y(s)} y2={y(s)}
              className={s === 0 ? "grafiek-as" : "grafiek-raster"}
            />
            <text x={links - 8} y={y(s) + 4} textAnchor="end" className="grafiek-tekst">
              {asFmt(s)}
            </text>
          </g>
        ))}

        {vakken.map((v, i) => {
          const x0 = links + i * vakBreedte;
          const gx = x0 + (vakBreedte - groepB) / 2;
          const titel =
            v.titel ??
            `${v.label}: ${reeksen
              .map((r, k) => `${r.naam} ${formatteer(v.waarden[k] ?? 0)}`)
              .join(" · ")}`;
          return (
            <g key={v.label} className="grafiek-groep" tabIndex={0} aria-label={titel}>
              <title>{titel}</title>
              <rect
                className="grafiek-vlak"
                x={x0 + 2} y={boven - 4} width={vakBreedte - 4} height={plotH + 8} rx={3}
              />
              {reeksen.map((_, k) => {
                const w = v.waarden[k] ?? 0;
                const h = top > 0 ? (w / top) * plotH : 0;
                const x = gx + k * (staafB + 2);
                return (
                  <path
                    key={k}
                    className={`staaf serie-${k + 1}`}
                    d={staafPad(x, y(w), staafB, h)}
                  />
                );
              })}
              {i === maxIndex && maxWaarde > 0 && (
                <text
                  x={gx + staafB / 2} y={y(maxWaarde) - 6}
                  textAnchor="middle" className="grafiek-tekst-ink"
                >
                  {formatteer(maxWaarde)}
                </text>
              )}
              <text
                x={x0 + vakBreedte / 2} y={hoogte - 8}
                textAnchor="middle" className="grafiek-tekst"
              >
                {v.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ScrollNaarEinde>
  );
}

export function Legenda({ reeksen }: { reeksen: Reeks[] }) {
  if (reeksen.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {reeksen.map((r, k) => (
        <li key={r.naam} className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <rect width="12" height="12" rx="2" className={`serie-${k + 1}`} />
          </svg>
          {r.naam}
        </li>
      ))}
    </ul>
  );
}

/**
 * Budgetmeter. De vulling draagt de ernst; daarnaast staat altijd een woord,
 * want kleur alleen is voor een deel van de lezers geen signaal.
 */
export function Meter({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-xs text-muted">geen budget</span>;
  }
  const klasse = pct > 100 ? "meter-kritiek" : pct >= 80 ? "meter-let-op" : "meter-goed";
  const woord = pct > 100 ? "over budget" : pct >= 80 ? "let op" : null;
  return (
    <div className="flex items-center gap-2">
      <div className={`meter w-24 ${klasse}`} role="img" aria-label={`${Math.round(pct)} procent van het budget`}>
        <i style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="cijfers text-xs">{Math.round(pct)}%</span>
      {woord && (
        <span className={`text-xs font-semibold ${pct > 100 ? "text-danger" : "text-warn"}`}>
          {pct > 100 ? "▲" : "●"} {woord}
        </span>
      )}
    </div>
  );
}
