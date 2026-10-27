import { describe, expect, it } from "vitest"
import assurancePolicy from "../src/baobab/contracts/shared/contracts/identity/v1/assurance-policy.schema.json"
import {
  CANONICAL_OPERATION_PROFILES,
  evaluateAssurance,
  INTERIM_POLICY_REVISION,
  interimAssurancePolicy,
} from "../src/baobab/auth/buyer-assurance"

/**
 * ADR-SHARED-042 CAA-03 (ruling of 22 October 2026): the strict interim
 * assurance verifier. Synthetic acr values only; the accepted values are
 * IAM-evidenced and security-approved configuration, never defaults.
 */
const ISSUER = "https://iam.example.test/"
const SESSION = "urn:example.test:acr:synthetic-session"
const policy = interimAssurancePolicy({
  issuer: ISSUER,
  acceptedAcr: [SESSION],
  approvalReference: "security-approval:synthetic",
})

describe("interim buyer assurance verifier", () => {
  it("mirrors the canonical operation mapping of the pinned Shared contract", () => {
    expect(CANONICAL_OPERATION_PROFILES).toEqual(
      assurancePolicy.$defs.canonicalOperationProfiles.const,
    )
  })

  it("accepts only an exact allowlisted acr from the configured issuer", () => {
    expect(
      evaluateAssurance(policy, "trade.buyer-context.resolve", { issuer: ISSUER, acr: SESSION }),
    ).toEqual({ ok: true, policyRevision: INTERIM_POLICY_REVISION })
    for (const token of [
      { issuer: ISSUER, acr: undefined },
      { issuer: ISSUER, acr: `${SESSION}-weaker` },
      { issuer: ISSUER, acr: SESSION.toUpperCase() },
      { issuer: "https://other.example.test/", acr: SESSION },
    ]) {
      expect(evaluateAssurance(policy, "trade.buyer-context.resolve", token)).toEqual({
        ok: false,
        reason: "ASSURANCE_INSUFFICIENT",
      })
    }
  })

  it("preserves exact issuer spelling, including slashless Hydra issuers", () => {
    for (const issuer of ["https://iam.example.test", ISSUER, "https://iam.example.test/realm"]) {
      const exact = interimAssurancePolicy({
        issuer,
        acceptedAcr: [SESSION],
        approvalReference: "security-approval:synthetic",
      })
      expect(exact?.issuer).toBe(issuer)
      expect(
        evaluateAssurance(exact, "trade.contract-price.view", { issuer, acr: SESSION }),
      ).toEqual({ ok: true, policyRevision: INTERIM_POLICY_REVISION })
      const alternate = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer + "/"
      expect(
        evaluateAssurance(exact, "trade.contract-price.view", { issuer: alternate, acr: SESSION }),
      ).toEqual({ ok: false, reason: "ASSURANCE_INSUFFICIENT" })
    }
  })

  it("never activates commitment or administration operations on the interim allowlist", () => {
    for (const operation of [
      "trade.order.commit",
      "trade.draft-order.finalize",
      "trade.purchase-approval.decide",
      "trade.rfq.submit",
      "trade.buyer-invitation.accept",
      "trade.buyer-member.manage",
    ] as const) {
      expect(evaluateAssurance(policy, operation, { issuer: ISSUER, acr: SESSION })).toEqual({
        ok: false,
        reason: "OPERATION_NOT_ACTIVATED",
      })
    }
  })

  it("has no permissive default: incomplete or wildcard configuration activates nothing", () => {
    for (const config of [
      { issuer: ISSUER, acceptedAcr: [], approvalReference: "a" },
      { issuer: ISSUER, acceptedAcr: [SESSION], approvalReference: "" },
      { issuer: ISSUER, acceptedAcr: [SESSION] },
      { issuer: undefined, acceptedAcr: [SESSION], approvalReference: "a" },
      { issuer: ISSUER, acceptedAcr: ["*"], approvalReference: "a" },
      { issuer: ISSUER, acceptedAcr: ["two values"], approvalReference: "a" },
      ...[
        "http://iam.example.test",
        "https://user:private@iam.example.test",
        "https://iam.example.test?query=value",
        "https://iam.example.test#fragment",
        " https://iam.example.test",
        "https://iam.example.test ",
      ].map((issuer) => ({ issuer, acceptedAcr: [SESSION], approvalReference: "a" })),
      { issuer: "not a url", acceptedAcr: [SESSION], approvalReference: "a" },
    ]) {
      const built = interimAssurancePolicy(config)
      expect(built).toBeNull()
      expect(
        evaluateAssurance(built, "trade.buyer-context.resolve", { issuer: ISSUER, acr: SESSION }),
      ).toEqual({ ok: false, reason: "OPERATION_NOT_ACTIVATED" })
    }
  })
})

