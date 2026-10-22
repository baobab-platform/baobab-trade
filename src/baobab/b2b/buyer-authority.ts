import { randomUUID } from "node:crypto"
import type B2BModuleService from "../../modules/b2b/service"
import {
  evaluateAssurance,
  type BuyerOperation,
  type InterimAssurancePolicy,
} from "../auth/buyer-assurance"
import {
  BuyerTokenError,
  type VerifiedBffCaller,
  type VerifiedBuyerToken,
} from "../auth/buyer-access-token"
import {
  buyerExecutionContextSchema,
  buyerOperationDecisionSchema,
} from "../contracts/authority-validation"
import {
  EstateBindingError,
  type EstateBindingAttestation,
  type EstateBindingResolver,
} from "../control-plane/estate-binding"
import {
  PrincipalResolutionError,
  type BuyerPrincipalResolver,
} from "../control-plane/principal-resolution"
import {
  TenantAttestationError,
  type WorkloadTenantVerifier,
} from "../control-plane/workload-tenant-verifier"
import { B2B_ROLES, type B2BRole } from "./types"

/**
 * ADR-SHARED-042 CAA-04/05 (ADR-0033): the TradeBuyerExecutionContext Trade
 * derives server-side for one buyer operation, from independently verified
 * facts, in this order:
 *
 *   1. The estate BFF authenticates as itself (buyer-identity-handoff v1.1):
 *      its own workload token, for a registered BFF client.
 *   2. Trade verifies the human IAM token itself, and requires its azp to be
 *      that same BFF client and its issuer the same issuer.
 *   3. The interim assurance verifier (CAA-03) accepts the token's acr for
 *      the operation's canonical profile, or the operation is not activated.
 *   4. The Control Plane resolves the exact (issuer, subject) to an ACTIVE
 *      canonical human Principal.
 *   5. The Control Plane attests the Digital Estate binding of the BFF's
 *      client from the BFF's own evidence: estate, seller-side Tenant, this
 *      Trade instance and environment. Without it the operation is
 *      UNAVAILABLE; nothing local substitutes.
 *   6. The actor has expressly selected a canonical Organisation; the server
 *      never infers one.
 *   7. Exactly one ACTIVE Trade buyer relationship of that Tenant links that
 *      Organisation, belongs to this Trade instance and records its link
 *      provenance.
 *   8. That Principal holds exactly one ACTIVE, in-effect membership of it.
 *   9. Only then does the Control Plane attest the Organisation for the
 *      seller-side Tenant, so attestation answers never leak to non-members.
 *
 * Nothing is cached across requests. The context names the membership and
 * relationship revisions it evaluated, lives at most 60 seconds and never
 * outlives its earliest evidence. It is not a credential and grants nothing
 * beyond this operation; buyer ALLOW never executes a transaction without the
 * seller decision and a native fence (ADR-SHARED-042 section 9). Reasons for
 * an Organisation the actor cannot act for are never more specific than
 * BUYER_NOT_AUTHORISED.
 */
export type DecisionOutcome =
  "ALLOW" | "APPROVAL_REQUIRED" | "SELECTION_REQUIRED" | "DENY" | "UNAVAILABLE"

/** The closed trade/v2 decisionReason vocabulary (tests/buyer-operation-policy.test.ts checks it). */
export type DecisionReason =
  | "BUYER_TOKEN_INVALID"
  | "ASSURANCE_INSUFFICIENT"
  | "IDENTITY_NOT_RESOLVED"
  | "PRINCIPAL_NOT_ACTIVE"
  | "ORGANISATION_SELECTION_REQUIRED"
  | "BUYER_NOT_AUTHORISED"
  | "ORGANISATION_NOT_ATTESTED"
  | "BUYER_ACCOUNT_NOT_ACTIVE"
  | "ROLE_NOT_PERMITTED"
  | "SITE_NOT_PERMITTED"
  | "MARKET_NOT_PERMITTED"
  | "PURCHASE_ORDER_REQUIRED"
  | "SPEND_LIMIT_EXCEEDED"
  | "SPEND_POLICY_NOT_CONFIGURED"
  | "APPROVAL_THRESHOLD_EXCEEDED"
  | "APPROVAL_AUTHORITY_NOT_CONFIGURED"
  | "SEPARATION_OF_DUTIES"
  | "TRANSACTION_CHANGED"
  | "CONTEXT_NOT_USABLE"
  | "SELLER_AUTHORITY_ABSENT"
  | "OPERATION_NOT_ACTIVATED"
  | "SOURCE_UNAVAILABLE"

