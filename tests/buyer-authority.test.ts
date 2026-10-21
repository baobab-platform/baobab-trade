import { describe, expect, it } from "vitest"
import { BuyerTokenError } from "../src/baobab/auth/buyer-access-token"
import { BuyerAuthorityError, resolveBuyerAuthority } from "../src/baobab/b2b/buyer-authority"
import { PrincipalResolutionError } from "../src/baobab/control-plane/principal-resolution"

/**
 * ZB-G03 step 3: the order and independence of Trade's buyer checks.
 * Fakes stand in for IAM, CP and the B2B module; this is not connected
 * acceptance (ZB-G03 step 4).
 */
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const PRINCIPAL = "019a0915-a8c0-7000-8000-000000000001"
const OTHER_PRINCIPAL = "019a0915-a8c0-7000-8000-0000000000ff"
const ORG = "019a0915-a8c0-7000-8000-00000000a001"
const OTHER_ORG = "019a0915-a8c0-7000-8000-00000000a002"
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"

type Membership = {
  id: string
  organisation_id: string
  customer_id: string | null
  principal_id: string | null
  status: string
  effective_from?: string | null
  effective_until?: string | null
}

const world = (
  change: { memberships?: Membership[]; orgStatus?: string; organisations?: unknown[] } = {},
) => {
  const calls: string[] = []
  const organisations = change.organisations ?? [
    {
      id: "b2borg_acme",
      canonical_organisation_id: ORG,
      tenant_id: "tn_zuribeans",
      status: change.orgStatus ?? "ACTIVE",
    },
    {
      id: "b2borg_other",
      canonical_organisation_id: OTHER_ORG,
      tenant_id: "tn_zuribeans",
      status: "ACTIVE",
    },
  ]
  const memberships: Membership[] = change.memberships ?? [
    {
      id: "b2bmem_1",
      organisation_id: "b2borg_acme",
      customer_id: "cus_1",
      principal_id: PRINCIPAL,
      status: "ACTIVE",
    },
  ]
  return {
    calls,
    deps: {
      now: () => NOW,
      tokens: {
        verify: async (token: string) => {
          calls.push("token")
          if (token === "medusa-customer-token")
            throw new BuyerTokenError("BUYER_TOKEN_INVALID", "not an IAM token")
          if (token === "issuer-down")
            throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "metadata unavailable")
          return {
            issuer: "https://iam.example.test/",
            subject: "kratos-1",
            authorisedParty: "zuribeans-bff",
            tokenId: "t1",
            expiresAt: new Date(NOW + 300_000),
          }
        },
      },
      principals: {
        resolve: async (token: string) => {
          calls.push("principal")
          if (token === "unknown-buyer") throw new PrincipalResolutionError("IDENTITY_NOT_RESOLVED")
          if (token === "suspended-buyer")
            throw new PrincipalResolutionError("PRINCIPAL_NOT_ACTIVE")
          if (token === "revoked-session")
            throw new PrincipalResolutionError("SUBJECT_TOKEN_NOT_CURRENT")
          if (token === "cp-down") throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
          return {
            principalId: PRINCIPAL,
            externalIdentityId: "x",
            evidenceExpiresAt: new Date(NOW + 60_000),
          }
        },
      },
      tenants: {
        verifyOrganisationTenant: async (tenantId: string, organisationId: string) => {
          calls.push(`tenant:${tenantId}:${organisationId}`)
          if (organisationId === OTHER_ORG) throw new Error("CP does not attest")
        },
      },
      b2b: {
        listB2BOrganisations: async (filter: { canonical_organisation_id: string }) =>
          organisations.filter(
            (o) =>
              (o as { canonical_organisation_id: string }).canonical_organisation_id ===
              filter.canonical_organisation_id,
          ),
        listBuyerMemberships: async (filter: { organisation_id: string; principal_id: string }) => {
          calls.push(`membership:${JSON.stringify(filter)}`)
          return memberships.filter(
            (m) =>
              m.organisation_id === filter.organisation_id &&
              m.principal_id === filter.principal_id,
          )
        },
        listBuyerRoles: async () => [
          { id: "r1", membership_id: "b2bmem_1", role: "BUYER" },
          { id: "r2", membership_id: "b2bmem_1", role: "SUPERUSER" },
        ],
      },
    } as never,
  }
}

const request = (
  change: Partial<{ subjectToken: string; requestedOrganisationId: string | undefined }> = {},
) => ({
  subjectToken: "iam-token",
  requestedOrganisationId: ORG,
  correlationId: CORRELATION,
  ...change,
})

const denied = async (promise: Promise<unknown>, code: string, status: number) => {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BuyerAuthorityError)
  expect(error).toMatchObject({ code, status })
}

