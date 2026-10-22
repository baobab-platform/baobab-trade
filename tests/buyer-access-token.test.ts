import { generateKeyPairSync, sign as signBytes, type KeyObject } from "node:crypto"
import { describe, expect, it } from "vitest"
import { BuyerTokenError, BuyerTokenVerifier } from "../src/baobab/auth/buyer-access-token"

/**
 * ZB-G03 step 3: Trade's own verification of an IAM buyer token. Synthetic
 * issuer, keys and tokens only -- this proves the verification boundary,
 * not connected IAM acceptance.
 */
const ISSUER = "https://iam.example.test/"
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const nowSeconds = Math.floor(NOW / 1000)

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 })

const jwk = (key: KeyObject, kid: string) => ({ ...key.export({ format: "jwk" }), kid, use: "sig" })
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

const claims = (change: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  sub: "kratos-identity-0001",
  aud: ["baobab-trade"],
  exp: nowSeconds + 300,
  iat: nowSeconds - 10,
  jti: "token-0001",
  scope: "openid trade:buy",
  actor_type: "human",
  azp: "zuribeans-bff",
  ...change,
})

const token = (
  payload: Record<string, unknown> = claims(),
  options: { alg?: string; kid?: string; key?: KeyObject; header?: Record<string, unknown> } = {},
) => {
  const alg = options.alg ?? "RS256"
  const head = b64({ alg, kid: options.kid ?? "rsa-1", typ: "JWT", ...options.header })
  const body = b64(payload)
  const input = Buffer.from(`${head}.${body}`)
  const signature =
    alg === "ES256"
      ? signBytes("SHA256", input, { key: options.key ?? ec.privateKey, dsaEncoding: "ieee-p1363" })
      : signBytes("RSA-SHA256", input, options.key ?? rsa.privateKey)
  return `${head}.${body}.${signature.toString("base64url")}`
}

const issuerFetch = (
  options: { jwksUri?: string; discoveryIssuer?: string; keys?: unknown[]; fail?: boolean } = {},
) => {
  const calls: string[] = []
  const fetcher = (async (input: string | URL) => {
    const url = input.toString()
    calls.push(url)
    if (options.fail) throw new Error("network down")
    if (url === `${ISSUER}.well-known/openid-configuration`) {
      return new Response(
        JSON.stringify({
          issuer: options.discoveryIssuer ?? ISSUER,
          jwks_uri: options.jwksUri ?? `${ISSUER}jwks`,
        }),
      )
    }
    if (url === (options.jwksUri ?? `${ISSUER}jwks`)) {
      return new Response(
        JSON.stringify({
          keys: options.keys ?? [jwk(rsa.publicKey, "rsa-1"), jwk(ec.publicKey, "ec-1")],
        }),
      )
    }
    return new Response("not found", { status: 404 })
  }) as typeof fetch
  return { fetcher, calls }
}

const verifier = (fetchOptions: Parameters<typeof issuerFetch>[0] = {}, now = NOW) => {
  const { fetcher, calls } = issuerFetch(fetchOptions)
  return {
    calls,
    v: new BuyerTokenVerifier({
      issuer: ISSUER,
      authorisedParties: ["zuribeans-bff"],
      fetcher,
      now: () => now,
    }),
  }
}

const rejects = async (v: BuyerTokenVerifier, raw: string, code = "BUYER_TOKEN_INVALID") => {
  const error = await v.verify(raw).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(BuyerTokenError)
  expect((error as BuyerTokenError).code).toBe(code)
}

