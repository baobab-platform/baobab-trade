// ADR-SHARED-042 CAA-04/05 (ADR-0033; Shared identity/v1
// buyer-identity-handoff v1.1, trade/v2 buyer-execution-context): the
// TradeBuyerExecutionContext Trade derives for operation
// trade.buyer-context.resolve, from evidence a confidential estate BFF
// presents server-to-server.
//
// The BFF authenticates as itself: the bearer is its own IAM workload token
// (trade:buyer-handoff). The human buyer's IAM access token travels in the
// body as subject evidence, with the non-authoritative selection requests.
// This route never uses Medusa's customer authentication: a Medusa customer
// token alone authorises nothing. ALLOW returns the server-built context;
// every other outcome returns a closed BuyerOperationDecision. Disabled (404)
// unless BAOBAB_BUYER_IDENTITY_ENABLED=true; enabled without its full
// configuration, it is UNAVAILABLE.
//
// Supersedes GET /store/b2b/context for estates on the IAM BFF path; that
// route keeps its Medusa-customer binding for the legacy session until the
// estate switches.
import { randomUUID } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { interimAssurancePolicy } from "../../../../baobab/auth/buyer-assurance"
import { BuyerTokenVerifier } from "../../../../baobab/auth/buyer-access-token"
import { resolveBuyerContext } from "../../../../baobab/b2b/buyer-authority"
import { getBaobabTradeEnvironment } from "../../../../baobab/config/environment"
import { getEstateBindingResolver } from "../../../../baobab/control-plane/estate-binding"
import { getBuyerPrincipalResolver } from "../../../../baobab/control-plane/principal-resolution"
import { getWorkloadTenantVerifier } from "../../../../baobab/control-plane/workload-tenant-verifier"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const COUNTRY = /^[A-Z]{2}$/
const ESTATE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
const ALLOWED_FIELDS = new Set([
  "subject_token",
  "subject_token_type",
  "requested_organisation_id",
  "requested_country_code",
  "requested_digital_estate_id",
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

const send = (res: MedusaResponse, status: number, body: unknown, correlationId: string) => {
  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader("X-Correlation-ID", correlationId)
  res.status(status).json(body)
}

const refuse = (
  res: MedusaResponse,
  status: number,
  outcome: "DENY" | "UNAVAILABLE",
  reason: string,
  correlationId: string,
) =>
  send(
    res,
    status,
    { decision: { outcome, reasons: [reason] }, correlation_id: correlationId },
    correlationId,
  )

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const headerCorrelation = req.headers["x-correlation-id"]?.toString()
  const fallbackCorrelation =
    headerCorrelation && UUID.test(headerCorrelation) ? headerCorrelation : randomUUID()

  const env = getBaobabTradeEnvironment()
  if (!env.buyerIdentityEnabled) {
    res.setHeader("Cache-Control", "private, no-store")
    return res.status(404).json({ code: "NOT_FOUND" })
  }
  const principals = getBuyerPrincipalResolver()
  if (
    !env.buyerIamIssuer ||
    env.buyerAuthorisedParties.length === 0 ||
    !principals ||
    !env.tradeEngineInstanceId
  ) {
    return refuse(res, 503, "UNAVAILABLE", "SOURCE_UNAVAILABLE", fallbackCorrelation)
  }

  const authorization = req.headers.authorization ?? ""
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization)
  if (!match || !JWS.test(match[1])) {
    return refuse(res, 401, "DENY", "BUYER_TOKEN_INVALID", fallbackCorrelation)
  }

  const body = req.body as Record<string, unknown> | undefined
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key)) ||
    typeof body.subject_token !== "string" ||
    body.subject_token.length > 8192 ||
    !JWS.test(body.subject_token) ||
    body.subject_token_type !== ACCESS_TOKEN_TYPE ||
    typeof body.correlation_id !== "string" ||
    !UUID.test(body.correlation_id) ||
    (headerCorrelation !== undefined && headerCorrelation !== body.correlation_id) ||
    (body.requested_organisation_id !== undefined &&
      typeof body.requested_organisation_id !== "string") ||
    (body.requested_country_code !== undefined &&
      (typeof body.requested_country_code !== "string" ||
        !COUNTRY.test(body.requested_country_code))) ||
    (body.requested_digital_estate_id !== undefined &&
      (typeof body.requested_digital_estate_id !== "string" ||
        !ESTATE.test(body.requested_digital_estate_id)))
  ) {
    // The body carries a credential: the answer never echoes it.
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("X-Correlation-ID", fallbackCorrelation)
    return res.status(400).json({ code: "INVALID_BUYER_OPERATION_REQUEST" })
  }
  const correlationId = body.correlation_id

  const result = await resolveBuyerContext(
    {
      tokens: tokenVerifier(env.buyerIamIssuer, env.buyerAuthorisedParties),
      assurance: interimAssurancePolicy({
        issuer: env.buyerIamIssuer,
        acceptedAcr: env.buyerAcceptedAcr,
        approvalReference: env.buyerAssuranceApprovalReference,
      }),
      principals,
      estates: getEstateBindingResolver(),
      tenants: getWorkloadTenantVerifier(),
      b2b: req.scope.resolve<B2BModuleService>(B2B_MODULE),
      engineInstanceId: env.tradeEngineInstanceId,
    },
    {
      callerToken: match[1],
      subjectToken: body.subject_token,
      requestedOrganisationId: body.requested_organisation_id as string | undefined,
      requestedCountryCode: body.requested_country_code as string | undefined,
      requestedDigitalEstateId: body.requested_digital_estate_id as string | undefined,
      correlationId,
    },
  )
  if (result.outcome === "ALLOW") return send(res, 200, result.context, correlationId)
  return send(
    res,
    result.status,
    { decision: result.decision, correlation_id: correlationId },
    correlationId,
  )
}
