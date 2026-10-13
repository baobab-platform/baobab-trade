import type { BindingActivation } from "./authenticated-binding-intake"
import { BINDING_ACTIVITY, BINDING_CAPABILITY } from "./authenticated-binding-intake"
import { assertBindingAdmission } from "./binding-authority-client"
import { assertCurrentSellerMarketContext } from "./seller-market-context"
import { assertFreshSellerFact } from "./governed-legal-seller"

/** The CP context/assessment must be read directly by the trusted server, not
 * supplied by an activation request. Local approval is never legal authority. */
export function assertBindingActivation(p: BindingActivation, now: number): void {
  if (
    !p ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    p.actor.subject !== p.admission?.principal_id ||
    p.actor.issuer !== p.admission.issuer ||
    p.actor.tokenId !== p.admission.token_id ||
    p.actor.tenantId !== p.scope.tenantId ||
    p.actor.organisationId !== p.scope.organisationId ||
    p.actor.audience !== "baobab-control-plane" ||
    !Array.isArray(p.actor.scopes) ||
    !p.actor.scopes.every((scope) => typeof scope === "string") ||
    !p.actor.scopes.includes("trade-binding:activate")
  )
    throw new Error("Invalid binding activation actor")
  assertBindingAdmission(p.admission, "activate", p.scope, p.admission.command_digest, now)
  assertCurrentSellerMarketContext(p.context, p.scope, now)
  if (!p.context.expires_at || Date.parse(p.context.expires_at) <= now || !p.context.market_id)
    throw new Error("Bounded CP binding context required")
  assertFreshSellerFact(
    p.legalDecision,
    {
      legalContextId: p.context.context_id,
      legalSellerKey: p.scope.responsibleLegalEntityId,
      legalActivity: BINDING_ACTIVITY,
      legalCapability: BINDING_CAPABILITY,
      marketCode: p.scope.marketCode,
      marketKey: p.context.market_id,
      orderReference: `cart/${p.scope.cartId}/complete`,
      organisationId: p.scope.organisationId,
      currencyCode: p.scope.currencyCode,
      totalMinor: 0,
      idempotencyKey: `native-checkout/${p.scope.cartId}`,
      correlationId: p.admission.decision_id,
    },
    now,
  )
}
