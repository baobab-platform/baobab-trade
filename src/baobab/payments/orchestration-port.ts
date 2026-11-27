import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../context/digital-estates"
import type { PaymentMethod, PaymentTerms } from "./payment-config"

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "SETTLED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN"

export type ProviderEnvironment = "SANDBOX" | "LIVE"

export type InitiatePaymentCommand = {
  paymentReference: string
  orderReference: string
  tenantId: string
  principalId: string
  organisationId?: string
  customerReference?: string
  marketKey: string
  legalSellerKey: string
  method: PaymentMethod
  terms: PaymentTerms
  providerKey: string
  merchantAccountId: string
  providerEnvironment: ProviderEnvironment
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

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const MARKET_KEY = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/

const isBoundedReference = (value: unknown): value is string =>
  typeof value === "string" && REFERENCE.test(value)

/**
 * A provider idempotency key binds one tenant, initiating Principal, buyer,
 * Digital Estate, Market, legal seller, merchant account/environment, currency,
 * amount and commercial term. Correlation IDs may change across retries.
 */
const REPLAY_FIELDS = [
  "paymentReference",
  "orderReference",
  "tenantId",
  "principalId",
  "organisationId",
  "customerReference",
  "marketKey",
  "legalSellerKey",
  "method",
  "terms",
  "providerKey",
  "merchantAccountId",
  "providerEnvironment",
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
    typeof stored.id !== "string" ||
    !PAYMENT_ID.test(stored.id) ||
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
    if (
      Boolean(command.organisationId) === Boolean(command.customerReference) ||
      (command.organisationId !== undefined && !isBoundedReference(command.organisationId)) ||
      (command.customerReference !== undefined && !isBoundedReference(command.customerReference))
    ) {
      throw new Error("Payment requires exactly one bounded B2B organisation or B2C customer reference")
    }
    if ((command.method === "INVOICE_TERMS") !== (command.terms !== "PREPAID")) {
      throw new Error("Invoice terms and payment method must agree")
    }
    if (
      command.providerEnvironment !== "SANDBOX" &&
      command.providerEnvironment !== "LIVE"
    ) {
      throw new Error("Payment provider environment must be explicit")
    }
    if (
      typeof command.marketKey !== "string" ||
      command.marketKey.length < 3 ||
      command.marketKey.length > 128 ||
      !MARKET_KEY.test(command.marketKey)
    ) {
      throw new Error("Payment requires a canonical Market key")
    }
    if (typeof command.currency !== "string" || !/^[A-Z]{3}$/.test(command.currency)) {
      throw new Error("Payment currency must be an uppercase ISO 4217 code")
    }
    for (const field of [
      "paymentReference",
      "orderReference",
      "tenantId",
      "principalId",
      "legalSellerKey",
      "providerKey",
      "merchantAccountId",
      "idempotencyKey",
      "correlationId",
    ] as const) {
      if (!isBoundedReference(command[field])) {
        throw new Error("Payment requires bounded tenant, Principal, seller and merchant identifiers")
      }
    }
    if (command.dueAt !== undefined && !Number.isFinite(command.dueAt.getTime())) {
      throw new Error("Payment due date must be a valid timestamp")
    }

    // This is the repository's existing one-party Digital Estate policy:
    // B2B organisation payments belong to ZuriBeans; B2C customer payments
    // belong to Thamani. The one-of constraint is enforced before this mapping.
    const digitalEstate = command.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
    const scoped = { ...command, digitalEstate }
    const existing = await this.records.findByIdempotencyKey(command.idempotencyKey)
    if (existing) return assertSamePaymentAttempt(scoped, existing)
    // The record adapter serializes creation under the durable unique key.
    return assertSamePaymentAttempt(scoped, await this.records.create(scoped))
  }

  async transition(
    payment: PaymentSnapshot,
    status: PaymentStatus,
    idempotencyKey: string,
    provider: { reference?: string; status?: string } = {},
  ): Promise<PaymentSnapshot> {
    if (!payment || !PAYMENT_ID.test(payment.id ?? "")) {
      throw new Error("Payment identifier is invalid")
    }
    if (!isBoundedReference(idempotencyKey)) {
      throw new Error("Payment transition idempotency key must be bounded")
    }
    if (!TRANSITIONS[payment.status]?.includes(status)) {
      throw new Error(`Invalid payment transition ${payment.status} -> ${status}`)
    }
    const providerEvidenceRequired =
      payment.status === "UNKNOWN" ||
      status === "AUTHORIZED" ||
      status === "CAPTURED" ||
      status === "SETTLED" ||
      status === "FAILED" ||
      (status === "CANCELLED" &&
        (payment.status === "AUTHORIZED" || payment.status === "UNKNOWN"))
    if (
      providerEvidenceRequired &&
      (!isBoundedReference(provider.reference) || !isBoundedReference(provider.status))
    ) {
      throw new Error("Payment state change requires provider reference and status evidence")
    }
    if (
      (provider.reference !== undefined && !isBoundedReference(provider.reference)) ||
      (provider.status !== undefined && !isBoundedReference(provider.status))
    ) {
      throw new Error("Payment provider evidence must be bounded")
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
