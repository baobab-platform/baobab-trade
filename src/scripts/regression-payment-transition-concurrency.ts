/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It creates disposable ZuriBeans
 * payment records via `MedusaPaymentOrchestrationAdapter`/`PaymentBridgeRecordAdapter`
 * — the real port and adapter every payment flow uses — fires genuinely
 * concurrent operations against them with `Promise.all`/`Promise.allSettled`,
 * and asserts the outcome, then deletes everything it created.
 *
 * A review of `PaymentBridgeRecordAdapter` found two race conditions that a
 * sequential-await unit test cannot reproduce, since a race only exists when
 * two calls are genuinely in flight at once:
 *
 *   1. Two concurrent `initiate()` calls sharing an idempotency key could
 *      both pass the "does this already exist" check before either had
 *      created a row, producing two payments (or an unhandled unique-
 *      constraint error) instead of one.
 *   2. Two concurrent `transition()` calls for the *same* payment — e.g. a
 *      legitimate "captured" webhook racing a stale "failed"/timeout one —
 *      could both read the same prior status, both pass the `status !== from`
 *      check, and the later write silently win over the earlier one (a lost
 *      update).
 *
 * The fix wraps both operations in Medusa's own Locking module
 * (`Modules.LOCKING`, the same primitive `acquireLockStep` uses inside
 * workflows) keyed on the idempotency key and the payment id respectively.
 * This script proves that under real concurrent execution: exactly one
 * payment is created for a shared idempotency key, and exactly one of two
 * concurrent transitions succeeds while the other is cleanly rejected as
 * stale — never silently lost.
 */
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  MedusaPaymentOrchestrationAdapter,
  PaymentBridgeRecordAdapter,
  ZURIBEANS_PAYMENT_POLICIES,
  resolvePaymentProvider,
} from "../baobab/payments"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const adapter = new MedusaPaymentOrchestrationAdapter(
    new PaymentBridgeRecordAdapter(bridge, locking),
  )

  const paymentIds: string[] = []
  try {
    const ug = ZURIBEANS_PAYMENT_POLICIES.find((policy) => policy.marketKey === "zuribeans-ug")
    if (!ug) throw new Error("Uganda payment policy is missing")
    const provider = resolvePaymentProvider(ug, "INVOICE_TERMS", "UGX")

    // --- Case 1: concurrent initiate() calls sharing one idempotency key must create exactly one payment ---
    const sharedIdempotencyKey = "regression:payment-concurrency:initiate"
    const initiateCommand = {
      paymentReference: "regression-payment-concurrency-initiate",
      orderReference: "regression-payment-concurrency-order",
      organisationId: "regression-payment-concurrency-org",
      marketKey: ug.marketKey,
      legalSellerKey: ug.legalSellerKey,
      method: "INVOICE_TERMS" as const,
      terms: "NET_30" as const,
      providerKey: provider.key,
      currency: ug.currency,
      amountMinor: 500_000,
      idempotencyKey: sharedIdempotencyKey,
      correlationId: "regression-payment-concurrency",
    }
    const [first, second] = await Promise.all([
      adapter.initiate(initiateCommand),
      adapter.initiate(initiateCommand),
    ])
    if (first.id !== second.id)
      throw new Error(
        "Concurrent initiate() calls sharing an idempotency key created two different payments",
      )
    paymentIds.push(first.id)
    const withSharedKey = await bridge.listCommercePayments({
      source_idempotency_key: sharedIdempotencyKey,
    })
    if (withSharedKey.length !== 1)
      throw new Error(
        `Expected exactly 1 payment for the shared idempotency key, found ${withSharedKey.length}`,
      )

    // --- Case 2: concurrent transitions for the SAME payment must not lost-update each other ---
    const racePayment = await adapter.initiate({
      ...initiateCommand,
      paymentReference: "regression-payment-concurrency-transition",
      idempotencyKey: "regression:payment-concurrency:transition-base",
    })
    paymentIds.push(racePayment.id)
    const outcomes = await Promise.allSettled([
      adapter.transition(racePayment, "PENDING", "regression:payment-concurrency:to-pending", {
        status: "RACE_A",
      }),
      adapter.transition(
        racePayment,
        "AUTHORIZED",
        "regression:payment-concurrency:to-authorized",
        {
          status: "RACE_B",
        },
      ),
    ])
    const fulfilled = outcomes.filter(
      (
        outcome,
      ): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof adapter.transition>>> =>
        outcome.status === "fulfilled",
    )
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    )
    if (fulfilled.length !== 1 || rejected.length !== 1)
      throw new Error(
        `Expected exactly one concurrent transition to succeed and one to be rejected as stale — got ${fulfilled.length} fulfilled, ${rejected.length} rejected. A lost update would show as 2 fulfilled.`,
      )
    const rejectionReason = rejected[0].reason
    if (!(rejectionReason instanceof Error) || !rejectionReason.message.includes("state changed"))
      throw new Error(`Rejected transition had an unexpected error: ${String(rejectionReason)}`)
    const [finalPayment] = await bridge.listCommercePayments({ id: racePayment.id })
    if (!["PENDING", "AUTHORIZED"].includes(finalPayment.status))
      throw new Error(
        `Unexpected final payment status after concurrent transitions: ${finalPayment.status}`,
      )
    const recordedTransitions = await bridge.listPaymentStatusTransitions({
      payment_id: racePayment.id,
    })
    if (recordedTransitions.length !== 1)
      throw new Error(
        `Expected exactly 1 recorded transition, found ${recordedTransitions.length} — the lock did not serialize concurrent writers`,
      )

    container
      .resolve("logger")
      .info(
        "Verified payment initiate()/transition() are race-safe under real concurrent execution",
      )
  } finally {
    if (paymentIds.length) {
      const transitions = await bridge.listPaymentStatusTransitions({ payment_id: paymentIds })
      if (transitions.length)
        await bridge.deletePaymentStatusTransitions(transitions.map((t) => t.id))
      await bridge.deleteCommercePayments(paymentIds)
    }
  }
}
