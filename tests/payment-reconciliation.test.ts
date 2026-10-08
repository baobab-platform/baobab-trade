import { describe, expect, it } from "vitest"
import { reconcilePaymentWithErp } from "../src/baobab/payments"

describe("Commerce-to-ERP payment reconciliation", () => {
  it("keeps missing ERP receivables explicit", () => {
    expect(
      reconcilePaymentWithErp({
        commerceStatus: "PENDING",
        commerceAmountMinor: 1000,
        commerceCurrency: "UGX",
      }),
    ).toEqual({ status: "PENDING_ERP", amountDeltaMinor: 1000, reasons: ["ERP_MISSING"] })
  })

  it("detects state, currency, and amount variances", () => {
    const result = reconcilePaymentWithErp({
      commerceStatus: "CAPTURED",
      commerceAmountMinor: 1000,
      commerceCurrency: "ZAR",
      erpStatus: "PENDING",
      erpAmountMinor: 900,
      erpCurrency: "USD",
    })
    expect(result.status).toBe("VARIANCE")
    expect(result.amountDeltaMinor).toBe(100)
    expect(result.reasons).toEqual(["AMOUNT_MISMATCH", "CURRENCY_MISMATCH", "STATUS_MISMATCH"])
  })

  it("matches authoritative ERP evidence without changing Commerce authority", () => {
    expect(
      reconcilePaymentWithErp({
        commerceStatus: "SETTLED",
        commerceAmountMinor: 2500,
        commerceCurrency: "ZAR",
        erpStatus: "SETTLED",
        erpAmountMinor: 2500,
        erpCurrency: "ZAR",
      }).status,
    ).toBe("MATCHED")
  })
})
