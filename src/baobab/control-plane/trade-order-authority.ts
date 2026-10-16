/**
 * ADR-SHARED-039 Trade-A TA-03: Trade's clients for the two CP operations an
 * order commitment needs.
 *
 * 1. Binding discovery (POST /internal/trade/v1/seller-operating-bindings/resolve,
 *    scope trade-seller-binding:resolve) identifies the ONE ACTIVE binding
 *    version for Trade's attested native configuration. It is never authority.
 * 2. Order authority (POST /internal/trade/v1/order-authority/resolve, scope
 *    trade-order-authority:resolve) decides one catalogued operation for that
 *    exact binding version. AUTHORIZED is a 30-second CP fact, never provider,
 *    money-movement or ERP authority.
 *
 * Every answer must echo the request exactly (TA-01): an answer to another,
 * delayed or replayed request is a failed call, never a binding or a denial.
 */
import {
  bindingResolutionSchema,
  bindingResolveRequestSchema,
  orderAuthorityDecisionSchema,
  orderAuthorityRequestSchema,
} from "../contracts/authority-validation"

export const SELLER_BINDING_RESOLVE_PATH = "/internal/trade/v1/seller-operating-bindings/resolve"
export const TRADE_ORDER_AUTHORITY_PATH = "/internal/trade/v1/order-authority/resolve"
/** Trade never honours a decision longer than this after receiving it. */
export const TRADE_ORDER_AUTHORITY_RECEIPT_LEASE_MS = 30_000

export type BindingReference = { binding_id: string; binding_version: number }

export type BindingResolveRequest = {
  context_id: string
  engine_instance_id: string
  native_configuration_reference: string
  native_configuration_digest: string
  currency: string
}

export type BindingResolutionOutcome =
  | "RESOLVED"
  | "NO_APPLICABLE_BINDING"
  | "AMBIGUOUS_BINDING"
  | "BINDING_NOT_ACTIVE"
  | "NATIVE_CONFIGURATION_MISMATCH"
  | "ENGINE_INSTANCE_NOT_BOUND"
  | "CONTEXT_NOT_USABLE"

export type BindingResolution = BindingResolveRequest & {
  resolution_id: string
  outcome: BindingResolutionOutcome
  binding_reference?: BindingReference
  status?: "ACTIVE"
  effective_from?: string
  effective_to?: string
  resolved_at: string
  provider_permissions_granted: false
}

/** Only the Trade-A classes are activatable in catalogue version 1. */
export type TradeAOperationClass =
  "trade.order.commit" | "trade.order.create" | "trade.draft-order.finalize"

export type OrderAuthorityRequest = {
  context_id: string
  engine_instance_id: string
  operation_class: TradeAOperationClass
  seller_operating_binding_reference: BindingReference
  native_configuration_digest: string
  currency: string
  operation_reference: string
}

export type OrderAuthorityDecision = Omit<OrderAuthorityRequest, "operation_class"> & {
  decision_id: string
  operation_class: string
  outcome: string
  tenant_id?: string
  operating_organisation_id?: string
  market?: string
  legal_actor_role?: string
  activity?: string
  mandate_id?: string
  supersedes_mandate_id?: string
  responsible_legal_entity_id?: string
  evidence_references?: string[]
  mandate_effective_from?: string
  mandate_effective_to?: string
  evaluated_at: string
  expires_at?: string
  policy_reference: string
  provider_permissions_granted: false
}

export interface TradeOrderAuthorityPort {
  resolveBinding(
    request: BindingResolveRequest,
    token: string,
    correlationId: string,
  ): Promise<BindingResolution>
  resolveOrderAuthority(
    request: OrderAuthorityRequest,
    token: string,
    correlationId: string,
  ): Promise<{ decision: OrderAuthorityDecision; receivedAt: number }>
}

const sameBinding = (a?: BindingReference, b?: BindingReference): boolean =>
  !!a && !!b && a.binding_id === b.binding_id && a.binding_version === b.binding_version

