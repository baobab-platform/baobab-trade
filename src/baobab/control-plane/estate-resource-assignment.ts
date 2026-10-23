import { getBaobabTradeEnvironment } from "../config/environment"
import {
  resourceAssignmentAttestationSchema,
  resourceAssignmentRequestSchema,
} from "../contracts/authority-validation"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "./workload-token"

/**
 * ADR-SHARED-042 section 14 Decision 9 (Platform Owner ruling of 23 October
 * 2026; Shared control-plane/v1 estate-resource-assignment.openapi.yaml; CP
 * ADR-BCP-031): a native commitment that does not arrive through a governed
 * BFF proves its Digital Estate only with CP's governed resource assignment
 * attestation. There is no second registry and Trade never certifies itself:
 *
 *   - WORKLOAD: an authenticated server application. Trade forwards the
 *     application's own IAM workload token (audience baobab-trade, scope
 *     trade:native-commitment:submit, ADR-IAM-0034); CP verifies and
 *     introspects it. A Medusa publishable key is never evidence;
 *   - NATIVE_RESOURCE: a native operation, job, callback or replay, named by
 *     the native seller configuration exactly as Trade attested it to CP
 *     under Trade-0 (reference and live digest).
 *
 * Trade's own workload token (scope estate:resource-assignment:resolve)
 * authenticates the call. Trade names the estate, its own engine instance,
 * the Market and the operation; it never names a Tenant or an assignment.
 * An attestation proves estate provenance only: it is never seller, buyer,
 * Market or purchasing authority.
 */
export const RESOURCE_ASSIGNMENT_SCOPE = "estate:resource-assignment:resolve"
export const RESOURCE_ASSIGNMENT_PATH = "/internal/estate/v1/resource-assignments/resolve"
const MAXIMUM_ATTESTATION_MS = 60_000
/** An attestation is never used before it was issued, beyond this skew. */
const CLOCK_SKEW_MS = 5_000
const ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token"

export type AssignmentOperation =
  "trade.order.commit" | "trade.order.create" | "trade.draft-order.finalize"

export type AssignmentSubject =
  | { scope: "WORKLOAD"; workloadToken: string }
  | {
      scope: "NATIVE_RESOURCE"
      nativeConfigurationReference: string
      nativeConfigurationDigest: string
    }

export type ResourceAssignmentRequest = {
  subject: AssignmentSubject
  digitalEstateId: string
  marketId: string
  operation: AssignmentOperation
  correlationId: string
}

export type ResourceAssignmentAttestation = {
  attestationId: string
  assignmentId: string
  assignmentRevision: number
  scope: AssignmentSubject["scope"]
  workloadClientId: string | null
  digitalEstateId: string
  tenantId: string
  engineInstanceId: string
  marketId: string
  operation: AssignmentOperation
  issuedAt: Date
  expiresAt: Date
  assignmentEffectiveUntil: Date | null
  evidenceReference: string
}

/** Closed CP denial codes (EstateResourceAssignmentDenialCode). */
export type ResourceAssignmentFailure =
  | "CALLER_NOT_PERMITTED"
  | "WORKLOAD_EVIDENCE_INVALID"
  | "NATIVE_RESOURCE_NOT_ATTESTED"
  | "ASSIGNMENT_NOT_FOUND"
  | "ASSIGNMENT_NOT_ACTIVE"
  | "OPERATION_NOT_PERMITTED"
  | "MARKET_NOT_PERMITTED"
  | "ENGINE_INSTANCE_NOT_PERMITTED"
  | "ASSIGNMENT_AMBIGUOUS"
  | "RESOLUTION_UNAVAILABLE"

const KNOWN: ReadonlySet<string> = new Set<ResourceAssignmentFailure>([
  "CALLER_NOT_PERMITTED",
  "WORKLOAD_EVIDENCE_INVALID",
  "NATIVE_RESOURCE_NOT_ATTESTED",
  "ASSIGNMENT_NOT_FOUND",
  "ASSIGNMENT_NOT_ACTIVE",
  "OPERATION_NOT_PERMITTED",
  "MARKET_NOT_PERMITTED",
  "ENGINE_INSTANCE_NOT_PERMITTED",
  "ASSIGNMENT_AMBIGUOUS",
  "RESOLUTION_UNAVAILABLE",
])

export class ResourceAssignmentError extends Error {
  constructor(readonly code: ResourceAssignmentFailure) {
    super(`Control Plane estate resource assignment denied: ${code}`)
    this.name = "ResourceAssignmentError"
  }
}

