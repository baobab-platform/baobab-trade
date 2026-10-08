import { createHash } from "node:crypto"
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  MedusaPaymentOrchestrationAdapter,
  PaymentBridgeRecordAdapter,
  reconcilePaymentWithErp,
  resolvePaymentProvider,
} from "../baobab/payments"
import {
  THAMANI_PAYMENT_POLICIES,
  assertRefundRequest,
  assertValidPaymentWebhook,
  signPaymentWebhook,
} from "../baobab/thamani/payments"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"

export default async function verifyThamaniPayments({ container }: ExecArgs): Promise<void> {
  const bridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const stored = await bridge.listPaymentPolicyBindings({
    market_key: THAMANI_PAYMENT_POLICIES.map((policy) => policy.marketKey),
  })
  if (stored.length !== 2)
    throw new Error(`Expected 2 Thamani payment policies, found ${stored.length}`)
  const ug = THAMANI_PAYMENT_POLICIES.find((policy) => policy.marketKey === "thamani_ug")
  if (!ug) throw new Error("Thamani Uganda payment policy is missing")
  if (ug.allowedTerms.some((term) => term !== "PREPAID"))
    throw new Error("Thamani B2C must not expose invoice terms")
  const provider = resolvePaymentProvider(ug, "SELECTED_PSP", "UGX")
  const adapter = new MedusaPaymentOrchestrationAdapter(
    new PaymentBridgeRecordAdapter(bridge, locking),
  )
  let payment = await adapter.initiate({
    paymentReference: "thamani-gate11-payment-ug",
    orderReference: "thamani-gate11-order-ug",
    customerReference: "customer:thamani-gate11",
    marketKey: ug.marketKey,
    legalSellerKey: ug.legalSellerKey,
    method: "SELECTED_PSP",
    terms: "PREPAID",
    providerKey: provider.key,
    currency: ug.currency,
    amountMinor: 125_000,
    idempotencyKey: "thamani:gate11:initiate:ug",
    correlationId: "thamani-gate11-verification",
  })
  for (const [from, to] of [
    ["CREATED", "PENDING"],
    ["PENDING", "AUTHORIZED"],
    ["AUTHORIZED", "CAPTURED"],
  ] as const) {
    if (payment.status === from)
      payment = await adapter.transition(payment, to, `thamani:gate11:${to.toLowerCase()}:ug`, {
        reference: "sandbox-ug-transaction",
        status: to,
      })
  }
  if (payment.status !== "CAPTURED") throw new Error("Thamani consumer payment was not captured")

  const rawBody = JSON.stringify({ event: "payment.captured", payment: payment.paymentReference })
  const timestampSeconds = 1_800_000_000
  const webhook = {
    providerKey: provider.key,
    eventId: "sandbox-event-thamani-gate11",
    timestampSeconds,
    rawBody,
    signature: signPaymentWebhook(
      {
        providerKey: provider.key,
        eventId: "sandbox-event-thamani-gate11",
        timestampSeconds,
        rawBody,
      },
      "gate11-test-secret",
    ),
  }
  assertValidPaymentWebhook(webhook, "gate11-test-secret", timestampSeconds)
  const [receipt] = await bridge.listPaymentWebhookReceipts({
    provider_key: webhook.providerKey,
    provider_event_id: webhook.eventId,
  })
  if (!receipt)
    await bridge.createPaymentWebhookReceipts({
      provider_key: webhook.providerKey,
      provider_event_id: webhook.eventId,
      payload_sha256: createHash("sha256").update(rawBody).digest("hex"),
      signature_verified: true,
      occurred_at: new Date(timestampSeconds * 1000),
      processed_at: new Date(),
      processing_status: "PROCESSED",
    })

  assertRefundRequest({
    amountMinor: 25_000,
    capturedAmountMinor: payment.amountMinor,
    alreadyRefundedMinor: 0,
    currency: payment.currency,
    paymentCurrency: payment.currency,
    reason: "CUSTOMER_RETURN",
  })
  const [refund] = await bridge.listPaymentRefunds({
    source_idempotency_key: "thamani:gate11:refund:ug",
  })
  if (!refund)
    await bridge.createPaymentRefunds({
      refund_reference: "thamani-gate11-refund-ug",
      payment_id: payment.id,
      order_reference: payment.orderReference,
      provider_key: provider.key,
      provider_reference: "sandbox-refund-ug",
      currency_code: payment.currency,
      amount_minor: 25_000,
      reason: "CUSTOMER_RETURN",
      status: "SUCCEEDED",
      source_idempotency_key: "thamani:gate11:refund:ug",
      correlation_id: payment.correlationId,
    })

  const pending = reconcilePaymentWithErp({
    commerceStatus: payment.status,
    commerceAmountMinor: payment.amountMinor,
    commerceCurrency: payment.currency,
  })
  const [reconciliation] = await bridge.listPaymentReconciliations({
    source_idempotency_key: "thamani:gate11:reconcile:ug",
  })
  if (!reconciliation)
    await bridge.createPaymentReconciliations({
      payment_id: payment.id,
      commerce_status: payment.status,
      commerce_amount_minor: payment.amountMinor,
      commerce_currency: payment.currency,
      amount_delta_minor: pending.amountDeltaMinor,
      status: pending.status,
      reasons: pending.reasons,
      source_idempotency_key: "thamani:gate11:reconcile:ug",
      observed_at: new Date(),
    })
  container
    .resolve("logger")
    .info("Verified Thamani Gate 11 payment, webhook, refund, and ERP reconciliation")
}
