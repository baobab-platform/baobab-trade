import { describe, expect, it, vi } from "vitest"
import { HttpTradePriceIssuerAuthority } from "../src/baobab/control-plane/trade-price-issuer"
import { nativeBuyerCommitRuntime } from "../src/baobab/b2b/native-buyer-commit-runtime"

const now = Date.parse("2026-11-05T11:00:00Z")
const correlation = "58f532d0-e2c1-45e0-a900-521d0cb40301"
const fingerprint = "a".repeat(64)
const check = {
  tenantId: "tn_dev07",
  cartId: "cart_native_buyer_001",
  marketId: "mkt_dev07",
  sellerLegalEntityId: "LE-DEV07",
  currency: "ZAR",
  issuerId: "issuer_dev07",
  decisionId: "58f532d0-e2c1-45e0-a900-521d0cb40302",
  policyReference: "cp:dev07:price-issuer",
  sourceDigest: "b".repeat(64),
}
const answer = {
  ...check,
  outcome: "AUTHORIZED",
  signerKeyFingerprint: fingerprint,
  expiresAt: new Date(now + 25000).toISOString(),
}

describe("live CP price issuer adapter", () => {
  it("redeems the original decision online on every price read and disables redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(answer))
    const issuer = new HttpTradePriceIssuerAuthority(
      new URL("https://cp.example.test"),
      { getAccessToken: async () => "test-workload-credential" },
      fingerprint,
      fetcher,
      () => now,
    )
    await expect(issuer.verifyCurrent(check, correlation)).resolves.toMatchObject({
      decisionId: check.decisionId,
    })
    await expect(issuer.verifyCurrent(check, correlation)).resolves.toMatchObject({
      decisionId: check.decisionId,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith(
      "https://cp.example.test/internal/trade/v1/price-issuer/resolve",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify({ ...check, signerKeyFingerprint: fingerprint }),
      }),
    )
  })

  it("refuses revoked, changed or overlong decisions from CP", async () => {
    const responses = [
      new Response(null, { status: 403 }),
      Response.json({ ...answer, sourceDigest: "c".repeat(64) }),
      Response.json({ ...answer, expiresAt: new Date(now + 31000).toISOString() }),
      Response.json({ ...answer, signerKeyFingerprint: "f".repeat(64) }),
    ]
    for (const response of responses) {
      const issuer = new HttpTradePriceIssuerAuthority(
        new URL("https://cp.example.test"),
        { getAccessToken: async () => "test-workload-credential" },
        fingerprint,
        async () => response,
        () => now,
      )
      await expect(issuer.verifyCurrent(check, correlation)).rejects.toThrow(
        "CP_PRICE_ISSUER_AUTHORITY_NOT_PROVEN",
      )
    }
  })

  it("refuses unconfigured or protected development runtime before resolving services", () => {
    expect(() =>
      nativeBuyerCommitRuntime({
        BAOBAB_NATIVE_BUYER_COMMIT_ENABLED: "true",
        BAOBAB_ENVIRONMENT: "development",
      }),
    ).toThrow()
    expect(() =>
      nativeBuyerCommitRuntime({
        BAOBAB_NATIVE_BUYER_COMMIT_ENABLED: "true",
        BAOBAB_ENVIRONMENT: "development",
        BAOBAB_DEPLOYMENT_ENV: "staging",
      }),
    ).toThrow()
  })
})
