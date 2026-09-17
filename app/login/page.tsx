import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { huidigeSessie, devModusActief, DEV_COOKIE_NAAM } from "@/lib/auth";
import { alsSysteem } from "@/lib/db";
import { supabaseInstellingen } from "@/lib/supabase";

async function kiesGebruiker(formData: FormData) {
  "use server";
  if (!devModusActief()) throw new Error("Alleen beschikbaar in dev-modus.");
  const id = String(formData.get("authUserId") ?? "");
  if (!id) return;
  const jar = await cookies();
  jar.set(DEV_COOKIE_NAAM, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/uren");
}

/**
 * Stuurt een inloglink, maar alleen naar actieve medewerkers. De melding is
 * altijd dezelfde, zodat je hier niet kunt uitproberen wie er werkt.
 */
async function stuurInloglink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const bekend = await alsSysteem(
    (tx) => tx`select 1 from medewerker where actief and lower(email) = ${email} limit 1`,
  );
  if (bekend[0]) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    const jar = await cookies();
    const { url, key } = supabaseInstellingen();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (lijst) => lijst.forEach(({ name, value, options }) => jar.set(name, value, options)),
      },
    });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/api/auth/callback` },
    });
    if (error) {
      console.error("Inloglink versturen mislukt:", error);
      redirect("/login?fout=mail");
    }
  }
  redirect("/login?verstuurd=1");
}

const FOUTEN: Record<string, string> = {
  mail: "De inloglink kon niet worden verstuurd. Probeer het over een paar minuten opnieuw.",
  onbekend:
    "Je bent ingelogd, maar dit e-mailadres staat niet als medewerker in de tool. Vraag de eigenaar om je toe te voegen.",
  code: "Inloggen is niet afgerond. Probeer het opnieuw.",
  "geen-code": "Inloggen is niet afgerond. Probeer het opnieuw.",
  start: "Inloggen kon niet starten. Staat deze aanbieder aan in Supabase?",
  aanbieder: "Onbekende manier van inloggen.",
};

export default async function LoginPagina({
  searchParams,
}: {
  searchParams: Promise<{ fout?: string; verstuurd?: string }>;
}) {
  const { fout, verstuurd } = await searchParams;
  if (await huidigeSessie()) redirect("/uren");

  const dev = devModusActief();
  const medewerkers = dev
    ? await alsSysteem(
        (tx) => tx`
          select m.auth_user_id, m.naam, m.rechten, f.naam as functie
          from medewerker m
          left join functie f on f.id = m.functie_id
          where m.actief and m.auth_user_id is not null
          order by m.rechten desc, m.naam
        `,
      )
    : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <p className="label">Declaratietool</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Inloggen</h1>

      {dev ? (
        <>
          <p className="mt-3 text-sm text-ink-2">
            Ontwikkelmodus: kies met wie je wilt werken. In productie gaat dit
            via je Google- of Microsoft-account.
          </p>
          {medewerkers.length === 0 ? (
            <p className="mt-6 rounded border border-warn bg-warn-bg p-4 text-sm">
              Er staan nog geen medewerkers met een account in de database.
              Draai <code className="cijfers">supabase/seed.sql</code> en voeg
              een medewerker toe met een <code className="cijfers">auth_user_id</code>.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-2">
              {medewerkers.map((m) => (
                <li key={m.auth_user_id as string}>
                  <form action={kiesGebruiker}>
                    <input
                      type="hidden"
                      name="authUserId"
                      value={m.auth_user_id as string}
                    />
                    <button
                      type="submit"
                      className="kaart flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"
                    >
                      <span>
                        <span className="block font-semibold">{m.naam as string}</span>
                        <span className="block text-xs text-muted">
                          {(m.functie as string) ?? "geen functie"}
                        </span>
                      </span>
                      <span className="label">{m.rechten as string}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink-2">
            Log in met het account waarmee je ook je mail leest, of vraag een
            inloglink aan.
          </p>
          {fout && (
            <p className="mt-4 rounded border border-warn bg-warn-bg p-4 text-sm">
              {FOUTEN[fout] ?? "Inloggen is mislukt."}
            </p>
          )}
          <div className="mt-6 flex flex-col gap-3">
            <a className="knop knop-primair" href="/api/auth/start?aanbieder=google">
              Doorgaan met Google
            </a>
            <a className="knop knop-stil" href="/api/auth/start?aanbieder=azure">
              Doorgaan met Microsoft
            </a>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            {verstuurd ? (
              <p className="rounded border border-line bg-surface-2 p-4 text-sm">
                Als dit adres bij ons bekend is, staat er nu een inloglink in je
                mail.
              </p>
            ) : (
              <form action={stuurInloglink} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="label">E-mailadres</span>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="veld"
                    placeholder="naam@bedrijf.nl"
                  />
                </label>
                <button type="submit" className="knop knop-stil">
                  Stuur inloglink
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </main>
  );
}
