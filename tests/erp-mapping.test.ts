import { describe, expect, it } from "vitest"
import type { ErpMappingType } from "../src/baobab/erp-integration"
describe("Gate 12 ERP mapping contract", () => {
  it("keeps all required cross-engine identities distinct", () => {
    const mappings: ErpMappingType[] = [
      "BUSINESS_PARTNER",
      "PRODUCT",
      "WAREHOUSE",
      "SALES_ORDER",
      "SHIPMENT",
      "FINANCIAL_CONSEQUENCE",
    ]
    expect(new Set(mappings).size).toBe(6)
    expect(mappings).toContain("BUSINESS_PARTNER")
    expect(mappings).toContain("FINANCIAL_CONSEQUENCE")
  })
})
