import { generateKeyPairSync, verify } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { REQUIRED_CHARGES, signedChargeBytes } from "../src/baobab/b2b/governed-cart-charge-issuer"
import {
  signDev07SyntheticPrice,
  dev07PrivateSigner,
  type Dev07SyntheticProfile,
  type Dev07Cart,
} from "../src/baobab/b2b/dev07-synthetic-price-issuer"
import { readDev07Cart, verifyDev07Caller } from "../src/scripts/serve-dev07-synthetic-price-issuer"
const pair = generateKeyPairSync("ed25519")
const now = Date.parse("2026-11-05T12:00:00Z")
const cart: Dev07Cart = {
  cartId: "cart_dev07_qualified",
  tenantId: "tn_dev07",
  marketKey: "ZA",
  countryCode: "ZA",
  sellerLegalEntityId: "LE-DEV07",
  currency: "ZAR",
  updatedAtExact: "2026-11-05T11:59:52.012000Z",
  resourceVersion: Date.parse("2026-11-05T11:59:52.012Z"),
}
const profile: Dev07SyntheticProfile = {
  syntheticOnly: true,
  tenantId: cart.tenantId,
  marketId: "mkt_dev07",
  marketKey: cart.marketKey,
  countryCode: cart.countryCode,
  sellerLegalEntityId: cart.sellerLegalEntityId,
  currency: cart.currency,
  issuerId: "issuer_dev07_private",
  policyReference: "cp:dev07:price-issuer:synthetic",
  charges: REQUIRED_CHARGES.map((kind) => ({
    kind,
    amountMinor: "1",
    resolution: "CHARGED" as const,
    sourceReference: "synthetic:dev07:" + kind.toLowerCase(),
    zeroReason: null,
  })),
}
describe("DEV-07 isolated synthetic pricing (not actual connected authority)", () => {
  it("signs exactly seven explicitly invented charge facts for the native cart", () => {
    const signed = signDev07SyntheticPrice(profile, cart, pair.privateKey, now)
    expect(
      verify(
        null,
        signedChargeBytes(signed.evidence),
        pair.publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(true)
    expect(signed.evidence.cartId).toBe(cart.cartId)
    expect(signed.evidence.charges.map((x) => x.kind)).toEqual(REQUIRED_CHARGES)
    expect(signed.evidence.expiresAt).toBe(new Date(now + 30000).toISOString())
  })
  it("denies a non-Ed25519 signer", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    expect(() => signDev07SyntheticPrice(profile, cart, rsa, now)).toThrow()
    expect(
      dev07PrivateSigner(
        pair.privateKey
          .export({
            type: "pkcs8",
            format: "pem",
          })
          .toString(),
      ).asymmetricKeyType,
    ).toBe("ed25519")
  })
  it("denies foreign scope, changed timestamp and absent synthetic declaration", () => {
    for (const field of [
      "tenantId",
      "marketKey",
      "countryCode",
      "sellerLegalEntityId",
      "currency",
    ] as const) {
      expect(() =>
        signDev07SyntheticPrice(profile, { ...cart, [field]: "WRONG" }, pair.privateKey, now),
      ).toThrow()
    }
    expect(() =>
      signDev07SyntheticPrice(
        profile,
        { ...cart, updatedAtExact: "2026-11-05T11:59:52.013000Z" },
        pair.privateKey,
        now,
      ),
    ).toThrow()
    expect(() =>
      signDev07SyntheticPrice(
        { ...profile, syntheticOnly: false as true },
        cart,
        pair.privateKey,
        now,
      ),
    ).toThrow()
  })
  it("refuses incomplete, duplicate or ungrounded charge facts", () => {
    for (const charges of [
      profile.charges.slice(1),
      [...profile.charges.slice(1), profile.charges[1]],
      [{ ...profile.charges[0], amountMinor: "0" }, ...profile.charges.slice(1)],
      [{ ...profile.charges[0], sourceReference: "real-tariff" }, ...profile.charges.slice(1)],
      [{ ...profile.charges[0], resolution: "EXEMPT" as const }, ...profile.charges.slice(1)],
    ])
      expect(() =>
        signDev07SyntheticPrice({ ...profile, charges }, cart, pair.privateKey, now),
      ).toThrow()
  })
  it("requires current actual IAM introspection with exact audience and scope", async () => {
    const original = {
      active: true,
      client_id: "trade-price-caller",
      iss: "https://iam.example.test",
      aud: "baobab-price-issuer",
      actor_type: "workload",
      scope: "trade:cart-final-charges",
      exp: Math.floor(now / 1000) + 120,
    }
    const cfg = {
      url: new URL("https://iam.example.test/oauth2/introspect"),
      clientId: "test-introspector",
      clientSecret: "test-secret",
      issuer: "https://iam.example.test",
      audience: "baobab-price-issuer",
      allowedCaller: "trade-price-caller",
      now: () => now,
    }
    for (const mutation of [
      { active: false },
      { client_id: "foreign" },
      { aud: "another" },
      { aud: [cfg.audience, "another"] },
      { actor_type: "human" },
      { scope: "trade:buy" },
      { exp: Math.floor(now / 1000) - 1 },
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ...original, ...mutation }))
      await expect(verifyDev07Caller("a".repeat(30), { ...cfg, fetcher })).rejects.toThrow()
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(original))
    await expect(verifyDev07Caller("a".repeat(30), { ...cfg, fetcher })).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(
      cfg.url,
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    )
  })
  it("reads persisted native cart and rejects absent binding", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          tenant_id: cart.tenantId,
          market_key: cart.marketKey,
          market_code: cart.countryCode,
          responsible_legal_entity_id: cart.sellerLegalEntityId,
          binding_currency: cart.currency,
          cart_currency: cart.currency.toLowerCase(),
          completed_at: null,
          updated_at: new Date(cart.resourceVersion),
          updated_at_exact: cart.updatedAtExact,
        },
      ],
    })
    await expect(readDev07Cart({ query } as never, cart.cartId)).resolves.toEqual(cart)
    expect(query).toHaveBeenCalledWith(expect.stringContaining("native_seller_cart_binding"), [
      cart.cartId,
    ])
    query.mockResolvedValueOnce({ rows: [] })
    await expect(readDev07Cart({ query } as never, cart.cartId)).rejects.toThrow()
  })
})
