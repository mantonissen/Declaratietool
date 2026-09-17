import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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

async function inloggenMetWachtwoord(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const wachtwoord = String(formData.get("wachtwoord") ?? "");
  if (!email || !wachtwoord) redirect("/login?fout=wachtwoord");

  const jar = await cookies();
  const { url, key } = supabaseInstellingen();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lijst) => lijst.forEach(({ name, value, options }) => jar.set(name, value, options)),
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: wachtwoord });
  // Eén melding voor een onbekend adres en een fout wachtwoord.
  if (error || !data.user) redirect("/login?fout=wachtwoord");

  // Account zonder actieve medewerker (bijvoorbeeld uit dienst): niet binnenlaten.
  const medewerker = await alsSysteem(
    (tx) => tx`
      select 1 from medewerker
      where actief
        and (auth_user_id = ${data.user.id}
             or (auth_user_id is null and lower(email) = ${email}))
      limit 1
    `,
  );
  if (!medewerker[0]) {
    await supabase.auth.signOut();
    redirect("/login?fout=onbekend");
  }
  redirect("/uren");
}

const FOUTEN: Record<string, string> = {
  wachtwoord: "E-mailadres of wachtwoord klopt niet.",
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
  searchParams: Promise<{ fout?: string }>;
}) {
  const { fout } = await searchParams;
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
            Log in met je e-mailadres en wachtwoord, of met het account
            waarmee je ook je mail leest.
          </p>
          {fout && (
            <p className="mt-4 rounded border border-warn bg-warn-bg p-4 text-sm">
              {FOUTEN[fout] ?? "Inloggen is mislukt."}
            </p>
          )}
          <form action={inloggenMetWachtwoord} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="label">E-mailadres</span>
              <input name="email" type="email" required autoComplete="username" className="veld" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Wachtwoord</span>
              <input name="wachtwoord" type="password" required autoComplete="current-password" className="veld" />
            </label>
            <button type="submit" className="knop knop-primair">Inloggen</button>
          </form>
          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
            <a className="knop knop-stil" href="/api/auth/start?aanbieder=google">
              Doorgaan met Google
            </a>
            <a className="knop knop-stil" href="/api/auth/start?aanbieder=azure">
              Doorgaan met Microsoft
            </a>
          </div>
        </>
      )}
    </main>
  );
}
