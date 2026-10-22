import { describe, expect, it } from "vitest"
import { interimAssurancePolicy } from "../src/baobab/auth/buyer-assurance"
import { BuyerTokenError } from "../src/baobab/auth/buyer-access-token"
import { resolveBuyerContext, type BuyerContextResult } from "../src/baobab/b2b/buyer-authority"
import { buyerExecutionContextSchema } from "../src/baobab/contracts/authority-validation"
import { EstateBindingError } from "../src/baobab/control-plane/estate-binding"
import { PrincipalResolutionError } from "../src/baobab/control-plane/principal-resolution"
import { TenantAttestationError } from "../src/baobab/control-plane/workload-tenant-verifier"

/**
 * ADR-SHARED-042 CAA-04/05: the order and independence of Trade's buyer
 * checks, and the TradeBuyerExecutionContext they produce. Fakes stand in
 * for IAM, CP and the B2B module; this is not connected acceptance (CAA-08).
 */
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const ISSUER = "https://iam.example.test/"
const BFF = "zuribeans-bff"
const PRINCIPAL = "019a0915-a8c0-7000-8000-000000000001"
const EXTERNAL = "019a0915-a8c0-7000-8000-000000000002"
const OTHER_PRINCIPAL = "019a0915-a8c0-7000-8000-0000000000ff"
const ORG = "019a0915-a8c0-7000-8000-00000000a001"
const OTHER_ORG = "019a0915-a8c0-7000-8000-00000000a002"
const CP_CONTEXT = "019a0915-a8c0-7000-8000-00000000c001"
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const ENGINE = "ei_trade01"
const TENANT = "tn_zuribeans"
const SESSION_ACR = "urn:example.test:acr:synthetic-session"

type Membership = {
  id: string
  organisation_id: string
  customer_id: string | null
  principal_id: string | null
  status: string
  revision: number
  effective_from?: string | null
  effective_until?: string | null
}

type Change = {
  memberships?: Membership[]
  organisations?: Record<string, unknown>[]
  orgChange?: Record<string, unknown>
  acr?: string
  callerClient?: string
  estateEngine?: string
  estateError?: EstateBindingError
  estates?: null
  tenants?: null
  tenantError?: Error
  assurance?: null
  shortEvidence?: number
}

