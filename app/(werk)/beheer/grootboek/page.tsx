import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { getal } from "@/lib/datum";
import {
  grootboekrekeningen, btwTarieven, factuurInstellingen, volgendNummerSuggestie, REKENING_SOORTEN, SOORT_LABEL,
} from "@/lib/facturatie";
import { boekhoudInstellingen, RUBRIEKEN, RUBRIEK_LABEL, type Rubriek } from "@/lib/boekhouding";
import { grootboekErbij, grootboekOpslaan, btwOpslaan, factuurInstellingenOpslaan, boekhoudRekeningenOpslaan } from "./acties";

export const dynamic = "force-dynamic";

export default async function GrootboekPagina() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");

  const [rekeningen, btw, instellingen, boekhoud, volgendNummer, gebruik] = await Promise.all([
    grootboekrekeningen(sessie),
    btwTarieven(sessie),
    factuurInstellingen(sessie),
    boekhoudInstellingen(sessie),
    volgendNummerSuggestie(sessie),
    alsGebruiker(sessie.authUserId, (tx) => tx`
      select grootboek_id, count(*)::int as n from boekingsregel group by grootboek_id
    `),
  ]);
  const regelsPer = new Map(gebruik.map((g) => [g.grootboek_id as string, Number(g.n)]));
  const actieveRekeningen = rekeningen.filter((r) => r.actief);
  const balansrekeningen = actieveRekeningen.filter((r) => r.soort === "activa" || r.soort === "passiva" || r.soort === "eigen_vermogen");
  const vaste: [keyof typeof boekhoud, string, string][] = [
    ["rekeningDebiteuren", "Debiteuren", "Wat klanten nog moeten betalen"],
    ["rekeningCrediteuren", "Crediteuren", "Wat jij leveranciers nog moet betalen"],
    ["rekeningBank", "Bank (standaard betaalmiddel)", "Vooraf gekozen bij betalen"],
    ["rekeningBtwVerschuldigd", "Af te dragen btw", "Btw op verkoopfacturen"],
    ["rekeningBtwVoorbelasting", "Voorbelasting", "Btw op inkoop"],
    ["rekeningBtwAangifte", "Btw-aangifte te betalen", "Waar de aangifte naartoe schuift"],
  ];

  const standaarden: [keyof typeof instellingen, string, string][] = [
    ["grootboekUren", "Uren (nacalculatie)", "Urenregels op een nacalculatieproject"],
    ["grootboekReiskosten", "Reiskosten", "Kilometers en bezoeken"],
    ["grootboekTermijn", "Termijnen vaste prijs", "Opleveringen van een vaste prijs"],
    ["grootboekAbonnement", "Abonnementen", "Periodieke termijnen"],
    ["grootboekOverig", "Overig", "Handmatige regels op een factuur"],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Grootboek en btw</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Het rekeningschema van de boekhouding: balansrekeningen (activa, passiva, eigen
        vermogen) en de winst-en-verliesrekeningen (omzet, kosten). Elke factuurregel en
        inkoop wijst er een aan; de vaste rekeningen onderaan gebruiken de automatische boekingen.
      </p>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Grootboekrekeningen</h2>
        <ul className="kaart divide-y divide-line">
          {rekeningen.map((r) => {
            const n = regelsPer.get(r.id) ?? 0;
            return (
              <li key={r.id}>
                <form action={grootboekOpslaan} className="flex flex-wrap items-end gap-2 px-4 py-3">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="flex flex-col gap-1">
                    <span className="label">Nummer</span>
                    <input name="nummer" required defaultValue={r.nummer} maxLength={20} className="veld cijfers min-h-10 w-24 py-1" />
                  </label>
                  <label className="flex min-w-40 flex-1 flex-col gap-1">
                    <span className="label">
                      Naam <span className="normal-case tracking-normal text-muted">· {SOORT_LABEL[r.soort]} · {n === 0 ? "nog niet gebruikt" : `${n} boekingsregel${n === 1 ? "" : "s"}`}</span>
                    </span>
                    <input name="naam" required defaultValue={r.naam} maxLength={120} className="veld min-h-10 py-1" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">In de jaarrekening</span>
                    <select key={r.rubriek} name="rubriek" defaultValue={r.rubriek} className="veld min-h-10 w-52 py-1 text-sm">
                      {RUBRIEKEN.map((rb) => <option key={rb} value={rb}>{RUBRIEK_LABEL[rb as Rubriek]}</option>)}
                    </select>
                  </label>
                  <div className="flex min-h-10 items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="actief" value="aan" defaultChecked={r.actief} className="size-5 accent-[var(--accent)]" />
                      Actief
                    </label>
                    {(r.soort === "activa" || r.soort === "eigen_vermogen") && (
                      <label className="flex items-center gap-2 text-sm" title="Bank, kas of privé: waar betalingen vandaan komen of naartoe gaan">
                        <input type="checkbox" name="betaalmiddel" value="aan" defaultChecked={r.betaalmiddel} className="size-5 accent-[var(--accent)]" />
                        Betaalmiddel
                      </label>
                    )}
                    <button type="submit" className="knop knop-stil knop-klein">Opslaan</button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
        <form action={grootboekErbij} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Nummer</span>
            <input name="nummer" required maxLength={20} placeholder="8040" className="veld cijfers min-h-10 w-24 py-1" />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="label">Naam</span>
            <input name="naam" required maxLength={120} placeholder="Bijvoorbeeld: Omzet cursussen" className="veld min-h-10 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Soort</span>
            <select name="soort" defaultValue="kosten" className="veld min-h-10 py-1">
              {REKENING_SOORTEN.map((s) => <option key={s} value={s}>{SOORT_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="betaalmiddel" value="aan" className="size-5 accent-[var(--accent)]" />
            Betaalmiddel
          </label>
          <button type="submit" className="knop knop-primair">Rekening toevoegen</button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Een rekening waarop geboekt is kun je niet weghalen, wel inactief maken; boekingen
          houden hun rekening. Nummers volgen het gangbare Nederlandse schema: 0–1 balans,
          4 kosten, 8 omzet.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Vaste rekeningen van de boekhouding</h2>
        <p className="mb-3 text-sm text-muted">Waar de automatische boekingen op steunen. Verander ze alleen als je het schema anders inricht.</p>
        <form action={boekhoudRekeningenOpslaan} className="kaart flex flex-col gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {vaste.map(([sleutel, label, uitleg]) => (
              <label key={sleutel} className="flex flex-col gap-2">
                <span className="label">{label}</span>
                <select key={(boekhoud[sleutel] as string | null) ?? "geen"} name={sleutel} defaultValue={(boekhoud[sleutel] as string | null) ?? ""} className="veld">
                  <option value="">— kies —</option>
                  {balansrekeningen.map((r) => <option key={r.id} value={r.id}>{r.nummer} · {r.naam}</option>)}
                </select>
                <span className="text-xs text-muted">{uitleg}</span>
              </label>
            ))}
            <label className="flex flex-col gap-2">
              <span className="label">Btw-aangifte</span>
              <select key={boekhoud.btwInterval} name="btwInterval" defaultValue={boekhoud.btwInterval} className="veld">
                <option value="maand">Per maand</option><option value="kwartaal">Per kwartaal</option><option value="jaar">Per jaar</option>
              </select>
              <span className="text-xs text-muted">Het ritme dat de Belastingdienst je heeft opgelegd.</span>
            </label>
          </div>
          <button type="submit" className="knop knop-primair self-start">Opslaan</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Standaardrekening per soort regel</h2>
        <p className="mb-3 text-sm text-muted">
          Een project kan voor zijn hoofdomzet (uren of termijnen) een eigen rekening kiezen;
          per factuurregel kun je altijd nog afwijken.
        </p>
        <form action={factuurInstellingenOpslaan} className="kaart flex flex-col gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {standaarden.map(([sleutel, label, uitleg]) => (
              <label key={sleutel} className="flex flex-col gap-2">
                <span className="label">{label}</span>
                <select key={(instellingen[sleutel] as string | null) ?? "geen"} name={sleutel} defaultValue={(instellingen[sleutel] as string | null) ?? ""} className="veld">
                  <option value="">— geen —</option>
                  {actieveRekeningen.filter((r) => r.soort === "omzet").map((r) => (
                    <option key={r.id} value={r.id}>{r.nummer} · {r.naam}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">{uitleg}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="label">Betaaltermijn (dagen)</span>
              <input name="betaaltermijn" inputMode="numeric" required defaultValue={String(instellingen.betaaltermijnDagen)} className="veld cijfers" />
              <span className="text-xs text-muted">Bepaalt de vervaldatum op de factuur.</span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="label">Voorvoegsel factuurnummer</span>
              <input name="prefix" maxLength={10} defaultValue={instellingen.prefix} placeholder="leeg" className="veld cijfers" />
              <span className="text-xs text-muted">Volgende nummer: <span className="cijfers">{volgendNummer}</span>. De reeks loopt per jaar door en slaat nooit een nummer over.</span>
            </label>
            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="label">Voettekst op de factuur</span>
              <textarea name="voettekst" rows={2} maxLength={400} defaultValue={instellingen.voettekst ?? ""} className="veld min-h-16 py-2" placeholder="Bijvoorbeeld: Op al onze werkzaamheden zijn onze algemene voorwaarden van toepassing." />
            </label>
          </div>
          <button type="submit" className="knop knop-primair self-start">Opslaan</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Btw-tarieven</h2>
        <p className="mb-3 text-sm text-muted">
          Elke klant heeft een standaardcode (meestal hoog); verlegd en vrijgesteld staan op nul
          procent en gaan als aparte code mee naar de boekhouding.
        </p>
        <ul className="kaart divide-y divide-line">
          {btw.map((t) => (
            <li key={t.code}>
              <form action={btwOpslaan} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
                <input type="hidden" name="code" value={t.code} />
                <span className="min-w-40 flex-1">
                  <span className="block font-medium">{t.omschrijving}</span>
                  <span className="cijfers block text-xs text-muted">{t.code}</span>
                </span>
                <span className="flex items-center gap-3">
                  <label className="flex items-center gap-1">
                    <input name="percentage" inputMode="decimal" required defaultValue={getal(t.percentage, 2)} className="veld cijfers min-h-9 w-20 py-1 text-right" aria-label={`Percentage ${t.omschrijving}`} />
                    <span className="text-muted">%</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="actief" value="aan" defaultChecked={t.actief} className="size-5 accent-[var(--accent)]" />
                    Actief
                  </label>
                  <button type="submit" className="knop knop-stil knop-klein">Opslaan</button>
                </span>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