describe("resolveBuyerAuthority", () => {
  it("binds the CP Principal to an active membership of the CP-attested organisation", async () => {
    const { deps, calls } = world()
    const authority = await resolveBuyerAuthority(deps, request())
    expect(authority).toEqual({
      principalId: PRINCIPAL,
      organisation: { id: "b2borg_acme", canonicalOrganisationId: ORG, status: "ACTIVE" },
      membership: { id: "b2bmem_1", status: "ACTIVE" },
      roles: ["BUYER"],
      evidenceExpiresAt: new Date(NOW + 60_000),
    })
    // Token first, then CP identity, then CP tenant attestation, then a
    // membership lookup keyed on the CP Principal -- never a customer id.
    expect(calls).toEqual([
      "token",
      "principal",
      `tenant:tn_zuribeans:${ORG}`,
      `membership:${JSON.stringify({ organisation_id: "b2borg_acme", principal_id: PRINCIPAL })}`,
    ])
  })

  it("rejects a Medusa customer token before asking the Control Plane anything", async () => {
    const { deps, calls } = world()
    await denied(
      resolveBuyerAuthority(deps, request({ subjectToken: "medusa-customer-token" })),
      "BUYER_TOKEN_INVALID",
      401,
    )
    expect(calls).toEqual(["token"])
  })

  it.each([
    ["unknown-buyer", "IDENTITY_NOT_RESOLVED", 403],
    ["suspended-buyer", "PRINCIPAL_NOT_ACTIVE", 403],
    ["revoked-session", "BUYER_TOKEN_INVALID", 401],
    ["cp-down", "BUYER_IDENTITY_UNAVAILABLE", 503],
    ["issuer-down", "BUYER_IDENTITY_UNAVAILABLE", 503],
  ])("%s is %s and never reaches membership", async (token, code, status) => {
    const { deps, calls } = world()
    await denied(resolveBuyerAuthority(deps, request({ subjectToken: token })), code, status)
    expect(calls.some((c) => c.startsWith("membership"))).toBe(false)
  })

  it("never infers membership from a customer id that matches but a Principal that does not", async () => {
    const { deps } = world({
      memberships: [
        {
          id: "b2bmem_1",
          organisation_id: "b2borg_acme",
          customer_id: "cus_1",
          principal_id: OTHER_PRINCIPAL,
          status: "ACTIVE",
        },
      ],
    })
    await denied(resolveBuyerAuthority(deps, request()), "BUYER_NOT_AUTHORISED", 403)
  })

  it("requires a selected organisation and treats unknown and non-member alike", async () => {
    await denied(
      resolveBuyerAuthority(world().deps, request({ requestedOrganisationId: undefined })),
      "BUYER_ORGANISATION_REQUIRED",
      400,
    )
    await denied(
      resolveBuyerAuthority(
        world().deps,
        request({ requestedOrganisationId: "019a0915-a8c0-7000-8000-00000000dead" }),
      ),
      "BUYER_NOT_AUTHORISED",
      403,
    )
    await denied(
      resolveBuyerAuthority(world().deps, request({ requestedOrganisationId: "b2borg_acme" })),
      "BUYER_NOT_AUTHORISED",
      403,
    )
  })

  it("denies when the Control Plane does not attest the organisation's tenant", async () => {
    const { deps, calls } = world()
    await denied(
      resolveBuyerAuthority(deps, request({ requestedOrganisationId: OTHER_ORG })),
      "TENANT_NOT_ATTESTED",
      403,
    )
    expect(calls.some((c) => c.startsWith("membership"))).toBe(false)
  })

  it.each([
    ["a pending organisation", { orgStatus: "PENDING" }],
    ["a suspended organisation", { orgStatus: "SUSPENDED" }],
    [
      "two organisations linked to one canonical id",
      {
        organisations: [
          { id: "a", canonical_organisation_id: ORG, tenant_id: "tn_zuribeans", status: "ACTIVE" },
          { id: "b", canonical_organisation_id: ORG, tenant_id: "tn_zuribeans", status: "ACTIVE" },
        ],
      },
    ],
    [
      "an invited membership",
      {
        memberships: [
          {
            id: "b2bmem_1",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "INVITED",
          },
        ],
      },
    ],
    [
      "a suspended membership",
      {
        memberships: [
          {
            id: "b2bmem_1",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "SUSPENDED",
          },
        ],
      },
    ],
    [
      "a membership not yet in effect",
      {
        memberships: [
          {
            id: "b2bmem_1",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "ACTIVE",
            effective_from: new Date(NOW + 1000).toISOString(),
          },
        ],
      },
    ],
    [
      "an ended membership",
      {
        memberships: [
          {
            id: "b2bmem_1",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "ACTIVE",
            effective_until: new Date(NOW).toISOString(),
          },
        ],
      },
    ],
    [
      "two memberships",
      {
        memberships: [
          {
            id: "b2bmem_1",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "ACTIVE",
          },
          {
            id: "b2bmem_2",
            organisation_id: "b2borg_acme",
            customer_id: null,
            principal_id: PRINCIPAL,
            status: "ACTIVE",
          },
        ],
      },
    ],
  ])("denies %s", async (_name, change) => {
    await denied(
      resolveBuyerAuthority(world(change as never).deps, request()),
      "BUYER_NOT_AUTHORISED",
      403,
    )
  })
})
