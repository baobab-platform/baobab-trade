/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It creates disposable ZuriBeans
 * fulfilment records via `MedusaFulfilmentAdapter`/`FulfilmentBridgeRecordAdapter`
 * — the real port and adapter every fulfilment flow uses — fires genuinely
 * concurrent operations against them, and asserts the outcome, then deletes
 * everything it created.
 *
 * A review of `FulfilmentBridgeRecordAdapter` found the same class of race
 * conditions as the payments adapter, plus one specific to fulfilment:
 *
 *   1. Two concurrent `request()` calls sharing an idempotency key could
 *      both pass the "does this already exist" check before either had
 *      created a row.
 *   2. Two concurrent `transition()` calls for the *same* fulfilment could
 *      both read the same prior status and the later write silently win —
 *      the exact same lost-update race the payments adapter had.
 *   3. `fulfilment_status_transition.idempotency_key` was uniquely
 *      constrained *globally*, not per fulfilment, and the prior-transition
 *      lookup matched on the key alone. If two *different* fulfilments ever
 *      used the same idempotency-key literal, the second fulfilment's real
 *      transition would be silently treated as "already applied" — the
 *      first fulfilment's transition row satisfying the check — and
 *      dropped without ever changing status or throwing.
 *
 * This script proves all three are closed: exactly one fulfilment is
 * created for a shared idempotency key; exactly one of two concurrent
 * transitions for the same fulfilment succeeds while the other is cleanly
 * rejected as stale; two *different* fulfilments reusing the same
 * idempotency-key literal each apply their own transition independently
 * instead of the second silently no-op'ing; and the SAME fulfilment
 * reusing its own idempotency key for a genuinely different transition is
 * rejected outright, since that would be a caller bug, not a safe replay.
 */
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  FulfilmentBridgeRecordAdapter,
  MedusaFulfilmentAdapter,
  ZURIBEANS_FULFILMENT_POLICIES,
  resolveFulfilmentProvider,
} from "../baobab/fulfilment"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const port = new MedusaFulfilmentAdapter(new FulfilmentBridgeRecordAdapter(bridge, locking))

  const fulfilmentIds: string[] = []
  try {
    const ug = ZURIBEANS_FULFILMENT_POLICIES.find((policy) => policy.marketKey === "zuribeans_ug")
    if (!ug) throw new Error("Uganda fulfilment policy is missing")
    const provider = resolveFulfilmentProvider(ug, "LOCAL_DELIVERY")

    // --- Case 1: concurrent request() calls sharing one idempotency key must create exactly one fulfilment ---
    const sharedIdempotencyKey = "regression:fulfilment-concurrency:request"
    const requestCommand = {
      fulfilmentReference: "regression-fulfilment-concurrency-request",
      orderReference: "regression-fulfilment-concurrency-order",
      organisationId: "regression-fulfilment-concurrency-org",
      marketKey: ug.marketKey,
      legalSellerKey: ug.legalSellerKey,
      sourceLocationKey: "UG-KLA-01",
      mode: "LOCAL_DELIVERY" as const,
      providerKey: provider.key,
      shipment: {
        originCountry: "UG",
        destinationCountry: "UG",
        grossWeightKg: 5,
        packageCount: 1,
      },
      idempotencyKey: sharedIdempotencyKey,
      correlationId: "regression-fulfilment-concurrency",
    }
    const [first, second] = await Promise.all([
      port.request(requestCommand),
      port.request(requestCommand),
    ])
    if (first.id !== second.id)
      throw new Error(
        "Concurrent request() calls sharing an idempotency key created two different fulfilments",
      )
    fulfilmentIds.push(first.id)
    const withSharedKey = await bridge.listCommerceFulfilments({
      source_idempotency_key: sharedIdempotencyKey,
    })
    if (withSharedKey.length !== 1)
      throw new Error(
        `Expected exactly 1 fulfilment for the shared idempotency key, found ${withSharedKey.length}`,
      )

    // --- Case 2: concurrent transitions for the SAME fulfilment must not lost-update each other ---
    const raceFulfilment = await port.request({
      ...requestCommand,
      fulfilmentReference: "regression-fulfilment-concurrency-transition",
      idempotencyKey: "regression:fulfilment-concurrency:transition-base",
    })
    fulfilmentIds.push(raceFulfilment.id)
    const outcomes = await Promise.allSettled([
      port.transition(raceFulfilment, "ACCEPTED", "regression:fulfilment-concurrency:to-accepted"),
      port.transition(
        raceFulfilment,
        "CANCELLED",
        "regression:fulfilment-concurrency:to-cancelled",
      ),
    ])
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled")
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    )
    if (fulfilled.length !== 1 || rejected.length !== 1)
      throw new Error(
        `Expected exactly one concurrent transition to succeed and one to be rejected as stale — got ${fulfilled.length} fulfilled, ${rejected.length} rejected.`,
      )
    if (
      !(rejected[0].reason instanceof Error) ||
      !rejected[0].reason.message.includes("state changed")
    )
      throw new Error(`Rejected transition had an unexpected error: ${String(rejected[0].reason)}`)
    const [finalFulfilment] = await bridge.listCommerceFulfilments({ id: raceFulfilment.id })
    if (!["ACCEPTED", "CANCELLED"].includes(finalFulfilment.status))
      throw new Error(
        `Unexpected final fulfilment status after concurrent transitions: ${finalFulfilment.status}`,
      )
    const recordedTransitions = await bridge.listFulfilmentStatusTransitions({
      fulfilment_id: raceFulfilment.id,
    })
    if (recordedTransitions.length !== 1)
      throw new Error(
        `Expected exactly 1 recorded transition, found ${recordedTransitions.length} — the lock did not serialize concurrent writers`,
      )

    // --- Case 3: two DIFFERENT fulfilments reusing the same idempotency-key literal must each apply independently ---
    const reusedKey = "regression:fulfilment-concurrency:reused-key"
    const fulfilmentA = await port.request({
      ...requestCommand,
      fulfilmentReference: "regression-fulfilment-concurrency-reuse-a",
      idempotencyKey: "regression:fulfilment-concurrency:reuse-a",
    })
    const fulfilmentB = await port.request({
      ...requestCommand,
      fulfilmentReference: "regression-fulfilment-concurrency-reuse-b",
      idempotencyKey: "regression:fulfilment-concurrency:reuse-b",
    })
    fulfilmentIds.push(fulfilmentA.id, fulfilmentB.id)
    const afterA = await port.transition(fulfilmentA, "ACCEPTED", reusedKey)
    if (afterA.status !== "ACCEPTED") throw new Error("Fulfilment A did not accept")
    // Fulfilment B reuses A's exact idempotency-key literal for its own, unrelated transition.
    // A record-adapter that matched on idempotency_key alone (not scoped to this fulfilment)
    // would see A's transition row, wrongly treat it as B's own prior replay, and silently
    // return B's unchanged REQUESTED snapshot without ever applying this transition — no error,
    // no state change, B silently stuck. Scoping the lookup (and the unique index) by
    // fulfilment_id means the same literal key is never a collision across fulfilments, so B's
    // transition must apply exactly as if the key were unique to it.
    const afterB = await port.transition(fulfilmentB, "CANCELLED", reusedKey)
    if (afterB.status !== "CANCELLED")
      throw new Error(
        `Fulfilment B's transition, which reused Fulfilment A's idempotency-key literal, did not apply (status: ${afterB.status}) — a cross-fulfilment idempotency collision would silently no-op it instead`,
      )

    // --- Case 4: the SAME fulfilment reusing its own idempotency key for a genuinely different transition must be rejected ---
    let reuseOnSameFulfilmentRejected = false
    try {
      // fulfilmentA is ACCEPTED; requesting CANCELLED under the SAME key it already used for
      // REQUESTED->ACCEPTED is a caller bug, not a safe replay.
      await port.transition(afterA, "CANCELLED", reusedKey)
    } catch (error) {
      reuseOnSameFulfilmentRejected =
        error instanceof Error && error.message.includes("reused for a different transition")
    }
    if (!reuseOnSameFulfilmentRejected)
      throw new Error(
        "Reusing Fulfilment A's own idempotency key for a different transition was not rejected",
      )

    container
      .resolve("logger")
      .info(
        "Verified fulfilment request()/transition() are race-safe and idempotency keys are scoped per fulfilment",
      )
  } finally {
    if (fulfilmentIds.length) {
      const transitions = await bridge.listFulfilmentStatusTransitions({
        fulfilment_id: fulfilmentIds,
      })
      if (transitions.length)
        await bridge.deleteFulfilmentStatusTransitions(transitions.map((t) => t.id))
      await bridge.deleteCommerceFulfilments(fulfilmentIds)
    }
  }
}
