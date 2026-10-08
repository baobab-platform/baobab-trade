import { MedusaError } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { describe, expect, it } from "vitest"
import { GET } from "../src/api/store/b2b/context/route"
import { B2B_MODULE } from "../src/modules/b2b"
import { signRealToken, TEST_JWT_SECRET } from "./support/real-token"

/**
 * Gate ZB-03.7: GET /store/b2b/context (src/api/store/b2b/context/route.ts)
 * had zero tests exercising the actual route handler -- only its building
 * blocks (resolveBuyerContext in tests/b2b-context-resolver.test.ts) were
 * ever tested, always with a hand-typed actor id. This drives the real
 * exported `GET` handler with an `auth_context.actor_id` recovered from a
 * JWT verified the same way @medusajs/framework/http's authenticate()
 * middleware verifies one (see tests/authenticate-middleware.test.ts),
 * proving the binding from a real token all the way into
 * resolveBuyerContext, not just that resolveBuyerContext works in isolation.
 */
type FakeOrganisation = {
  id: string
  canonical_organisation_id: string
  tenant_id: string
  status: string
}

function fakeB2BModuleService(options: {
  organisations: FakeOrganisation[]
  memberships: Array<{
    id: string
    organisation_id: string
    customer_id: string
    principal_id: string
    status: string
  }>
  roles: Array<{ id: string; membership_id: string; role: string }>
}) {
  return {
    listB2BOrganisations: async (filter: { canonical_organisation_id: string }) =>
      options.organisations.filter(
        (o) => o.canonical_organisation_id === filter.canonical_organisation_id,
      ),
    listBuyerMemberships: async (filter: { organisation_id: string; customer_id: string }) =>
      options.memberships.filter(
        (m) => m.organisation_id === filter.organisation_id && m.customer_id === filter.customer_id,
      ),
    listBuyerRoles: async (filter: { membership_id: string }) =>
      options.roles.filter((r) => r.membership_id === filter.membership_id),
  }
}

const actorIdFromRealToken = (token: string): string => {
  const verified = jwt.verify(token, TEST_JWT_SECRET)
  if (typeof verified === "string" || !("actor_id" in verified)) {
    throw new Error("expected a decoded token payload with actor_id")
  }
  return verified.actor_id as string
}

const buildRequest = (
  b2b: ReturnType<typeof fakeB2BModuleService>,
  canonicalOrganisationId: string | undefined,
  actorId: string,
) => ({
  query: canonicalOrganisationId ? { canonical_organisation_id: canonicalOrganisationId } : {},
  auth_context: { actor_id: actorId, actor_type: "customer" },
  scope: {
    resolve: (key: string) => {
      if (key === B2B_MODULE) return b2b
      throw new Error(`unexpected container key requested: ${key}`)
    },
  },
})

const buildResponse = () => {
  const res: { statusCode?: number; body?: unknown; status: (code: number) => typeof res } = {
    status(code: number) {
      res.statusCode = code
      return res
    },
  }
  ;(res as unknown as { json: (body: unknown) => void }).json = (body: unknown) => {
    res.body = body
  }
  return res as typeof res & { json: (body: unknown) => void; statusCode?: number; body?: unknown }
}

describe("GET /store/b2b/context (Gate ZB-03.7 real-token verification)", () => {
  it("rejects a request with no canonical_organisation_id", async () => {
    const token = signRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const b2b = fakeB2BModuleService({ organisations: [], memberships: [], roles: [] })
    const req = buildRequest(b2b, undefined, actorIdFromRealToken(token))

    await expect(GET(req as never, buildResponse() as never)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
  })

  it("returns 404 when no organisation is linked to the canonical id", async () => {
    const token = signRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const b2b = fakeB2BModuleService({ organisations: [], memberships: [], roles: [] })
    const req = buildRequest(b2b, "canon-org-1", actorIdFromRealToken(token))

    await expect(GET(req as never, buildResponse() as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it("rejects a real, validly-signed token whose actor has no membership in the organisation (IDOR)", async () => {
    const attackerToken = signRealToken({ actor_id: "cus_attacker", actor_type: "customer" })
    const b2b = fakeB2BModuleService({
      organisations: [
        {
          id: "org-1",
          canonical_organisation_id: "canon-org-1",
          tenant_id: "tn_1",
          status: "ACTIVE",
        },
      ],
      memberships: [
        {
          id: "mem-1",
          organisation_id: "org-1",
          customer_id: "cus_legit_member",
          principal_id: "principal-1",
          status: "ACTIVE",
        },
      ],
      roles: [],
    })
    const req = buildRequest(b2b, "canon-org-1", actorIdFromRealToken(attackerToken))

    await expect(GET(req as never, buildResponse() as never)).rejects.toMatchObject({
      type: MedusaError.Types.FORBIDDEN,
    })
  })

  it("rejects a suspended membership even for the correct, real-token-verified actor", async () => {
    const token = signRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const b2b = fakeB2BModuleService({
      organisations: [
        {
          id: "org-1",
          canonical_organisation_id: "canon-org-1",
          tenant_id: "tn_1",
          status: "ACTIVE",
        },
      ],
      memberships: [
        {
          id: "mem-1",
          organisation_id: "org-1",
          customer_id: "cus_1",
          principal_id: "principal-1",
          status: "SUSPENDED",
        },
      ],
      roles: [],
    })
    const req = buildRequest(b2b, "canon-org-1", actorIdFromRealToken(token))

    await expect(GET(req as never, buildResponse() as never)).rejects.toMatchObject({
      type: MedusaError.Types.FORBIDDEN,
    })
  })

  it("returns buyer context when a real-token-verified actor has active membership", async () => {
    const token = signRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const b2b = fakeB2BModuleService({
      organisations: [
        {
          id: "org-1",
          canonical_organisation_id: "canon-org-1",
          tenant_id: "tn_1",
          status: "ACTIVE",
        },
      ],
      memberships: [
        {
          id: "mem-1",
          organisation_id: "org-1",
          customer_id: "cus_1",
          principal_id: "principal-1",
          status: "ACTIVE",
        },
      ],
      roles: [{ id: "role-1", membership_id: "mem-1", role: "BUYER" }],
    })
    const req = buildRequest(b2b, "canon-org-1", actorIdFromRealToken(token))
    const res = buildResponse()

    await GET(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      organisation: { id: "org-1", canonical_organisation_id: "canon-org-1", status: "ACTIVE" },
      membership: { id: "mem-1", status: "ACTIVE" },
      roles: ["BUYER"],
    })
  })
})