const world = (change: Change = {}) => {
  const calls: string[] = []
  let ids = 0
  const organisations = change.organisations ?? [
    {
      id: "b2borg_acme",
      canonical_organisation_id: ORG,
      tenant_id: TENANT,
      status: "ACTIVE",
      engine_instance_id: ENGINE,
      relationship_revision: 4,
      link_provenance: "cp-attestation:synthetic-1",
      ...change.orgChange,
    },
    {
      id: "b2borg_other",
      canonical_organisation_id: OTHER_ORG,
      tenant_id: TENANT,
      status: "ACTIVE",
      engine_instance_id: ENGINE,
      relationship_revision: 1,
      link_provenance: "cp-attestation:synthetic-2",
    },
  ]
  const memberships: Membership[] = change.memberships ?? [
    {
      id: "b2bmem_01synthetic",
      organisation_id: "b2borg_acme",
      customer_id: "cus_1",
      principal_id: PRINCIPAL,
      status: "ACTIVE",
      revision: 7,
    },
  ]
  const deps = {
    now: () => NOW,
    newId: () => `019a0915-a8c0-7000-8000-${String(++ids).padStart(12, "0")}`,
    engineInstanceId: ENGINE,
    assurance:
      change.assurance === null
        ? null
        : interimAssurancePolicy({
            issuer: ISSUER,
            acceptedAcr: [SESSION_ACR],
            approvalReference: "security-approval:synthetic",
          }),
    tokens: {
      verifyBffCaller: async (token: string) => {
        calls.push("caller")
        if (token === "stolen-buyer-token")
          throw new BuyerTokenError("BUYER_TOKEN_INVALID", "not a workload token")
        if (token === "caller-issuer-down")
          throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "metadata unavailable")
        return {
          issuer: ISSUER,
          clientId: change.callerClient ?? BFF,
          tokenId: "c1",
          expiresAt: new Date(NOW + (change.shortEvidence ?? 300_000)),
        }
      },
      verify: async (token: string) => {
        calls.push("token")
        if (token === "medusa-customer-token")
          throw new BuyerTokenError("BUYER_TOKEN_INVALID", "not an IAM token")
        if (token === "issuer-down")
          throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "metadata unavailable")
        return {
          issuer: ISSUER,
          subject: "kratos-1",
          authorisedParty: BFF,
          tokenId: "t1",
          expiresAt: new Date(NOW + 300_000),
          acr: change.acr ?? SESSION_ACR,
          amr: ["pwd"],
        }
      },
    },
    principals: {
      resolve: async (token: string) => {
        calls.push("principal")
        if (token === "unknown-buyer") throw new PrincipalResolutionError("IDENTITY_NOT_RESOLVED")
        if (token === "suspended-buyer") throw new PrincipalResolutionError("PRINCIPAL_NOT_ACTIVE")
        if (token === "revoked-session")
          throw new PrincipalResolutionError("SUBJECT_TOKEN_NOT_CURRENT")
        if (token === "cp-down") throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
        return {
          principalId: token === "other-buyer" ? OTHER_PRINCIPAL : PRINCIPAL,
          externalIdentityId: EXTERNAL,
          evidenceExpiresAt: new Date(NOW + 240_000),
        }
      },
    },
    estates:
      change.estates === null
        ? null
        : {
            resolve: async (request: {
              subjectAuthorisedParty: string
              clientEvidence: string
            }) => {
              calls.push(`estate:${request.subjectAuthorisedParty}`)
              if (change.estateError) throw change.estateError
              return {
                bindingId: "5d2c7f0e-3b1a-4c6d-9e8f-0a1b2c3d4e5f",
                revision: 3,
                digitalEstateId: "zuribeans",
                tenantId: TENANT,
                engineInstanceId: change.estateEngine ?? ENGINE,
                environment: "staging",
                deploymentReference: "deployment.zuribeans.staging",
                evidenceReference: "changeset:synthetic-0001",
                expiresAt: new Date(NOW + 45_000),
              }
            },
          },
    tenants:
      change.tenants === null
        ? null
        : {
            verifyOrganisationTenant: async (tenantId: string, canonical: string) => {
              calls.push(`attest:${tenantId}:${canonical}`)
              if (change.tenantError) throw change.tenantError
              return { contextId: CP_CONTEXT, expiresAt: new Date(NOW + 50_000) }
            },
          },
    b2b: {
      listB2BOrganisations: async (filter: {
        canonical_organisation_id: string
        tenant_id: string
      }) => {
        calls.push("organisation")
        return organisations.filter(
          (o) =>
            o.canonical_organisation_id === filter.canonical_organisation_id &&
            o.tenant_id === filter.tenant_id,
        )
      },
      listBuyerMemberships: async (filter: { organisation_id: string; principal_id: string }) => {
        calls.push("membership")
        return memberships.filter(
          (m) =>
            m.organisation_id === filter.organisation_id && m.principal_id === filter.principal_id,
        )
      },
      listBuyerRoles: async () => [{ role: "BUYER" }, { role: "APPROVER" }, { role: "SUPERUSER" }],
    },
  }
  return { calls, deps }
}

const run = (
  change: Change = {},
  request: Partial<{
    callerToken: string
    subjectToken: string
    requestedOrganisationId: string | undefined
  }> = {},
) => {
  const { calls, deps } = world(change)
  const promise = resolveBuyerContext(deps as never, {
    callerToken: "bff-token",
    subjectToken: "buyer-token",
    requestedOrganisationId: ORG,
    correlationId: CORRELATION,
    ...request,
  })
  return { calls, promise }
}

const refused = (result: BuyerContextResult) => {
  if (result.outcome === "ALLOW") throw new Error("expected a refusal")
  return {
    outcome: result.decision.outcome,
    reasons: result.decision.reasons,
    status: result.status,
  }
}

