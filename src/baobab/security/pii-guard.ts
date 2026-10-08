/**
 * Consumer PII key names that must never appear in canonical event payloads
 * or structured logs, across either Digital Estate. Deliberately separate
 * from `forbiddenEventKeys` in `./b2b-isolation.ts` (which guards
 * credentials/secrets, not personal data): a canonical event or log line can
 * be free of both, either, or neither, and the two guards are composed
 * together wherever a payload needs to be fully checked (see
 * `src/scripts/verify-thamani-events.ts`).
 */
/** Shared with `../logging/logger.ts`'s log-redaction key pattern — one definition of "PII key name". */
export const PERSONAL_DATA_KEY_PATTERN =
  /(?:email|e[-_]?mail|phone(?:[-_]?number)?|first[-_]?name|last[-_]?name|full[-_]?name|customer[-_]?name|address(?:[-_]?(?:line)?[12])?|street|postal[-_]?code|zip[-_]?code|date[-_]?of[-_]?birth|dob|ssn|national[-_]?id|passport[-_]?number)$/i

export const assertNoPersonalData = (value: unknown, path = "data"): void => {
  if (Array.isArray(value))
    return value.forEach((item, index) => assertNoPersonalData(item, `${path}[${index}]`))
  if (typeof value !== "object" || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (PERSONAL_DATA_KEY_PATTERN.test(key)) throw new Error(`PERSONAL_DATA_FIELD:${path}.${key}`)
    assertNoPersonalData(nested, `${path}.${key}`)
  }
}
