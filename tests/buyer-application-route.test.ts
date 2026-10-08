import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/store/b2b/organisations/apply/route"
import { B2B_MODULE } from "../src/modules/b2b"

const originalTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
afterEach(() => {
  if (originalTenant === undefined) delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
  else process.env.BAOBAB_ZURIBEANS_TENANT_ID = originalTenant
})

const response = () => {
  const res: { statusCode?: number; body?: unknown; status: (code: number) => typeof res } = {
    status(code) {
      res.statusCode = code
      return res
    },
  }
  ;(res as typeof res & { json: (body: unknown) => void }).json = (body) => {
    res.body = body
  }
  return res as typeof res & { json: (body: unknown) => void }
}

describe("POST /store/b2b/organisations/apply", () => {
  it("creates only a submitted application using server-authoritative tenant context", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const createBuyerApplications = vi.fn(async (input) => ({ id: "b2bapp_1", ...input }))
    const service = {
      listBuyerApplications: vi.fn(async () => []),
      createBuyerApplications,
      createB2BOrganisations: vi.fn(),
      createBuyerMemberships: vi.fn(),
      createBuyerRoles: vi.fn(),
    }
    const req = {
      auth_context: { actor_id: "cus_1", actor_type: "customer" },
      headers: { "idempotency-key": "application-key-0001" },
      body: {
        legal_name: "Acme Procurement",
        tenant_id: "tn_attacker",
        requested_market_keys: ["UG", "ZA"],
      },
      scope: { resolve: (key: string) => (key === B2B_MODULE ? service : null) },
    }
    const res = response()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createBuyerApplications).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tn_zuribeans",
        applicant_customer_id: "cus_1",
        applicant_principal_id: null,
        status: "SUBMITTED",
      }),
    )
    expect(service.createB2BOrganisations).not.toHaveBeenCalled()
    expect(service.createBuyerMemberships).not.toHaveBeenCalled()
    expect(service.createBuyerRoles).not.toHaveBeenCalled()
  })

  it("replays the same idempotent request without creating another application", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const body = {
      legal_name: "Acme Procurement",
      requested_market_keys: ["UG"],
    }
    const { createHash } = await import("node:crypto")
    const normalized = {
      legal_name: body.legal_name,
      trading_name: null,
      registration_number: null,
      country_of_registration: null,
      website: null,
      requested_market_keys: ["UG"],
    }
    const existing = {
      id: "b2bapp_1",
      ...normalized,
      tenant_id: "tn_zuribeans",
      request_hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
      status: "SUBMITTED",
      revision: 1,
      submitted_at: new Date(),
    }
    const service = {
      listBuyerApplications: vi.fn(async () => [existing]),
      createBuyerApplications: vi.fn(),
    }
    const req = {
      auth_context: { actor_id: "cus_1", actor_type: "customer" },
      headers: { "idempotency-key": "application-key-0001" },
      body,
      scope: { resolve: () => service },
    }
    const res = response()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.createBuyerApplications).not.toHaveBeenCalled()
  })
})
