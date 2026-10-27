import { describe, expect, it } from "vitest"
import { CANONICAL_OPERATION_PROFILES, evaluateAssurance } from "../src/baobab/auth/buyer-assurance"
import { loadBuyerAssurancePolicy } from "../src/baobab/auth/buyer-assurance-policy"

const issuer = "https://issuer.example.test"
const now = Date.parse("2026-10-27T12:00:00Z")
const document = () => ({
  policy_id: "synthetic.buyer-policy",
  policy_version: 2,
  status: "APPROVED",
  issuer,
  audience: "baobab-trade",
  approval_reference: "synthetic:source-test-only",
  effective_from: new Date(now - 1000).toISOString(),
  effective_until: new Date(now + 10000).toISOString(),
  profiles: {
    BUYER_SESSION: { accepted_acr_values: ["synthetic:session"], step_up_required: false },
    BUYER_COMMITMENT: {
      accepted_acr_values: ["synthetic:commitment"],
      required_methods: ["pwd", "otp"],
      step_up_required: true,
      max_authentication_age_seconds: 120,
    },
    BUYER_ADMINISTRATION: {
      accepted_acr_values: ["synthetic:admin"],
      required_methods: ["hwk"],
      step_up_required: true,
      max_authentication_age_seconds: 60,
      phishing_resistant_required: true,
    },
  },
  operation_profiles: { ...CANONICAL_OPERATION_PROFILES },
})
const load = (doc: unknown = document()) => loadBuyerAssurancePolicy(JSON.stringify(doc), issuer)
const evidence = {
  issuer,
  acr: "synthetic:commitment",
  amr: ["pwd", "otp"],
  authTime: new Date(now - 115000),
}

describe("Shared full buyer assurance policy", () => {
  it("checks every canonical operation profile and bounds evidence by policy and freshness", () => {
    const policy = load()
    expect(policy).not.toBeNull()
    for (const [operation, profile] of Object.entries(CANONICAL_OPERATION_PROFILES)) {
      const req = document().profiles[profile]
      const token = {
        issuer,
        acr: req.accepted_acr_values[0],
        amr: "required_methods" in req ? req.required_methods : [],
        authTime: new Date(now - 1000),
      }
      expect(
        evaluateAssurance(
          policy,
          operation as keyof typeof CANONICAL_OPERATION_PROFILES,
          token,
          now,
        ),
      ).toEqual({ ok: true, policyRevision: policy?.policyRevision, expiresAt: now + 10000 })
      expect(
        evaluateAssurance(
          policy,
          operation as keyof typeof CANONICAL_OPERATION_PROFILES,
          { ...token, acr: "synthetic:unknown" },
          now,
        ),
      ).toEqual({ ok: false, reason: "ASSURANCE_INSUFFICIENT" })
    }
    expect(evaluateAssurance(policy, "trade.order.commit", evidence, now)).toEqual({
      ok: true,
      policyRevision: policy?.policyRevision,
      expiresAt: now + 5000,
    })
  })

  it.each([
    ["missing methods", { amr: undefined }],
    ["missing required method", { amr: ["otp"] }],
    ["prefix ACR", { acr: "synthetic:commitment:stronger" }],
    ["session ACR", { acr: "synthetic:session" }],
    ["missing auth time", { authTime: undefined }],
    ["future authentication", { authTime: new Date(now + 1) }],
    ["stale authentication", { authTime: new Date(now - 120001) }],
    ["non-finite authentication", { authTime: new Date(NaN) }],
  ])("refuses %s", (_name, patch) => {
    expect(evaluateAssurance(load(), "trade.order.commit", { ...evidence, ...patch }, now)).toEqual(
      { ok: false, reason: "ASSURANCE_INSUFFICIENT" },
    )
  })

  it("rejects policy interval, issuer mismatch and invalid evaluation clocks", () => {
    for (const instant of [now - 1001, now + 10000, NaN, Infinity]) {
      expect(evaluateAssurance(load(), "trade.order.commit", evidence, instant)).toEqual({
        ok: false,
        reason: "OPERATION_NOT_ACTIVATED",
      })
    }
    expect(
      evaluateAssurance(load(), "trade.order.commit", { ...evidence, issuer: issuer + "/" }, now),
    ).toEqual({ ok: false, reason: "OPERATION_NOT_ACTIVATED" })
  })

  it("validates the exact pinned schema, status and non-wildcard trust configuration", () => {
    const invalid: unknown[] = [
      null,
      {},
      { ...document(), extra: true },
      { ...document(), approval_reference: " " },
      ...["DRAFT", "SUSPENDED", "RETIRED"].map((status) => ({ ...document(), status })),
      { ...document(), audience: "other" },
      { ...document(), issuer: issuer + "/" },
      { ...document(), effective_until: new Date(now - 2000).toISOString() },
      { ...document(), policy_version: Number.MAX_SAFE_INTEGER + 1 },
    ]
    for (const change of [
      { accepted_acr_values: ["*"] },
      { accepted_acr_values: [" synthetic:commitment"] },
      { accepted_acr_values: ["same", "same"] },
      { required_methods: ["*"] },
      { max_authentication_age_seconds: undefined },
      { max_authentication_age_seconds: 0 },
      { extra: true },
    ]) {
      const doc = document()
      invalid.push({
        ...doc,
        profiles: {
          ...doc.profiles,
          BUYER_COMMITMENT: { ...doc.profiles.BUYER_COMMITMENT, ...change },
        },
      })
    }
    for (const operation of Object.keys(CANONICAL_OPERATION_PROFILES)) {
      invalid.push({
        ...document(),
        operation_profiles: {
          ...CANONICAL_OPERATION_PROFILES,
          [operation]: "BUYER_SESSION-DOWNGRADE",
        },
      })
    }
    for (const doc of invalid) expect(load(doc)).toBeNull()
    expect(loadBuyerAssurancePolicy("invalid JSON", issuer)).toBeNull()
    expect(loadBuyerAssurancePolicy(" ".repeat(65537), issuer)).toBeNull()
  })

  it("snapshots immutable requirements and records a bounded, version-bound revision", () => {
    const doc = document()
    doc.policy_id = "a".repeat(128)
    const policy = load(doc)
    if (!policy) throw new Error("expected a valid synthetic policy")
    expect(Object.isFrozen(policy.profiles.BUYER_COMMITMENT.accepted_acr_values)).toBe(true)
    expect(("trade.buyer-context:v1;" + policy.policyRevision).length).toBeLessThanOrEqual(128)
    expect(load({ ...doc, policy_version: 3 })?.policyRevision).not.toBe(policy.policyRevision)
    expect(load({ ...doc, approval_reference: "different:approval" })?.policyRevision).not.toBe(
      policy.policyRevision,
    )
  })
})
