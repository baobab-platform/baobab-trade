import type { ILockingModule } from "@medusajs/framework/types"
import { isUniqueConstraintViolation } from "../db-errors"
import type FulfilmentBridgeModuleService from "../../modules/fulfilment-bridge/service"
import type {
  FulfilmentEvidence,
  FulfilmentRecordRepository,
  FulfilmentSnapshot,
  FulfilmentStatus,
  RequestFulfilmentCommand,
} from "./fulfilment-port"
type Stored = Awaited<ReturnType<FulfilmentBridgeModuleService["listCommerceFulfilments"]>>[number]
const snapshot = (record: Stored): FulfilmentSnapshot => ({
  id: record.id,
  digitalEstate: record.digital_estate,
  fulfilmentReference: record.fulfilment_reference,
  orderReference: record.order_reference,
  organisationId: record.organisation_id ?? undefined,
  customerReference: record.customer_reference ?? undefined,
  marketKey: record.market_key,
  legalSellerKey: record.legal_seller_key,
  sourceLocationKey: record.source_location_key,
  mode: record.mode,
  providerKey: record.provider_key,
  shipment: record.shipment_metadata as RequestFulfilmentCommand["shipment"],
  idempotencyKey: record.source_idempotency_key,
  correlationId: record.correlation_id,
  status: record.status,
  shipmentReference: record.shipment_reference,
  carrierReference: record.carrier_reference,
  trackingReference: record.tracking_reference,
  trackingUrl: record.tracking_url,
  dispatchDate: record.dispatch_date,
  deliveryDate: record.delivery_date,
})
export class FulfilmentBridgeRecordAdapter implements FulfilmentRecordRepository {
  constructor(
    private readonly bridge: FulfilmentBridgeModuleService,
    private readonly locking: ILockingModule,
  ) {}
  async findByIdempotencyKey(key: string) {
    const [record] = await this.bridge.listCommerceFulfilments({ source_idempotency_key: key })
    return record ? snapshot(record) : undefined
  }
  async create(command: RequestFulfilmentCommand & { digitalEstate: string }) {
    // Mirrors PaymentBridgeRecordAdapter.create(): two concurrent request() calls sharing an
    // idempotency key could otherwise both pass the port's existence check before either had
    // created a row.
    return this.locking.execute(`fulfilment-idempotency:${command.idempotencyKey}`, async () => {
      const existing = await this.findByIdempotencyKey(command.idempotencyKey)
      if (existing) return existing
      try {
        return snapshot(
          await this.bridge.createCommerceFulfilments({
            digital_estate: command.digitalEstate,
            fulfilment_reference: command.fulfilmentReference,
            order_reference: command.orderReference,
            organisation_id: command.organisationId,
            customer_reference: command.customerReference,
            market_key: command.marketKey,
            legal_seller_key: command.legalSellerKey,
            source_location_key: command.sourceLocationKey,
            mode: command.mode,
            provider_key: command.providerKey,
            status: "REQUESTED",
            shipment_metadata: command.shipment,
            source_idempotency_key: command.idempotencyKey,
            correlation_id: command.correlationId,
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
    current: FulfilmentSnapshot,
    to: FulfilmentStatus,
    idempotencyKey: string,
    evidence: FulfilmentEvidence = {},
  ) {
    // Locking on the fulfilment id (not the idempotency key) serializes every transition
    // attempt for this fulfilment, closing the same lost-update race payments had. The prior-
    // transition lookup is scoped to this fulfilment_id — an idempotency_key that happens to
    // match a DIFFERENT fulfilment's transition must never be treated as this one already
    // having happened, and a match that belongs to this fulfilment but targets a different
    // (from, to) pair is a caller bug, not a safe replay.
    return this.locking.execute(`fulfilment:${current.id}`, async () => {
      const [prior] = await this.bridge.listFulfilmentStatusTransitions({
        fulfilment_id: current.id,
        idempotency_key: idempotencyKey,
      })
      const [stored] = await this.bridge.listCommerceFulfilments({ id: current.id })
      if (!stored) throw new Error("Fulfilment does not exist")
      if (prior) {
        if (prior.from_status !== stored.status || prior.to_status !== to)
          throw new Error("Fulfilment idempotency key reused for a different transition")
        return snapshot(stored)
      }
      if (stored.status !== current.status)
        throw new Error("Fulfilment state changed before transition")
      try {
        await this.bridge.createFulfilmentStatusTransitions({
          fulfilment_id: current.id,
          from_status: current.status,
          to_status: to,
          idempotency_key: idempotencyKey,
          evidence,
          occurred_at: new Date(),
        })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        const [racedWith] = await this.bridge.listFulfilmentStatusTransitions({
          fulfilment_id: current.id,
          idempotency_key: idempotencyKey,
        })
        if (!racedWith || racedWith.from_status !== current.status || racedWith.to_status !== to)
          throw error
        const [racedStored] = await this.bridge.listCommerceFulfilments({ id: current.id })
        if (!racedStored) throw error
        return snapshot(racedStored)
      }
      return snapshot(
        await this.bridge.updateCommerceFulfilments({
          id: current.id,
          status: to,
          shipment_reference: evidence.shipmentReference,
          carrier_reference: evidence.carrierReference,
          tracking_reference: evidence.trackingReference,
          tracking_url: evidence.trackingUrl,
          dispatch_date: evidence.dispatchDate,
          delivery_date: evidence.deliveryDate,
        }),
      )
    })
  }
}
