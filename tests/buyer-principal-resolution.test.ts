import { describe, expect, it } from "vitest"
import {
  ControlPlanePrincipalResolver,
  PrincipalResolutionError,
  PRINCIPAL_RESOLVE_PATH,
} from "../src/baobab/control-plane/principal-resolution"

/**
 * ZB-G03 step 3: Trade's call to CP's delegated Principal resolution. A fake
 * Control Plane only -- this pins the wire boundary, not a connected CP.
 */
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const PRINCIPAL = "019a0915-a8c0-7000-8000-000000000001"
const EXTERNAL = "019a0915-a8c0-7000-8000-000000000002"
const SUBJECT_TOKEN = "header.payload.signature"

const resolution = (change: Record<string, unknown> = {}) => ({
  outcome: "RESOLVED",
  principal_id: PRINCIPAL,
  actor_type: "human",
  status: "ACTIVE",
  external_identity_id: EXTERNAL,
  evidence_expires_at: new Date(NOW + 60_000).toISOString(),
  ...change,
})

const resolver = (respond: () => Response | Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = []
  const r = new ControlPlanePrincipalResolver({
    baseUrl: "https://cp.example.test",
    tokenProvider: { getAccessToken: async () => "trade-workload-token" },
    fetcher: (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: url.toString(), init: init ?? {} })
      return respond()
    }) as typeof fetch,
    now: () => NOW,
  })
  return { r, requests }
}

describe("ControlPlanePrincipalResolver", () => {
  it("authenticates as Trade and carries the buyer token only as subject evidence", async () => {
    const { r, requests } = resolver(() => Response.json(resolution()))
    await expect(r.resolve(SUBJECT_TOKEN, CORRELATION)).resolves.toEqual({
      principalId: PRINCIPAL,
      externalIdentityId: EXTERNAL,
      evidenceExpiresAt: new Date(NOW + 60_000),
    })
    expect(requests).toHaveLength(1)
    const [{ url, init }] = requests
    expect(url).toBe(`https://cp.example.test${PRINCIPAL_RESOLVE_PATH}`)
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer trade-workload-token")
    expect(headers.get("x-correlation-id")).toBe(CORRELATION)
    // Trade asserts no identity: no issuer, subject, email or customer.
    expect(JSON.parse(init.body as string)).toEqual({
      subject_token: SUBJECT_TOKEN,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      correlation_id: CORRELATION,
    })
  })

  it.each([
    ["IDENTITY_NOT_RESOLVED", 404],
    ["PRINCIPAL_NOT_ACTIVE", 403],
    ["SUBJECT_TOKEN_NOT_CURRENT", 403],
    ["CALLER_NOT_PERMITTED", 403],
    ["RESOLUTION_UNAVAILABLE", 503],
  ])("surfaces CP's %s", async (code, status) => {
    const { r } = resolver(() => Response.json({ code }, { status }))
    await expect(r.resolve(SUBJECT_TOKEN, CORRELATION)).rejects.toEqual(
      new PrincipalResolutionError(code as never),
    )
  })

  it.each([
    ["an unknown denial code", () => Response.json({ code: "SOMETHING_NEW" }, { status: 403 })],
    ["a non-JSON body", () => new Response("<html>", { status: 502 })],
    ["a registered outcome", () => Response.json(resolution({ outcome: "REGISTERED" }))],
    ["a workload Principal", () => Response.json(resolution({ actor_type: "workload" }))],
    ["a suspended Principal", () => Response.json(resolution({ status: "SUSPENDED" }))],
    ["a malformed principal id", () => Response.json(resolution({ principal_id: "cus_01" }))],
    [
      "expired evidence",
      () => Response.json(resolution({ evidence_expires_at: new Date(NOW - 1).toISOString() })),
    ],
    ["a network failure", () => Promise.reject(new Error("reset"))],
  ])("fails closed on %s", async (_name, respond) => {
    const { r } = resolver(respond as () => Response)
    await expect(r.resolve(SUBJECT_TOKEN, CORRELATION)).rejects.toEqual(
      new PrincipalResolutionError("RESOLUTION_UNAVAILABLE"),
    )
  })

  it("fails closed without a workload token and refuses an insecure Control Plane", async () => {
    const r = new ControlPlanePrincipalResolver({
      baseUrl: "https://cp.example.test",
      tokenProvider: {
        getAccessToken: async () => {
          throw new Error("IAM down")
        },
      },
    })
    await expect(r.resolve(SUBJECT_TOKEN, CORRELATION)).rejects.toEqual(
      new PrincipalResolutionError("RESOLUTION_UNAVAILABLE"),
    )
    expect(
      () =>
        new ControlPlanePrincipalResolver({
          baseUrl: "http://cp.example.test",
          tokenProvider: { getAccessToken: async () => "t" },
        }),
    ).toThrow()
  })
})
