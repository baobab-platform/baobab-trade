/**
 * Pure validation for ZB-06 admin HTTP bodies (ADR-0030).
 * Kept separate from Medusa route handlers so CI can exercise rejects without HTTP.
 */

import {
  isKnownTradeUom,
  normalizeTradeUom,
  type ClassificationConfidence,
  type CommercialAssortmentStatus,
  type RegulatoryEligibility,
} from "./product-assortment-policy"

export type AdminValidationError = { field: string; message: string }

const CONFIDENCES: ClassificationConfidence[] = [
  "PROPOSED",
  "UNDER_REVIEW",
  "VERIFIED",
  "AUTHORITATIVE",
  "DISPUTED",
  "EXPIRED",
]

const STATUSES: CommercialAssortmentStatus[] = ["ACTIVE", "SUSPENDED", "WITHDRAWN"]

const isValidIsoTimestamp = (value: string): boolean => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    )
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === "Z" ? 0 : Number(match[8])
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[9])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  )
}

const requireString = (
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: AdminValidationError } => {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: { field, message: `${field} is required` } }
  }
  return { ok: true, value: value.trim() }
}

export const validateTradeProfileBody = (
  body: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: AdminValidationError } => {
  for (const field of [
    "product_id",
    "canonical_product_key",
    "country_of_origin",
    "hs_classification_reference",
    "commodity_category",
    "trade_uom",
  ]) {
    const r = requireString(body[field], field)
    if (!r.ok) return r
  }

  const tradeUom = normalizeTradeUom(String(body.trade_uom))
  if (!isKnownTradeUom(tradeUom)) {
    return {
      ok: false,
      error: {
        field: "trade_uom",
        message: `trade_uom "${tradeUom}" is not a recognised trade unit code`,
      },
    }
  }

  let confidence: ClassificationConfidence = "PROPOSED"
  if (body.classification_confidence !== undefined) {
    if (
      typeof body.classification_confidence !== "string" ||
      !CONFIDENCES.includes(body.classification_confidence as ClassificationConfidence)
    ) {
      return {
        ok: false,
        error: { field: "classification_confidence", message: "invalid classification_confidence" },
      }
    }
    confidence = body.classification_confidence as ClassificationConfidence
  }

  return {
    ok: true,
    data: {
      product_id: String(body.product_id).trim(),
      canonical_product_key: String(body.canonical_product_key).trim(),
      country_of_origin: String(body.country_of_origin).trim(),
      hs_classification_reference: String(body.hs_classification_reference).trim(),
      commodity_category: String(body.commodity_category).trim(),
      trade_uom: tradeUom,
      classification_confidence: confidence,
    },
  }
}

export const validateMarketEligibilityBody = (
  body: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: AdminValidationError } => {
  for (const field of ["product_id", "market_key"]) {
    const r = requireString(body[field], field)
    if (!r.ok) return r
  }

  if (
    typeof body.status !== "string" ||
    !STATUSES.includes(body.status as CommercialAssortmentStatus)
  ) {
    return { ok: false, error: { field: "status", message: "status is required and must be valid" } }
  }
  const status = body.status as CommercialAssortmentStatus

  if (
    body.regulatory_eligibility !== undefined &&
    body.regulatory_eligibility !== "NOT_EVALUATED"
  ) {
    return {
      ok: false,
      error: {
        field: "regulatory_eligibility",
        message: "regulatory_eligibility is owned by the qualified regulatory provider",
      },
    }
  }
  const regulatory: RegulatoryEligibility = "NOT_EVALUATED"

  // Store eligibility is temporal policy, not an arbitrarily parseable
  // JavaScript Date. Unqualified/reversed windows must never be activated.
  const boundaries: Record<string, Date | null> = {}
  for (const field of ["effective_from", "effective_until"]) {
    const value = body[field]
    if (value === null || value === undefined) {
      boundaries[field] = null
      continue
    }
    if (typeof value !== "string" || !isValidIsoTimestamp(value)){
      return {
        ok: false,
        error: { field, message: `${field} must be an ISO 8601 timestamp with timezone` },
      }
    }
    boundaries[field] = new Date(value)
  }

  if (
    boundaries.effective_from &&
    boundaries.effective_until &&
    boundaries.effective_from.getTime() >= boundaries.effective_until.getTime()
  ) {
    return {
      ok: false,
      error: { field: "effective_until", message: "effective_until must follow effective_from" },
    }
  }

  if (
    body.policy_reference !== undefined &&
    body.policy_reference !== null &&
    (typeof body.policy_reference !== "string" || !body.policy_reference.trim())
  ) {
    return {
      ok: false,
      error: { field: "policy_reference", message: "policy_reference must be a non-empty string" },
    }
  }

  return {
    ok: true,
    data: {
      product_id: String(body.product_id).trim(),
      market_key: String(body.market_key).trim(),
      status,
      regulatory_eligibility: regulatory,
      policy_reference:
        typeof body.policy_reference === "string" ? body.policy_reference.trim() : null,
      effective_from: boundaries.effective_from,
      effective_until: boundaries.effective_until,
    },
  }
}

export const validatePurchaseConstraintBody = (
  body: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: AdminValidationError } => {
  for (const field of ["variant_id", "market_key", "trade_uom"]) {
    const r = requireString(body[field], field)
    if (!r.ok) return r
  }

  for (const field of ["minimum_order_quantity", "order_multiple"]) {
    const value = body[field]
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      return {
        ok: false,
        error: { field, message: `${field} must be a positive integer` },
      }
    }
  }

  const tradeUom = normalizeTradeUom(String(body.trade_uom))
  if (!isKnownTradeUom(tradeUom)) {
    return {
      ok: false,
      error: {
        field: "trade_uom",
        message: `trade_uom "${tradeUom}" is not a recognised trade unit code`,
      },
    }
  }

  return {
    ok: true,
    data: {
      variant_id: String(body.variant_id).trim(),
      market_key: String(body.market_key).trim(),
      minimum_order_quantity: body.minimum_order_quantity,
      order_multiple: body.order_multiple,
      trade_uom: tradeUom,
    },
  }
}

export const validateCanonicalLinkBody = (
  body: Record<string, unknown>,
): { ok: true; canonical_product_key: string } | { ok: false; error: AdminValidationError } => {
  const r = requireString(body.canonical_product_key, "canonical_product_key")
  if (!r.ok) return r
  return { ok: true, canonical_product_key: r.value }
}
