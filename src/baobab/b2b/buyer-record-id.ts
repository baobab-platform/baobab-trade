import { randomUUID } from "node:crypto"

/**
 * Shared buyer-organisation/v1 uses lowercase opaque IDs. Medusa's default
 * generator appends an uppercase ULID, which cannot cross that boundary.
 * Mint the ID before native persistence so foreign keys, returned DTOs and
 * the Shared context all name the same record. Never lowercase an existing
 * ID or rewrite an explicitly supplied fixture/legacy identity.
 *
 * Preserve the generated service's single/batch overloads, transaction
 * context, receiver and native persistence/event behavior.
 */
export function withBuyerRecordIds<T extends (data: never, context?: never) => unknown>(
  create: T,
  prefix: "b2borg" | "b2bmem",
): T {
  const identify = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value
    const row = value as Record<string, unknown>
    if (row.id) return value
    return { ...row, id: `${prefix}_${randomUUID().replaceAll("-", "")}` }
  }
  return function (this: unknown, data: unknown, context: unknown) {
    const identified = Array.isArray(data) ? data.map(identify) : identify(data)
    return create.call(this, identified as never, context as never)
  } as T
}
