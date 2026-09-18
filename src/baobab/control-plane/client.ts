import {
  assertTradeEntitlement,
  fromContextResolutionResponse,
  isValidContextResolutionResponse,
  type BaobabTenantContext,
} from "../contracts/tenant-context"
import { isProblemDetails, ControlPlaneProblemError } from "../contracts/problem-details"
import { isValidMarket, type BaobabMarket } from "../contracts/market"
import {
  isCanonicalEntityId,
  isValidMappingResolutionResponse,
  type MappingResolutionRequest,
  type MappingResolutionResponse,
} from "../contracts/canonical-mapping"
import {
  isValidPlatformContextResolutionResponse,
  type RawPlatformContextResolutionResponse,
} from "../contracts/platform-context"

export interface ControlPlaneClient {
  resolveContext(accessToken: string, correlationId: string): Promise<BaobabTenantContext>
  getMarket(marketId: string, accessToken: string, correlationId: string): Promise<BaobabMarket>
  resolveMapping(
    request: MappingResolutionRequest,
    accessToken: string,
    correlationId: string,
  ): Promise<MappingResolutionResponse>
  resolvePlatformContext(
    tenantId: string,
    organisationId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<RawPlatformContextResolutionResponse>
}

export type HttpControlPlaneClientOptions = {
  baseUrl: string
  contextPath: string
  productId: string
  marketPathTemplate?: string
  mappingResolutionPath?: string
  platformContextPath?: string
  timeoutMs?: number
  now?: () => number
}

type CachedContext = { context: BaobabTenantContext; expiresAtMs: number }

const MAX_CACHE_TTL_SECONDS = 60

const withLeadingSlash = (path: string): string => (path.startsWith("/") ? path : `/${path}`)

async function readProblemOrThrow(response: Response): Promise<never> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`Control Plane request failed with status ${response.status}`)
  }

  if (isProblemDetails(body)) {
    throw new ControlPlaneProblemError(body)
  }

  throw new Error(`Control Plane request failed with status ${response.status}`)
}

export class HttpControlPlaneClient implements ControlPlaneClient {
  private readonly baseUrl: string
  private readonly contextPath: string
  private readonly productId: string
  private readonly marketPathTemplate: string
  private readonly mappingResolutionPath: string
  private readonly platformContextPath: string
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly contextCache = new Map<string, CachedContext>()

  constructor(options: HttpControlPlaneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "")
    this.contextPath = withLeadingSlash(options.contextPath)
    this.productId = options.productId
    this.marketPathTemplate = withLeadingSlash(
      options.marketPathTemplate ?? "/v1/markets/{market_id}",
    )
    this.mappingResolutionPath = withLeadingSlash(
      options.mappingResolutionPath ?? "/v1/resolution/mappings",
    )
    this.platformContextPath = withLeadingSlash(
      options.platformContextPath ?? "/v1/platform-context/resolve",
    )
    this.timeoutMs = options.timeoutMs ?? 3000
    this.now = options.now ?? Date.now
  }

  /**
   * Resolves tenant context per POST /v1/context/resolve. The Control Plane
   * grants a maximum 15 second success cache (60 second schema ceiling); a
   * cache miss or expiry re-resolves rather than serving a stale result
   * (fail closed, per contracts.lock.yaml `fail_on_unresolved_tenant_context`).
   */
  async resolveContext(accessToken: string, correlationId: string): Promise<BaobabTenantContext> {
    if (!accessToken.trim()) {
      throw new Error("An access token is required to resolve tenant context")
    }

    const cached = this.contextCache.get(accessToken)
    if (cached && cached.expiresAtMs > this.now()) {
      return cached.context
    }

    const response = await fetch(`${this.baseUrl}${this.contextPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ product_id: this.productId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      this.contextCache.delete(accessToken)
      await readProblemOrThrow(response)
    }

    const candidate: unknown = await response.json()
    if (!isValidContextResolutionResponse(candidate)) {
      throw new Error("Control Plane returned an invalid context-resolution response")
    }

    const context = assertTradeEntitlement(fromContextResolutionResponse(candidate))
    const ttlSeconds = Math.min(context.cacheTtlSeconds, MAX_CACHE_TTL_SECONDS)
    this.contextCache.set(accessToken, {
      context,
      expiresAtMs: this.now() + ttlSeconds * 1000,
    })

    return context
  }

  /**
   * Resolves Market configuration per GET /v1/markets/{market_id}. Trade
   * never invents a market_id locally; it always arrives from a trusted
   * source (resolved tenant context, or an already-verified mapping).
   * Returns the Market as-is regardless of lifecycle status; callers that
   * are about to transact must additionally call `assertMarketTransactable`.
   */
  async getMarket(
    marketId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<BaobabMarket> {
    const path = this.marketPathTemplate.replace("{market_id}", encodeURIComponent(marketId))

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-correlation-id": correlationId,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      await readProblemOrThrow(response)
    }

    const candidate: unknown = await response.json()
    if (!isValidMarket(candidate)) {
      throw new Error("Control Plane returned an invalid market")
    }

    return candidate
  }

  async resolveMapping(
    request: MappingResolutionRequest,
    accessToken: string,
    correlationId: string,
  ): Promise<MappingResolutionResponse> {
    if (!isCanonicalEntityId(request.canonical_entity_id)) {
      throw new Error("A valid canonical entity ID is required for mapping resolution")
    }

    const response = await fetch(`${this.baseUrl}${this.mappingResolutionPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      await readProblemOrThrow(response)
    }

    const candidate: unknown = await response.json()
    if (
      !isValidMappingResolutionResponse(candidate) ||
      candidate.canonical_entity_id !== request.canonical_entity_id
    ) {
      throw new Error("Control Plane returned an invalid mapping-resolution response")
    }

    return candidate
  }

  /**
   * Resolves platform (tenant + organisation) context per POST
   * /v1/platform-context/resolve, using a workload-scoped access token
   * rather than a buyer's own token -- see ADR for this slice. Never
   * cached: this call exists specifically to attest a tenant_id/
   * organisation_id pair at read time, so callers must always see a fresh
   * result rather than a value from an unrelated earlier assertion.
   */
  async resolvePlatformContext(
    tenantId: string,
    organisationId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<RawPlatformContextResolutionResponse> {
    const response = await fetch(`${this.baseUrl}${this.platformContextPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ tenant_id: tenantId, organisation_id: organisationId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      await readProblemOrThrow(response)
    }

    const candidate: unknown = await response.json()
    if (!isValidPlatformContextResolutionResponse(candidate)) {
      throw new Error("Control Plane returned an invalid platform-context response")
    }

    return candidate
  }
}
