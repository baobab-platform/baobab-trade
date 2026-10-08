import { createThamaniErpProjection } from "../erp-integration"
import type { ErpProjectionCommand } from "../../erp-integration"
import {
  THAMANI_STORE_CREDIT_REASON_CONFIG,
  type ThamaniStoreCreditReason,
} from "./store-credit-config"

export type ThamaniStoreCreditErpProjectionInput = {
  reason: ThamaniStoreCreditReason
  orderId: string
  creditLineId: string
  legalSellerKey: "thamani-uganda" | "thamani-south-africa"
  marketKey: "thamani_ug" | "thamani_za"
  amountMinor: number
  currency: string
  sourceVersion: number
  correlationId: string
}

/**
 * Builds the CREDIT_LINE ERP projection for a store credit issuance. The
 * ERP financial consequence is always derived from the reason (see
 * `THAMANI_STORE_CREDIT_REASON_CONFIG`), never taken from the caller, so a
 * REFUND-reason credit can never be mis-booked as a marketing expense (or
 * vice versa) by an ERP integrator error at the call site.
 */
export const createThamaniStoreCreditErpProjection = (
  input: ThamaniStoreCreditErpProjectionInput,
): ErpProjectionCommand => {
  const config = THAMANI_STORE_CREDIT_REASON_CONFIG[input.reason]
  return createThamaniErpProjection({
    kind: "CREDIT_LINE",
    commerceReference: input.creditLineId,
    canonicalEntityId: `canonical:thamani:credit_line:${input.creditLineId}`,
    legalSellerKey: input.legalSellerKey,
    marketKey: input.marketKey,
    payload: {
      order_id: input.orderId,
      reason: input.reason,
      erp_financial_consequence: config.erpFinancialConsequence,
      amount_minor: input.amountMinor,
      currency: input.currency,
    },
    sourceVersion: input.sourceVersion,
    correlationId: input.correlationId,
  })
}
