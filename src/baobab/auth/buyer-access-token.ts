import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto"

/**
 * ZB-G03 step 3 (CP ADR-BCP-028; Shared identity/v1
 * buyer-identity-handoff.schema.json): Trade validates the buyer's IAM
 * access token itself before asking the Control Plane who the buyer is.
 *
 * The token must be signed by the configured IAM issuer's published keys,
 * audience-bound to Trade, carry trade:buy and actor_type human, and have
 * been obtained by an allowlisted confidential BFF client. Provider
 * organisation, group, role, tenant or email claims are never read: they are
 * not buyer-membership evidence. A Medusa customer token is not an IAM token
 * and fails here.
 *
 * Local verification is necessary, never sufficient: the Control Plane also
 * verifies the token and confirms it is current by introspection.
 *
 * Handoff v1.1 (ADR-SHARED-042 section 14): the BFF also authenticates as
 * itself with its own workload token (verifyBffCaller), whose client must
 * equal the buyer token's azp, so a stolen buyer token cannot be presented by
 * another caller.
 */
export const TRADE_AUDIENCE = "baobab-trade"
export const TRADE_BUY_SCOPE = "trade:buy"
/** identity/v1 buyer-identity-handoff v1.1: the BFF's own caller credential. */
export const TRADE_BUYER_HANDOFF_SCOPE = "trade:buyer-handoff"

const CLOCK_SKEW_SECONDS = 30
const MAXIMUM_LIFETIME_SECONDS = 15 * 60
const MAXIMUM_TOKEN_LENGTH = 8192
const MAXIMUM_DOCUMENT_BYTES = 64 * 1024
const KEY_CACHE_MS = 5 * 60 * 1000

export class BuyerTokenError extends Error {
  constructor(
    readonly code: "BUYER_TOKEN_INVALID" | "BUYER_TOKEN_UNAVAILABLE",
    message: string,
  ) {
    super(message)
    this.name = "BuyerTokenError"
  }
}

export type VerifiedBuyerToken = {
  issuer: string
  subject: string
  authorisedParty: string
  tokenId: string
  expiresAt: Date
  /** Issuer-asserted assurance evidence (ADR-SHARED-042 CAA-03); never authority by itself. */
  acr?: string
  amr: string[]
  authTime?: Date
}

/** The registered estate BFF's own workload token (BffCallerTokenClaims). */
export type VerifiedBffCaller = {
  issuer: string
  clientId: string
  tokenId: string
  expiresAt: Date
}

export type BuyerTokenVerifierOptions = {
  issuer: string
  authorisedParties: readonly string[]
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

type Header = { alg?: unknown; kid?: unknown; typ?: unknown; crit?: unknown }
type Claims = Record<string, unknown>

const decodeSegment = (segment: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("segment is not base64url")
  return Buffer.from(segment, "base64url")
}

const parseJson = <T>(bytes: Buffer): T => {
  const value: unknown = JSON.parse(bytes.toString("utf8"))
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("not a JSON object")
  }
  return value as T
}

const httpsUrl = (value: string): URL => {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("an https URL without credentials, query or fragment is required")
  }
  return url
}

export class BuyerTokenVerifier {
  private readonly issuer: string
  private readonly issuerOrigin: string
  private readonly authorisedParties: ReadonlySet<string>
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private keys: { byKid: Map<string, KeyObject>; fetchedAt: number } | null = null

  constructor(options: BuyerTokenVerifierOptions) {
    // OIDC issuer identifiers compare exactly. URL.href adds a slash to a
    // bare HTTPS origin, which changes Hydra's valid slashless issuer.
    // Validate transport separately without rewriting the trust identifier.
    httpsUrl(options.issuer)
    if (options.issuer.trim() !== options.issuer) throw new Error("issuer whitespace is invalid")
    this.issuer = options.issuer
    this.issuerOrigin = new URL(this.issuer).origin
    const parties = options.authorisedParties.map((party) => party.trim()).filter(Boolean)
    if (parties.length === 0) throw new Error("at least one authorised BFF client is required")
    this.authorisedParties = new Set(parties)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 3000
  }