export interface ResourceAssignmentResolver {
  resolve(request: ResourceAssignmentRequest): Promise<ResourceAssignmentAttestation>
}

export type ControlPlaneResourceAssignmentResolverOptions = {
  baseUrl: string
  tokenProvider: WorkloadTokenProvider
  engineInstanceId: string
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class ControlPlaneResourceAssignmentResolver implements ResourceAssignmentResolver {
  private readonly endpoint: URL
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(private readonly options: ControlPlaneResourceAssignmentResolverOptions) {
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
    this.endpoint = new URL(RESOURCE_ASSIGNMENT_PATH, base)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  async resolve(request: ResourceAssignmentRequest): Promise<ResourceAssignmentAttestation> {
    const unavailable = () => new ResourceAssignmentError("RESOLUTION_UNAVAILABLE")
    const subject = request.subject
    const body = {
      scope: subject?.scope,
      ...(subject?.scope === "WORKLOAD"
        ? { workload_evidence: subject.workloadToken, workload_evidence_type: ACCESS_TOKEN }
        : subject?.scope === "NATIVE_RESOURCE"
          ? {
              native_resource: {
                native_configuration_reference: subject.nativeConfigurationReference,
                native_configuration_digest: subject.nativeConfigurationDigest,
              },
            }
          : {}),
      digital_estate_id: request.digitalEstateId,
      engine_instance_id: this.options.engineInstanceId,
      market_id: request.marketId,
      operation: request.operation,
      correlation_id: request.correlationId,
    }
    // Never send what CP would refuse: a malformed request is a Trade defect,
    // not a provenance answer.
    if (!resourceAssignmentRequestSchema(body)) throw unavailable()
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
      // UNAVAILABLE, never a provenance answer.
      const code = (payload as { code?: unknown } | null)?.code
      throw new ResourceAssignmentError(
        typeof code === "string" && KNOWN.has(code)
          ? (code as ResourceAssignmentFailure)
          : "RESOLUTION_UNAVAILABLE",
      )
    }
    // Never trust a bare 200: the attestation must satisfy the Shared wire
    // contract, answer exactly what was asked and still be current.
    if (!resourceAssignmentAttestationSchema(payload)) throw unavailable()
    const value = payload as Record<string, unknown>
    const now = this.now()
    const issuedAt = Date.parse(value.issued_at as string)
    const expiresAt = Date.parse(value.expires_at as string)
    const until =
      value.assignment_effective_until === undefined
        ? null
        : Date.parse(value.assignment_effective_until as string)
    if (
      value.scope !== subject.scope ||
      value.digital_estate_id !== request.digitalEstateId ||
      value.trade_engine_instance_id !== this.options.engineInstanceId ||
      value.market_id !== request.marketId ||
      value.operation !== request.operation ||
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
      assignmentId: value.assignment_id as string,
      assignmentRevision: value.assignment_revision as number,
      scope: value.scope as AssignmentSubject["scope"],
      workloadClientId: (value.workload_client_id as string | undefined) ?? null,
      digitalEstateId: value.digital_estate_id as string,
      tenantId: value.tenant_id as string,
      engineInstanceId: value.trade_engine_instance_id as string,
      marketId: value.market_id as string,
      operation: value.operation as AssignmentOperation,
      issuedAt: new Date(issuedAt),
      expiresAt: new Date(expiresAt),
      assignmentEffectiveUntil: until === null ? null : new Date(until),
      evidenceReference: value.evidence_reference as string,
    }
  }
}

let singleton: ResourceAssignmentResolver | null | undefined

/**
 * Null unless explicitly enabled, with this instance's engine id, CP and a
 * development or staging environment. Without it, a native commitment with
 * no governed BFF has no estate provenance and is never classified; there is
 * no B2C or implicit fallback.
 */
export const getResourceAssignmentResolver = (): ResourceAssignmentResolver | null => {
  if (singleton !== undefined) return singleton
  const env = getBaobabTradeEnvironment()
  if (
    !env.resourceAssignmentEnabled ||
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
    singleton = new ControlPlaneResourceAssignmentResolver({
      baseUrl: env.controlPlaneBaseUrl,
      engineInstanceId: env.tradeEngineInstanceId,
      tokenProvider: new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: env.iamWorkloadTokenUrl,
        clientId: env.iamWorkloadClientId,
        clientSecret: env.iamWorkloadClientSecret,
        scope: RESOURCE_ASSIGNMENT_SCOPE,
      }),
    })
  } catch {
    singleton = null
  }
  return singleton
}

export const resetResourceAssignmentResolverForTests = (): void => {
  singleton = undefined
}
