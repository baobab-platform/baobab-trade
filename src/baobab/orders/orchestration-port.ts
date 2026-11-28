/**
 * ADR-0014 ORD-COM-010/021–023: a checkout idempotency key binds ONE
 * immutable purchase intent. Replays may have new correlation IDs but may
 * not change tenant, buyer Principal/organisation, Market identity/revision,
 * legal seller, currency, order reference or quoted total.
 *
 * A read-then-create seam is NOT atomic native Medusa commitment. Persistent
 * storage must still supply a tenant/principal-scoped unique key, a local
 * commit+outbox transaction, and committed-result-loss/replay adoption proof.
 */
export type OrderCommand = {
  orderReference: string
  tenantId: string
  principalId: string
  organisationId: string
  marketId: string
  marketRevision: number
  marketKey: string
  legalSellerKey: string
  currencyCode: string
  totalMinor: number
  idempotencyKey: string
  correlationId: string
}
export type OrderSnapshot = OrderCommand & { id: string; status: string }

export type OrderIdempotencyScope = Pick<
  OrderCommand,
  "tenantId" | "principalId" | "organisationId"
>

export interface OrderRecordRepository {
  findByIdempotencyKey(
    key: string,
    scope: OrderIdempotencyScope,
  ): Promise<OrderSnapshot | undefined>
  create(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}
export interface OrderOrchestrationPort {
  place(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}

const BOUND_FIELDS = [
  "orderReference",
  "tenantId",
  "principalId",
  "organisationId",
  "marketId",
  "marketRevision",
  "marketKey",
  "legalSellerKey",
  "currencyCode",
  "totalMinor",
  "idempotencyKey",
] as const

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const MARKET_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const MARKET_KEY = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/
const ORDER_ID = /^order_[A-Za-z0-9]+$/

const isBoundedReference = (value: unknown): value is string =>
  typeof value === "string" && REFERENCE.test(value)

export const assertUnchangedOrderAttempt = (
  command: OrderCommand,
  stored: OrderSnapshot,
): OrderSnapshot => {
  if (
    !stored ||
    !isBoundedReference(stored.id) ||
    !ORDER_ID.test(stored.id) ||
    BOUND_FIELDS.some((field) => stored[field] !== command[field])
  ) {
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
    if (!Number.isSafeInteger(command.marketRevision) || command.marketRevision < 1) {
      throw new Error("Order Market revision must be a positive integer")
    }
    if (typeof command.currencyCode !== "string" || !/^[A-Z]{3}$/.test(command.currencyCode)) {
      throw new Error("Order currency must use an uppercase ISO 4217 code")
    }
    for (const field of [
      "orderReference",
      "tenantId",
      "principalId",
      "organisationId",
      "legalSellerKey",
      "idempotencyKey",
      "correlationId",
    ] as const) {
      if (!isBoundedReference(command[field])) {
        throw new Error("Checkout requires nonempty and bounded authority identifiers")
      }
    }
    if (
      typeof command.marketId !== "string" ||
      command.marketId.length < 3 ||
      command.marketId.length > 63 ||
      !MARKET_ID.test(command.marketId) ||
      typeof command.marketKey !== "string" ||
      command.marketKey.length < 3 ||
      command.marketKey.length > 128 ||
      !MARKET_KEY.test(command.marketKey)
    ) {
      throw new Error("Checkout requires canonical CP Market identity and key")
    }

    const scope = {
      tenantId: command.tenantId,
      principalId: command.principalId,
      organisationId: command.organisationId,
    }
    const stored = await this.records.findByIdempotencyKey(command.idempotencyKey, scope)
    if (stored) return assertUnchangedOrderAttempt(command, stored)
    const created = await this.records.create(command)
    // Even the creation adapter may return an existing row after a unique-key
    // conflict: never accept a different purchase under the submitted key.
    return assertUnchangedOrderAttempt(command, created)
  }

  async retrieve(id: string): Promise<OrderSnapshot> {
    if (typeof id !== "string" || !ORDER_ID.test(id)) {
      throw new Error("Order identifier is invalid")
    }
    const stored = await this.records.retrieve(id)
    if (!stored || stored.id !== id) {
      throw new Error("Native Order retrieval returned a different order")
    }
    return stored
  }
}
