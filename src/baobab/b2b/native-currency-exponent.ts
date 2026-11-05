import type { PgClient } from "../orders/postgres-governed-binding-persistence"

/** Actual Medusa Currency Module metadata on the Order owner's connection.
 * Monetary precision is never inferred from an ISO code, storefront session,
 * cart metadata or a JavaScript number. Empty/ambiguous/invalid rows deny.
 */
export async function readNativeCurrencyExponent(
  db: Pick<PgClient, "query">,
  currency: string,
): Promise<number> {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("NATIVE_CURRENCY_METADATA_UNAVAILABLE")
  }
  try {
    const result = await db.query(
      "SELECT decimal_digits FROM currency WHERE code=$1 FOR SHARE",
      [currency.toLowerCase()],
    )
    if (result.rows.length !== 1) throw new Error()
    const value = result.rows[0].decimal_digits
    // PostgreSQL int4 may be a JS number. A numeric string may be returned
    // by another trusted driver but must still represent an exact integer.
    const precision = typeof value === "number" ? value :
      typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ?
      Number(value) : NaN
    if (!Number.isSafeInteger(precision) || precision < 0 || precision > 9) {
      throw new Error()
    }
    return precision
  } catch {
    throw new Error("NATIVE_CURRENCY_METADATA_UNAVAILABLE")
  }
}