/** The wire TradeBuyerExecutionContext (trade/v2 buyer-execution-context.schema.json). */
export type TradeBuyerExecutionContext = {
  context_id: string
  decision_id: string
  correlation_id: string
  actor_type: "HUMAN"
  actor_principal_id: string
  external_identity_id: string
  tenant_id: string
  digital_estate_id: string
  engine_instance_id: string
  canonical_organisation_id: string
  buyer_organisation_id: string
  buyer_membership_id: string
  membership_revision: number
  roles: B2BRole[]
  cp_context_id: string
  operation: BuyerOperation
  policy_revision: string
  decision: { outcome: "ALLOW"; reasons: [] }
  evaluated_at: string
  expires_at: string
  evidence_references: string[]
}

export type BuyerContextResult =
  | { outcome: "ALLOW"; status: 200; context: TradeBuyerExecutionContext }
  | {
      outcome: Exclude<DecisionOutcome, "ALLOW">
      status: 401 | 403 | 409 | 503
      decision: { outcome: Exclude<DecisionOutcome, "ALLOW">; reasons: DecisionReason[] }
    }

export type BuyerAuthorityDependencies = {
  tokens: {
    verify(token: string): Promise<VerifiedBuyerToken>
    verifyBffCaller(token: string): Promise<VerifiedBffCaller>
  }
  assurance: InterimAssurancePolicy | null
  principals: BuyerPrincipalResolver
  estates: EstateBindingResolver | null
  tenants: WorkloadTenantVerifier | null
  b2b: Pick<B2BModuleService, "listB2BOrganisations" | "listBuyerMemberships" | "listBuyerRoles">
  engineInstanceId: string
  now?: () => number
  newId?: () => string
}

export type BuyerContextRequest = {
  callerToken: string
  subjectToken: string
  requestedOrganisationId?: string
  requestedDigitalEstateId?: string
  correlationId: string
}

const OPERATION: BuyerOperation = "trade.buyer-context.resolve"
const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CONTEXT_LIFETIME_MS = 60_000
/** The Trade operation policy this evaluator implements (trade/v2 policy_revision). */
export const BUYER_CONTEXT_POLICY_REVISION = "trade.buyer-context.resolve:v1"

const inEffect = (from: unknown, until: unknown, now: number): boolean => {
  const start = from ? new Date(from as string | Date).getTime() : -Infinity
  const end = until ? new Date(until as string | Date).getTime() : Infinity
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= now && now < end
}

class Refusal extends Error {
  constructor(
    readonly outcome: Exclude<DecisionOutcome, "ALLOW">,
    readonly reason: DecisionReason,
    readonly status: 401 | 403 | 409 | 503,
  ) {
    super(reason)
  }
}

const deny = (reason: DecisionReason, status: 401 | 403 = 403) =>
  new Refusal("DENY", reason, status)
const unavailable = () => new Refusal("UNAVAILABLE", "SOURCE_UNAVAILABLE", 503)

const tokenRefusal = (error: unknown): Refusal =>
  error instanceof BuyerTokenError && error.code === "BUYER_TOKEN_INVALID"
    ? deny("BUYER_TOKEN_INVALID", 401)
    : unavailable()

