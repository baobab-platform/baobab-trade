import type B2BModuleService from "../../modules/b2b/service"
import { BuyerTokenError, type VerifiedBuyerToken } from "../auth/buyer-access-token"
import {
  PrincipalResolutionError,
  type BuyerPrincipalResolver,
} from "../control-plane/principal-resolution"
import type { WorkloadTenantVerifier } from "../control-plane/workload-tenant-verifier"
import { B2B_ROLES, type B2BRole } from "./types"

/**
 * ZB-G03 step 3 (CP ADR-BCP-028; IAM ADR-0010 section 0): the buyer
 * authority Trade derives for one request, from an IAM buyer token and a
 * requested canonical Organisation, in this order:
 *
 *   1. Trade verifies the IAM access token itself (issuer keys, Trade
 *      audience, trade:buy, human, allowlisted BFF client, lifetime).
 *   2. The Control Plane resolves the token's exact (issuer, subject) to an
 *      ACTIVE canonical human Principal, after verifying and introspecting
 *      the same token.
 *   3. The requested canonical Organisation must be linked to exactly one
 *      ACTIVE Trade organisation whose tenant the Control Plane attests.
 *   4. That Principal must hold exactly one ACTIVE, in-effect buyer
 *      membership of that organisation; its roles are read from Trade.
 *
 * Membership is keyed on the CP Principal, never on a Medusa customer,
 * email, provider organisation claim or the ZuriBeans tenant's own
 * Organisation, and nothing here is cached across requests. An unknown
 * Organisation and a missing membership are indistinguishable to the
 * caller, so neither can be probed.
 */
export type BuyerAuthorityFailure =
  | "BUYER_TOKEN_INVALID"
  | "BUYER_IDENTITY_UNAVAILABLE"
  | "IDENTITY_NOT_RESOLVED"
  | "PRINCIPAL_NOT_ACTIVE"
  | "BUYER_ORGANISATION_REQUIRED"
  | "BUYER_NOT_AUTHORISED"
  | "TENANT_NOT_ATTESTED"

export class BuyerAuthorityError extends Error {
  constructor(
    readonly code: BuyerAuthorityFailure,
    readonly status: 400 | 401 | 403 | 503,
  ) {
    super(code)
    this.name = "BuyerAuthorityError"
  }
}

export type BuyerAuthority = {
  principalId: string
  organisation: { id: string; canonicalOrganisationId: string; status: "ACTIVE" }
  membership: { id: string; status: "ACTIVE" }
  roles: B2BRole[]
  /** The earliest of the token's expiry and CP's evidence expiry; never reuse past it. */
  evidenceExpiresAt: Date
}

export type BuyerAuthorityDependencies = {
  tokens: { verify(token: string): Promise<VerifiedBuyerToken> }
  principals: BuyerPrincipalResolver
  tenants: WorkloadTenantVerifier
  b2b: Pick<B2BModuleService, "listB2BOrganisations" | "listBuyerMemberships" | "listBuyerRoles">
  now?: () => number
}

const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const inEffect = (from: unknown, until: unknown, now: number): boolean => {
  const start = from ? new Date(from as string | Date).getTime() : -Infinity
  const end = until ? new Date(until as string | Date).getTime() : Infinity
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= now && now < end
}

export async function resolveBuyerAuthority(
  deps: BuyerAuthorityDependencies,
  request: { subjectToken: string; requestedOrganisationId?: string; correlationId: string },
): Promise<BuyerAuthority> {
  const now = (deps.now ?? Date.now)()

  let token: VerifiedBuyerToken
  try {
    token = await deps.tokens.verify(request.subjectToken)
  } catch (error) {
    if (error instanceof BuyerTokenError && error.code === "BUYER_TOKEN_INVALID") {
      throw new BuyerAuthorityError("BUYER_TOKEN_INVALID", 401)
    }
    throw new BuyerAuthorityError("BUYER_IDENTITY_UNAVAILABLE", 503)
  }

  let principalId: string
  let cpEvidenceExpiresAt: Date
  try {
    const resolved = await deps.principals.resolve(request.subjectToken, request.correlationId)
    principalId = resolved.principalId
    cpEvidenceExpiresAt = resolved.evidenceExpiresAt
  } catch (error) {
    const code = error instanceof PrincipalResolutionError ? error.code : "RESOLUTION_UNAVAILABLE"
    switch (code) {
      case "IDENTITY_NOT_RESOLVED":
        throw new BuyerAuthorityError("IDENTITY_NOT_RESOLVED", 403)
      case "PRINCIPAL_NOT_ACTIVE":
        throw new BuyerAuthorityError("PRINCIPAL_NOT_ACTIVE", 403)
      case "SUBJECT_TOKEN_INVALID":
      case "SUBJECT_TOKEN_NOT_CURRENT":
      case "SUBJECT_TOKEN_NOT_FOR_CALLER":
        throw new BuyerAuthorityError("BUYER_TOKEN_INVALID", 401)
      default:
        throw new BuyerAuthorityError("BUYER_IDENTITY_UNAVAILABLE", 503)
    }
  }

  const requested = request.requestedOrganisationId
  if (requested === undefined) throw new BuyerAuthorityError("BUYER_ORGANISATION_REQUIRED", 400)
  if (!CANONICAL_ID.test(requested)) throw new BuyerAuthorityError("BUYER_NOT_AUTHORISED", 403)

  const organisations = await deps.b2b.listB2BOrganisations({
    canonical_organisation_id: requested,
  })
  if (organisations.length !== 1 || organisations[0].status !== "ACTIVE") {
    throw new BuyerAuthorityError("BUYER_NOT_AUTHORISED", 403)
  }
  const organisation = organisations[0]

  // b2b_organisation.tenant_id is Trade-local; CP attests it on every read.
  try {
    await deps.tenants.verifyOrganisationTenant(
      organisation.tenant_id,
      requested,
      request.correlationId,
    )
  } catch {
    throw new BuyerAuthorityError("TENANT_NOT_ATTESTED", 403)
  }

  const memberships = await deps.b2b.listBuyerMemberships({
    organisation_id: organisation.id,
    principal_id: principalId,
  })
  if (memberships.length !== 1) throw new BuyerAuthorityError("BUYER_NOT_AUTHORISED", 403)
  const membership = memberships[0]
  if (
    membership.principal_id !== principalId ||
    membership.organisation_id !== organisation.id ||
    membership.status !== "ACTIVE" ||
    !inEffect(membership.effective_from, membership.effective_until, now)
  ) {
    throw new BuyerAuthorityError("BUYER_NOT_AUTHORISED", 403)
  }

  const roles = (await deps.b2b.listBuyerRoles({ membership_id: membership.id }))
    .map((record) => record.role as B2BRole)
    .filter((role) => (B2B_ROLES as readonly string[]).includes(role))

  const evidenceExpiresAt = new Date(
    Math.min(token.expiresAt.getTime(), cpEvidenceExpiresAt.getTime()),
  )
  if (evidenceExpiresAt.getTime() <= now) throw new BuyerAuthorityError("BUYER_TOKEN_INVALID", 401)

  return {
    principalId,
    organisation: { id: organisation.id, canonicalOrganisationId: requested, status: "ACTIVE" },
    membership: { id: membership.id, status: "ACTIVE" },
    roles: [...new Set(roles)],
    evidenceExpiresAt,
  }
}
