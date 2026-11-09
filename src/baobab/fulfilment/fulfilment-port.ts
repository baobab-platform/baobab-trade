import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../context/digital-estates"
import type { FulfilmentMode } from "./fulfilment-config"

export type Incoterm = "EXW" | "FCA" | "FOB" | "CFR" | "CIF" | "DAP" | "DPU" | "DDP"
export type FulfilmentStatus =
  | "REQUESTED"
  | "ACCEPTED"
  | "ALLOCATED"
  | "DISPATCHED"
  | "DELIVERED"
  | "CANCELLED"
  | "EXCEPTION"
  | "RECONCILIATION_REQUIRED"

export type ShipmentMetadata = {
  originCountry: string
  destinationCountry: string
  exporterOrganisationId?: string
  importerOrganisationId?: string
  hsReferences?: string[]
  complianceDecisionId?: string
  incoterm?: Incoterm
  grossWeightKg: number
  packageCount: number
  exportReference?: string
  customsReference?: string
}

export type RequestFulfilmentCommand = {
  fulfilmentReference: string
  orderReference: string
  organisationId?: string
  customerReference?: string
  marketKey: string
  legalSellerKey: string
  sourceLocationKey: string
  mode: FulfilmentMode
  providerKey: string
  shipment: ShipmentMetadata
  idempotencyKey: string
  correlationId: string
}

export type FulfilmentSnapshot = RequestFulfilmentCommand & {
  id: string
  digitalEstate: string
  status: FulfilmentStatus
  shipmentReference?: string | null
  carrierReference?: string | null
  trackingReference?: string | null
  trackingUrl?: string | null
  dispatchDate?: Date | null
  deliveryDate?: Date | null
}

export interface FulfilmentRecordRepository {
  findByIdempotencyKey(key: string): Promise<FulfilmentSnapshot | undefined>
  create(command: RequestFulfilmentCommand & { digitalEstate: string }): Promise<FulfilmentSnapshot>
  transition(
    current: FulfilmentSnapshot,
    to: FulfilmentStatus,
    idempotencyKey: string,
    evidence?: FulfilmentEvidence,
  ): Promise<FulfilmentSnapshot>
}

export type FulfilmentEvidence = {
  shipmentReference?: string
  carrierReference?: string
  trackingReference?: string
  trackingUrl?: string
  dispatchDate?: Date
  deliveryDate?: Date
}

export interface FulfilmentPort {
  request(command: RequestFulfilmentCommand): Promise<FulfilmentSnapshot>
  transition(
    current: FulfilmentSnapshot,
    to: FulfilmentStatus,
    idempotencyKey: string,
    evidence?: FulfilmentEvidence,
  ): Promise<FulfilmentSnapshot>
}

const TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  REQUESTED: ["ACCEPTED", "CANCELLED", "EXCEPTION", "RECONCILIATION_REQUIRED"],
  ACCEPTED: ["ALLOCATED", "CANCELLED", "EXCEPTION", "RECONCILIATION_REQUIRED"],
  ALLOCATED: ["DISPATCHED", "EXCEPTION", "RECONCILIATION_REQUIRED"],
  DISPATCHED: ["DELIVERED", "EXCEPTION", "RECONCILIATION_REQUIRED"],
  DELIVERED: [],
  CANCELLED: [],
  EXCEPTION: ["RECONCILIATION_REQUIRED", "ACCEPTED", "ALLOCATED", "DISPATCHED"],
  RECONCILIATION_REQUIRED: ["ACCEPTED", "ALLOCATED", "DISPATCHED", "DELIVERED", "CANCELLED"],
}

const SHIPMENT_FIELDS = [
  "originCountry", "destinationCountry", "exporterOrganisationId",
  "importerOrganisationId", "complianceDecisionId", "incoterm",
  "grossWeightKg", "packageCount", "exportReference", "customsReference",
] as const
const REQUEST_FIELDS = [
  "fulfilmentReference", "orderReference", "organisationId", "customerReference",
  "marketKey", "legalSellerKey", "sourceLocationKey", "mode",
  "providerKey", "idempotencyKey",
] as const

/**
 * ADR-0016 FUL-COM-015/016/021/023: one key commits one physical
 * fulfilment intent. Provider-lock races may return an existing record,
 * but it must be the SAME order/warehouse/carrier/cross-border shipment.
 */
export const assertSameFulfilmentAttempt = (
  requested: RequestFulfilmentCommand & { digitalEstate: string },
  stored: FulfilmentSnapshot,
): FulfilmentSnapshot => {
  if (
    !stored ||
    !stored.id ||
    requested.digitalEstate !== stored.digitalEstate ||
    REQUEST_FIELDS.some((field) => requested[field] !== stored[field]) ||
    SHIPMENT_FIELDS.some((field) => requested.shipment[field] !== stored.shipment[field]) ||
    JSON.stringify(requested.shipment.hsReferences ?? []) !==
      JSON.stringify(stored.shipment.hsReferences ?? [])
  ) {
    throw new Error("Fulfilment idempotency key reused for a different shipment")
  }
  return stored
}

const validateShipment = (command: RequestFulfilmentCommand) => {
  if (Boolean(command.organisationId) === Boolean(command.customerReference))
    throw new Error("Fulfilment requires exactly one B2B organisation or B2C customer reference")
  if (
    !Number.isFinite(command.shipment.grossWeightKg) ||
    !(command.shipment.grossWeightKg > 0) ||
    !Number.isSafeInteger(command.shipment.packageCount) ||
    command.shipment.packageCount <= 0
  )
    throw new Error("Shipment weight and package count must be positive")
  if (command.mode === "CROSS_BORDER") {
    const s = command.shipment
    if (s.originCountry === s.destinationCountry)
      throw new Error("Cross-border origin and destination must differ")
    if (
      !s.exporterOrganisationId ||
      !s.importerOrganisationId ||
      !s.incoterm ||
      !s.hsReferences?.length ||
      !s.complianceDecisionId
    )
      throw new Error("Cross-border fulfilment metadata is incomplete")
  }
}

export class MedusaFulfilmentAdapter implements FulfilmentPort {
  constructor(private readonly records: FulfilmentRecordRepository) {}
  async request(command: RequestFulfilmentCommand) {
    validateShipment(command)
    const digitalEstate = command.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
    if (!/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/.test(command.idempotencyKey)) {
      throw new Error("Fulfilment requires a bounded idempotency key")
    }
    const scoped = { ...command, digitalEstate }
    const existing = await this.records.findByIdempotencyKey(command.idempotencyKey)
    if (existing) return assertSameFulfilmentAttempt(scoped, existing)
    return assertSameFulfilmentAttempt(scoped, await this.records.create(scoped))
  }
  async transition(
    current: FulfilmentSnapshot,
    to: FulfilmentStatus,
    idempotencyKey: string,
    evidence: FulfilmentEvidence = {},
  ) {
    if (!TRANSITIONS[current.status].includes(to))
      throw new Error(`Invalid fulfilment transition ${current.status} -> ${to}`)
    if (to === "DISPATCHED" && (!evidence.shipmentReference || !evidence.dispatchDate))
      throw new Error("Authoritative shipment evidence is required for dispatch")
    if (to === "DELIVERED" && !evidence.deliveryDate)
      throw new Error("Authoritative delivery evidence is required")
    return this.records.transition(current, to, idempotencyKey, evidence)
  }
}