export async function resolveBuyerContext(
  deps: BuyerAuthorityDependencies,
  request: BuyerContextRequest,
): Promise<BuyerContextResult> {
  try {
    return { outcome: "ALLOW", status: 200, context: await evaluate(deps, request) }
  } catch (error) {
    const refusal = error instanceof Refusal ? error : unavailable()
    const decision = { outcome: refusal.outcome, reasons: [refusal.reason] }
    if (!buyerOperationDecisionSchema(decision)) {
      return {
        outcome: "UNAVAILABLE",
        status: 503,
        decision: { outcome: "UNAVAILABLE", reasons: ["SOURCE_UNAVAILABLE"] },
      }
    }
    return { outcome: refusal.outcome, status: refusal.status, decision }
  }
}

async function evaluate(
  deps: BuyerAuthorityDependencies,
  request: BuyerContextRequest,
): Promise<TradeBuyerExecutionContext> {
  const now = (deps.now ?? Date.now)()
  const newId = deps.newId ?? randomUUID

  // 1-2. The BFF as itself, then the human token, bound to the same client.
  const caller = await deps.tokens.verifyBffCaller(request.callerToken).catch((error) => {
    throw tokenRefusal(error)
  })
  const token = await deps.tokens.verify(request.subjectToken).catch((error) => {
    throw tokenRefusal(error)
  })
  if (token.authorisedParty !== caller.clientId || token.issuer !== caller.issuer) {
    throw deny("BUYER_TOKEN_INVALID", 401)
  }

  // 3. Assurance for this operation's canonical profile.
  const assurance = evaluateAssurance(deps.assurance, OPERATION, token)
  if (!assurance.ok) throw deny(assurance.reason)

  // 4. The canonical Principal.
  const principal = await deps.principals
    .resolve(request.subjectToken, request.correlationId)
    .catch((error) => {
      const code = error instanceof PrincipalResolutionError ? error.code : "RESOLUTION_UNAVAILABLE"
      switch (code) {
        case "IDENTITY_NOT_RESOLVED":
          throw deny("IDENTITY_NOT_RESOLVED")
        case "PRINCIPAL_NOT_ACTIVE":
          throw deny("PRINCIPAL_NOT_ACTIVE")
        case "SUBJECT_TOKEN_INVALID":
        case "SUBJECT_TOKEN_NOT_CURRENT":
        case "SUBJECT_TOKEN_NOT_FOR_CALLER":
          throw deny("BUYER_TOKEN_INVALID", 401)
        default:
          throw unavailable()
      }
    })

  // 5. The Digital Estate, only from CP's attestation of the BFF's evidence.
  if (!deps.estates) throw unavailable()
  const estate: EstateBindingAttestation = await deps.estates
    .resolve({
      clientEvidence: request.callerToken,
      subjectAuthorisedParty: caller.clientId,
      requestedDigitalEstateId: request.requestedDigitalEstateId,
      correlationId: request.correlationId,
    })
    .catch((error) => {
      const code = error instanceof EstateBindingError ? error.code : "RESOLUTION_UNAVAILABLE"
      if (code === "RESOLUTION_UNAVAILABLE" || code === "CALLER_NOT_PERMITTED") throw unavailable()
      throw deny("CONTEXT_NOT_USABLE")
    })
  if (estate.engineInstanceId !== deps.engineInstanceId) throw deny("CONTEXT_NOT_USABLE")

  // 6. An express selection; never inferred.
  const requested = request.requestedOrganisationId
  if (requested === undefined) {
    throw new Refusal("SELECTION_REQUIRED", "ORGANISATION_SELECTION_REQUIRED", 409)
  }
  if (!CANONICAL_ID.test(requested)) throw deny("BUYER_NOT_AUTHORISED")

  // 7. Exactly one ACTIVE relationship of the seller-side Tenant, on this
  // Trade instance, with recorded link provenance.
  const organisations = await deps.b2b
    .listB2BOrganisations({ canonical_organisation_id: requested, tenant_id: estate.tenantId })
    .catch(() => {
      throw unavailable()
    })
  if (organisations.length !== 1) throw deny("BUYER_NOT_AUTHORISED")
  const organisation = organisations[0]
  if (
    organisation.status !== "ACTIVE" ||
    organisation.tenant_id !== estate.tenantId ||
    organisation.canonical_organisation_id !== requested ||
    organisation.engine_instance_id !== estate.engineInstanceId ||
    !organisation.link_provenance
  ) {
    throw deny("BUYER_NOT_AUTHORISED")
  }

  // 8. Exactly one ACTIVE, in-effect membership keyed on the Principal.
  const memberships = await deps.b2b
    .listBuyerMemberships({ organisation_id: organisation.id, principal_id: principal.principalId })
    .catch(() => {
      throw unavailable()
    })
  if (memberships.length !== 1) throw deny("BUYER_NOT_AUTHORISED")
  const membership = memberships[0]
  if (
    membership.principal_id !== principal.principalId ||
    membership.organisation_id !== organisation.id ||
    membership.status !== "ACTIVE" ||
    !inEffect(membership.effective_from, membership.effective_until, now)
  ) {
    throw deny("BUYER_NOT_AUTHORISED")
  }
  const roles = (
    await deps.b2b.listBuyerRoles({ membership_id: membership.id }).catch(() => {
      throw unavailable()
    })
  )
    .map((record) => record.role as B2BRole)
    .filter((role) => (B2B_ROLES as readonly string[]).includes(role))

  // 9. CP attests the Organisation for the seller-side Tenant.
  if (!deps.tenants) throw unavailable()
  const cpContext = await deps.tenants
    .verifyOrganisationTenant(estate.tenantId, requested, request.correlationId)
    .catch((error) => {
      throw error instanceof TenantAttestationError
        ? deny("ORGANISATION_NOT_ATTESTED")
        : unavailable()
    })

  const expiries = [
    now + CONTEXT_LIFETIME_MS,
    token.expiresAt.getTime(),
    caller.expiresAt.getTime(),
    principal.evidenceExpiresAt.getTime(),
    estate.expiresAt.getTime(),
    ...(cpContext.expiresAt ? [cpContext.expiresAt.getTime()] : []),
  ]
  const expiresAt = Math.min(...expiries)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw deny("CONTEXT_NOT_USABLE")

  const context: TradeBuyerExecutionContext = {
    context_id: newId(),
    decision_id: newId(),
    correlation_id: request.correlationId,
    actor_type: "HUMAN",
    actor_principal_id: principal.principalId,
    external_identity_id: principal.externalIdentityId,
    tenant_id: estate.tenantId,
    digital_estate_id: estate.digitalEstateId,
    engine_instance_id: estate.engineInstanceId,
    canonical_organisation_id: requested,
    buyer_organisation_id: organisation.id,
    buyer_membership_id: membership.id,
    membership_revision: Number(membership.revision),
    roles: [...new Set(roles)],
    cp_context_id: cpContext.contextId,
    operation: OPERATION,
    policy_revision: `${BUYER_CONTEXT_POLICY_REVISION};${assurance.policyRevision}`,
    decision: { outcome: "ALLOW", reasons: [] },
    evaluated_at: new Date(now).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    evidence_references: [
      `cp-principal-resolution:${principal.externalIdentityId}`,
      `cp-estate-binding:${estate.bindingId}@r${estate.revision}`,
      `cp-context:${cpContext.contextId}`,
      `trade-buyer-relationship:${organisation.id}@r${Number(organisation.relationship_revision)}`,
      `assurance:${assurance.policyRevision}@${deps.assurance?.approvalReference ?? ""}`,
    ],
  }
  // The context must satisfy the Shared wire contract it claims to be.
  if (!buyerExecutionContextSchema(context)) throw unavailable()
  return context
}
