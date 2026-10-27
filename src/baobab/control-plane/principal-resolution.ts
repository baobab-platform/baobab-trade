import { getBaobabTradeEnvironment } from "../config/environment"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "./workload-token"

/**
 * ZB-G03 step 3 (CP ADR-BCP-028; Shared identity/v1
 * principal-resolution.openapi.yaml): Trade asks the Control Plane which
 * canonical human Principal an authenticated buyer is.
 *
 * Two credentials, never merged: Trade's own workload token (scope
 * identity:principal:resolve) authenticates the call, and the buyer's
 * Trade-audience IAM access token travels in the body as subject evidence,
 * which CP verifies and introspects itself. Trade never names the issuer,
 * subject, email or Medusa customer. A resolution is identity only: it
 * carries no tenant, membership, role, market or purchasing authority.
 */
export const PRINCIPAL_RESOLVE_SCOPE = "identity:principal:resolve"
export const PRINCIPAL_RESOLVE_PATH = "/internal/identity/v1/principals/resolve"
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type ResolvedBuyerPrincipal = {
  principalId: string
  externalIdentityId: string
  evidenceExpiresAt: Date
}

/** Closed CP denial codes (principal-resolution.schema.json), plus transport failure. */
export type PrincipalResolutionFailure =
  | "CALLER_NOT_PERMITTED"
  | "SUBJECT_TOKEN_INVALID"
  | "SUBJECT_TOKEN_NOT_CURRENT"
  | "SUBJECT_TOKEN_NOT_FOR_CALLER"
  | "IDENTITY_NOT_RESOLVED"
  | "PRINCIPAL_NOT_ACTIVE"
  | "RESOLUTION_UNAVAILABLE"

const KNOWN: ReadonlySet<string> = new Set<PrincipalResolutionFailure>([
  "CALLER_NOT_PERMITTED",
  "SUBJECT_TOKEN_INVALID",
  "SUBJECT_TOKEN_NOT_CURRENT",
  "SUBJECT_TOKEN_NOT_FOR_CALLER",
  "IDENTITY_NOT_RESOLVED",
  "PRINCIPAL_NOT_ACTIVE",
  "RESOLUTION_UNAVAILABLE",
])

export class PrincipalResolutionError extends Error {
  constructor(readonly code: PrincipalResolutionFailure) {
    super(`Control Plane principal resolution denied: ${code}`)
    this.name = "PrincipalResolutionError"
  }
}

export interface BuyerPrincipalResolver {
  resolve(subjectToken: string, correlationId: string): Promise<ResolvedBuyerPrincipal>
}

export type ControlPlanePrincipalResolverOptions = {
  baseUrl: string
  tokenProvider: WorkloadTokenProvider
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class ControlPlanePrincipalResolver implements BuyerPrincipalResolver {
  private readonly endpoint: URL
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly options: ControlPlanePrincipalResolverOptions) {
    const base = new URL(options.baseUrl)
    if (
      base.protocol !== "https:" &&
      !(base.protocol === "http:" && base.hostname === "localhost")
    ) {
      throw new Error("the Control Plane base URL must be https outside localhost")
    }
    this.endpoint = new URL(PRINCIPAL_RESOLVE_PATH, base)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  async resolve(subjectToken: string, correlationId: string): Promise<ResolvedBuyerPrincipal> {
    if (!UUID.test(correlationId)) throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
    let accessToken: string
    try {
      accessToken = await this.options.tokenProvider.getAccessToken()
    } catch {
      throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
    }
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({
          subject_token: subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          correlation_id: correlationId,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
    }
    if (!response.ok) {
      const code = (body as { code?: unknown } | null)?.code
      throw new PrincipalResolutionError(
        typeof code === "string" && KNOWN.has(code)
          ? (code as PrincipalResolutionFailure)
          : "RESOLUTION_UNAVAILABLE",
      )
    }
    // Never trust a bare 200: the answer must be an ACTIVE human resolution
    // whose evidence is still current.
    const value = body as Record<string, unknown>
    const expires =
      typeof value.evidence_expires_at === "string" ? Date.parse(value.evidence_expires_at) : NaN
    if (
      value.outcome !== "RESOLVED" ||
      value.actor_type !== "human" ||
      value.status !== "ACTIVE" ||
      typeof value.principal_id !== "string" ||
      !UUID.test(value.principal_id) ||
      typeof value.external_identity_id !== "string" ||
      !UUID.test(value.external_identity_id) ||
      !Number.isFinite(expires) ||
      expires <= this.now()
    ) {
      throw new PrincipalResolutionError("RESOLUTION_UNAVAILABLE")
    }
    return {
      principalId: value.principal_id,
      externalIdentityId: value.external_identity_id,
      evidenceExpiresAt: new Date(expires),
    }
  }
}

let singleton: BuyerPrincipalResolver | null | undefined

/**
 * Null unless the buyer identity path is explicitly configured. Without it,
 * buyer-context routes fail closed; there is no Medusa-identity fallback.
 */
export const getBuyerPrincipalResolver = (): BuyerPrincipalResolver | null => {
  if (singleton !== undefined) return singleton
  const env = getBaobabTradeEnvironment()
  if (
    !env.buyerIdentityEnabled ||
    !env.iamWorkloadTokenUrl ||
    !env.iamWorkloadClientSecret ||
    !env.controlPlaneBaseUrl
  ) {
    singleton = null
    return singleton
  }
  singleton = new ControlPlanePrincipalResolver({
    baseUrl: env.controlPlaneBaseUrl,
    tokenProvider: new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: env.iamWorkloadTokenUrl,
      clientId: env.iamWorkloadClientId,
      clientSecret: env.iamWorkloadClientSecret,
      scope: PRINCIPAL_RESOLVE_SCOPE,
      audience: "baobab-control-plane",
    }),
  })
  return singleton
}

export const resetBuyerPrincipalResolverForTests = (): void => {
  singleton = undefined
}
