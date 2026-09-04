import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { alsSysteem } from "./db";

export type Rechten = "medewerker" | "projectleider" | "eigenaar";

export type Sessie = {
  authUserId: string;
  medewerkerId: string;
  naam: string;
  rechten: Rechten;
};

const DEV_COOKIE = "declaratietool_dev_gebruiker";

function devModus(): boolean {
  const aan = process.env.AUTH_MODUS === "dev";
  if (aan && process.env.NODE_ENV === "production") {
    // Zonder deze grens zou één verkeerd gezette variabele de hele
    // afscherming omzeilen: in dev-modus kies je zelf wie je bent.
    throw new Error(
      "AUTH_MODUS=dev kan niet samen met NODE_ENV=production. " +
        "Zet AUTH_MODUS=supabase voordat je uitrolt.",
    );
  }
  return aan;
}

export function devModusActief(): boolean {
  return devModus();
}

/** Het account dat is ingelogd, nog zonder te kijken wie dat intern is. */
async function ingelogdAccount(): Promise<{ id: string; email: string | null } | null> {
  const jar = await cookies();

  if (devModus()) {
    const id = jar.get(DEV_COOKIE)?.value;
    return id ? { id, email: null } : null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY ontbreken.",
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      // In een server component mag je geen cookies zetten; Supabase
      // ververst het token dan via de middleware.
      setAll: () => {},
    },
  });

  // getUser() controleert het token bij Supabase zelf. getSession() doet dat
  // niet en is daarom hier niet goed genoeg.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * De ingelogde medewerker, of null. Wordt op elke beschermde pagina
 * aangeroepen; het opzoeken gebeurt zonder afscherming omdat op dat moment
 * nog niet vaststaat wie de gebruiker is.
 *
 * Een medewerker die door de eigenaar is aangemaakt heeft nog geen account.
 * Logt er iemand in met precies dat e-mailadres, dan wordt het account
 * eenmalig gekoppeld. Zo hoeft er geen SQL aan te pas te komen om een collega
 * binnen te laten.
 */
export async function huidigeSessie(): Promise<Sessie | null> {
  const account = await ingelogdAccount();
  if (!account) return null;
  const authUserId = account.id;

  let rijen = await alsSysteem(
    (tx) => tx`
      select id, naam, rechten
      from medewerker
      where auth_user_id = ${authUserId} and actief
      limit 1
    `,
  );

  if (!rijen[0] && account.email) {
    rijen = await alsSysteem(
      (tx) => tx`
        update medewerker
        set auth_user_id = ${authUserId}
        where auth_user_id is null
          and actief
          and lower(email) = lower(${account.email})
        returning id, naam, rechten
      `,
    );
  }

  const rij = rijen[0];
  if (!rij) return null;

  return {
    authUserId,
    medewerkerId: rij.id as string,
    naam: rij.naam as string,
    rechten: rij.rechten as Rechten,
  };
}

/** Zoals huidigeSessie, maar gooit als er niemand is ingelogd. */
export async function vereisteSessie(): Promise<Sessie> {
  const sessie = await huidigeSessie();
  if (!sessie) throw new Error("Niet ingelogd");
  return sessie;
}

export function magBeheren(rechten: Rechten): boolean {
  return rechten === "projectleider" || rechten === "eigenaar";
}

export function zietBedragen(rechten: Rechten): boolean {
  return rechten === "projectleider" || rechten === "eigenaar";
}

export const DEV_COOKIE_NAAM = DEV_COOKIE;