describe("BuyerTokenVerifier", () => {
  it("accepts an RS256 and an ES256 Trade buyer token from the issuer's keys", async () => {
    const { v } = verifier()
    await expect(v.verify(token())).resolves.toEqual({
      issuer: ISSUER,
      subject: "kratos-identity-0001",
      authorisedParty: "zuribeans-bff",
      tokenId: "token-0001",
      expiresAt: new Date((nowSeconds + 300) * 1000),
      acr: undefined,
      amr: [],
      authTime: undefined,
    })
    await expect(
      v.verify(token(claims({ aud: "baobab-trade" }), { alg: "ES256", kid: "ec-1" })),
    ).resolves.toMatchObject({
      subject: "kratos-identity-0001",
    })
  })

  it.each([
    ["another issuer", { iss: "https://attacker.example.test/" }],
    ["another audience", { aud: ["baobab-control-plane"] }],
    ["no trade:buy", { scope: "openid context:resolve" }],
    ["a scope that only contains trade:buy as a substring", { scope: "trade:buyer" }],
    ["a workload token", { actor_type: "workload" }],
    ["no actor type", { actor_type: undefined }],
    ["an unregistered client", { azp: "medusa-storefront" }],
    ["no authorised party", { azp: undefined }],
    ["no subject", { sub: undefined }],
    ["no token id", { jti: undefined }],
    ["an expired token", { exp: nowSeconds - 1 }],
    ["an over-long lifetime", { iat: nowSeconds - 10, exp: nowSeconds + 3600 }],
    ["a future issue time", { iat: nowSeconds + 120, exp: nowSeconds + 300 }],
    ["a future not-before", { nbf: nowSeconds + 120 }],
  ])("rejects %s", async (_name, change) => {
    await rejects(verifier().v, token(claims(change)))
  })

  it("never reads provider organisation, role, tenant or email claims as evidence", async () => {
    const { v } = verifier()
    const verified = await v.verify(
      token(
        claims({
          organization: { acme: {} },
          groups: ["buyers"],
          tenant_id: "tn_x",
          email: "a@b.test",
        }),
      ),
    )
    // Assurance evidence is carried for the assurance verifier; nothing else.
    expect(Object.keys(verified).sort()).toEqual([
      "acr",
      "amr",
      "authTime",
      "authorisedParty",
      "expiresAt",
      "issuer",
      "subject",
      "tokenId",
    ])
  })

  it("rejects forged, unsigned, symmetric and malformed tokens", async () => {
    const { v } = verifier()
    await rejects(v, token(claims(), { key: attacker.privateKey }))
    const [h, p] = token().split(".")
    await rejects(v, `${b64({ alg: "none", kid: "rsa-1" })}.${p}.`)
    await rejects(v, `${b64({ alg: "HS256", kid: "rsa-1" })}.${p}.c2lnbmF0dXJl`)
    await rejects(v, `${h}.${b64(claims({ sub: "someone-else" }))}.${token().split(".")[2]}`)
    await rejects(v, token(claims(), { header: { crit: ["exp"] } }))
    await rejects(v, token(claims(), { kid: "unknown" }))
    await rejects(v, "opaque-medusa-session-token")
    await rejects(v, `${h}.${p}`)
    // An RS256 header cannot be satisfied by the EC key and vice versa.
    await rejects(v, token(claims(), { alg: "RS256", kid: "ec-1" }))
  })

  it("trusts keys only from the issuer's own discovery and same-origin JWKS", async () => {
    await rejects(
      verifier({ jwksUri: "https://attacker.example.test/jwks" }).v,
      token(),
      "BUYER_TOKEN_UNAVAILABLE",
    )
    await rejects(
      verifier({ discoveryIssuer: "https://attacker.example.test/" }).v,
      token(),
      "BUYER_TOKEN_UNAVAILABLE",
    )
    await rejects(verifier({ fail: true }).v, token(), "BUYER_TOKEN_UNAVAILABLE")
    // A published key carrying private material is never used.
    const leaked = { ...rsa.privateKey.export({ format: "jwk" }), kid: "rsa-1", use: "sig" }
    await rejects(verifier({ keys: [leaked] }).v, token())
    await rejects(verifier({ keys: [{ ...jwk(rsa.publicKey, "rsa-1"), use: "enc" }] }).v, token())
  })

  it("refreshes keys once for an unknown key id, so rotation heals", async () => {
    const { v, calls } = verifier()
    await v.verify(token())
    expect(calls).toHaveLength(2)
    await v.verify(token())
    expect(calls).toHaveLength(2)
    await rejects(v, token(claims(), { kid: "rotated" }))
    expect(calls).toHaveLength(4)
  })

  it("refuses an insecure issuer or an empty client allowlist", () => {
    expect(
      () =>
        new BuyerTokenVerifier({ issuer: "http://iam.example.test/", authorisedParties: ["x"] }),
    ).toThrow()
    expect(() => new BuyerTokenVerifier({ issuer: ISSUER, authorisedParties: [" "] })).toThrow()
  })
  it("carries issuer-asserted assurance evidence and refuses malformed assurance claims", async () => {
    const { v } = verifier()
    const verified = await v.verify(
      token(
        claims({
          acr: "urn:example.test:acr:synthetic-session",
          amr: ["pwd", "otp"],
          auth_time: nowSeconds - 60,
        }),
      ),
    )
    expect(verified).toMatchObject({
      acr: "urn:example.test:acr:synthetic-session",
      amr: ["pwd", "otp"],
      authTime: new Date((nowSeconds - 60) * 1000),
    })
    expect((await v.verify(token())).amr).toEqual([])
    for (const change of [
      { acr: "" },
      { acr: 3 },
      { amr: "pwd" },
      { amr: [""] },
      { auth_time: "yesterday" },
    ]) {
      await rejects(v, token(claims(change)))
    }
  })
})

describe("BuyerTokenVerifier.verifyBffCaller (handoff v1.1)", () => {
  const caller = (change: Record<string, unknown> = {}) =>
    claims({
      sub: "zuribeans-bff",
      scope: "trade:buyer-handoff",
      actor_type: "workload",
      azp: undefined,
      client_id: "zuribeans-bff",
      ...change,
    })
  const callerRejects = async (v: BuyerTokenVerifier, raw: string) => {
    const error = await v.verifyBffCaller(raw).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BuyerTokenError)
    expect((error as BuyerTokenError).code).toBe("BUYER_TOKEN_INVALID")
  }

  it("accepts the registered BFF's own workload token", async () => {
    const { v } = verifier()
    await expect(v.verifyBffCaller(token(caller()))).resolves.toEqual({
      issuer: ISSUER,
      clientId: "zuribeans-bff",
      tokenId: "token-0001",
      expiresAt: new Date((nowSeconds + 300) * 1000),
    })
  })

  it("refuses a buyer token, another client, a missing scope or a foreign audience as the caller", async () => {
    const { v } = verifier()
    await callerRejects(v, token(claims()))
    for (const change of [
      { actor_type: "human" },
      { client_id: "rogue-bff" },
      { client_id: undefined },
      { scope: "trade:buy" },
      { aud: ["baobab-control-plane"] },
      { exp: nowSeconds - 1 },
    ]) {
      await callerRejects(v, token(caller(change)))
    }
    await callerRejects(v, token(caller(), { key: attacker.privateKey }))
  })

  it("never accepts the BFF's workload token as buyer evidence", async () => {
    const { v } = verifier()
    await rejects(v, token(caller()))
  })
})