  /** A human buyer token: actor human, trade:buy, an authorised BFF azp. */
  async verify(token: string): Promise<VerifiedBuyerToken> {
    const invalid = (reason: string) => new BuyerTokenError("BUYER_TOKEN_INVALID", reason)
    const claims = await this.verifySigned(token)
    const {
      iss,
      sub,
      exp,
      jti,
      scope,
      actor_type: actorType,
      azp,
      acr,
      amr,
      auth_time: authTime,
    } = claims
    if (actorType !== "human") throw invalid("token is not a human token")
    if (typeof scope !== "string" || !scope.split(" ").includes(TRADE_BUY_SCOPE)) {
      throw invalid("token does not carry trade:buy")
    }
    if (typeof azp !== "string" || !this.authorisedParties.has(azp)) {
      throw invalid("token was not obtained by an authorised BFF client")
    }
    // Assurance claims are evidence only. A malformed one is not ignored:
    // it makes the token invalid rather than silently weaker.
    if (acr !== undefined && (typeof acr !== "string" || acr.length === 0 || acr.length > 255)) {
      throw invalid("token acr is malformed")
    }
    if (
      amr !== undefined &&
      (!Array.isArray(amr) ||
        amr.some((m) => typeof m !== "string" || m.length === 0 || m.length > 64))
    ) {
      throw invalid("token amr is malformed")
    }
    if (authTime !== undefined && (typeof authTime !== "number" || !Number.isInteger(authTime))) {
      throw invalid("token auth_time is malformed")
    }
    return {
      issuer: iss as string,
      subject: sub as string,
      authorisedParty: azp,
      tokenId: jti as string,
      expiresAt: new Date((exp as number) * 1000),
      acr: acr as string | undefined,
      amr: (amr as string[] | undefined) ?? [],
      authTime: authTime === undefined ? undefined : new Date((authTime as number) * 1000),
    }
  }

  /**
   * The BFF's own workload token, presented as the caller credential
   * (buyer-identity-handoff v1.1): actor workload, trade:buyer-handoff and a
   * registered BFF client. It authenticates the BFF, never a buyer.
   */
  async verifyBffCaller(token: string): Promise<VerifiedBffCaller> {
    const invalid = (reason: string) => new BuyerTokenError("BUYER_TOKEN_INVALID", reason)
    const claims = await this.verifySigned(token)
    const { iss, exp, jti, scope, actor_type: actorType, client_id: clientId } = claims
    if (actorType !== "workload") throw invalid("caller token is not a workload token")
    if (typeof scope !== "string" || !scope.split(" ").includes(TRADE_BUYER_HANDOFF_SCOPE)) {
      throw invalid("caller token does not carry trade:buyer-handoff")
    }
    if (typeof clientId !== "string" || !this.authorisedParties.has(clientId)) {
      throw invalid("caller token is not for an authorised BFF client")
    }
    return {
      issuer: iss as string,
      clientId,
      tokenId: jti as string,
      expiresAt: new Date((exp as number) * 1000),
    }
  }

  /** Signature, issuer, Trade audience, subject, token id and bounded lifetime. */
  private async verifySigned(token: string): Promise<Claims> {
    const invalid = (reason: string) => new BuyerTokenError("BUYER_TOKEN_INVALID", reason)
    if (typeof token !== "string" || token.length > MAXIMUM_TOKEN_LENGTH)
      throw invalid("token is malformed")
    const parts = token.split(".")
    if (parts.length !== 3) throw invalid("token is not a compact JWS")
    let header: Header
    let claims: Claims
    let signature: Buffer
    try {
      header = parseJson<Header>(decodeSegment(parts[0]))
      claims = parseJson<Claims>(decodeSegment(parts[1]))
      signature = decodeSegment(parts[2])
    } catch {
      throw invalid("token is malformed")
    }
    if ((header.alg !== "RS256" && header.alg !== "ES256") || header.crit !== undefined) {
      throw invalid("token algorithm is not accepted")
    }
    if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 256) {
      throw invalid("token key id is missing")
    }
    const key = await this.key(header.kid)
    if (!key) throw invalid("token key is not published by the issuer")
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
    const ok =
      header.alg === "RS256"
        ? key.asymmetricKeyType === "rsa" && verifySignature("RSA-SHA256", signed, key, signature)
        : key.asymmetricKeyType === "ec" &&
          verifySignature("SHA256", signed, { key, dsaEncoding: "ieee-p1363" }, signature)
    if (!ok) throw invalid("token signature is invalid")

