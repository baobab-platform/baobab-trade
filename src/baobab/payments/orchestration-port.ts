import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../context/digital-estates"
import type { PaymentMethod, PaymentTerms } from "./payment-config"

export type PaymentStatus =
  "CREATED" | "PENDING" | "AUTHORIZED" | "CAPTURED" | "SETTLED" | "FAILED" | "CANCELLED" | "UNKNOWN"

export type InitiatePaymentCommand = {
  paymentReference: string
  orderReference: string
  organisationId?: string
  customerReference?: string
  marketKey: string
  legalSellerKey: string
  method: PaymentMethod
  terms: PaymentTerms
  providerKey: string
  currency: string
  amountMinor: number
  idempotencyKey: string
  correlationId: string
  dueAt?: Date
}

export type PaymentSnapshot = InitiatePaymentCommand & {
  id: string
  digitalEstate: string
  status: PaymentStatus
  providerReference?: string | null
  providerStatus?: string | null
}

export interface PaymentRecordRepository {
  findByIdempotencyKey(key: string): Promise<PaymentSnapshot | undefined>
  create(command: InitiatePaymentCommand & { digitalEstate: string }): Promise<PaymentSnapshot>
  transition(
    paymentId: string,
    from: PaymentStatus,
    to: PaymentStatus,
    idempotencyKey: string,
    providerReference?: string,
    providerStatus?: string,
  ): Promise<PaymentSnapshot>
}

export interface PaymentOrchestrationPort {
  initiate(command: InitiatePaymentCommand): Promise<PaymentSnapshot>
  transition(
    payment: PaymentSnapshot,
    status: PaymentStatus,
    idempotencyKey: string,
    provider?: { reference?: string; status?: string },
  ): Promise<PaymentSnapshot>
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ["PENDING", "AUTHORIZED", "FAILED", "CANCELLED", "UNKNOWN"],
  PENDING: ["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "UNKNOWN"],
  AUTHORIZED: ["CAPTURED", "CANCELLED", "UNKNOWN"],
  CAPTURED: ["SETTLED", "UNKNOWN"],
  SETTLED: [],
  FAILED: [],
  CANCELLED: [],
  UNKNOWN: ["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
}

/**
 * A provider idempotency key binds one merchant, seller, buyer, currency,
 * amount and commercial term. Losing the response cannot permit another
 * payment attempt to adopt the original provider transaction.
 */
const REPLAY_FIELDS = [
  "paymentReference",
  "orderReference",
  "organisationId",
  "customerReference",
  "marketKey",
  "legalSellerKey",
  "method",
  "terms",
  "providerKey",
  "currency",
  "amountMinor",
  "idempotencyKey",
] as const

export const assertSamePaymentAttempt = (
  command: InitiatePaymentCommand & { digitalEstate: string },
  stored: PaymentSnapshot,
): PaymentSnapshot => {
  if (
    !stored ||
    !stored.id ||
    stored.digitalEstate !== command.digitalEstate ||
    REPLAY_FIELDS.some((field) => stored[field] !== command[field]) ||
    (stored.dueAt?.getTime() ?? null) !== (command.dueAt?.getTime() ?? null)
  ) {
    throw new Error("Payment idempotency key reused for a different financial attempt")
  }
  return stored
}

export class MedusaPaymentOrchestrationAdapter implements PaymentOrchestrationPort {
  constructor(private readonly records: PaymentRecordRepository) {}

  async initiate(command: InitiatePaymentCommand): Promise<PaymentSnapshot> {
    if (!Number.isSafeInteger(command.amountMinor) || command.amountMinor <= 0) {
      throw new Error("Payment amount must be a positive integer in minor units")
    }
    if (Boolean(command.organisationId) === Boolean(command.customerReference)) {
      throw new Error("Payment requires exactly one B2B organisation or B2C customer reference")
    }
    if (command.terms !== "PREPAID" && command.method !== "INVOICE_TERMS") {
      throw new Error("Commercial invoice terms require the INVOICE_TERMS method")
    }
    // organisationId/customerReference exclusivity is already enforced above — this is the same
    // trusted, explicit derivation tax and trade-readiness use, never inferred from Market or
    // currency (ZuriBeans and Thamani can share both per country).
    const digitalEstate = command.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
    if (
      !command.idempotencyKey ||
      !/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/.test(command.idempotencyKey)
    ) {
      throw new Error("Payment idempotency key must be a bounded opaque identifier")
    }
    const scoped = { ...command, digitalEstate }
    const existing = await this.records.findByIdempotencyKey(command.idempotencyKey)
    if (existing) {
      // Cross-tenant/merchant/amount reuse must not disclose provider or payment
      // details; a matching key is not an authorisation credential.
      return assertSamePaymentAttempt(scoped, existing)
    }
    // PaymentBridgeRecordAdapter holds the durable unique-key lock; it may
    // return a concurrent winner. The result STILL must match this attempt.
    return assertSamePaymentAttempt(scoped, await this.records.create(scoped))
  }

  async transition(
    payment: PaymentSnapshot,
    status: PaymentStatus,
    idempotencyKey: string,
    provider: { reference?: string; status?: string } = {},
  ): Promise<PaymentSnapshot> {
    if (!TRANSITIONS[payment.status].includes(status)) {
      throw new Error(`Invalid payment transition ${payment.status} -> ${status}`)
    }
    return this.records.transition(
      payment.id,
      payment.status,
      status,
      idempotencyKey,
      provider.reference,
      provider.status,
    )
  }
}
