import { describe, expect, it } from "vitest"
import {
  buildThamaniStoreCreditOrderChangeInput,
  createThamaniStoreCreditErpProjection,
  THAMANI_STORE_CREDIT_REASON_CONFIG,
} from "../src/baobab/thamani/store-credit"

describe("Thamani Gate 17 store credit", () => {
  it("gives every reason a distinct, non-revenue-reversing ERP consequence except REFUND", () => {
    expect(THAMANI_STORE_CREDIT_REASON_CONFIG.REFUND.erpFinancialConsequence).toBe("AR_CREDIT_MEMO")
    expect(THAMANI_STORE_CREDIT_REASON_CONFIG.SERVICE.erpFinancialConsequence).toBe(
      "CUSTOMER_SERVICE_EXPENSE",
    )
    expect(THAMANI_STORE_CREDIT_REASON_CONFIG.PROMOTIONAL.erpFinancialConsequence).toBe(
      "MARKETING_EXPENSE",
    )
    const consequences = Object.values(THAMANI_STORE_CREDIT_REASON_CONFIG).map(
      (config) => config.erpFinancialConsequence,
    )
    expect(new Set(consequences).size).toBe(3)
  })

  it("rejects a non-positive amount for every reason", () => {
    for (const reason of ["REFUND", "SERVICE", "PROMOTIONAL"] as const) {
      expect(() =>
        buildThamaniStoreCreditOrderChangeInput({
          orderId: "order_1",
          amountMinor: 0,
          reason,
          referenceId: "ref_1",
          serviceJustification: "note",
        }),
      ).toThrow("positive integer")
      expect(() =>
        buildThamaniStoreCreditOrderChangeInput({
          orderId: "order_1",
          amountMinor: -100,
          reason,
          referenceId: "ref_1",
          serviceJustification: "note",
        }),
      ).toThrow("positive integer")
    }
  })

  it("requires REFUND and PROMOTIONAL to trace back to a source referenceId", () => {
    expect(() =>
      buildThamaniStoreCreditOrderChangeInput({
        orderId: "order_1",
        amountMinor: 100,
        reason: "REFUND",
      }),
    ).toThrow("referenceId")
    expect(() =>
      buildThamaniStoreCreditOrderChangeInput({
        orderId: "order_1",
        amountMinor: 100,
        reason: "PROMOTIONAL",
      }),
    ).toThrow("referenceId")
    expect(
      buildThamaniStoreCreditOrderChangeInput({
        orderId: "order_1",
        amountMinor: 100,
        reason: "REFUND",
        referenceId: "return_1",
      }).referenceId,
    ).toBe("return_1")
  })

  it("lets SERVICE substitute a justification for a referenceId, but requires one of them", () => {
    expect(() =>
      buildThamaniStoreCreditOrderChangeInput({
        orderId: "order_1",
        amountMinor: 100,
        reason: "SERVICE",
      }),
    ).toThrow("serviceJustification")
    const withJustification = buildThamaniStoreCreditOrderChangeInput({
      orderId: "order_1",
      amountMinor: 100,
      reason: "SERVICE",
      serviceJustification: "Late delivery goodwill credit",
    })
    expect(withJustification.referenceId).toBeNull()
    expect(withJustification.internalNote).toBe("Late delivery goodwill credit")
    const withReferenceId = buildThamaniStoreCreditOrderChangeInput({
      orderId: "order_1",
      amountMinor: 100,
      reason: "SERVICE",
      referenceId: "case_42",
    })
    expect(withReferenceId.referenceId).toBe("case_42")
  })

  it("tags every credit line with its own reason's reference, not a shared default", () => {
    const refund = buildThamaniStoreCreditOrderChangeInput({
      orderId: "order_1",
      amountMinor: 100,
      reason: "REFUND",
      referenceId: "return_1",
    })
    const promotional = buildThamaniStoreCreditOrderChangeInput({
      orderId: "order_1",
      amountMinor: 100,
      reason: "PROMOTIONAL",
      referenceId: "policy_1",
    })
    expect(refund.reference).toBe(THAMANI_STORE_CREDIT_REASON_CONFIG.REFUND.reference)
    expect(promotional.reference).toBe(THAMANI_STORE_CREDIT_REASON_CONFIG.PROMOTIONAL.reference)
    expect(refund.reference).not.toBe(promotional.reference)
  })

  it("derives the ERP financial consequence from the reason rather than accepting a caller value", () => {
    const command = createThamaniStoreCreditErpProjection({
      reason: "SERVICE",
      orderId: "order_1",
      creditLineId: "ordcrl_1",
      legalSellerKey: "thamani-uganda",
      marketKey: "thamani_ug",
      amountMinor: 500,
      currency: "UGX",
      sourceVersion: 1,
      correlationId: "corr",
    })
    expect(command.kind).toBe("CREDIT_LINE")
    expect(command.payload.erp_financial_consequence).toBe("CUSTOMER_SERVICE_EXPENSE")
    expect(command.payload.reason).toBe("SERVICE")
  })

  it("rejects cross-Market legal sellers, matching every other Thamani ERP projection", () => {
    expect(() =>
      createThamaniStoreCreditErpProjection({
        reason: "REFUND",
        orderId: "order_1",
        creditLineId: "ordcrl_1",
        legalSellerKey: "thamani-south-africa",
        marketKey: "thamani_ug",
        amountMinor: 500,
        currency: "UGX",
        sourceVersion: 1,
        correlationId: "corr",
      }),
    ).toThrow("boundary")
  })
})
