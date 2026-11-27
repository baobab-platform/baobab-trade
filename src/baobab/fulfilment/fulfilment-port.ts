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
  tenantId: string
  principalId: string
  organisationId?: string
  customerReference?: string
  marketId: string
  marketRevision: number
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
  sourceSystem?: "CARRIER" | "THIRD_PARTY_LOGISTICS" | "WMS" | "ERP"
  sourceEventReference?: string
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

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const MARKET_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const MARKET_KEY = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/
const FULFILMENT_ID = /^ful_[A-Za-z0-9]+$/
const COUNTRY_CODE = /^[A-Z]{2}$/

const isBoundedReference = (value: unknown): value is string =>
  typeof value === "string" && REFERENCE.test(value)

const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime())

const SHIPMENT_FIELDS = [
  "originCountry",
  "destinationCountry",
  "exporterOrganisationId",
  "importerOrganisationId",
  "complianceDecisionId",
  "incoterm",
  "grossWeightKg",
  "packageCount",
  "exportReference",
  "customsReference",
] as const
const REQUEST_FIELDS = [
  "fulfilmentReference",
  "orderReference",
  "tenantId",
  "principalId",
  "organisationId",
  "customerReference",
  "marketId",
  "marketRevision",
  "marketKey",
  "legalSellerKey",
  "sourceLocationKey",
  "mode",
  "providerKey",
  "idempotencyKey",
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
    !FULFILMENT_ID.test(stored.id ?? "") ||
    requested.digitalEstate !== stored.digitalEstate ||
    REQUEST_FIELDS.some((field) => requested[field] !== stored[field]) ||
    !stored.shipment ||
    SHIPMENT_FIELDS.some((field) => requested.shipment[field] !== stored.shipment[field]) ||
    JSON.stringify(requested.shipment.hsReferences ?? []) !==
      JSON.stringify(stored.shipment.hsReferences ?? [])
  ) {
    throw new Error("Fulfilment idempotency key reused for a different shipment")
  }
  return stored
}

export const validateFulfilmentCommand = (command: RequestFulfilmentCommand): void => {
  if (!command || typeof command !== "object" || !command.shipment) {
    throw new Error("Fulfilment shipment metadata is required")
  }
  if (
    Boolean(command.organisationId) === Boolean(command.customerReference) ||
    (command.organisationId !== undefined && !isBoundedReference(command.organisationId)) ||
    (command.customerReference !== undefined && !isBoundedReference(command.customerReference))
  ) {
    throw new Error("Fulfilment requires exactly one bounded B2B organisation or B2C customer reference")
  }
  for (const field of [
    "fulfilmentReference",
    "orderReference",
    "tenantId",
    "principalId",
    "legalSellerKey",
    "sourceLocationKey",
    "providerKey",
    "idempotencyKey",
    "correlationId",
  ] as const) {
    if (!isBoundedReference(command[field])) {
      throw new Error("Fulfilment requires bounded tenant, Principal, seller, source and provider identifiers")
    }
  }
  if (
    typeof command.marketId !== "string" ||
    command.marketId.length < 3 ||
    command.marketId.length > 63 ||
    !MARKET_ID.test(command.marketId) ||
    !Number.isSafeInteger(command.marketRevision) ||
    command.marketRevision < 1 ||
    typeof command.marketKey !== "string" ||
    command.marketKey.length < 3 ||
    command.marketKey.length > 128 ||
    !MARKET_KEY.test(command.marketKey)
  ) {
    throw new Error("Fulfilment requires an explicit CP Market identity, revision and canonical key")
  }
  const shipment = command.shipment
  if (
    typeof shipment.originCountry !== "string" ||
    !COUNTRY_CODE.test(shipment.originCountry) ||
    typeof shipment.destinationCountry !== "string" ||
    !COUNTRY_CODE.test(shipment.destinationCountry)
  ) {
    throw new Error("Shipment origin and destination must be ISO alpha-2 country codes")
  }
  if (
    !Number.isFinite(shipment.grossWeightKg) ||
    shipment.grossWeightKg <= 0 ||
    !Number.isSafeInteger(shipment.packageCount) ||
    shipment.packageCount <= 0
  ) {
    throw new Error("Shipment weight and package count must be positive")
  }
  for (const value of [
    shipment.exporterOrganisationId,
    shipment.importerOrganisationId,
    shipment.complianceDecisionId,
    shipment.exportReference,
    shipment.customsReference,
  ]) {
    if (value !== undefined && !isBoundedReference(value)) {
      throw new Error("Shipment references must be bounded canonical identifiers")
    }
  }
  if (
    shipment.hsReferences !== undefined &&
    (!Array.isArray(shipment.hsReferences) ||
      shipment.hsReferences.some((value) => !isBoundedReference(value)) ||
      new Set(shipment.hsReferences).size !== shipment.hsReferences.length)
  ) {
    throw new Error("Shipment HS references must be explicit, bounded and unique")
  }
  if (command.mode === "CROSS_BORDER") {
    if (shipment.originCountry === shipment.destinationCountry)
      throw new Error("Cross-border origin and destination must differ")
    if (
      !shipment.exporterOrganisationId ||
      !shipment.importerOrganisationId ||
      !shipment.incoterm ||
      !shipment.hsReferences?.length ||
      !shipment.complianceDecisionId
    ) {
      throw new Error("Cross-border fulfilment metadata is incomplete")
    }
  }
}

