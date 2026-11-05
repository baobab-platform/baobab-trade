import { createHmac, randomUUID } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { BuyerTokenVerifier } from "../../../../baobab/auth/buyer-access-token"
import { interimAssurancePolicy } from "../../../../baobab/auth/buyer-assurance"
import { loadBuyerAssurancePolicy } from "../../../../baobab/auth/buyer-assurance-policy"
import { CurrentNativeBuyerAuthority, type CurrentNativeBuyerAuthorityDependencies } from
  "../../../../baobab/b2b/current-native-buyer-authority"
import { commitMedusaNativeBuyerOrder, type NativeMedusaOrderSource } from
  "../../../../baobab/b2b/medusa-native-transaction-owner"
import { type AuthorizedCommitment } from "../../../../baobab/b2b/native-buyer-commitment"
import { type PostgresSpendReservationCommands } from "../../../../baobab/b2b/spend-reservation-commands"
import { getBaobabTradeEnvironment } from "../../../../baobab/config/environment"
import { getBuyerPrincipalResolver } from "../../../../baobab/control-plane/principal-resolution"
import { getEstateBindingResolver } from "../../../../baobab/control-plane/estate-binding"
import { getWorkloadTenantVerifier } from "../../../../baobab/control-plane/workload-tenant-verifier"
import { type BaobabTenantContext } from "../../../../baobab/contracts/tenant-context"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { tradeOrderAuthorityDependencies } from "../../../../baobab/orders/trade-a-runtime"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const CART = /^cart_[A-Za-z0-9_-]{6,128}$/
const KEY = /^[A-Za-z0-9._:-]{16,128}$/
const COUNTRY = /^[A-Z]{2}$/
const FIELDS = new Set([
  "subject_token", "subject_token_type", "requested_organisation_id",
  "requested_country_code", "cart_id", "idempotency_key", "correlation_id",
])
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

/** Trusted Medusa internal registry service, never an HTTP plugin result.
 * The concrete native/cart/policy/charge sources must be installed by the
 * owning engine. Missing issuer, tax, duty, freight, policy or native reader
 * is UNAVAILABLE, not an implicit zero/allow. No simulated fallback.
 */
export const NATIVE_BUYER_COMMIT_RUNTIME = "baobab_native_buyer_commit_runtime"
export type NativeBuyerCommitRuntime = Pick<
  CurrentNativeBuyerAuthorityDependencies, "policies" | "readPurchase"
> & {
  spend: PostgresSpendReservationCommands
  source: NativeMedusaOrderSource
  resolveTenant(request: {
    callerToken: string; subjectToken: string; cartId: string;
    organisationId: string; countryCode: string; correlationId: string
  }): Promise<BaobabTenantContext>
  verifyReplay(tenant: BaobabTenantContext, nativeOrderId: string): Promise<boolean>
}
const send = (res: MedusaResponse, status: number, correlationId: string,
              body: Record<string, unknown>) => {
  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader("X-Correlation-ID", correlationId)
  return res.status(status).json(body)
}
const deny = (res: MedusaResponse, correlation: string, status: 401 | 403 | 409 | 503) =>
  send(res, status, correlation, { code: "BUYER_COMMITMENT_UNAVAILABLE_OR_DENIED",
                                correlation_id: correlation })

function nativeOrderId(secret: string, scope: readonly string[]): string {
  if (!/^[0-9a-f]{64,128}$/i.test(secret)) throw new Error("SERVER_ORDER_ID_KEY_UNAVAILABLE")
  return "order_" + createHmac("sha256", Buffer.from(secret, "hex"))
    .update(JSON.stringify(scope)).digest("hex").slice(0, 48)
}

