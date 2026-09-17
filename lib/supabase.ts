import "server-only";
import { createClient } from "@supabase/supabase-js";
import { alsSysteem } from "./db";

/** Project-URL en anon key; zonder die twee kan niemand inloggen. */
export function supabaseInstellingen(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL en SUPABASE_ANON_KEY ontbreken.");
  }
  return { url, key };
}

export const MIN_WACHTWOORD = 10;

/**
 * Zet het wachtwoord van een medewerker. Heeft die nog geen account, dan
 * maken we het aan en koppelen het meteen. Gebruikt de service-role-sleutel,
 * die alles mag: alleen aanroepen nadat vaststaat dat dit de eigenaar is.
 */
export async function stelWachtwoordIn(medewerkerId: string, wachtwoord: string): Promise<void> {
  const { url } = supabaseInstellingen();
  const sleutel = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sleutel) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  if (wachtwoord.length < MIN_WACHTWOORD) {
    throw new Error(`Een wachtwoord heeft minstens ${MIN_WACHTWOORD} tekens.`);
  }

  const [m] = await alsSysteem(
    (tx) => tx`select email, auth_user_id from medewerker where id = ${medewerkerId}`,
  );
  if (!m) throw new Error("Medewerker niet gevonden.");
  if (!m.email) throw new Error("Deze medewerker heeft geen e-mailadres.");

  const admin = createClient(url, sleutel, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;

  let authUserId = m.auth_user_id as string | null;
  if (!authUserId) {
    const email = String(m.email).toLowerCase();
    const { data, error } = await admin.createUser({ email, password: wachtwoord, email_confirm: true });
    if (data.user) {
      authUserId = data.user.id;
    } else if (error?.code === "email_exists") {
      // Bestaat al, bijvoorbeeld van een eerdere poging: opzoeken en hergebruiken.
      const { data: lijst, error: fout } = await admin.listUsers({ perPage: 1000 });
      if (fout) throw fout;
      authUserId = lijst.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (!authUserId) throw error;
    } else {
      throw error ?? new Error("Account aanmaken mislukt.");
    }
    await alsSysteem(
      (tx) => tx`update medewerker set auth_user_id = ${authUserId} where id = ${medewerkerId}`,
    );
  }

  const { error } = await admin.updateUserById(authUserId, { password: wachtwoord, email_confirm: true });
  if (error) throw error;
}
