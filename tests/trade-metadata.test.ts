import { describe, expect, it } from "vitest"
import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../src/baobab/context/digital-estates"
import {
  validateCrossBorderMetadata,
  type CrossBorderTransactionMetadata,
} from "../src/baobab/trade-readiness"
const valid: CrossBorderTransactionMetadata = {
  digitalEstate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
  transactionReference: "tx",
  orderReference: "ord",
  marketKey: "zuribeans_ug",
  legalSellerKey: "seller",
  exporterOrganisationId: "exporter",
  importerOrganisationId: "importer",
  originCountry: "UG",
  destinationCountry: "ZA",
  incoterm: "CIF",
  customsProcedureReference: "procedure",
  exportEligibilityReference: "eligibility",
  exporterRegistrationReference: "export-reg",
  importerRegistrationReference: "import-reg",
  lines: [
    {
      canonicalProductKey: "coffee",
      hsClassificationReference: "HS-0901.11",
      hsClassificationStatus: "VERIFIED",
      customsTariffReference: "customs-tariff",
      landedCostReference: "landed-cost",
      originCountry: "UG",
      tradeUom: "BAG",
      quantity: 2,
      netWeightKg: 120,
      grossWeightKg: 121,
    },
  ],
  idempotencyKey: "idem",
  correlationId: "corr",
}
describe("cross-border trade metadata", () => {
  it("accepts complete classification, origin, UOM, and customs metadata", () => {
    expect(() => validateCrossBorderMetadata(valid)).not.toThrow()
  })
  it("rejects invalid HS references and origin conflicts", () => {
    expect(() =>
      validateCrossBorderMetadata({
        ...valid,
        lines: [{ ...valid.lines[0], hsClassificationReference: "coffee" }],
      }),
    ).toThrow(/HS/)
    expect(() =>
      validateCrossBorderMetadata({
        ...valid,
        lines: [{ ...valid.lines[0], originCountry: "KE" }],
      }),
    ).toThrow(/origin/)
  })
  it("rejects a missing Digital Estate", () => {
    expect(() => validateCrossBorderMetadata({ ...valid, digitalEstate: "" })).toThrow(/incomplete/)
  })
})
