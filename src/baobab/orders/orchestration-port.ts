/**
 * ADR-0014 ORD-COM-010/021–023: a checkout idempotency key binds ONE
 * immutable purchase intent. Replays may have new correlation IDs but may
 * not change the buyer, legal seller, Market, currency or quoted total.
 *
 * A read-then-create seam is NOT atomic native Medusa commitment. Persistent
 * storage must still supply a unique key, a local commit+outbox transaction,
 * and a committed-result-loss/replay adoption test.
 */
export type OrderCommand = {
  orderReference: string
  organisationId: string
  marketKey: string
  legalSellerKey: string
  currencyCode: string
  totalMinor: number
  idempotencyKey: string
  correlationId: string
}
export type OrderSnapshot = OrderCommand & { id: string; status: string }

export interface OrderRecordRepository {
  findByIdempotencyKey(key: string): Promise<OrderSnapshot | undefined>
  create(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}
export interface OrderOrchestrationPort {
  place(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}

const BOUND_FIELDS = [
  "orderReference",
  "organisationId",
  "marketKey",
  "legalSellerKey",
  "currencyCode",
  "totalMinor",
  "idempotencyKey",
] as const

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/

export const assertUnchangedOrderAttempt = (
  command: OrderCommand,
  stored: OrderSnapshot,
): OrderSnapshot => {
  if (!stored || !stored.id || BOUND_FIELDS.some((field) => stored[field] !== command[field])) {
    throw new Error("Checkout replay refused: the idempotency key belongs to a different purchase")
  }
  return stored
}

export class MedusaOrderOrchestrationAdapter implements OrderOrchestrationPort {
  constructor(private readonly records: OrderRecordRepository) {}

  async place(command: OrderCommand): Promise<OrderSnapshot> {
    if (!Number.isSafeInteger(command.totalMinor) || command.totalMinor < 0) {
      throw new Error("Order total must be a non-negative safe integer")
    }
    if (!/^[A-Z]{3}$/.test(command.currencyCode)) {
      throw new Error("Order currency must use an uppercase ISO 4217 code")
    }
    for (const field of [
      "orderReference",
      "organisationId",
      "marketKey",
      "legalSellerKey",
      "idempotencyKey",
      "correlationId",
    ] as const) {
      if (!REFERENCE.test(command[field] ?? "")) {
        throw new Error("Checkout requires nonempty and bounded authority identifiers")
      }
    }

    const stored = await this.records.findByIdempotencyKey(command.idempotencyKey)
    if (stored) return assertUnchangedOrderAttempt(command, stored)
    const created = await this.records.create(command)
    // Even the creation adapter may return an existing row after a unique-key
    // conflict: never accept a different purchase under the submitted key.
    return assertUnchangedOrderAttempt(command, created)
  }

  retrieve(id: string): Promise<OrderSnapshot> {
    if (!REFERENCE.test(id ?? "")) throw new Error("Order identifier is invalid")
    return this.records.retrieve(id)
  }
}
