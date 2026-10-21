// ZB-G03 step 3 (CP ADR-BCP-028; IAM ADR-0010 section 0; Shared identity/v1
// buyer-identity-handoff.schema.json): the buyer context Trade derives from
// an IAM buyer token presented server-to-server by a confidential estate BFF.
//
// This route deliberately does not use Medusa's customer authentication: a
// Medusa customer token alone authorises no commerce operation. The bearer
// must be an IAM access token for audience baobab-trade with trade:buy. The
// body is the non-authoritative BuyerOperationRequest: every field is a
// request Trade resolves, never a proof. Trade verifies the token, the
// Control Plane resolves the canonical Principal and attests the
// organisation's tenant, and Trade checks an active buyer membership keyed on
// that Principal. Disabled (404) unless BAOBAB_BUYER_IDENTITY_ENABLED=true.
//
// Supersedes GET /store/b2b/context for estates on the IAM BFF path; that
// route keeps its Medusa-customer binding for the legacy session until the
// estate switches.
import { randomUUID } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BuyerTokenVerifier } from "../../../../baobab/auth/buyer-access-token"
import { BuyerAuthorityError, resolveBuyerAuthority } from "../../../../baobab/b2b/buyer-authority"
import { getBaobabTradeEnvironment } from "../../../../baobab/config/environment"
import { getBuyerPrincipalResolver } from "../../../../baobab/control-plane/principal-resolution"
import { getWorkloadTenantVerifier } from "../../../../baobab/control-plane/workload-tenant-verifier"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COUNTRY = /^[A-Z]{2}$/
const ALLOWED_FIELDS = new Set([
  "requested_organisation_id",
  "requested_country_code",
  "correlation_id",
])

let verifier: { issuer: string; parties: string; instance: BuyerTokenVerifier } | undefined

const tokenVerifier = (issuer: string, parties: string[]): BuyerTokenVerifier => {
  const key = parties.join(",")
  if (!verifier || verifier.issuer !== issuer || verifier.parties !== key) {
    verifier = {
      issuer,
      parties: key,
      instance: new BuyerTokenVerifier({ issuer, authorisedParties: parties }),
    }
  }
  return verifier.instance
}

const deny = (res: MedusaResponse, status: number, code: string, correlationId: string) => {
  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader("X-Correlation-ID", correlationId)
  res.status(status).json({ code })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const headerCorrelation = req.headers["x-correlation-id"]?.toString()
  const fallbackCorrelation =
    headerCorrelation && UUID.test(headerCorrelation) ? headerCorrelation : randomUUID()

  const env = getBaobabTradeEnvironment()
  const principals = getBuyerPrincipalResolver()
  const tenants = getWorkloadTenantVerifier()
  if (!env.buyerIdentityEnabled) return deny(res, 404, "NOT_FOUND", fallbackCorrelation)
  if (!env.buyerIamIssuer || env.buyerAuthorisedParties.length === 0 || !principals || !tenants) {
    return deny(res, 503, "BUYER_IDENTITY_UNAVAILABLE", fallbackCorrelation)
  }

  const authorization = req.headers.authorization ?? ""
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization)
  if (!match) return deny(res, 401, "BUYER_TOKEN_INVALID", fallbackCorrelation)

  const body = req.body as Record<string, unknown> | undefined
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key)) ||
    typeof body.correlation_id !== "string" ||
    !UUID.test(body.correlation_id) ||
    (headerCorrelation !== undefined && headerCorrelation !== body.correlation_id) ||
    (body.requested_organisation_id !== undefined &&
      typeof body.requested_organisation_id !== "string") ||
    (body.requested_country_code !== undefined &&
      (typeof body.requested_country_code !== "string" ||
        !COUNTRY.test(body.requested_country_code)))
  ) {
    return deny(res, 400, "INVALID_BUYER_OPERATION_REQUEST", fallbackCorrelation)
  }
  const correlationId = body.correlation_id

  try {
    const authority = await resolveBuyerAuthority(
      {
        tokens: tokenVerifier(env.buyerIamIssuer, env.buyerAuthorisedParties),
        principals,
        tenants,
        b2b: req.scope.resolve<B2BModuleService>(B2B_MODULE),
      },
      {
        subjectToken: match[1],
        requestedOrganisationId: body.requested_organisation_id as string | undefined,
        correlationId,
      },
    )
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("X-Correlation-ID", correlationId)
    // A Trade-local projection: identity, the bound organisation, the
    // membership and its roles. No market, price, credit or purchase
    // decision is implied; each operation re-derives authority.
    res.status(200).json({
      principal_id: authority.principalId,
      organisation: {
        id: authority.organisation.id,
        canonical_organisation_id: authority.organisation.canonicalOrganisationId,
        status: authority.organisation.status,
      },
      membership: { id: authority.membership.id, status: authority.membership.status },
      roles: authority.roles,
      evidence_expires_at: authority.evidenceExpiresAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof BuyerAuthorityError)
      return deny(res, error.status, error.code, correlationId)
    return deny(res, 503, "BUYER_IDENTITY_UNAVAILABLE", correlationId)
  }
}
