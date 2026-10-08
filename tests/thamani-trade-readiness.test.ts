import { describe, expect, it } from "vitest"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../src/baobab/context/digital-estates"
import {
  ProjectedTradeComplianceAdapter,
  type CrossBorderTransactionMetadata,
} from "../src/baobab/trade-readiness"
import {
  THAMANI_TRADE_LANES,
  THAMANI_TRADE_PROFILES,
  requireVerifiedTradeProfile,
} from "../src/baobab/thamani/trade-readiness"

describe("Thamani Gate 14 trade readiness", () => {
  it("projects every eligible product/Market pair with origin and cost references", () => {
    expect(THAMANI_TRADE_PROFILES.length).toBeGreaterThan(38)
    expect(
      THAMANI_TRADE_PROFILES.every(
        (profile) =>
          profile.originCountry && profile.customsTariffReference && profile.landedCostReference,
      ),
    ).toBe(true)
  })
  it("keeps illustrative HS classifications unverified", () => {
    expect(
      THAMANI_TRADE_PROFILES.every((profile) => profile.hsClassificationStatus === "UNVERIFIED"),
    ).toBe(true)
    expect(() => requireVerifiedTradeProfile(THAMANI_TRADE_PROFILES[0])).toThrow("customs review")
  })
  it("routes an unverified retail import to review through TradeCompliancePort", async () => {
    const profile = THAMANI_TRADE_PROFILES.find(
      (item) => item.marketKey === "thamani_za" && item.originCountry === "UG",
    )
    if (!profile) throw new Error("Missing import profile")
    const transaction: CrossBorderTransactionMetadata = {
      digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
      transactionReference: "test",
      orderReference: "procurement-test",
      marketKey: profile.marketKey,
      legalSellerKey: "thamani-south-africa",
      exporterOrganisationId: "supplier",
      importerOrganisationId: "thamani-south-africa",
      originCountry: "UG",
      destinationCountry: "ZA",
      incoterm: "DAP",
      customsProcedureReference: "procedure",
      exportEligibilityReference: "eligibility",
      exporterRegistrationReference: "exporter",
      importerRegistrationReference: "importer",
      lines: [
        {
          canonicalProductKey: profile.canonicalProductKey,
          hsClassificationReference: profile.hsClassificationReference,
          hsClassificationStatus: profile.hsClassificationStatus,
          customsTariffReference: profile.customsTariffReference,
          landedCostReference: profile.landedCostReference,
          originCountry: profile.originCountry,
          tradeUom: "EACH",
          quantity: 1,
          netWeightKg: 1,
          grossWeightKg: 1.1,
        },
      ],
      idempotencyKey: "test",
      correlationId: "test",
    }
    const port = new ProjectedTradeComplianceAdapter(
      {
        async listPolicies(origin, destination) {
          return THAMANI_TRADE_LANES.filter(
            (lane) => lane.originCountry === origin && lane.destinationCountry === destination,
          ).map((lane) => ({
            ...lane,
            permittedIncoterms: [...lane.permittedIncoterms],
            permittedTradeUoms: [...lane.permittedTradeUoms],
          }))
        },
      },
      {
        async isVerified() {
          return false
        },
      },
    )
    const decision = await port.evaluate(transaction, new Date("2026-09-09"))
    expect(decision).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasons: ["HS_CLASSIFICATION_UNVERIFIED"],
    })
  })
})
