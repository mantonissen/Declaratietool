/** Project-URL en anon key; zonder die twee kan niemand inloggen. */
export function supabaseInstellingen(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL en SUPABASE_ANON_KEY ontbreken.");
  }
  return { url, key };
}
