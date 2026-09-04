import Link from "next/link";
import { redirect } from "next/navigation";
import { vereisteSessie } from "@/lib/auth";
import { alsGebruiker } from "@/lib/db";
import { werkInstellingenBij } from "../acties";

export const dynamic = "force-dynamic";

export default async function InstellingenPagina() {
  const sessie = await vereisteSessie();
  if (sessie.rechten !== "eigenaar") redirect("/beheer");

  const [i] = await alsGebruiker(sessie.authUserId, (tx) => tx`
    select bedrijfsnaam, adres, postcode, plaats, kvk_nummer, btw_nummer,
           iban, email, telefoon
    from instellingen
  `);
  const v = (k: string) => ((i?.[k] as string) ?? "");

  const velden: [string, string, string, string?][] = [
    ["bedrijfsnaam", "Bedrijfsnaam", v("bedrijfsnaam")],
    ["adres", "Adres", v("adres")],
    ["postcode", "Postcode", v("postcode")],
    ["plaats", "Plaats", v("plaats")],
    ["kvk", "KvK-nummer", v("kvk_nummer")],
    ["btw", "Btw-nummer", v("btw_nummer")],
    ["iban", "IBAN", v("iban")],
    ["email", "E-mailadres", v("email"), "email"],
    ["telefoon", "Telefoon", v("telefoon"), "tel"],
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 md:px-8 md:py-8">
      <Link href="/beheer" className="knop knop-kaal -ml-2">← Beheer</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Bedrijfsgegevens</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Dit komt bovenaan de urenspecificatie die je klanten krijgen.
      </p>
      <form action={werkInstellingenBij} className="kaart flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {velden.map(([naam, label, waarde, type]) => (
            <label key={naam} className={`flex flex-col gap-2 ${naam === "bedrijfsnaam" || naam === "adres" ? "sm:col-span-2" : ""}`}>
              <span className="label">{label}</span>
              <input name={naam} type={type ?? "text"} defaultValue={waarde} required={naam === "bedrijfsnaam"} maxLength={120} className={`veld ${naam === "iban" || naam === "kvk" || naam === "btw" ? "cijfers" : ""}`} />
            </label>
          ))}
        </div>
        <button type="submit" className="knop knop-primair self-start">Opslaan</button>
      </form>
    </div>
  );
}
