import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE_NAAM, devModusActief } from "@/lib/auth";

export async function GET(request: Request) {
  const jar = await cookies();
  if (devModusActief()) {
    jar.delete(DEV_COOKIE_NAAM);
  } else {
    // Supabase bewaart zijn sessie in cookies met een sb-voorvoegsel.
    for (const c of jar.getAll()) {
      if (c.name.startsWith("sb-")) jar.delete(c.name);
    }
  }
  return NextResponse.redirect(new URL("/login", request.url));
}
