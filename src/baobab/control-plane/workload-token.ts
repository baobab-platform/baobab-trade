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
    value.access_token.trim().length > 0 &&
    typeof value.expires_in === "number" &&
    value.expires_in > 0
  )
}

// Refreshed this far ahead of the token's stated expiry so an in-flight
// request never gets handed a token that expires mid-call.
const EXPIRY_SAFETY_MARGIN_SECONDS = 30

export class ClientCredentialsWorkloadTokenProvider implements WorkloadTokenProvider {
  private readonly tokenUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly timeoutMs: number
  private readonly now: () => number
  private cached: CachedToken | null = null

  constructor(options: ClientCredentialsWorkloadTokenProviderOptions) {
    this.tokenUrl = options.tokenUrl
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.timeoutMs = options.timeoutMs ?? 3000
    this.now = options.now ?? Date.now
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs > this.now()) {
      return this.cached.accessToken
    }

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      this.cached = null
      throw new Error(`Workload token request failed with status ${response.status}`)
    }

    const candidate: unknown = await response.json()
    if (!isValidTokenResponse(candidate)) {
      throw new Error("Identity provider returned an invalid workload token response")
    }

    const ttlSeconds = Math.max(candidate.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS, 0)
    this.cached = {
      accessToken: candidate.access_token,
      expiresAtMs: this.now() + ttlSeconds * 1000,
    }

    return candidate.access_token
  }
}
