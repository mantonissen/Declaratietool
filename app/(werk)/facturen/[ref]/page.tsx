import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { specificatie } from "@/lib/facturatie";
import { euro, getal, korteDatum, minutenAlsTijd } from "@/lib/datum";
import { corrigeer } from "../acties";

export const dynamic = "force-dynamic";

export default async function FactuurPagina({ params }: { params: Promise<{ ref: string }> }) {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");
  const { ref } = await params;
  const referentie = decodeURIComponent(ref);

  const s = await specificatie(sessie, { factuur: referentie });
  if (!s.klant || !s.project || (s.uren.length === 0 && s.ritten.length === 0 && s.termijnen.length === 0)) notFound();

  const vast = s.project.facturatiemodel !== "nacalculatie";
  const totOmzet = s.uren.reduce((a, u) => a + (u.omzet ?? 0), 0);
  const kmBedrag = s.ritten.reduce((a, r) => a + (r.kmBedrag ?? 0), 0);
  const termijnBedrag = s.termijnen.reduce((a, t) => a + t.bedrag, 0);

  const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
    <th className={`label border-b border-line bg-surface-2 px-3 py-2 ${r ? "text-right" : "text-left"}`}>{children}</th>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/facturen" className="knop knop-kaal -ml-2">← Facturen</Link>
      <p className="label mt-2">Factuur · {s.project.facturatiemodel === "abonnement" ? "abonnement" : vast ? "vaste prijs" : "nacalculatie"}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
        <span className="cijfers">{referentie}</span> · {s.project.naam}
      </h1>
      <p className="mt-1 text-sm text-muted">{s.klant.naam}</p>

      <div className="mt-4 mb-6 flex flex-wrap items-center gap-3">
        <a href={`/api/specificatie?factuur=${encodeURIComponent(referentie)}`} className="knop knop-primair">Specificatie (PDF)</a>
        <a href={`/api/specificatie?factuur=${encodeURIComponent(referentie)}&detail=vol`} className="knop knop-kaal">intern, met alles</a>
        <span className="cijfers ml-auto text-lg font-semibold">{euro(totOmzet + kmBedrag + termijnBedrag)}</span>
      </div>

      {s.termijnen.length > 0 && (
        <div className="tabel-omhulsel mb-4">
          <table className="w-full text-sm">
            <thead><tr><Th>Termijn</Th><Th r>Bedrag</Th></tr></thead>
            <tbody>
              {s.termijnen.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2"><span className="block font-medium">{t.omschrijving}</span>{t.geplandOp && <span className="block text-xs text-muted">gepland {korteDatum(t.geplandOp)}</span>}</td>
                  <td className="cijfers px-3 py-2 text-right font-semibold">{euro(t.bedrag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(s.uren.length > 0 || s.ritten.length > 0) && (
        <div className="tabel-omhulsel">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Datum</Th>
                <Th>{vast ? "Verantwoorde uren" : "Regel"}</Th>
                <Th r>Uren</Th>
                <Th r>Bedrag</Th>
                <Th r></Th>
              </tr>
            </thead>
            <tbody>
              {s.uren.map((u) => (
                <tr key={u.id} className={`border-b border-line last:border-0 ${u.minuten < 0 ? "text-muted" : ""}`}>
                  <td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(u.datum)}</td>
                  <td className="px-3 py-2">
                    <span className="block font-medium">{u.onderdeel} <span className="font-normal text-muted">· {u.medewerker}</span></span>
                    <span className="block text-xs text-muted">{u.omschrijving ?? ""}</span>
                  </td>
                  <td className="cijfers px-3 py-2 text-right">{minutenAlsTijd(u.minuten)}</td>
                  <td className="cijfers px-3 py-2 text-right">{vast ? "—" : euro(u.omzet)}</td>
                  <td className="px-3 py-2 text-right">
                    {!vast && u.status === "gefactureerd" && !u.gecorrigeerd && u.minuten > 0 && (
                      <details className="inline-block text-left">
                        <summary className="knop knop-kaal knop-klein cursor-pointer list-none">Corrigeren</summary>
                        <form action={corrigeer} className="kaart absolute z-10 mt-1 flex w-72 flex-col gap-2 p-3 shadow-lg">
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="referentie" value={referentie} />
                          <p className="text-xs text-muted">
                            Het origineel blijft staan; er komt een tegenboeking van {minutenAlsTijd(-u.minuten)} bij
                            en, als je een nieuwe tijd invult, een nieuwe regel. Beide in de huidige periode, op de volgende factuur.
                          </p>
                          <label className="flex flex-col gap-1"><span className="label">Nieuwe tijd (leeg = crediteren)</span>
                            <input name="nieuweTijd" placeholder="bijv. 2:30" className="veld cijfers min-h-9 py-1" /></label>
                          <label className="flex flex-col gap-1"><span className="label">Waarom</span>
                            <input name="toelichting" required maxLength={200} className="veld min-h-9 py-1" placeholder="Komt op de specificatie" /></label>
                          <button type="submit" className="knop knop-primair knop-klein">Boek correctie</button>
                        </form>
                      </details>
                    )}
                    {u.gecorrigeerd && <span className="label">gecorrigeerd</span>}
                  </td>
                </tr>
              ))}
              {s.ritten.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="cijfers px-3 py-2 whitespace-nowrap">{korteDatum(r.datum)}</td>
                  <td className="px-3 py-2"><span className="block font-medium">Rit · {r.medewerker}</span><span className="block text-xs text-muted">{r.doel}{r.omschrijving ? ` · ${r.omschrijving}` : ""}</span></td>
                  <td className="cijfers px-3 py-2 text-right">{getal(r.totaalKm, 0)} km</td>
                  <td className="cijfers px-3 py-2 text-right">{euro(r.kmBedrag)}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        {vast
          ? "Bij een vaste prijs staan de uren als verantwoording op de specificatie, zonder bedrag. Klopt een termijn niet, dan volgt een creditnota in je boekhouding; hier blijft de historie staan."
          : "Gefactureerde regels zijn op slot. Een correctie maakt een tegenboeking in de huidige periode; die verschijnt in het volgende factuurvoorstel van dit project."}
      </p>
    </div>
  );
}
