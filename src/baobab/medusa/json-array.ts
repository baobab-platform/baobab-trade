/**
 * Medusa 2.21 inferred model.json() writes as Record<string, unknown>.
 * Existing Baobab JSONB columns intentionally contain JSON arrays. PostgreSQL
 * jsonb accepts both objects and arrays; this bridge preserves the JSON
 * payload byte-shape rather than silently wrapping it in an object.
 *
 * This is a typed boundary for known JSONB fields, NOT a way to suppress
 * model enum, tenant, actor, or relation authorization errors.
 */
export function medusaJsonArray<T>(value: readonly T[]): Record<string, unknown> {
  if (!Array.isArray(value)) {
    throw new Error("Medusa JSONB array boundary requires a real array")
  }
  return value as unknown as Record<string, unknown>
}

/** Fail closed when stored JSON was changed from array to map or null. */
export function readMedusaJsonArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    throw new Error("Medusa JSONB array contract violated")
  }
  return value as T[]
}
