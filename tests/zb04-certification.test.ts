import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import certification from "../conformance/zb04-certification.json"

describe("ZB-04 end-to-end certification controls", () => {
  it("maps every gate control to executable repository evidence", () => {
    expect(certification.controls).toHaveLength(8)
    for (const control of certification.controls) {
      expect(control.id).toMatch(/^ZB04-[0-9]{2}$/)
      expect(control.evidence.length).toBeGreaterThan(0)
      for (const path of control.evidence) expect(existsSync(path), `${control.id}: ${path}`).toBe(true)
    }
  })

  it("keeps the authority chain explicit and ERP-gated", () => {
    expect(certification.authorityChain).toEqual([
      "IAM_PRINCIPAL",
      "CP_TENANT_AND_CANONICAL_ORGANISATION",
      "TRADE_APPLICATION_AND_KYB",
      "ERP_BUSINESS_PARTNER_AND_COMMERCIAL_DECISION",
      "TRADE_ACTIVATION_AND_MEMBERSHIP",
    ])
  })

  it("does not falsely claim production certification from unit tests", () => {
    expect(certification.status).toBe("IMPLEMENTED_AWAITING_ENVIRONMENT_CERTIFICATION")
    expect(certification.productionEvidence).toContain("real iDempiere business-partner projection")
    expect(certification.productionEvidence).toContain("real notification-provider message receipt")
    expect(certification.productionEvidence).toContain("operator sign-off with correlation IDs and timestamps")
  })

  it("keeps the CI certification pack enabled", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8")
    expect(ci).toContain("npm run test:zb04")
  })
})
