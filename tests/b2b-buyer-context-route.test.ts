import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/store/b2b/buyer-context/route"
import { resetEstateBindingResolverForTests } from "../src/baobab/control-plane/estate-binding"
import { resetBuyerPrincipalResolverForTests } from "../src/baobab/control-plane/principal-resolution"
import { resetWorkloadTenantVerifierForTests } from "../src/baobab/control-plane/workload-tenant-verifier"

/**
 * ADR-SHARED-042 CAA-04/05 (handoff v1.1): POST /store/b2b/buyer-context
 * fails closed before any identity work. The bearer is the BFF's own token;
 * the buyer token is subject evidence in the body. The authority composition itself is covered by
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
  "BAOBAB_TRADE_ENGINE_INSTANCE_ID",
  "BAOBAB_ENVIRONMENT",
] as const
const SUBJECT = "synthetic-header.synthetic-payload.synthetic-signature"
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

const enable = () => {
  vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "true")
  vi.stubEnv("BAOBAB_IAM_BUYER_ISSUER", "https://iam.example.test/")
  vi.stubEnv("BAOBAB_IAM_BUYER_AUTHORISED_PARTIES", "zuribeans-bff")
  vi.stubEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL", "https://iam.example.test/oauth2/token")
  vi.stubEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET", "synthetic-workload-secret")
  vi.stubEnv("BAOBAB_CONTROL_PLANE_BASE_URL", "https://cp.example.test")
  vi.stubEnv("BAOBAB_TRADE_ENGINE_INSTANCE_ID", "ei_trade01")
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
        subject_token: SUBJECT,
        subject_token_type: TOKEN_TYPE,
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
    resetEstateBindingResolverForTests()
    resetWorkloadTenantVerifierForTests()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    resetBuyerPrincipalResolverForTests()
    resetEstateBindingResolverForTests()
    resetWorkloadTenantVerifierForTests()
  })

  it("does not exist unless the buyer identity path is enabled", async () => {
    const res = await call({ authorization: "Bearer a.b.c" })
    expect(res.statusCode).toBe(404)
  })

  it("is unavailable, never a fallback, when enabled without its configuration", async () => {
    vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "true")
    const res = await call({ authorization: "Bearer a.b.c" })
    expect(res).toMatchObject({
      statusCode: 503,
      body: { decision: { outcome: "UNAVAILABLE", reasons: ["SOURCE_UNAVAILABLE"] } },
    })
  })

  it("is unavailable without this Trade instance's engine id", async () => {
    enable()
    vi.stubEnv("BAOBAB_TRADE_ENGINE_INSTANCE_ID", undefined)
    const res = await call({ authorization: "Bearer a.b.c" })
    expect(res.statusCode).toBe(503)
  })

  it("requires the BFF's own bearer token; a missing or malformed one is refused", async () => {
    enable()
    for (const authorization of [
      undefined,
      "",
      "Basic abc",
      "Bearer ",
      "Bearer a b",
      "Bearer opaque",
    ]) {
      const res = await call({ authorization })
      expect(res).toMatchObject({
        statusCode: 401,
        body: { decision: { outcome: "DENY", reasons: ["BUYER_TOKEN_INVALID"] } },
      })
      expect(res.headers["cache-control"]).toBe("private, no-store")
    }
  })

  const evidence = {
    subject_token: SUBJECT,
    subject_token_type: TOKEN_TYPE,
    correlation_id: CORRELATION,
  }
  it.each([
    ["an asserted principal", { ...evidence, principal_id: "p" }],
    ["an asserted tenant", { ...evidence, tenant_id: "tn_zuribeans" }],
    ["an asserted estate", { ...evidence, digital_estate_id: "zuribeans" }],
    ["an asserted membership", { ...evidence, buyer_membership_id: "m" }],
    ["asserted roles", { ...evidence, roles: ["ACCOUNT_ADMIN"] }],
    ["an asserted execution context", { ...evidence, decision: { outcome: "ALLOW" } }],
    ["no subject token (v1.0 shape)", { correlation_id: CORRELATION }],
    ["an opaque subject token", { ...evidence, subject_token: "opaque" }],
    [
      "an ID token type",
      { ...evidence, subject_token_type: "urn:ietf:params:oauth:token-type:id_token" },
    ],
    ["a missing correlation id", { subject_token: SUBJECT, subject_token_type: TOKEN_TYPE }],
    ["a non-UUID correlation id", { ...evidence, correlation_id: "trade-ctx/1" }],
    ["a lowercase country", { ...evidence, requested_country_code: "za" }],
    ["a malformed estate hint", { ...evidence, requested_digital_estate_id: "Zuri Beans" }],
    ["a non-object body", ["x"]],
  ])("rejects %s before any identity work", async (_name, body) => {
    enable()
    const res = await call({ authorization: "Bearer a.b.c", body })
    expect(res).toMatchObject({
      statusCode: 400,
      body: { code: "INVALID_BUYER_OPERATION_REQUEST" },
    })
    expect(JSON.stringify(res.body)).not.toContain(SUBJECT)
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
