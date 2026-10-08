import type { ILockingModule } from "@medusajs/framework/types"
import { isUniqueConstraintViolation } from "../db-errors"
import type FulfilmentBridgeModuleService from "../../modules/fulfilment-bridge/service"

/**
 * `FulfilmentAllocation`/`FulfilmentOrderLine`/`CommerceReturn` had no idempotent-write helper of
 * their own — unlike `CommerceFulfilment`, which gets one through `FulfilmentBridgeRecordAdapter`
 * — so every caller (currently only Thamani's Gate 12 verify script) reimplemented a
 * list-then-create check ad hoc. That check-then-insert is not atomic on its own, and a genuine
 * concurrent retry hits the DB's unique constraint as an unhandled error instead of gracefully
 * returning what already exists. These mirror the same lock-then-check-then-create-with-
 * unique-violation-fallback pattern `FulfilmentBridgeRecordAdapter` already uses for
 * `CommerceFulfilment`.
 */

export const createIdempotentFulfilmentOrderLine = async (
  bridge: FulfilmentBridgeModuleService,
  locking: ILockingModule,
  input: { fulfilmentId: string; orderLineReference: string; fulfilledQuantity: number },
) => {
  const find = () =>
    bridge.listFulfilmentOrderLines({
      fulfilment_id: input.fulfilmentId,
      order_line_reference: input.orderLineReference,
    })
  return locking.execute(
    `fulfilment-order-line:${input.fulfilmentId}:${input.orderLineReference}`,
    async () => {
      const [existing] = await find()
      if (existing) return existing
      try {
        return await bridge.createFulfilmentOrderLines({
          fulfilment_id: input.fulfilmentId,
          order_line_reference: input.orderLineReference,
          fulfilled_quantity: input.fulfilledQuantity,
        })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        const [racedWith] = await find()
        if (!racedWith) throw error
        return racedWith
      }
    },
  )
}

export const createIdempotentFulfilmentAllocations = async (
  bridge: FulfilmentBridgeModuleService,
  locking: ILockingModule,
  input: {
    fulfilmentId: string
    orderLineReference: string
    allocations: readonly { sourceLocationKey: string; quantity: number }[]
  },
) => {
  const find = () =>
    bridge.listFulfilmentAllocations({
      fulfilment_id: input.fulfilmentId,
      order_line_reference: input.orderLineReference,
    })
  return locking.execute(
    `fulfilment-allocations:${input.fulfilmentId}:${input.orderLineReference}`,
    async () => {
      const existing = await find()
      const existingLocations = new Set(existing.map((item) => item.source_location_key))
      const missing = input.allocations.filter(
        (allocation) => !existingLocations.has(allocation.sourceLocationKey),
      )
      if (!missing.length) return existing
      try {
        const created = await bridge.createFulfilmentAllocations(
          missing.map((allocation) => ({
            fulfilment_id: input.fulfilmentId,
            order_line_reference: input.orderLineReference,
            source_location_key: allocation.sourceLocationKey,
            quantity: allocation.quantity,
            // Derived from the allocation's own business key (fulfilment, line, location)
            // rather than its position in the input array, so a retry that reorders or
            // resubmits the same logical allocations is still recognised as a replay.
            source_idempotency_key: `fulfilment-allocation:${input.fulfilmentId}:${input.orderLineReference}:${allocation.sourceLocationKey}`,
          })),
        )
        return [...existing, ...created]
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        return find()
      }
    },
  )
}

export const createIdempotentCommerceReturn = async (
  bridge: FulfilmentBridgeModuleService,
  locking: ILockingModule,
  input: {
    returnReference: string
    fulfilmentId: string
    orderReference: string
    orderLineReference: string
    quantity: number
    reason: "DAMAGED" | "WRONG_ITEM" | "NOT_AS_DESCRIBED" | "CUSTOMER_REMORSE"
    disposition: "RESTOCK" | "QUARANTINE" | "DISPOSE" | "INSPECT"
    status: "REQUESTED" | "AUTHORIZED" | "RECEIVED" | "COMPLETED" | "REJECTED"
    idempotencyKey: string
    correlationId: string
  },
) => {
  const find = () => bridge.listCommerceReturns({ source_idempotency_key: input.idempotencyKey })
  return locking.execute(`commerce-return-idempotency:${input.idempotencyKey}`, async () => {
    const [existing] = await find()
    if (existing) return existing
    try {
      return await bridge.createCommerceReturns({
        return_reference: input.returnReference,
        fulfilment_id: input.fulfilmentId,
        order_reference: input.orderReference,
        order_line_reference: input.orderLineReference,
        quantity: input.quantity,
        reason: input.reason,
        disposition: input.disposition,
        status: input.status,
        source_idempotency_key: input.idempotencyKey,
        correlation_id: input.correlationId,
      })
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error
      const [racedWith] = await find()
      if (!racedWith) throw error
      return racedWith
    }
  })
}
