import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  FulfilmentBridgeRecordAdapter,
  MedusaFulfilmentAdapter,
  createIdempotentCommerceReturn,
  createIdempotentFulfilmentAllocations,
  createIdempotentFulfilmentOrderLine,
  reconcileFulfilment,
  resolveFulfilmentProvider,
} from "../baobab/fulfilment"
import {
  THAMANI_FULFILMENT_POLICIES,
  assertCompleteAllocation,
  assertReturnRequest,
} from "../baobab/thamani/fulfilment"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const policies = await bridge.listFulfilmentPolicyBindings({
    market_key: THAMANI_FULFILMENT_POLICIES.map((policy) => policy.marketKey),
  })
  if (policies.length !== 2)
    throw new Error(`Expected 2 Thamani fulfilment policies, found ${policies.length}`)
  const ug = THAMANI_FULFILMENT_POLICIES.find((policy) => policy.marketKey === "thamani_ug")
  if (!ug) throw new Error("Thamani Uganda fulfilment policy missing")
  const provider = resolveFulfilmentProvider(ug, "PARCEL_SHIPMENT")
  const port = new MedusaFulfilmentAdapter(new FulfilmentBridgeRecordAdapter(bridge, locking))
  let fulfilment = await port.request({
    fulfilmentReference: "thamani-gate12-parcel-ug",
    orderReference: "thamani-gate12-order-ug",
    customerReference: "customer:thamani-gate12",
    marketKey: ug.marketKey,
    legalSellerKey: ug.legalSellerKey,
    sourceLocationKey: "TH-UG-KLA-01",
    mode: "PARCEL_SHIPMENT",
    providerKey: provider.key,
    shipment: {
      originCountry: "UG",
      destinationCountry: "UG",
      grossWeightKg: 1.2,
      packageCount: 2,
    },
    idempotencyKey: "thamani:gate12:request:ug",
    correlationId: "thamani-gate12-verification",
  })
  const allocations = [
    { orderLineReference: "line-1", sourceLocationKey: "TH-UG-KLA-01", quantity: 1 },
    { orderLineReference: "line-1", sourceLocationKey: "TH-UG-EBB-01", quantity: 1 },
  ] as const
  assertCompleteAllocation({ "line-1": 2 }, allocations)
  await createIdempotentFulfilmentOrderLine(bridge, locking, {
    fulfilmentId: fulfilment.id,
    orderLineReference: "line-1",
    fulfilledQuantity: 2,
  })
  await createIdempotentFulfilmentAllocations(bridge, locking, {
    fulfilmentId: fulfilment.id,
    orderLineReference: "line-1",
    allocations,
  })
  for (const [from, to] of [
    ["REQUESTED", "ACCEPTED"],
    ["ACCEPTED", "ALLOCATED"],
  ] as const)
    if (fulfilment.status === from)
      fulfilment = await port.transition(fulfilment, to, `thamani:gate12:${to.toLowerCase()}`)
  if (fulfilment.status === "ALLOCATED")
    fulfilment = await port.transition(fulfilment, "DISPATCHED", "thamani:gate12:dispatched", {
      shipmentReference: "SHIP:TH-GATE12",
      carrierReference: "manual-thamani-ug",
      trackingReference: "TH-GATE12-TRACK",
      trackingUrl: "https://tracking.example.invalid/TH-GATE12-TRACK",
      dispatchDate: new Date(),
    })
  if (fulfilment.status !== "DISPATCHED" || !fulfilment.trackingReference)
    throw new Error("Thamani parcel tracking evidence missing")
  assertReturnRequest({
    quantity: 1,
    fulfilledQuantity: 2,
    alreadyReturnedQuantity: 0,
    reason: "DAMAGED",
  })
  await createIdempotentCommerceReturn(bridge, locking, {
    returnReference: "thamani-gate12-return-1",
    fulfilmentId: fulfilment.id,
    orderReference: fulfilment.orderReference,
    orderLineReference: "line-1",
    quantity: 1,
    reason: "DAMAGED",
    disposition: "QUARANTINE",
    status: "AUTHORIZED",
    idempotencyKey: "thamani:gate12:return:1",
    correlationId: fulfilment.correlationId,
  })
  const result = reconcileFulfilment({
    commerceStatus: fulfilment.status,
    executionStatus: "DISPATCHED",
    shipmentReference: fulfilment.shipmentReference,
  })
  if (result.status !== "MATCHED") throw new Error("Thamani fulfilment execution did not reconcile")
  const [reconciliation] = await bridge.listFulfilmentReconciliations({
    source_idempotency_key: "thamani:gate12:reconcile",
  })
  if (!reconciliation)
    await bridge.createFulfilmentReconciliations({
      fulfilment_id: fulfilment.id,
      execution_reference: fulfilment.shipmentReference,
      commerce_status: fulfilment.status,
      execution_status: "DISPATCHED",
      status: result.status,
      reasons: result.reasons,
      source_idempotency_key: "thamani:gate12:reconcile",
      observed_at: new Date(),
    })
  container
    .resolve("logger")
    .info(
      "Verified Thamani Gate 12 partial allocation, parcel tracking, return, and reconciliation",
    )
}
