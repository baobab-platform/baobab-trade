import { describe, expect, it } from "vitest"
import { reconcileTax } from "../src/baobab/tax"
describe("Commerce-to-ERP tax reconciliation", () => {
  it("keeps missing ERP accounting explicit", () => {
    expect(reconcileTax({ commerceTaxMinor: 100, commerceCurrency: "UGX" })).toEqual({
      status: "PENDING_ERP",
      deltaMinor: 100,
      reasons: ["ERP_TAX_MISSING"],
    })
  })
  it("detects amount and currency variances", () => {
    expect(
      reconcileTax({
        commerceTaxMinor: 100,
        commerceCurrency: "ZAR",
        erpTaxMinor: 90,
        erpCurrency: "USD",
      }).reasons,
    ).toEqual(["AMOUNT_MISMATCH", "CURRENCY_MISMATCH"])
  })
})