describe("buyer execution context (ADR-SHARED-042 CAA-04/05)", () => {
  it("builds a schema-valid context from every independent fact", async () => {
    const { calls, promise } = run()
    const result = await promise
    if (result.outcome !== "ALLOW") throw new Error(JSON.stringify(result))
    const context = result.context
    expect(buyerExecutionContextSchema(context)).toBe(true)
    expect(context).toMatchObject({
      actor_type: "HUMAN",
      actor_principal_id: PRINCIPAL,
      external_identity_id: EXTERNAL,
      tenant_id: TENANT,
      digital_estate_id: "zuribeans",
      engine_instance_id: ENGINE,
      canonical_organisation_id: ORG,
      buyer_organisation_id: "b2borg_acme",
      buyer_membership_id: "b2bmem_01synthetic",
      membership_revision: 7,
      cp_context_id: CP_CONTEXT,
      operation: "trade.buyer-context.resolve",
      decision: { outcome: "ALLOW", reasons: [] },
      correlation_id: CORRELATION,
    })
    // Unknown roles never become authority.
    expect(context.roles).toEqual(["BUYER", "APPROVER"])
    expect(context.context_id).not.toBe(context.cp_context_id)
    expect(context.evidence_references).toContain("trade-buyer-relationship:b2borg_acme@r4")
    expect(context.evidence_references).toContain(
      "cp-estate-binding:5d2c7f0e-3b1a-4c6d-9e8f-0a1b2c3d4e5f@r3",
    )
    // The earliest evidence (the estate attestation, 45 s) bounds the context.
    expect(Date.parse(context.expires_at) - Date.parse(context.evaluated_at)).toBe(45_000)
    // CP attests the Organisation only after membership is proven.
    expect(calls).toEqual([
      "caller",
      "token",
      "principal",
      `estate:${BFF}`,
      "organisation",
      "membership",
      `attest:${TENANT}:${ORG}`,
    ])
  })

  it("never outlives 60 seconds or the BFF evidence", async () => {
    const short = await run({ shortEvidence: 10_000 }).promise
    if (short.outcome !== "ALLOW") throw new Error("expected ALLOW")
    expect(Date.parse(short.context.expires_at) - NOW).toBe(10_000)
  })

  it("requires the BFF to authenticate as the buyer token's own client", async () => {
    expect(refused(await run({}, { callerToken: "stolen-buyer-token" }).promise)).toMatchObject({
      outcome: "DENY",
      reasons: ["BUYER_TOKEN_INVALID"],
      status: 401,
    })
    const { calls, promise } = run({ callerClient: "other-bff" })
    expect(refused(await promise)).toMatchObject({ reasons: ["BUYER_TOKEN_INVALID"], status: 401 })
    expect(calls).not.toContain("principal")
    expect(refused(await run({}, { callerToken: "caller-issuer-down" }).promise)).toMatchObject({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
  })

  it("refuses a Medusa customer token and an unavailable issuer", async () => {
    expect(refused(await run({}, { subjectToken: "medusa-customer-token" }).promise)).toMatchObject(
      {
        reasons: ["BUYER_TOKEN_INVALID"],
        status: 401,
      },
    )
    expect(refused(await run({}, { subjectToken: "issuer-down" }).promise)).toMatchObject({
      outcome: "UNAVAILABLE",
      status: 503,
    })
  })

  it("enforces the interim assurance verifier before identity is resolved", async () => {
    const downgraded = run({ acr: "urn:example.test:acr:synthetic-session-ish" })
    expect(refused(await downgraded.promise)).toMatchObject({
      outcome: "DENY",
      reasons: ["ASSURANCE_INSUFFICIENT"],
    })
    expect(downgraded.calls).not.toContain("principal")
    const unconfigured = run({ assurance: null })
    expect(refused(await unconfigured.promise)).toMatchObject({
      outcome: "DENY",
      reasons: ["OPERATION_NOT_ACTIVATED"],
    })
    expect(unconfigured.calls).not.toContain("principal")
  })

  it("maps CP identity answers closed and never provisions", async () => {
    for (const [token, reason, status] of [
      ["unknown-buyer", "IDENTITY_NOT_RESOLVED", 403],
      ["suspended-buyer", "PRINCIPAL_NOT_ACTIVE", 403],
      ["revoked-session", "BUYER_TOKEN_INVALID", 401],
      ["cp-down", "SOURCE_UNAVAILABLE", 503],
    ] as const) {
      const { calls, promise } = run({}, { subjectToken: token })
      expect(refused(await promise)).toMatchObject({ reasons: [reason], status })
      expect(calls).not.toContain("organisation")
    }
  })

  it("is UNAVAILABLE without CP's estate attestation and never substitutes one", async () => {
    const missing = run({ estates: null })
    expect(refused(await missing.promise)).toMatchObject({
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
      status: 503,
    })
    expect(missing.calls).not.toContain("organisation")
    expect(
      refused(await run({ estateError: new EstateBindingError("RESOLUTION_UNAVAILABLE") }).promise),
    ).toMatchObject({ outcome: "UNAVAILABLE" })
  })

  it("refuses a wrong, revoked or ambiguous estate binding and a foreign Trade instance", async () => {
    for (const code of [
      "BINDING_NOT_FOUND",
      "BINDING_AMBIGUOUS",
      "BINDING_NOT_ACTIVE",
      "ENVIRONMENT_MISMATCH",
      "ENGINE_INSTANCE_NOT_PERMITTED",
      "CLIENT_NOT_FOR_SUBJECT",
    ] as const) {
      const { calls, promise } = run({ estateError: new EstateBindingError(code) })
      expect(refused(await promise)).toMatchObject({
        outcome: "DENY",
        reasons: ["CONTEXT_NOT_USABLE"],
      })
      expect(calls).not.toContain("organisation")
    }
    expect(refused(await run({ estateEngine: "ei_other01" }).promise)).toMatchObject({
      reasons: ["CONTEXT_NOT_USABLE"],
    })
  })

  it("requires an express company selection", async () => {
    expect(refused(await run({}, { requestedOrganisationId: undefined }).promise)).toEqual({
      outcome: "SELECTION_REQUIRED",
      reasons: ["ORGANISATION_SELECTION_REQUIRED"],
      status: 409,
    })
  })

  it("refuses relationships that are not ACTIVE, linked, attested or on this instance, indistinguishably", async () => {
    for (const orgChange of [
      { status: "SUSPENDED" },
      { engine_instance_id: null },
      { engine_instance_id: "ei_other01" },
      { link_provenance: null },
      { tenant_id: "tn_other" },
    ]) {
      const { calls, promise } = run({ orgChange })
      expect(refused(await promise)).toMatchObject({
        outcome: "DENY",
        reasons: ["BUYER_NOT_AUTHORISED"],
      })
      expect(calls.some((c) => c.startsWith("attest:"))).toBe(false)
    }
    for (const requestedOrganisationId of ["019a0915-a8c0-7000-8000-00000000dead", "not-a-uuid"]) {
      expect(refused(await run({}, { requestedOrganisationId }).promise).reasons).toEqual([
        "BUYER_NOT_AUTHORISED",
      ])
    }
  })

  it("binds membership to the CP Principal, never another member or a customer", async () => {
    // Another person's membership of the same organisation does not apply.
    expect(refused(await run({}, { subjectToken: "other-buyer" }).promise).reasons).toEqual([
      "BUYER_NOT_AUTHORISED",
    ])
    // Switching to a company the person is not a member of is refused.
    expect(refused(await run({}, { requestedOrganisationId: OTHER_ORG }).promise).reasons).toEqual([
      "BUYER_NOT_AUTHORISED",
    ])
    const base = {
      id: "b2bmem_01synthetic",
      organisation_id: "b2borg_acme",
      customer_id: "cus_1",
      principal_id: PRINCIPAL,
      revision: 2,
    }
    for (const memberships of [
      [{ ...base, status: "SUSPENDED" }],
      [{ ...base, status: "REVOKED" }],
      [{ ...base, status: "INVITED" }],
      [{ ...base, status: "ACTIVE", effective_until: new Date(NOW - 1).toISOString() }],
      [{ ...base, status: "ACTIVE", effective_from: new Date(NOW + 60_000).toISOString() }],
      [
        { ...base, status: "ACTIVE" },
        { ...base, id: "b2bmem_02synthetic", status: "ACTIVE" },
      ],
    ]) {
      expect(refused(await run({ memberships }).promise).reasons).toEqual(["BUYER_NOT_AUTHORISED"])
    }
  })

  it("refuses an Organisation CP does not attest for the seller-side Tenant", async () => {
    expect(
      refused(await run({ tenantError: new TenantAttestationError("not attested") }).promise),
    ).toMatchObject({ outcome: "DENY", reasons: ["ORGANISATION_NOT_ATTESTED"] })
    expect(refused(await run({ tenantError: new Error("network") }).promise)).toMatchObject({
      outcome: "UNAVAILABLE",
    })
    expect(refused(await run({ tenants: null }).promise)).toMatchObject({ outcome: "UNAVAILABLE" })
  })
})
