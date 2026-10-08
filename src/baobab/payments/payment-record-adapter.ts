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

const snapshot = (payment: StoredPayment): PaymentSnapshot => ({
  id: payment.id,
  digitalEstate: payment.digital_estate,
  paymentReference: payment.payment_reference,
  orderReference: payment.order_reference,
  organisationId: payment.organisation_id ?? undefined,
  customerReference: payment.customer_reference ?? undefined,
  marketKey: payment.market_key,
  legalSellerKey: payment.legal_seller_key,
  method: payment.method,
  terms: payment.terms,
  providerKey: payment.provider_key,
  providerReference: payment.provider_reference,
  providerStatus: payment.provider_status,
  currency: payment.currency_code,
  amountMinor: Number(payment.amount_minor),
  status: payment.status,
  idempotencyKey: payment.source_idempotency_key,
  correlationId: payment.correlation_id,
  dueAt: payment.due_at ?? undefined,
})

export class PaymentBridgeRecordAdapter implements PaymentRecordRepository {
  constructor(
    private readonly bridge: PaymentBridgeModuleService,
    private readonly locking: ILockingModule,
  ) {}

  async findByIdempotencyKey(key: string): Promise<PaymentSnapshot | undefined> {
    const [payment] = await this.bridge.listCommercePayments({ source_idempotency_key: key })
    return payment ? snapshot(payment) : undefined
  }

  async create(
    command: InitiatePaymentCommand & { digitalEstate: string },
  ): Promise<PaymentSnapshot> {
    // Two concurrent initiate() calls sharing an idempotency key can both pass the port's
    // findByIdempotencyKey check before either has created a row — this lock (keyed on the
    // idempotency key, not the not-yet-assigned payment id) closes that gap by serializing the
    // check-then-create sequence itself. The unique-constraint catch below is defense in depth
    // for a lock provider that isn't fully distributed.
    return this.locking.execute(`payment-idempotency:${command.idempotencyKey}`, async () => {
      const existing = await this.findByIdempotencyKey(command.idempotencyKey)
      if (existing) return existing
      try {
        return snapshot(
          await this.bridge.createCommercePayments({
            digital_estate: command.digitalEstate,
            payment_reference: command.paymentReference,
            order_reference: command.orderReference,
            organisation_id: command.organisationId,
            customer_reference: command.customerReference,
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
    // Two concurrent transitions for the SAME payment — e.g. a legitimate "captured" webhook
    // racing a stale "failed"/timeout one, each with its own idempotency key — could otherwise
    // both read the same prior status, both pass the `current.status !== from` check, and the
    // later write win regardless of which event was actually correct. Locking on the payment id
    // (not the idempotency key) serializes every transition attempt for this payment.
    return this.locking.execute(`payment:${paymentId}`, async () => {
      const [existingTransition] = await this.bridge.listPaymentStatusTransitions({
        idempotency_key: idempotencyKey,
      })
      const [current] = await this.bridge.listCommercePayments({ id: paymentId })
      if (!current) throw new Error("Payment does not exist")
      if (existingTransition) {
        // An idempotency key is meant to replay the exact same transition, not silently no-op a
        // different one that happens to reuse it — that would hide a real caller bug.
        if (existingTransition.from_status !== from || existingTransition.to_status !== to)
          throw new Error("Payment idempotency key reused for a different transition")
        return snapshot(current)
      }
      if (current.status !== from)
        throw new Error("Payment state changed before transition could be applied")
      await this.bridge.createPaymentStatusTransitions({
        payment_id: paymentId,
        from_status: from,
        to_status: to,
        idempotency_key: idempotencyKey,
        provider_reference: providerReference,
        provider_status: providerStatus,
        occurred_at: new Date(),
      })
      return snapshot(
        await this.bridge.updateCommercePayments({
          id: paymentId,
          status: to,
          provider_reference: providerReference,
          provider_status: providerStatus,
        }),
      )
    })
  }
}
