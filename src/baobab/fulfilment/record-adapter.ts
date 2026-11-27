import type { ILockingModule } from "@medusajs/framework/types"
import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../context/digital-estates"
import { isUniqueConstraintViolation } from "../db-errors"
import type FulfilmentBridgeModuleService from "../../modules/fulfilment-bridge/service"
import {
  validateFulfilmentCommand,
  type FulfilmentEvidence,
  type FulfilmentRecordRepository,
  type FulfilmentSnapshot,
  type FulfilmentStatus,
  type RequestFulfilmentCommand,
} from "./fulfilment-port"

type Stored = Awaited<ReturnType<FulfilmentBridgeModuleService["listCommerceFulfilments"]>>[number]

const requiredStoredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`Stored Fulfilment is missing authoritative ${field}`)
  }
  return value
}

const exactPositiveInteger = (value: unknown, field: string): number => {
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
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`Stored Fulfilment ${field} is not an exact positive integer`)
  }
  const exact = BigInt(raw)
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Stored Fulfilment ${field} exceeds the safe integer boundary`)
  }
  return Number(exact)
}

const storedDate = (value: unknown, field: string): Date | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Stored Fulfilment ${field} is not a valid timestamp`)
  }
  return date
}

const snapshot = (record: Stored): FulfilmentSnapshot => {
  const digitalEstate = requiredStoredText(record.digital_estate, "Digital Estate")
  if (
    digitalEstate !== ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID &&
    digitalEstate !== THAMANI_DIGITAL_ESTATE_CANONICAL_ID
  ) {
    throw new Error("Stored Fulfilment has an unsupported Digital Estate")
  }
  const result: FulfilmentSnapshot = {
    id: requiredStoredText(record.id, "native Fulfilment ID"),
    digitalEstate,
    fulfilmentReference: requiredStoredText(record.fulfilment_reference, "fulfilment reference"),
    orderReference: requiredStoredText(record.order_reference, "Order reference"),
    tenantId: requiredStoredText(record.tenant_id, "tenant"),
    principalId: requiredStoredText(record.principal_id, "initiating Principal"),
    organisationId: record.organisation_id ?? undefined,
    customerReference: record.customer_reference ?? undefined,
    marketId: requiredStoredText(record.market_id, "opaque CP Market ID"),
    marketRevision: exactPositiveInteger(record.market_revision, "Market revision"),
    marketKey: requiredStoredText(record.market_key, "Market key"),
    legalSellerKey: requiredStoredText(record.legal_seller_key, "legal seller"),
    sourceLocationKey: requiredStoredText(record.source_location_key, "source location"),
    mode: record.mode,
    providerKey: requiredStoredText(record.provider_key, "logistics provider"),
    shipment: record.shipment_metadata as RequestFulfilmentCommand["shipment"],
    idempotencyKey: requiredStoredText(record.source_idempotency_key, "idempotency key"),
    correlationId: requiredStoredText(record.correlation_id, "correlation ID"),
    status: record.status,
    shipmentReference: record.shipment_reference,
    carrierReference: record.carrier_reference,
    trackingReference: record.tracking_reference,
    trackingUrl: record.tracking_url,
    dispatchDate: storedDate(record.dispatch_date, "dispatch date"),
    deliveryDate: storedDate(record.delivery_date, "delivery date"),
  }
  if (!/^ful_[A-Za-z0-9]+$/.test(result.id)) {
    throw new Error("Stored Fulfilment has an invalid native identifier")
  }
  validateFulfilmentCommand(result)
  return result
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const FULFILMENT_ID = /^ful_[A-Za-z0-9]+$/

const dateFingerprint = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value)
}

