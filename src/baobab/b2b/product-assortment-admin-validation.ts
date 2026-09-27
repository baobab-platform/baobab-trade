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

const REGS: RegulatoryEligibility[] = [
  "NOT_EVALUATED",
  "PENDING",
  "ELIGIBLE",
  "ELIGIBLE_WITH_CONDITIONS",
  "REVIEW_REQUIRED",
  "INELIGIBLE",
  "SUSPENDED",
  "EXPIRED",
  "ERROR",
]

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

  let status: CommercialAssortmentStatus = "ACTIVE"
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !STATUSES.includes(body.status as CommercialAssortmentStatus)
    ) {
      return { ok: false, error: { field: "status", message: "invalid status" } }
    }
    status = body.status as CommercialAssortmentStatus
  }

  let regulatory: RegulatoryEligibility = "NOT_EVALUATED"
  if (body.regulatory_eligibility !== undefined) {
    if (
      typeof body.regulatory_eligibility !== "string" ||
      !REGS.includes(body.regulatory_eligibility as RegulatoryEligibility)
    ) {
      return {
        ok: false,
        error: { field: "regulatory_eligibility", message: "invalid regulatory_eligibility" },
      }
    }
    regulatory = body.regulatory_eligibility as RegulatoryEligibility
  }

  return {
    ok: true,
    data: {
      product_id: String(body.product_id).trim(),
      market_key: String(body.market_key).trim(),
      status,
      regulatory_eligibility: regulatory,
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