    const nowSeconds = Math.floor(this.now() / 1000)
    const { iss, sub, aud, exp, iat, nbf, jti } = claims
    const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : []
    if (iss !== this.issuer) throw invalid("token issuer is not the configured IAM issuer")
    if (!audiences.includes(TRADE_AUDIENCE)) throw invalid("token is not audience-bound to Trade")
    if (typeof sub !== "string" || sub.length === 0 || sub.length > 255)
      throw invalid("token subject is invalid")
    if (typeof jti !== "string" || jti.length === 0 || jti.length > 255)
      throw invalid("token id is missing")
    if (
      typeof exp !== "number" ||
      typeof iat !== "number" ||
      !Number.isInteger(exp) ||
      !Number.isInteger(iat) ||
      exp <= iat ||
      exp - iat > MAXIMUM_LIFETIME_SECONDS ||
      iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      exp <= nowSeconds
    ) {
      throw invalid("token lifetime is invalid or expired")
    }
    if (nbf !== undefined && (typeof nbf !== "number" || nbf > nowSeconds + CLOCK_SKEW_SECONDS)) {
      throw invalid("token is not yet valid")
    }
    return claims
  }

  /** Keys come only from the issuer's own discovery document and same-origin JWKS. */
  private async key(kid: string): Promise<KeyObject | undefined> {
    const fresh = this.keys && this.now() - this.keys.fetchedAt < KEY_CACHE_MS
    if (fresh && this.keys?.byKid.has(kid)) return this.keys.byKid.get(kid)
    // An unknown kid triggers one refresh, so key rotation heals without restart.
    this.keys = await this.fetchKeys()
    return this.keys.byKid.get(kid)
  }

  private async getDocument(url: URL): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "issuer metadata is unavailable")
    }
    const text = response.ok ? await response.text() : ""
    if (!response.ok || Buffer.byteLength(text) > MAXIMUM_DOCUMENT_BYTES) {
      throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "issuer metadata is unavailable")
    }
    try {
      return parseJson<Record<string, unknown>>(Buffer.from(text))
    } catch {
      throw new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "issuer metadata is malformed")
    }
  }

  private async fetchKeys(): Promise<{ byKid: Map<string, KeyObject>; fetchedAt: number }> {
    const unavailable = () =>
      new BuyerTokenError("BUYER_TOKEN_UNAVAILABLE", "issuer metadata is invalid")
    const discovery = await this.getDocument(
      new URL(
        ".well-known/openid-configuration",
        this.issuer.endsWith("/") ? this.issuer : `${this.issuer}/`,
      ),
    )
    if (discovery.issuer !== this.issuer || typeof discovery.jwks_uri !== "string")
      throw unavailable()
    let jwksUri: URL
    try {
      jwksUri = httpsUrl(discovery.jwks_uri)
    } catch {
      throw unavailable()
    }
    if (jwksUri.origin !== this.issuerOrigin) throw unavailable()
    const jwks = await this.getDocument(jwksUri)
    if (!Array.isArray(jwks.keys)) throw unavailable()
    const byKid = new Map<string, KeyObject>()
    for (const candidate of jwks.keys as JsonWebKey[]) {
      if (
        typeof candidate?.kid !== "string" ||
        (candidate.use !== undefined && candidate.use !== "sig")
      )
        continue
      if (candidate.kty !== "RSA" && !(candidate.kty === "EC" && candidate.crv === "P-256"))
        continue
      try {
        // Public members only: a key carrying private material is refused.
        if (candidate.d !== undefined) continue
        byKid.set(candidate.kid, createPublicKey({ key: candidate, format: "jwk" }))
      } catch {
        continue
      }
    }
    return { byKid, fetchedAt: this.now() }
  }
}
