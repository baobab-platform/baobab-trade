import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HttpDocumentaryRestrictionClient,
  assertUnblockedDocumentaryScope,
  type DocumentaryRestrictionRequest,
} from "../src/baobab/control-plane/documentary-restriction"

const now = Date.parse("2026-10-11T06:00:00Z")
const request: DocumentaryRestrictionRequest = {
  context_id: "0190a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  capability: "commerce.order.create",
  market: "ZA",
  operation_reference: "cart/synthetic/complete",
}
const expected = { ...request, organisation_id: "0190a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c" }
const fresh = () => ({
  ...expected, blocked: false, authority_granted: false,
  policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
  evaluated_at: new Date(now).toISOString(),
  expires_at: new Date(now + 1500).toISOString(),
})

afterEach(() => vi.unstubAllGlobals())

describe("PEO-02T native Trade negative restriction consumer", () => {
  it("accepts only an exact current non-authorizing scope with no active restriction", () => {
    expect(() => assertUnblockedDocumentaryScope(fresh(), expected, now)).not.toThrow()
    for (const mutation of [
      { blocked: true }, { authority_granted: true },
      { organisation_id: "other-org" }, { context_id: "other-context" },
      { capability: "payments.capture" }, { market: "UG" },
      { operation_reference: "another-order" },
      { policy_reference: "untrusted" },
      { expires_at: new Date(now).toISOString() },
      { expires_at: new Date(now + 30_000).toISOString() },
      { evaluated_at: new Date(now - 30_000).toISOString() },
    ]) {
      expect(() => assertUnblockedDocumentaryScope({ ...fresh(), ...mutation }, expected, now))
        .toThrow("Documentary restriction denied")
    }
  })

  it("calls CP over workload-authenticated private HTTP and denies transport errors", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fresh() }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpDocumentaryRestrictionClient("https://cp.example")
    await expect(client.assess(request, "workload-token", "corr-1")).resolves.toMatchObject(fresh())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://cp.example/internal/documentary/v1/restrictions/assess")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      authorization: "Bearer workload-token", "cache-control": "no-store",
    })
    expect(JSON.parse(init.body as string)).toEqual(request)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(client.assess(request, "workload-token", "corr-1"))
      .rejects.toThrow("current CP authority unavailable")
    expect(() => new HttpDocumentaryRestrictionClient("http://cp.example"))
      .toThrow("HTTPS")
  })
})
