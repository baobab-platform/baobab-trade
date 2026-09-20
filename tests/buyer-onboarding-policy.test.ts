import { describe, expect, it } from "vitest"
import {
  assertBuyerApplicationTransition,
  BuyerOnboardingPolicyError,
  resolveBuyerTenantId,
} from "../src/baobab/b2b/onboarding-policy"

describe("Gate ZB-04 buyer onboarding policy", () => {
  it("allows the governed review path", () => {
    expect(() => assertBuyerApplicationTransition("DRAFT", "SUBMITTED")).not.toThrow()
    expect(() => assertBuyerApplicationTransition("SUBMITTED", "UNDER_REVIEW")).not.toThrow()
    expect(() =>
      assertBuyerApplicationTransition("UNDER_REVIEW", "APPROVED", {
        decisionReference: "decision-001",
        canonicalOrganisationId: "canonical:buyer:001",
      }),
    ).not.toThrow()
  })

  it("rejects direct activation-style shortcuts", () => {
    expect(() =>
      assertBuyerApplicationTransition("DRAFT", "APPROVED", {
        decisionReference: "decision-001",
        canonicalOrganisationId: "canonical:buyer:001",
      }),
    ).toThrowError(BuyerOnboardingPolicyError)
  })

  it("requires immutable decision evidence", () => {
    expect(() => assertBuyerApplicationTransition("UNDER_REVIEW", "REJECTED")).toThrowError(
      expect.objectContaining({ code: "MISSING_DECISION_REFERENCE" }),
    )
  })

  it("requires canonical linkage before approval", () => {
    expect(() =>
      assertBuyerApplicationTransition("UNDER_REVIEW", "APPROVED", {
        decisionReference: "decision-001",
      }),
    ).toThrowError(expect.objectContaining({ code: "MISSING_CANONICAL_LINK" }))
  })

  it("derives tenant identity only from server configuration", () => {
    expect(resolveBuyerTenantId({ BAOBAB_ZURIBEANS_TENANT_ID: "tn_zuribeans" })).toBe(
      "tn_zuribeans",
    )
    expect(() => resolveBuyerTenantId({})).toThrowError(
      expect.objectContaining({ code: "TENANT_NOT_CONFIGURED" }),
    )
  })
})
