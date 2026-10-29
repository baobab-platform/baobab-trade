/**
 * OAuth2 client-credentials grant against baobab-iam's Keycloak realm, for
 * the `baobab-trade-workload` service-account client (already configured in
 * baobab-iam with the `context:resolve` scope --
 * config/clients/baobab-trade-workload.json -- but never consumed by any
 * code in this repo until ZB-03.6). This is a machine identity: Trade
 * itself is the subject, not a buyer or admin user, so it is deliberately
 * kept separate from the buyer-facing access tokens `ControlPlaneClient`
 * accepts as a parameter.
 */
export interface WorkloadTokenProvider {
  getAccessToken(): Promise<string>
}

export type ClientCredentialsWorkloadTokenProviderOptions = {
  tokenUrl: string
  clientId: string
  clientSecret: string
  /** Space-separated scopes to request; omitted, IAM issues the client's defaults. */
  scope?: string
  /** Exact OAuth resource audience for CP-bound requests, never caller-supplied. */
  audience?: string
  timeoutMs?: number
  now?: () => number
}

type CachedToken = { accessToken: string; expiresAtMs: number }

type TokenResponse = { access_token?: unknown; expires_in?: unknown }

const isValidTokenResponse = (
  candidate: unknown,
): candidate is { access_token: string; expires_in: number } => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as TokenResponse
  return (
    typeof value.access_token === "string" &&
    value.access_token.length > 0 &&
    value.access_token.length <= 16384 &&
    !/\s/.test(value.access_token) &&
    typeof value.expires_in === "number" &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in > 0 &&
    value.expires_in <= 86400
  )
}

// Refreshed this far ahead of the token's stated expiry so an in-flight
// request never gets handed a token that expires mid-call.
const EXPIRY_SAFETY_MARGIN_SECONDS = 30
const MAXIMUM_TOKEN_RESPONSE_BYTES = 65536

/** Bound the complete body, including peers that stall after HTTP headers.
 * A token response is private; neither body bytes nor parse errors are echoed.
 */
const readTokenResponse = async (response: Response, signal: AbortSignal): Promise<unknown> => {
  if (
    !response.body ||
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
  ) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error("Identity provider returned an invalid workload token response")
  }
  const reader = response.body.getReader()
  let abort: (() => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Workload token response deadline exceeded"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const part = await Promise.race([reader.read(), deadline])
      if (part.done) break
      length += part.value.byteLength
      if (length > MAXIMUM_TOKEN_RESPONSE_BYTES) throw new Error()
      chunks.push(part.value)
    }
    signal.throwIfAborted()
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)),
    )
  } catch {
    throw new Error("Identity provider returned an invalid workload token response")
  } finally {
    if (abort) signal.removeEventListener("abort", abort)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class ClientCredentialsWorkloadTokenProvider implements WorkloadTokenProvider {
  private readonly tokenUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly scope?: string
  private readonly audience?: string
  private readonly timeoutMs: number
  private readonly now: () => number
  private cached: CachedToken | null = null

  constructor(options: ClientCredentialsWorkloadTokenProviderOptions) {
    this.tokenUrl = options.tokenUrl
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.scope = options.scope
    this.audience = options.audience
    this.timeoutMs = options.timeoutMs ?? 3000
    this.now = options.now ?? Date.now
  }

  async getAccessToken(): Promise<string> {
    const startedAt = this.now()
    if (!Number.isFinite(startedAt)) throw new Error("Workload token clock is invalid")
    if (this.cached && this.cached.expiresAtMs > startedAt) {
      return this.cached.accessToken
    }
    this.cached = null

    const signal = AbortSignal.timeout(this.timeoutMs)
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      // A redirect can resend the form's client secret to another origin.
      // The deployment-owned token endpoint is the sole credential target.
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...(this.scope ? { scope: this.scope } : {}),
        ...(this.audience ? { audience: this.audience } : {}),
      }),
      signal,
    })

    if (!response.ok) {
      this.cached = null
      void response.body?.cancel().catch(() => undefined)
      throw new Error(`Workload token request failed with status ${response.status}`)
    }

    const candidate: unknown = await readTokenResponse(response, signal)
    if (!isValidTokenResponse(candidate)) {
      this.cached = null
      throw new Error("Identity provider returned an invalid workload token response")
    }

    const receivedAt = this.now()
    if (
      !Number.isFinite(receivedAt) ||
      receivedAt < startedAt ||
      receivedAt >= startedAt + candidate.expires_in * 1000
    ) {
      this.cached = null
      throw new Error("Workload token response is no longer current")
    }

    const ttlSeconds = Math.max(candidate.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS, 0)
    this.cached = {
      accessToken: candidate.access_token,
      // Count from before the grant request, never extend authority by time
      // spent waiting for the token endpoint or response body.
      expiresAtMs: startedAt + ttlSeconds * 1000,
    }

    return candidate.access_token
  }
}