/** The only consequential store mutation owned by this path.
 * There is no Medusa customer-session fallback or client-provided prices.
 * CurrentNativeBuyerAuthority obtains and rechecks the true IAM/CP operation
 * and seller mandate; the native owner writes Medusa order, spend, seller
 * receipt, buyer receipt and the original outbox in one PostgreSQL XID.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const suppliedCorrelation = req.headers["x-correlation-id"]?.toString()
  const correlation = suppliedCorrelation && UUID.test(suppliedCorrelation)
    ? suppliedCorrelation : randomUUID()
  const env = getBaobabTradeEnvironment()
  if (process.env.BAOBAB_NATIVE_BUYER_COMMIT_ENABLED !== "true" ||
      !["development", "integration"].includes(process.env.BAOBAB_ENVIRONMENT ?? "") ||
      process.env.BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED !== "true" ||
      !env.buyerIdentityEnabled) return deny(res, correlation, 403)

  const b = req.body as Record<string, unknown> | null
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization ?? "")
  if (!bearer || !JWS.test(bearer[1])) return deny(res, correlation, 401)
  if (!b || typeof b !== "object" || Array.isArray(b) ||
      Object.keys(b).length !== FIELDS.size ||
      Object.keys(b).some((key) => !FIELDS.has(key)) ||
      typeof b.subject_token !== "string" || !JWS.test(b.subject_token) ||
      b.subject_token.length > 8192 || b.subject_token_type !== TOKEN_TYPE ||
      typeof b.requested_organisation_id !== "string" ||
      !UUID.test(b.requested_organisation_id) ||
      typeof b.requested_country_code !== "string" ||
      !COUNTRY.test(b.requested_country_code) ||
      typeof b.cart_id !== "string" || !CART.test(b.cart_id) ||
      typeof b.idempotency_key !== "string" || !KEY.test(b.idempotency_key) ||
      req.headers["idempotency-key"] !== b.idempotency_key ||
      b.correlation_id !== correlation ||
      !env.buyerIamIssuer || !env.tradeEngineInstanceId ||
      env.buyerAuthorisedParties.length === 0) return deny(res, correlation, 403)

  try {
    const principalResolver = getBuyerPrincipalResolver()
    const estateResolver = getEstateBindingResolver()
    const tenantVerifier = getWorkloadTenantVerifier()
    if (!principalResolver || !estateResolver || !tenantVerifier ||
        !req.scope.hasRegistration?.(NATIVE_BUYER_COMMIT_RUNTIME)) {
      return deny(res, correlation, 503)
    }
    // The BFF identity and human are independently verified here AND inside
    // CurrentNativeBuyerAuthority. A buyer-context discovery ALLOW is unused.
    const tokenVerifier = new BuyerTokenVerifier({
      issuer: env.buyerIamIssuer, authorisedParties: env.buyerAuthorisedParties,
    })
    const [caller, human] = await Promise.all([
      tokenVerifier.verifyBffCaller(bearer[1]),
      tokenVerifier.verify(b.subject_token),
    ])
    if (caller.clientId !== human.authorisedParty || caller.issuer !== human.issuer)
      return deny(res, correlation, 401)

    const runtime = req.scope.resolve<NativeBuyerCommitRuntime>(NATIVE_BUYER_COMMIT_RUNTIME)
    if (!runtime?.source?.readFinalCart || !runtime?.source?.readFinal ||
        !runtime?.source?.orderInput || !runtime?.spend ||
        !runtime?.policies || !runtime?.readPurchase ||
        !runtime?.verifyReplay || !runtime?.resolveTenant) {
      return deny(res, correlation, 503)
    }
    const seller = tradeOrderAuthorityDependencies(req.scope)
    const request = {
      callerToken: bearer[1],
      subjectToken: b.subject_token,
      requestedOrganisationId: b.requested_organisation_id,
      requestedCountryCode: b.requested_country_code,
      correlationId: correlation,
    }
    const authority = new CurrentNativeBuyerAuthority({
      buyer: {
        tokens: tokenVerifier,
        assurance: env.buyerAssurancePolicyJson !== undefined
          ? loadBuyerAssurancePolicy(env.buyerAssurancePolicyJson, env.buyerIamIssuer)
          : interimAssurancePolicy({
              issuer: env.buyerIamIssuer,
              acceptedAcr: env.buyerAcceptedAcr,
              approvalReference: env.buyerAssuranceApprovalReference,
            }),
        principals: principalResolver,
        estates: estateResolver,
        tenants: tenantVerifier,
        b2b: req.scope.resolve<B2BModuleService>(B2B_MODULE),
        engineInstanceId: env.tradeEngineInstanceId,
      },
      policies: runtime.policies,
      markets: seller.controlPlane,
      tokens: seller.tokens,
      seller,
      readPurchase: runtime.readPurchase,
    }, request)
    const tenant = await runtime.resolveTenant({
      callerToken: bearer[1], subjectToken: b.subject_token,
      cartId: b.cart_id, organisationId: b.requested_organisation_id,
      countryCode: b.requested_country_code, correlationId: correlation,
    })
    if (tenant.lifecycleStatus !== "active" || tenant.entitled !== true ||
        tenant.productId !== env.controlPlaneProductId ||
        tenant.correlationId !== correlation) return deny(res, correlation, 403)

    // Stable native ID is a server-HMAC of the tenant and selected purchase;
    // no browser can assert a native order ID or replay another tenant's order.
    const orderId = nativeOrderId(process.env.BAOBAB_NATIVE_ORDER_ID_HMAC_KEY ?? "", [
      tenant.tenantId, tenant.entityId, b.requested_organisation_id,
      b.requested_country_code, b.cart_id, b.idempotency_key,
    ])
    const result = await commitMedusaNativeBuyerOrder({
      orderModule: req.scope.resolve<IOrderModuleService>(Modules.ORDER),
      spend: runtime.spend,
      source: runtime.source,
      authorizeNow: async (): Promise<AuthorizedCommitment> => {
        const fresh = await authority.authorizeNow()
        if (fresh.context.tenant_id !== tenant.tenantId ||
            fresh.seller.responsible_legal_entity_id !== tenant.entityId ||
            fresh.receipt.resource_id !== b.cart_id) throw new Error("NATIVE_BUYER_TENANT_OR_CART_CHANGED")
        return fresh
      },
      recheckAuthorityNow: (original) => authority.recheckAuthorityNow(original),
    }, {
      nativeOrderId: orderId,
      idempotencyKey: b.idempotency_key,
      correlationId: correlation,
      tenant,
    })
    if (result.outcome === "COMMITTED") {
      return send(res, 201, correlation, {
        outcome: "COMMITTED", order_id: result.orderId, correlation_id: correlation,
      })
    }
    if (result.outcome === "REPLAYED" &&
        await runtime.verifyReplay(tenant, orderId)) {
      return send(res, 200, correlation, {
        outcome: "REPLAYED", order_id: orderId, correlation_id: correlation,
      })
    }
    return deny(res, correlation, result.outcome === "REPLAYED" ? 503 : 409)
  } catch {
    // Native/CP/issuer errors, SQL, security evidence and tokens are private.
    return deny(res, correlation, 503)
  }
}