/** TA-01: every echoed field must equal the originating request. */
export function isResolutionFor(
  value: unknown,
  request: BindingResolveRequest,
): value is BindingResolution {
  if (!bindingResolutionSchema(value)) return false
  const r = value as BindingResolution
  return (
    r.context_id === request.context_id &&
    r.engine_instance_id === request.engine_instance_id &&
    r.native_configuration_reference === request.native_configuration_reference &&
    r.native_configuration_digest === request.native_configuration_digest &&
    r.currency === request.currency &&
    r.provider_permissions_granted === false &&
    (r.outcome === "RESOLVED") === (r.binding_reference !== undefined)
  )
}

export function isDecisionFor(
  value: unknown,
  request: OrderAuthorityRequest,
): value is OrderAuthorityDecision {
  if (!orderAuthorityDecisionSchema(value)) return false
  const d = value as OrderAuthorityDecision
  return (
    d.context_id === request.context_id &&
    d.engine_instance_id === request.engine_instance_id &&
    d.operation_class === request.operation_class &&
    sameBinding(d.seller_operating_binding_reference, request.seller_operating_binding_reference) &&
    d.native_configuration_digest === request.native_configuration_digest &&
    d.currency === request.currency &&
    d.operation_reference === request.operation_reference &&
    d.provider_permissions_granted === false
  )
}

/**
 * ADR-SHARED-039 §4: Trade denies once min(expires_at, its own receipt + 30 s)
 * has passed. Only AUTHORIZED, with a lease that started at or before receipt
 * and has not ended, is current.
 */
export function isCurrentOrderAuthority(
  decision: OrderAuthorityDecision,
  receivedAt: number,
  now: number,
): boolean {
  if (decision.outcome !== "AUTHORIZED" || !decision.expires_at || !decision.mandate_id)
    return false
  const evaluated = Date.parse(decision.evaluated_at)
  const expires = Date.parse(decision.expires_at)
  if (!Number.isFinite(evaluated) || !Number.isFinite(expires) || !Number.isFinite(receivedAt))
    return false
  if (evaluated > receivedAt + 1000 || expires - evaluated > TRADE_ORDER_AUTHORITY_RECEIPT_LEASE_MS)
    return false
  return now < Math.min(expires, receivedAt + TRADE_ORDER_AUTHORITY_RECEIPT_LEASE_MS)
}

export class HttpTradeOrderAuthorityClient implements TradeOrderAuthorityPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(baseUrl))
      throw new Error("CP Trade order authority requires HTTPS")
  }

  private async post(
    path: string,
    body: unknown,
    token: string,
    correlationId: string,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-correlation-id": correlationId,
        "cache-control": "no-store",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (response.status !== 200)
      throw new Error("Control Plane Trade authority unavailable or refused")
    return response.json()
  }

  async resolveBinding(request: BindingResolveRequest, token: string, correlationId: string) {
    if (!bindingResolveRequestSchema(request) || !token?.trim() || !correlationId?.trim())
      throw new Error("Invalid seller binding discovery request")
    const payload = await this.post(SELLER_BINDING_RESOLVE_PATH, request, token, correlationId)
    if (!isResolutionFor(payload, request))
      throw new Error("Invalid Control Plane seller binding resolution: fail closed")
    return payload
  }

  async resolveOrderAuthority(
    request: OrderAuthorityRequest,
    token: string,
    correlationId: string,
  ) {
    if (!orderAuthorityRequestSchema(request) || !token?.trim() || !correlationId?.trim())
      throw new Error("Invalid Trade order-authority request")
    const payload = await this.post(TRADE_ORDER_AUTHORITY_PATH, request, token, correlationId)
    // The receipt time is taken before any further work, so local delay only shortens the lease.
    const receivedAt = this.now()
    if (!isDecisionFor(payload, request))
      throw new Error("Invalid Control Plane Trade order-authority decision: fail closed")
    return { decision: payload, receivedAt }
  }
}
