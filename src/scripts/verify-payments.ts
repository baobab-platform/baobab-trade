import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  MedusaPaymentOrchestrationAdapter,
  PaymentBridgeRecordAdapter,
  ZURIBEANS_PAYMENT_POLICIES,
  reconcilePaymentWithErp,
  resolvePaymentProvider,
} from "../baobab/payments"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"

export default async function verifyPayments({ container }: ExecArgs): Promise<void> {
  const bridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const policies = await bridge.listPaymentPolicyBindings({})
  if (policies.length !== 2)
    throw new Error(`Expected 2 payment policies, found ${policies.length}`)

  const ug = ZURIBEANS_PAYMENT_POLICIES.find((policy) => policy.marketKey === "zuribeans-ug")
  if (!ug) throw new Error("Uganda payment policy is missing")
  const provider = resolvePaymentProvider(ug, "INVOICE_TERMS", "UGX")
  const adapter = new MedusaPaymentOrchestrationAdapter(
    new PaymentBridgeRecordAdapter(bridge, locking),
  )
  let payment = await adapter.initiate({
    paymentReference: "gate8-payment-ug-net30",
    orderReference: "gate8-order-ug-net30",
    organisationId: "gate8-b2b-organisation",
    marketKey: ug.marketKey,
    legalSellerKey: ug.legalSellerKey,
    method: "INVOICE_TERMS",
    terms: "NET_30",
    providerKey: provider.key,
    currency: ug.currency,
    amountMinor: 1_250_000,
    idempotencyKey: "gate8:initiate:ug:net30",
    correlationId: "gate8-payment-verification",
    dueAt: new Date(Date.now() + 30 * 86_400_000),
  })
  payment = await adapter.transition(payment, "PENDING", "gate8:pending:ug:net30", {
    status: "AWAITING_ERP_RECEIVABLE",
  })
  if (payment.status !== "PENDING") throw new Error("Invoice-terms payment did not remain pending")

  const pending = reconcilePaymentWithErp({
    commerceStatus: payment.status,
    commerceAmountMinor: payment.amountMinor,
    commerceCurrency: payment.currency,
  })
  const [existing] = await bridge.listPaymentReconciliations({
    source_idempotency_key: "gate8:reconcile:ug:net30",
  })
  if (!existing) {
    await bridge.createPaymentReconciliations({
      payment_id: payment.id,
      commerce_status: payment.status,
      commerce_amount_minor: payment.amountMinor,
      commerce_currency: payment.currency,
      amount_delta_minor: pending.amountDeltaMinor,
      status: pending.status,
      reasons: pending.reasons,
      source_idempotency_key: "gate8:reconcile:ug:net30",
      observed_at: new Date(),
    })
  }
  const reconciliations = await bridge.listPaymentReconciliations({ payment_id: payment.id })
  if (reconciliations.length !== 1 || reconciliations[0].status !== "PENDING_ERP") {
    throw new Error("Missing explicit Commerce-to-ERP reconciliation state")
  }
  const replay = await adapter.initiate({ ...payment, idempotencyKey: "gate8:initiate:ug:net30" })
  if (replay.id !== payment.id) throw new Error("Payment initiation is not idempotent")

  container
    .resolve("logger")
    .info("Verified Gate 8 payment policy, lifecycle, idempotency, and ERP reconciliation")
}
