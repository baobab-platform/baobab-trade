import { describe, expect, it } from "vitest"
import {
  createThamaniErpProjection,
  THAMANI_ERP_PROJECTION_KINDS,
} from "../src/baobab/thamani/erp-integration"

describe("Thamani Gate 15 ERP contract", () => {
  it("covers every required projection family", () => {
    expect(THAMANI_ERP_PROJECTION_KINDS).toEqual([
      "PRODUCT",
      "SUPPLIER",
      "WAREHOUSE",
      "ORDER",
      "SHIPMENT",
      "PAYMENT",
      "RETURN_REFUND",
      "CREDIT_LINE",
    ])
  })
  it("derives a stable versioned idempotency key", () => {
    const projection = createThamaniErpProjection({
      kind: "RETURN_REFUND",
      commerceReference: "return-1",
      canonicalEntityId: "canonical:return:1",
      legalSellerKey: "thamani-south-africa",
      marketKey: "thamani_za",
      payload: { refund_minor: 5000 },
      sourceVersion: 2,
      correlationId: "corr",
    })
    expect(projection.idempotencyKey).toBe("thamani:erp:return_refund:canonical:return:1:v2")
    expect(projection.payload.source_version).toBe(2)
  })
  it("rejects cross-Market legal sellers", () => {
    expect(() =>
      createThamaniErpProjection({
        kind: "ORDER",
        commerceReference: "order",
        canonicalEntityId: "canonical:order",
        legalSellerKey: "thamani-south-africa",
        marketKey: "thamani_ug",
        payload: {},
        sourceVersion: 1,
        correlationId: "corr",
      }),
    ).toThrow(/boundary/)
  })
})