const evidenceFingerprint = (value: unknown): string => {
  const evidence =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {}
  return JSON.stringify({
    sourceSystem: evidence.sourceSystem ?? null,
    sourceEventReference: evidence.sourceEventReference ?? null,
    shipmentReference: evidence.shipmentReference ?? null,
    carrierReference: evidence.carrierReference ?? null,
    trackingReference: evidence.trackingReference ?? null,
    trackingUrl: evidence.trackingUrl ?? null,
    dispatchDate: dateFingerprint(evidence.dispatchDate),
    deliveryDate: dateFingerprint(evidence.deliveryDate),
  })
}

const sameTransition = (
  prior: {
    fulfilment_id: string
    from_status: string
    to_status: string
    evidence?: unknown
  },
  current: FulfilmentSnapshot,
  to: FulfilmentStatus,
  evidence: FulfilmentEvidence,
): boolean =>
  prior.fulfilment_id === current.id &&
  prior.from_status === current.status &&
  prior.to_status === to &&
  evidenceFingerprint(prior.evidence) === evidenceFingerprint(evidence)

export class FulfilmentBridgeRecordAdapter implements FulfilmentRecordRepository {
  constructor(
    private readonly bridge: FulfilmentBridgeModuleService,
    private readonly locking: ILockingModule,
  ) {}

  async findByIdempotencyKey(key: string) {
    if (typeof key !== "string" || !REFERENCE.test(key)) {
      throw new Error("Fulfilment idempotency key is invalid")
    }
    const [record] = await this.bridge.listCommerceFulfilments({ source_idempotency_key: key })
    return record ? snapshot(record) : undefined
  }

  async create(command: RequestFulfilmentCommand & { digitalEstate: string }) {
    validateFulfilmentCommand(command)
    const expectedEstate = command.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
    if (command.digitalEstate !== expectedEstate) {
      throw new Error("Fulfilment Digital Estate does not match the buyer party")
    }
    return this.locking.execute(`fulfilment-idempotency:${command.idempotencyKey}`, async () => {
      const existing = await this.findByIdempotencyKey(command.idempotencyKey)
      if (existing) return existing
      try {
        return snapshot(
          await this.bridge.createCommerceFulfilments({
            digital_estate: command.digitalEstate,
            tenant_id: command.tenantId,
            principal_id: command.principalId,
            market_id: command.marketId,
            market_revision: command.marketRevision,
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
    if (!current || !FULFILMENT_ID.test(current.id ?? "") || !REFERENCE.test(idempotencyKey)) {
      throw new Error("Fulfilment transition identity is invalid")
    }
    return this.locking.execute(`fulfilment:${current.id}`, async () => {
      const [prior] = await this.bridge.listFulfilmentStatusTransitions({
        fulfilment_id: current.id,
        idempotency_key: idempotencyKey,
      })
      const [stored] = await this.bridge.listCommerceFulfilments({ id: current.id })
      if (!stored) throw new Error("Fulfilment does not exist")
      if (prior) {
        if (!sameTransition(prior, current, to, evidence)) {
          throw new Error("Fulfilment idempotency key reused for a different transition")
        }
        if (stored.status !== to) {
          throw new Error("Fulfilment transition log and native state disagree; reconciliation is required")
        }
        return snapshot(stored)
      }
      if (stored.status !== current.status) {
        throw new Error("Fulfilment state changed before transition")
      }
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
        if (!racedWith || !sameTransition(racedWith, current, to, evidence)) throw error
        const [racedStored] = await this.bridge.listCommerceFulfilments({ id: current.id })
        if (!racedStored) throw error
        if (racedStored.status !== to) {
          throw new Error("Fulfilment transition log and native state disagree; reconciliation is required")
        }
        return snapshot(racedStored)
      }
      // These are still separate writes. A crash after the transition log but
      // before this update is detected on replay and must be reconciled; it is
      // not treated as a successful transition.
      const updated = snapshot(
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
      if (updated.id !== current.id || updated.status !== to) {
        throw new Error("Fulfilment transition writeback did not reach the requested native state")
      }
      return updated
    })
  }
}
