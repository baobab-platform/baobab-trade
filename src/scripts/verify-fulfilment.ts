import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  FulfilmentBridgeRecordAdapter,
  MedusaFulfilmentAdapter,
  ZURIBEANS_FULFILMENT_POLICIES,
  reconcileFulfilment,
  resolveFulfilmentProvider,
} from "../baobab/fulfilment"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"
export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const policies = await bridge.listFulfilmentPolicyBindings({
    market_key: ZURIBEANS_FULFILMENT_POLICIES.map((policy) => policy.marketKey),
  })
  if (policies.length !== 2)
    throw new Error(`Expected 2 ZuriBeans fulfilment policies, found ${policies.length}`)
  const ug = ZURIBEANS_FULFILMENT_POLICIES.find((policy) => policy.marketKey === "zuribeans_ug")
  if (!ug) throw new Error("Uganda fulfilment policy missing")
  const provider = resolveFulfilmentProvider(ug, "CROSS_BORDER")
  const port = new MedusaFulfilmentAdapter(new FulfilmentBridgeRecordAdapter(bridge, locking))
  let fulfilment = await port.request({
    fulfilmentReference: "gate9-ug-za-fulfilment",
    orderReference: "gate9-order",
    organisationId: "gate9-b2b-buyer",
    marketKey: ug.marketKey,
    legalSellerKey: ug.legalSellerKey,
    sourceLocationKey: "UG-EBB-01",
    mode: "CROSS_BORDER",
    providerKey: provider.key,
    shipment: {
      originCountry: "UG",
      destinationCountry: "ZA",
      exporterOrganisationId: "zuribeans-uganda",
      importerOrganisationId: "gate9-b2b-buyer",
      hsReferences: ["0901.11"],
      complianceDecisionId: "gate9-compliance-approved",
      incoterm: "CIF",
      grossWeightKg: 1200,
      packageCount: 24,
      exportReference: "gate9-export-ref",
      customsReference: "gate9-customs-ref",
    },
    idempotencyKey: "gate9:request:ug-za",
    correlationId: "gate9-verification",
  })
  const replay = await port.request({ ...fulfilment, idempotencyKey: "gate9:request:ug-za" })
  if (replay.id !== fulfilment.id) throw new Error("Fulfilment request is not idempotent")
  for (const [from, to] of [
    ["REQUESTED", "ACCEPTED"],
    ["ACCEPTED", "ALLOCATED"],
  ] as const)
    if (fulfilment.status === from)
      fulfilment = await port.transition(fulfilment, to, `gate9:${to.toLowerCase()}`)
  if (fulfilment.status === "ALLOCATED")
    fulfilment = await port.transition(fulfilment, "DISPATCHED", "gate9:dispatched", {
      shipmentReference: "IDEMPIERE:M_INOUT:GATE9",
      carrierReference: "gate9-carrier",
      trackingReference: "gate9-track",
      trackingUrl: "https://tracking.example.invalid/gate9-track",
      dispatchDate: new Date(),
    })
  if (!fulfilment.trackingReference || fulfilment.status !== "DISPATCHED")
    throw new Error("Tracking projection or dispatch evidence missing")
  const result = reconcileFulfilment({
    commerceStatus: fulfilment.status,
    executionStatus: "DISPATCHED",
    shipmentReference: fulfilment.shipmentReference,
  })
  const [existing] = await bridge.listFulfilmentReconciliations({
    source_idempotency_key: "gate9:reconcile",
  })
  if (!existing)
    await bridge.createFulfilmentReconciliations({
      fulfilment_id: fulfilment.id,
      execution_reference: fulfilment.shipmentReference,
      commerce_status: fulfilment.status,
      execution_status: "DISPATCHED",
      status: result.status,
      reasons: result.reasons,
      source_idempotency_key: "gate9:reconcile",
      observed_at: new Date(),
    })
  if (result.status !== "MATCHED")
    throw new Error("Fulfilment did not reconcile with execution evidence")
  container
    .resolve("logger")
    .info("Verified Gate 9 cross-border fulfilment, tracking, and reconciliation")
}
