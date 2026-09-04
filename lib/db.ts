import "server-only";
import postgres from "postgres";

// Eén verbinding per proces. Next maakt in ontwikkeling meerdere modules aan
// bij hot reload; de globale cache voorkomt dat het aantal verbindingen
// oploopt.
const globalVoorDb = globalThis as unknown as { sql?: postgres.Sql };

function maakVerbinding(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ontbreekt. Kopieer .env.example naar .env en vul hem in.",
    );
  }
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    // De datums in dit model zijn kalenderdatums zonder tijdzone. Zonder deze
    // omzetting maakt de driver er Date-objecten van die in een andere zone
    // een dag kunnen verschuiven.
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (v: string) => v,
        parse: (v: string) => v,
      },
    },
  });
}

export const sql: postgres.Sql = globalVoorDb.sql ?? maakVerbinding();
if (process.env.NODE_ENV !== "production") globalVoorDb.sql = sql;

/**
 * Voert werk uit namens een ingelogde gebruiker.
 *
 * De applicatie verbindt met een rol die alles mag; daarom wordt binnen de
 * transactie teruggeschakeld naar `authenticated` en de gebruiker gezet in
 * dezelfde instelling die Supabase gebruikt. Vanaf dat moment geldt het row
 * level security-beleid uit de migraties -- dat is de enige plek waar
 * afscherming staat, en die geldt hier dus net zo goed als in productie.
 *
 * `set local` en `set_config(..., true)` gelden alleen binnen de transactie,
 * dus na afloop staat de verbinding weer schoon in de pool.
 */
export async function alsGebruiker<T>(
  authUserId: string,
  werk: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${authUserId}, true)`;
    await tx`set local role authenticated`;
    return werk(tx);
  }) as Promise<T>;
}

/**
 * Werk zonder rolwissel, dus zonder afscherming. Alleen voor dingen die
 * plaatsvinden vóór er een gebruiker bekend is, zoals opzoeken wie er inlogt.
 */
export async function alsSysteem<T>(
  werk: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin((tx) => werk(tx)) as Promise<T>;
}
