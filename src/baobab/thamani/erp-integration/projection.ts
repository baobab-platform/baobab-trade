import type { ErpProjectionCommand, ProjectionKind } from "../../erp-integration"

export const THAMANI_ERP_PROJECTION_KINDS = [
  "PRODUCT",
  "SUPPLIER",
  "WAREHOUSE",
  "ORDER",
  "SHIPMENT",
  "PAYMENT",
  "RETURN_REFUND",
  "CREDIT_LINE",
] as const satisfies readonly ProjectionKind[]

export type ThamaniErpProjectionInput = {
  kind: (typeof THAMANI_ERP_PROJECTION_KINDS)[number]
  commerceReference: string
  canonicalEntityId: string
  legalSellerKey: "thamani-uganda" | "thamani-south-africa"
  marketKey: "thamani_ug" | "thamani_za"
  payload: Record<string, unknown>
  sourceVersion: number
  correlationId: string
}

export const createThamaniErpProjection = (
  input: ThamaniErpProjectionInput,
): ErpProjectionCommand => {
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion <= 0)
    throw new Error("Thamani ERP source version must be positive")
  if (
    (input.marketKey === "thamani_ug" && input.legalSellerKey !== "thamani-uganda") ||
    (input.marketKey === "thamani_za" && input.legalSellerKey !== "thamani-south-africa")
  )
    throw new Error("Thamani ERP projection crosses Market legal-seller boundary")
  return {
    kind: input.kind,
    commerceReference: input.commerceReference,
    canonicalEntityId: input.canonicalEntityId,
    legalSellerKey: input.legalSellerKey,
    marketKey: input.marketKey,
    payload: { ...input.payload, source_version: input.sourceVersion },
    idempotencyKey: `thamani:erp:${input.kind.toLowerCase()}:${input.canonicalEntityId}:v${input.sourceVersion}`,
    correlationId: input.correlationId,
  }
}
