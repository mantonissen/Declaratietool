import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseInstellingen } from "@/lib/supabase";

const AANBIEDERS = ["google", "azure"] as const;
type Aanbieder = (typeof AANBIEDERS)[number];

/**
 * Stuurt de gebruiker door naar Google of Microsoft. Supabase zet daarbij een
 * PKCE-cookie; de callback heeft die nodig om de code in te wisselen.
 */
export async function GET(request: Request) {
  const adres = new URL(request.url);
  const aanbieder = adres.searchParams.get("aanbieder") as Aanbieder | null;
  if (!aanbieder || !AANBIEDERS.includes(aanbieder)) {
    return NextResponse.redirect(new URL("/login?fout=aanbieder", adres.origin));
  }

  const jar = await cookies();
  const { url, key } = supabaseInstellingen();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lijst) => lijst.forEach(({ name, value, options }) => jar.set(name, value, options)),
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: aanbieder,
    options: {
      redirectTo: `${adres.origin}/api/auth/callback`,
      // Microsoft geeft het e-mailadres alleen mee als je erom vraagt.
      scopes: aanbieder === "azure" ? "email" : undefined,
    },
  });
  if (error || !data.url) {
    console.error("Inloggen starten mislukt:", error);
    return NextResponse.redirect(new URL("/login?fout=start", adres.origin));
  }
  return NextResponse.redirect(data.url);
}
