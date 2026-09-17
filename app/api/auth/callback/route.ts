import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { huidigeSessie } from "@/lib/auth";
import { supabaseInstellingen } from "@/lib/supabase";

/**
 * Hier komt de gebruiker terug: van Google of Microsoft met een code, of via
 * een inloglink uit de mail met een token_hash (werkt ook op een ander apparaat).
 */
export async function GET(request: Request) {
  const adres = new URL(request.url);
  const code = adres.searchParams.get("code");
  const terug = (fout: string) =>
    NextResponse.redirect(new URL(`/login?fout=${fout}`, adres.origin));

  const tokenHash = adres.searchParams.get("token_hash");
  const type = adres.searchParams.get("type") as EmailOtpType | null;
  if (!code && !(tokenHash && type)) return terug("geen-code");

  const jar = await cookies();
  const { url, key } = supabaseInstellingen();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lijst) => lijst.forEach(({ name, value, options }) => jar.set(name, value, options)),
    },
  });

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
  if (error) {
    console.error("Code inwisselen mislukt:", error);
    return terug("code");
  }

  // Wel een account, maar niet als medewerker bekend: uitloggen en zeggen waarom.
  if (!(await huidigeSessie())) {
    await supabase.auth.signOut();
    return terug("onbekend");
  }
  return NextResponse.redirect(new URL("/uren", adres.origin));
}