const validateEvidence = (
  current: FulfilmentSnapshot,
  to: FulfilmentStatus,
  evidence: FulfilmentEvidence,
): void => {
  for (const value of [
    evidence.sourceEventReference,
    evidence.shipmentReference,
    evidence.carrierReference,
    evidence.trackingReference,
  ]) {
    if (value !== undefined && !isBoundedReference(value)) {
      throw new Error("Fulfilment execution evidence references must be bounded")
    }
  }
  if (evidence.trackingUrl !== undefined) {
    let url: URL
    try {
      url = new URL(evidence.trackingUrl)
    } catch {
      throw new Error("Fulfilment tracking URL must be a valid HTTPS URL")
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Fulfilment tracking URL must be a credential-free HTTPS URL")
    }
  }
  if (evidence.dispatchDate !== undefined && !validDate(evidence.dispatchDate)) {
    throw new Error("Fulfilment dispatch evidence must have a valid timestamp")
  }
  if (evidence.deliveryDate !== undefined && !validDate(evidence.deliveryDate)) {
    throw new Error("Fulfilment delivery evidence must have a valid timestamp")
  }
  const allowedEvidenceSources = ["CARRIER", "THIRD_PARTY_LOGISTICS", "WMS", "ERP"]
  if (
    evidence.sourceSystem !== undefined &&
    !allowedEvidenceSources.includes(evidence.sourceSystem)
  ) {
    throw new Error("Fulfilment execution evidence source is invalid")
  }
  const requiresExecutionEvidence = to === "DISPATCHED" || to === "DELIVERED"
  if (
    requiresExecutionEvidence &&
    (!evidence.sourceSystem || !isBoundedReference(evidence.sourceEventReference))
  ) {
    throw new Error("Authoritative external execution evidence is required")
  }
  if (to === "DISPATCHED" && (!evidence.shipmentReference || !evidence.dispatchDate)) {
    throw new Error("Authoritative shipment reference and dispatch timestamp are required")
  }
  if (to === "DELIVERED") {
    if (!evidence.deliveryDate || !(evidence.shipmentReference ?? current.shipmentReference)) {
      throw new Error("Authoritative delivery and shipment evidence are required")
    }
    const dispatchDate = evidence.dispatchDate ?? current.dispatchDate
    if (dispatchDate && evidence.deliveryDate.getTime() < dispatchDate.getTime()) {
      throw new Error("Delivery evidence cannot predate dispatch")
    }
  }
}

export class MedusaFulfilmentAdapter implements FulfilmentPort {
  constructor(private readonly records: FulfilmentRecordRepository) {}
  async request(command: RequestFulfilmentCommand) {
    validateFulfilmentCommand(command)
    const digitalEstate = command.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
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
    if (!current || !FULFILMENT_ID.test(current.id ?? "")) {
      throw new Error("Fulfilment identifier is invalid")
    }
    if (!isBoundedReference(idempotencyKey)) {
      throw new Error("Fulfilment transition idempotency key must be bounded")
    }
    if (!TRANSITIONS[current.status]?.includes(to)) {
      throw new Error(`Invalid fulfilment transition ${current.status} -> ${to}`)
    }
    validateEvidence(current, to, evidence)
    return this.records.transition(current, to, idempotencyKey, evidence)
  }
}
