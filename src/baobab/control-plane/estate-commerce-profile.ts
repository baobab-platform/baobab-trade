import { getBaobabTradeEnvironment } from "../config/environment"
import {
  commerceProfileAttestationSchema,
  commerceProfileRequestSchema,
} from "../contracts/authority-validation"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "./workload-token"

/**
 * ADR-SHARED-042 section 14 Decision 8 (Platform Owner ruling of 22 October
 * 2026; Shared control-plane/v1 estate-commerce-profile.openapi.yaml; CP
 * ADR-BCP-030): Trade learns whether a Digital Estate commits B2B or B2C on
 * this engine instance in a Market only from the Control Plane's governed
 * EstateCommerceProfile attestation.
 *
 * Trade's own workload token (scope estate:commerce-profile:resolve)
 * authenticates the call. Trade names the estate, its own engine instance,
 * the Market and the estate provenance it already holds: the CP estate client
 * binding attestation of a governed BFF request, or (Decision 9) the CP
 * governed resource assignment attestation of a non-BFF commitment. CP
 * re-verifies that provenance from its own record. Trade never names a Tenant, profile, model or
 * revision, and nothing local (sales channel, domain, currency, customer
 * type) substitutes for the answer. An attestation classifies the estate
 * only; it is never seller, buyer or purchasing authority.
 */
export const COMMERCE_PROFILE_SCOPE = "estate:commerce-profile:resolve"
export const COMMERCE_PROFILE_PATH = "/internal/estate/v1/commerce-profiles/resolve"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAXIMUM_ATTESTATION_MS = 60_000
/** An attestation is never used before it was issued, beyond this skew. */
const CLOCK_SKEW_MS = 5_000

export type CommerceModel = "B2B" | "B2C"

export type CommerceProfileAttestation = {
  attestationId: string
  commerceProfileId: string
  profileRevision: number
  digitalEstateId: string
  tenantId: string
  engineInstanceId: string
  marketId: string
  commerceModel: CommerceModel
  issuedAt: Date
  expiresAt: Date
  profileEffectiveUntil: Date | null
  evidenceReference: string
}

/** Closed CP denial codes (estate-commerce-profile.schema.json). */
export type CommerceProfileFailure =
  | "PROFILE_NOT_REGISTERED"
  | "PROFILE_NOT_ACTIVE"
  | "PROFILE_AMBIGUOUS"
  | "ESTATE_PROVENANCE_INVALID"
  | "ENGINE_INSTANCE_NOT_PERMITTED"
  | "CALLER_NOT_PERMITTED"
  | "RESOLUTION_UNAVAILABLE"

const KNOWN: ReadonlySet<string> = new Set<CommerceProfileFailure>([
  "PROFILE_NOT_REGISTERED",
  "PROFILE_NOT_ACTIVE",
  "PROFILE_AMBIGUOUS",
  "ESTATE_PROVENANCE_INVALID",
  "ENGINE_INSTANCE_NOT_PERMITTED",
  "CALLER_NOT_PERMITTED",
  "RESOLUTION_UNAVAILABLE",
])

export class CommerceProfileError extends Error {
  constructor(readonly code: CommerceProfileFailure) {
    super(`Control Plane estate commerce profile denied: ${code}`)
    this.name = "CommerceProfileError"
  }
}

/** The CP attestation that proved the request's Digital Estate. */
export type EstateProvenance = {
  kind: "ESTATE_CLIENT_BINDING" | "GOVERNED_RESOURCE_ASSIGNMENT"
  reference: string
}

export type CommerceProfileRequest = {
  digitalEstateId: string
  marketId: string
  provenance: EstateProvenance
  correlationId: string
}

export interface CommerceProfileResolver {
  resolve(request: CommerceProfileRequest): Promise<CommerceProfileAttestation>
}

