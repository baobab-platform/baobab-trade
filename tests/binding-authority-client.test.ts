import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpBindingAuthorityClient } from "../src/baobab/orders/binding-authority-client"
const scope = {
  cartId: "cart",
  tenantId: "tn_test01",
  organisationId: "00000000-0000-4000-8000-000000000001",
  responsibleLegalEntityId: "LE-SELLER",
  marketCode: "ZA",
  currencyCode: "ZAR",
  salesChannelId: "channel",
  regionId: "region",
}
const digest = "a".repeat(64)
const decision = () => ({
  scope,
  command_digest: digest,
  decision_id: crypto.randomUUID(),
  principal_id: "prn_operator",
  issuer: "https://iam.example.test",
  token_id: "human-token-id",
  scope_name: "trade-binding:activate",
  evaluated_at: new Date(Date.now() - 100).toISOString(),
  valid_until: new Date(Date.now() + 4000).toISOString(),
  matched_grant_ids: ["exact-grant"],
  provider_permissions_granted: false,
})
afterEach(() => vi.unstubAllGlobals())
describe("fixed CP command authority transport", () => {
  it.each([
    "http://cp.example.test",
    "https://user:secret@cp.example.test",
    "https://cp.example.test/override",
    "https://cp.example.test/?route=other",
  ])("rejects credential/path/HTTP origin %s", (url) => {
    expect(() => new HttpBindingAuthorityClient(url)).toThrow()
  })
  it("forwards the actual human token only to the canonical route with redirect and body bounds", async () => {
    const fetch = vi.fn(async () => Response.json(decision()))
    vi.stubGlobal("fetch", fetch)
    await new HttpBindingAuthorityClient("https://cp.example.test").authorize(
      "actual-human-token",
      "activate",
      scope,
      digest,
    )
    expect(fetch).toHaveBeenCalledWith(
      "https://cp.example.test/internal/trade-binding/v1/activate/authorize",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer actual-human-token" }),
      }),
    )
  })
  it.each(["scope", "actor", "lease", "provider"])(
    "denies invalid %s CP decision",
    async (mode) => {
      const d = decision()
      if (mode === "scope") d.scope = { ...scope, tenantId: "tn_other01" }
      if (mode === "actor") Object.assign(d, { actor_type: "workload" })
      if (mode === "lease") d.valid_until = new Date(Date.now() + 60000).toISOString()
      if (mode === "provider") Object.assign(d, { provider_permissions_granted: true })
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(d)),
      )
      await expect(
        new HttpBindingAuthorityClient("https://cp.example.test").authorize(
          "actual-token",
          "activate",
          scope,
          digest,
        ),
      ).rejects.toThrow()
    },
  )
  it("denies oversized decoded authority bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } }),
      ),
    )
    await expect(
      new HttpBindingAuthorityClient("https://cp.example.test").authorize(
        "actual-token",
        "activate",
        scope,
        digest,
      ),
    ).rejects.toThrow("too large")
  })
})
