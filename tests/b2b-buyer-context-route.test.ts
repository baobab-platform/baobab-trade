import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/store/b2b/buyer-context/route"
import { resetBuyerPrincipalResolverForTests } from "../src/baobab/control-plane/principal-resolution"
import { resetWorkloadTenantVerifierForTests } from "../src/baobab/control-plane/workload-tenant-verifier"

/**
 * ZB-G03 step 3: POST /store/b2b/buyer-context fails closed before any
 * identity work. The authority composition itself is covered by
 * tests/buyer-authority.test.ts.
 */
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const ENV = [
  "BAOBAB_BUYER_IDENTITY_ENABLED",
  "BAOBAB_IAM_BUYER_ISSUER",
  "BAOBAB_IAM_BUYER_AUTHORISED_PARTIES",
  "BAOBAB_IAM_WORKLOAD_TOKEN_URL",
  "BAOBAB_IAM_WORKLOAD_CLIENT_SECRET",
  "BAOBAB_CONTROL_PLANE_BASE_URL",
] as const

const enable = () => {
  vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "true")
  vi.stubEnv("BAOBAB_IAM_BUYER_ISSUER", "https://iam.example.test/")
  vi.stubEnv("BAOBAB_IAM_BUYER_AUTHORISED_PARTIES", "zuribeans-bff")
  vi.stubEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL", "https://iam.example.test/oauth2/token")
  vi.stubEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET", "synthetic-workload-secret")
  vi.stubEnv("BAOBAB_CONTROL_PLANE_BASE_URL", "https://cp.example.test")
}

const call = async (
  options: { authorization?: string; body?: unknown; correlation?: string } = {},
) => {
  const res: { statusCode?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  }
  const response = {
    setHeader: (name: string, value: string) => {
      res.headers[name.toLowerCase()] = value
    },
    status(code: number) {
      res.statusCode = code
      return response
    },
    json(body: unknown) {
      res.body = body
      return response
    },
  }
  const headers: Record<string, string> = {}
  if (options.authorization !== undefined) headers.authorization = options.authorization
  if (options.correlation !== undefined) headers["x-correlation-id"] = options.correlation
  await POST(
    {
      headers,
      body: options.body ?? {
        requested_organisation_id: "019a0915-a8c0-7000-8000-00000000a001",
        correlation_id: CORRELATION,
      },
      scope: {
        resolve: () => {
          throw new Error("no module may be read before the request is validated")
        },
      },
    } as never,
    response as never,
  )
  return res
}

describe("POST /store/b2b/buyer-context", () => {
  beforeEach(() => {
    for (const name of ENV) vi.stubEnv(name, undefined)
    resetBuyerPrincipalResolverForTests()
    resetWorkloadTenantVerifierForTests()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    resetBuyerPrincipalResolverForTests()
    resetWorkloadTenantVerifierForTests()
  })

  it("does not exist unless the buyer identity path is enabled", async () => {
    const res = await call({ authorization: "Bearer a.b.c" })
    expect(res.statusCode).toBe(404)
  })

  it("is unavailable, never a fallback, when enabled without its configuration", async () => {
    vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "true")
    const res = await call({ authorization: "Bearer a.b.c" })
    expect(res).toMatchObject({ statusCode: 503, body: { code: "BUYER_IDENTITY_UNAVAILABLE" } })
  })

  it("requires an IAM bearer token; a missing or malformed one is refused", async () => {
    enable()
    for (const authorization of [undefined, "", "Basic abc", "Bearer ", "Bearer a b"]) {
      const res = await call({ authorization })
      expect(res).toMatchObject({ statusCode: 401, body: { code: "BUYER_TOKEN_INVALID" } })
      expect(res.headers["cache-control"]).toBe("private, no-store")
    }
  })

  it.each([
    ["an asserted principal", { principal_id: "p", correlation_id: CORRELATION }],
    ["an asserted tenant", { tenant_id: "tn_zuribeans", correlation_id: CORRELATION }],
    ["an asserted membership", { buyer_membership_id: "m", correlation_id: CORRELATION }],
    ["asserted roles", { roles: ["ACCOUNT_ADMIN"], correlation_id: CORRELATION }],
    ["a missing correlation id", { requested_organisation_id: "x" }],
    ["a non-UUID correlation id", { correlation_id: "trade-ctx/1" }],
    ["a lowercase country", { requested_country_code: "za", correlation_id: CORRELATION }],
    ["a non-object body", ["x"]],
  ])("rejects %s before any identity work", async (_name, body) => {
    enable()
    const res = await call({ authorization: "Bearer a.b.c", body })
    expect(res).toMatchObject({
      statusCode: 400,
      body: { code: "INVALID_BUYER_OPERATION_REQUEST" },
    })
  })

  it("rejects a correlation header that disagrees with the body", async () => {
    enable()
    const res = await call({
      authorization: "Bearer a.b.c",
      correlation: "5d2a3c4b-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
    })
    expect(res.statusCode).toBe(400)
  })
})