export type ControlPlaneCommerceProfileResolverOptions = {
  baseUrl: string
  tokenProvider: WorkloadTokenProvider
  engineInstanceId: string
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class ControlPlaneCommerceProfileResolver implements CommerceProfileResolver {
  private readonly endpoint: URL
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly options: ControlPlaneCommerceProfileResolverOptions) {
    const base = new URL(options.baseUrl)
    if (
      base.protocol !== "https:" &&
      !(base.protocol === "http:" && base.hostname === "localhost")
    ) {
      throw new Error("the Control Plane base URL must be https outside localhost")
    }
    if (!/^ei_[a-z0-9]+$/.test(options.engineInstanceId)) {
      throw new Error("a canonical Trade engine instance id is required")
    }
    this.endpoint = new URL(COMMERCE_PROFILE_PATH, base)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  async resolve(request: CommerceProfileRequest): Promise<CommerceProfileAttestation> {
    const unavailable = () => new CommerceProfileError("RESOLUTION_UNAVAILABLE")
    const body = {
      digital_estate_id: request.digitalEstateId,
      engine_instance_id: this.options.engineInstanceId,
      market_id: request.marketId,
      estate_provenance: {
        kind: request.provenance?.kind,
        reference: request.provenance?.reference,
      },
      correlation_id: request.correlationId,
    }
    // Never send what CP would refuse: a malformed estate, Market or
    // provenance is a Trade defect, not a classification answer.
    if (
      (request.provenance?.kind !== "ESTATE_CLIENT_BINDING" &&
        request.provenance?.kind !== "GOVERNED_RESOURCE_ASSIGNMENT") ||
      !UUID.test(request.provenance.reference ?? "") ||
      !commerceProfileRequestSchema(body)
    ) {
      throw unavailable()
    }
    let accessToken: string
    try {
      accessToken = await this.options.tokenProvider.getAccessToken()
    } catch {
      throw unavailable()
    }
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "x-correlation-id": request.correlationId,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw unavailable()
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw unavailable()
    }
    if (!response.ok) {
      // A route CP has not mounted answers with a generic code: that is
      // UNAVAILABLE, never a classification.
      const code = (payload as { code?: unknown } | null)?.code
      throw new CommerceProfileError(
        typeof code === "string" && KNOWN.has(code)
          ? (code as CommerceProfileFailure)
          : "RESOLUTION_UNAVAILABLE",
      )
    }
    // Never trust a bare 200: the attestation must satisfy the Shared wire
    // contract, answer exactly what was asked and still be current.
    if (!commerceProfileAttestationSchema(payload)) throw unavailable()
    const value = payload as Record<string, unknown>
    const now = this.now()
    const issuedAt = Date.parse(value.issued_at as string)
    const expiresAt = Date.parse(value.expires_at as string)
    const until =
      value.profile_effective_until === undefined
        ? null
        : Date.parse(value.profile_effective_until as string)
    if (
      value.digital_estate_id !== request.digitalEstateId ||
      value.trade_engine_instance_id !== this.options.engineInstanceId ||
      value.market_id !== request.marketId ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      issuedAt > now + CLOCK_SKEW_MS ||
      expiresAt - issuedAt > MAXIMUM_ATTESTATION_MS ||
      (until !== null && (!Number.isFinite(until) || expiresAt > until))
    ) {
      throw unavailable()
    }
    return {
      attestationId: value.attestation_id as string,
      commerceProfileId: value.commerce_profile_id as string,
      profileRevision: value.profile_revision as number,
      digitalEstateId: value.digital_estate_id as string,
      tenantId: value.tenant_id as string,
      engineInstanceId: value.trade_engine_instance_id as string,
      marketId: value.market_id as string,
      commerceModel: value.commerce_model as CommerceModel,
      issuedAt: new Date(issuedAt),
      expiresAt: new Date(expiresAt),
      profileEffectiveUntil: until === null ? null : new Date(until),
      evidenceReference: value.evidence_reference as string,
    }
  }
}

let singleton: CommerceProfileResolver | null | undefined

/**
 * Null unless a provenance path (the buyer identity path or Decision 9
 * resource assignment), this instance's engine id and a development or
 * staging environment are configured. Without it, every native commitment is
 * unclassified and the commit fence refuses it; there is no default model.
 */
export const getCommerceProfileResolver = (): CommerceProfileResolver | null => {
  if (singleton !== undefined) return singleton
  const env = getBaobabTradeEnvironment()
  if (
    !(env.buyerIdentityEnabled || env.resourceAssignmentEnabled) ||
    !env.iamWorkloadTokenUrl ||
    !env.iamWorkloadClientSecret ||
    !env.controlPlaneBaseUrl ||
    !env.tradeEngineInstanceId ||
    (env.deploymentEnvironment !== "development" && env.deploymentEnvironment !== "staging")
  ) {
    singleton = null
    return singleton
  }
  try {
    singleton = new ControlPlaneCommerceProfileResolver({
      baseUrl: env.controlPlaneBaseUrl,
      engineInstanceId: env.tradeEngineInstanceId,
      tokenProvider: new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: env.iamWorkloadTokenUrl,
        clientId: env.iamWorkloadClientId,
        clientSecret: env.iamWorkloadClientSecret,
        scope: COMMERCE_PROFILE_SCOPE,
      }),
    })
  } catch {
    singleton = null
  }
  return singleton
}

export const resetCommerceProfileResolverForTests = (): void => {
  singleton = undefined
}
