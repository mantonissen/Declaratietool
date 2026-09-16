import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Ververst het Supabase-token op elk verzoek. Server components mogen geen
 * cookies zetten, dus zonder deze stap loopt een sessie na een uur af.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (process.env.AUTH_MODUS === "dev" || !url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lijst, headers) => {
        lijst.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        lijst.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Niet voor statische bestanden, de cron en het inlogverkeer zelf.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|api/auth|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
