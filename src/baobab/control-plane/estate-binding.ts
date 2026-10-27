import { getBaobabTradeEnvironment } from "../config/environment"
import { estateBindingAttestationSchema } from "../contracts/authority-validation"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "./workload-token"

/**
 * ADR-SHARED-042 CAA-04 (Platform Owner ruling of 22 October 2026; Shared
 * control-plane/v1 estate-client-binding.openapi.yaml): Trade learns which
 * Digital Estate, Tenant and deployment the estate BFF behind a buyer request
 * serves only from the Control Plane's attestation.
 *
 * Trade's own workload token (scope estate:client-binding:resolve)
 * authenticates the call. The BFF's own workload token travels in the body
 * as client evidence, which CP verifies and introspects itself. Trade states
 * its own engine instance and environment; it never names a tenant, binding
 * or deployment, and the buyer token's azp alone never selects an estate.
 * An attestation is context, never buyer or purchasing authority.
 */
export const ESTATE_BINDING_SCOPE = "estate:client-binding:resolve"
export const ESTATE_BINDING_PATH = "/internal/estate/v1/client-bindings/resolve"
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAXIMUM_ATTESTATION_MS = 60_000

export type EstateBindingAttestation = {
  bindingId: string
  revision: number
  digitalEstateId: string
  tenantId: string
  engineInstanceId: string
  environment: string
  deploymentReference: string
  evidenceReference: string
  expiresAt: Date
}

/** Closed CP denial codes (estate-client-binding.schema.json), plus transport failure. */
export type EstateBindingFailure =
  | "CALLER_NOT_PERMITTED"
  | "CLIENT_EVIDENCE_INVALID"
  | "CLIENT_NOT_FOR_SUBJECT"
  | "BINDING_NOT_FOUND"
  | "BINDING_AMBIGUOUS"
  | "BINDING_NOT_ACTIVE"
  | "ENVIRONMENT_MISMATCH"
  | "ENGINE_INSTANCE_NOT_PERMITTED"
  | "RESOLUTION_UNAVAILABLE"

const KNOWN: ReadonlySet<string> = new Set<EstateBindingFailure>([
  "CALLER_NOT_PERMITTED",
  "CLIENT_EVIDENCE_INVALID",
  "CLIENT_NOT_FOR_SUBJECT",
  "BINDING_NOT_FOUND",
  "BINDING_AMBIGUOUS",
  "BINDING_NOT_ACTIVE",
  "ENVIRONMENT_MISMATCH",
  "ENGINE_INSTANCE_NOT_PERMITTED",
  "RESOLUTION_UNAVAILABLE",
])

export class EstateBindingError extends Error {
  constructor(readonly code: EstateBindingFailure) {
    super(`Control Plane estate binding denied: ${code}`)
    this.name = "EstateBindingError"
  }
}

export interface EstateBindingResolver {
  resolve(request: {
    clientEvidence: string
    subjectAuthorisedParty: string
    requestedDigitalEstateId?: string
    correlationId: string
  }): Promise<EstateBindingAttestation>
}

export type ControlPlaneEstateBindingResolverOptions = {
  baseUrl: string
  tokenProvider: WorkloadTokenProvider
  engineInstanceId: string
  environment: string
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class ControlPlaneEstateBindingResolver implements EstateBindingResolver {
  private readonly endpoint: URL
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly options: ControlPlaneEstateBindingResolverOptions) {
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
    if (options.environment !== "development" && options.environment !== "staging") {
      throw new Error("estate binding resolution runs only in development or staging")
    }
    this.endpoint = new URL(ESTATE_BINDING_PATH, base)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  async resolve(request: {
    clientEvidence: string
    subjectAuthorisedParty: string
    requestedDigitalEstateId?: string
    correlationId: string
  }): Promise<EstateBindingAttestation> {
    const unavailable = () => new EstateBindingError("RESOLUTION_UNAVAILABLE")
    if (!UUID.test(request.correlationId)) throw unavailable()
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
        body: JSON.stringify({
          purpose: "BUYER_OPERATION",
          client_evidence: request.clientEvidence,
          client_evidence_type: ACCESS_TOKEN_TYPE,
          subject_authorised_party: request.subjectAuthorisedParty,
          engine_instance_id: this.options.engineInstanceId,
          environment: this.options.environment,
          ...(request.requestedDigitalEstateId
            ? { requested_digital_estate_id: request.requestedDigitalEstateId }
            : {}),
          correlation_id: request.correlationId,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw unavailable()
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw unavailable()
    }
    if (!response.ok) {
      // A route CP has not mounted answers with a generic code: that is
      // UNAVAILABLE, never a binding decision.
      const code = (body as { code?: unknown } | null)?.code
      throw new EstateBindingError(
        typeof code === "string" && KNOWN.has(code)
          ? (code as EstateBindingFailure)
          : "RESOLUTION_UNAVAILABLE",
      )
    }
    // Never trust a bare 200: the attestation must satisfy the Shared wire
    // contract, name this instance and environment, and still be current.
    if (!estateBindingAttestationSchema(body)) throw unavailable()
    const value = body as Record<string, unknown>
    const now = this.now()
    const attestedAt = Date.parse(value.attested_at as string)
    const expiresAt = Date.parse(value.expires_at as string)
    if (
      value.engine_instance_id !== this.options.engineInstanceId ||
      value.environment !== this.options.environment ||
      value.bff_client_id !== request.subjectAuthorisedParty ||
      (request.requestedDigitalEstateId !== undefined &&
        value.digital_estate_id !== request.requestedDigitalEstateId) ||
      !Number.isFinite(attestedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt - attestedAt > MAXIMUM_ATTESTATION_MS
    ) {
      throw unavailable()
    }
    return {
      bindingId: value.binding_id as string,
      revision: value.revision as number,
      digitalEstateId: value.digital_estate_id as string,
      tenantId: value.tenant_id as string,
      engineInstanceId: value.engine_instance_id as string,
      environment: value.environment as string,
      deploymentReference: value.deployment_reference as string,
      evidenceReference: value.evidence_reference as string,
      expiresAt: new Date(expiresAt),
    }
  }
}

let singleton: EstateBindingResolver | null | undefined

/**
 * Null unless the buyer identity path, this instance's engine id and a
 * development or staging environment are configured. Without it, every
 * operation that needs the Digital Estate is UNAVAILABLE; there is no
 * configured, header or hostname fallback.
 */
export const getEstateBindingResolver = (): EstateBindingResolver | null => {
  if (singleton !== undefined) return singleton
  const env = getBaobabTradeEnvironment()
  if (
    !env.buyerIdentityEnabled ||
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
    singleton = new ControlPlaneEstateBindingResolver({
      baseUrl: env.controlPlaneBaseUrl,
      engineInstanceId: env.tradeEngineInstanceId,
      environment: env.deploymentEnvironment,
      tokenProvider: new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: env.iamWorkloadTokenUrl,
        clientId: env.iamWorkloadClientId,
        clientSecret: env.iamWorkloadClientSecret,
        scope: ESTATE_BINDING_SCOPE,
        audience: "baobab-control-plane",
      }),
    })
  } catch {
    singleton = null
  }
  return singleton
}

export const resetEstateBindingResolverForTests = (): void => {
  singleton = undefined
}
