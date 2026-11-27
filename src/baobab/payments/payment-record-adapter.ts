import { MedusaError } from "@medusajs/framework/utils"
import type { ILockingModule } from "@medusajs/framework/types"
import type PaymentBridgeModuleService from "../../modules/payment-bridge/service"
import type {
  InitiatePaymentCommand,
  PaymentRecordRepository,
  PaymentSnapshot,
  PaymentStatus,
} from "./orchestration-port"

const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof MedusaError &&
  error.type === MedusaError.Types.INVALID_DATA &&
  error.message.includes("already exists")

type StoredPayment = Awaited<ReturnType<PaymentBridgeModuleService["listCommercePayments"]>>[number]

const requiredStoredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`Stored Payment is missing authoritative ${field}`)
  }
  return value
}

const exactMinorAmount = (value: unknown): number => {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : value !== null &&
            typeof value === "object" &&
            typeof (value as { toString?: unknown }).toString === "function"
          ? (value as { toString(): string }).toString()
          : ""
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error("Stored Payment amount_minor is not an exact non-negative integer")
  }
  const exact = BigInt(raw)
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored Payment amount_minor exceeds the safe integer boundary")
  }
  return Number(exact)
}

const snapshot = (payment: StoredPayment): PaymentSnapshot => {
  const providerEnvironment = payment.provider_environment
  if (providerEnvironment !== "SANDBOX" && providerEnvironment !== "LIVE") {
    throw new Error("Stored Payment has no valid provider environment")
  }
  const dueAt = payment.due_at
    ? payment.due_at instanceof Date
      ? payment.due_at
      : new Date(String(payment.due_at))
    : undefined
  if (dueAt && !Number.isFinite(dueAt.getTime())) {
    throw new Error("Stored Payment has an invalid due date")
  }
  return {
    id: requiredStoredText(payment.id, "native Payment ID"),
    digitalEstate: requiredStoredText(payment.digital_estate, "Digital Estate"),
    tenantId: requiredStoredText(payment.tenant_id, "tenant"),
    principalId: requiredStoredText(payment.principal_id, "initiating Principal"),
    merchantAccountId: requiredStoredText(payment.merchant_account_id, "merchant account"),
    providerEnvironment,
    paymentReference: requiredStoredText(payment.payment_reference, "payment reference"),
    orderReference: requiredStoredText(payment.order_reference, "order reference"),
    organisationId: payment.organisation_id ?? undefined,
    customerReference: payment.customer_reference ?? undefined,
    marketId: requiredStoredText(payment.market_id, "opaque CP Market ID"),
    marketRevision: payment.market_revision,
    marketKey: requiredStoredText(payment.market_key, "Market key"),
    legalSellerKey: requiredStoredText(payment.legal_seller_key, "legal seller"),
    method: payment.method,
    terms: payment.terms,
    providerKey: requiredStoredText(payment.provider_key, "provider"),
    providerReference: payment.provider_reference,
    providerStatus: payment.provider_status,
    currency: requiredStoredText(payment.currency_code, "currency"),
    amountMinor: exactMinorAmount(payment.amount_minor),
    status: payment.status,
    idempotencyKey: requiredStoredText(payment.source_idempotency_key, "idempotency key"),
    correlationId: requiredStoredText(payment.correlation_id, "correlation ID"),
    dueAt,
  }
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/

export class PaymentBridgeRecordAdapter implements PaymentRecordRepository {
  constructor(
    private readonly bridge: PaymentBridgeModuleService,
    private readonly locking: ILockingModule,
  ) {}

  async findByIdempotencyKey(key: string): Promise<PaymentSnapshot | undefined> {
    if (typeof key !== "string" || !REFERENCE.test(key)) {
      throw new Error("Payment idempotency key is invalid")
    }
    const [payment] = await this.bridge.listCommercePayments({ source_idempotency_key: key })
    return payment ? snapshot(payment) : undefined
  }

  async create(
    command: InitiatePaymentCommand & { digitalEstate: string },
  ): Promise<PaymentSnapshot> {
    return this.locking.execute(`payment-idempotency:${command.idempotencyKey}`, async () => {
      const existing = await this.findByIdempotencyKey(command.idempotencyKey)
      if (existing) return existing
      try {
        return snapshot(
          await this.bridge.createCommercePayments({
            digital_estate: command.digitalEstate,
            tenant_id: command.tenantId,
            principal_id: command.principalId,
            merchant_account_id: command.merchantAccountId,
            provider_environment: command.providerEnvironment,
            payment_reference: command.paymentReference,
            order_reference: command.orderReference,
            organisation_id: command.organisationId,
            customer_reference: command.customerReference,
            market_id: command.marketId,
            market_revision: command.marketRevision,
            market_key: command.marketKey,
            legal_seller_key: command.legalSellerKey,
            method: command.method,
            terms: command.terms,
            provider_key: command.providerKey,
            currency_code: command.currency,
            amount_minor: command.amountMinor,
            status: "CREATED",
            source_idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
            due_at: command.dueAt,
          }),
        )
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        const racedWith = await this.findByIdempotencyKey(command.idempotencyKey)
        if (!racedWith) throw error
        return racedWith
      }
    })
  }

  async transition(
    paymentId: string,
    from: PaymentStatus,
    to: PaymentStatus,
    idempotencyKey: string,
    providerReference?: string,
    providerStatus?: string,
  ): Promise<PaymentSnapshot> {
    if (!PAYMENT_ID.test(paymentId) || !REFERENCE.test(idempotencyKey)) {
      throw new Error("Payment transition identity is invalid")
    }
    return this.locking.execute(`payment:${paymentId}`, async () => {
      const [existingTransition] = await this.bridge.listPaymentStatusTransitions({
        idempotency_key: idempotencyKey,
      })
      const [current] = await this.bridge.listCommercePayments({ id: paymentId })
      if (!current) throw new Error("Payment does not exist")
      if (existingTransition) {
        if (
          existingTransition.payment_id !== paymentId ||
          existingTransition.from_status !== from ||
          existingTransition.to_status !== to ||
          (existingTransition.provider_reference ?? undefined) !== providerReference ||
          (existingTransition.provider_status ?? undefined) !== providerStatus
        ) {
          throw new Error("Payment idempotency key reused for a different transition")
        }
        if (
          current.status !== to ||
          (current.provider_reference ?? undefined) !== providerReference ||
          (current.provider_status ?? undefined) !== providerStatus
        ) {
          throw new Error("Payment transition log and current state disagree; reconciliation is required")
        }
        return snapshot(current)
      }
      if (current.status !== from) {
        throw new Error("Payment state changed before transition could be applied")
      }
      await this.bridge.createPaymentStatusTransitions({
        payment_id: paymentId,
        from_status: from,
        to_status: to,
        idempotency_key: idempotencyKey,
        provider_reference: providerReference,
        provider_status: providerStatus,
        occurred_at: new Date(),
      })
      const updated = snapshot(
        await this.bridge.updateCommercePayments({
          id: paymentId,
          status: to,
          provider_reference: providerReference,
          provider_status: providerStatus,
        }),
      )
      if (
        updated.id !== paymentId ||
        updated.status !== to ||
        (updated.providerReference ?? undefined) !== providerReference ||
        (updated.providerStatus ?? undefined) !== providerStatus
      ) {
        throw new Error("Payment transition writeback did not match the requested provider evidence")
      }
      return updated
    })
  }
}
