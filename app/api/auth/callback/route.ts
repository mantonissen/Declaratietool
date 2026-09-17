import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { huidigeSessie } from "@/lib/auth";
import { supabaseInstellingen } from "@/lib/supabase";

/** Hier komt de gebruiker terug van Google of Microsoft, met een code. */
export async function GET(request: Request) {
  const adres = new URL(request.url);
  const code = adres.searchParams.get("code");
  const terug = (fout: string) =>
    NextResponse.redirect(new URL(`/login?fout=${fout}`, adres.origin));

  if (!code) return terug("geen-code");

  const jar = await cookies();
  const { url, key } = supabaseInstellingen();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lijst) => lijst.forEach(({ name, value, options }) => jar.set(name, value, options)),
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
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
