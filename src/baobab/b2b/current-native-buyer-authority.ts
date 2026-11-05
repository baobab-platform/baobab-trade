import { randomUUID } from "node:crypto"
import type { ControlPlaneClient } from "../control-plane/client"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import {
  buyerAuthorityReceiptSchema,
  buyerExecutionContextSchema,
} from "../contracts/authority-validation"
import { isCurrentOrderAuthority, isDecisionFor } from "../control-plane/trade-order-authority"
import {
  enforceOrderAuthority,
  type OrderAuthorityEnforcementDependencies,
} from "../orders/order-authority-enforcement"
import {
  resolveNativeConfiguration,
  type NativeCommitmentScope,
} from "../orders/native-configuration-resolver"
import {
  resolveBuyerCommitIdentity,
  type BuyerAuthorityDependencies,
  type BuyerContextRequest,
  type BuyerIdentitySnapshot,
} from "./buyer-authority"
import { evaluateBuyerOperation, type SiteUse } from "./buyer-operation-policy"
import { loadBuyerOperationPolicy, type B2BPolicyStore } from "./buyer-operation-policy-source"
import {
  buildFinalBuyerCommitmentValuation,
  type FinalNativeValuationFacts,
} from "./buyer-commitment-valuation"
import type { AuthorizedCommitment } from "./native-buyer-commitment"
import {
  requireCurrentNativeCommitAuthority,
  type NativeCommitAuthorityReadback,
} from "./native-commit-authority-readback"

/**
 * Trusted native purchase facts, never an HTTP request or a buyer assertion.
 * The native source must read the immutable purchase/version, current hold,
 * governed Sites and complete FINAL_PRICED obligation itself. This port does
 * not declare tax, freight, duty or Incoterms final merely because absent.
 */
export type NativeBuyerPurchase = {
  native: NativeCommitmentScope
  operationReference: string
  marketKey: string
  valuation: FinalNativeValuationFacts
  reservationId: string
  holdRevision: number
  sites: SiteUse[]
  purchaseOrderNumber?: string
  agreementReference?: string
}

export type CurrentNativeBuyerAuthorityDependencies = {
  buyer: BuyerAuthorityDependencies
  policies: B2BPolicyStore
  markets: Pick<ControlPlaneClient, "getMarket">
  tokens: WorkloadTokenProvider
  seller: OrderAuthorityEnforcementDependencies
  /** Always re-read. The caller owns the native pricing/purchase source. */
  readPurchase(identity: BuyerIdentitySnapshot): Promise<NativeBuyerPurchase>
  now?: () => number
}

const refuse = (): never => {
  // Never expose raw IAM/CP, database, token or customer-address errors.
  throw new Error("CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN")
}

/**
 * CAA-06b live composition of EXISTING authority clients and policy sources.
 * There is no alternate IAM, CP permission model or messaging framework.
 * Construct one instance per server request; no token/context/purchase cache.
 * The native owner calls recheckAuthorityNow under the existing spend lock.
 * Application routes remain unwired pending genuine native-source/runtime proof.
 */
export class CurrentNativeBuyerAuthority {
  constructor(
    private readonly deps: CurrentNativeBuyerAuthorityDependencies,
    private readonly request: BuyerContextRequest,
  ) {}

  private async currentPurchase() {
    const startedAt = (this.deps.now ?? Date.now)()
    const result = await resolveBuyerCommitIdentity(this.deps.buyer, this.request)
    if (result.outcome !== "RESOLVED") return refuse()
    const context = result.identity
    const country = this.request.requestedCountryCode
    if (!country) return refuse()
    const purchase = await this.deps.readPurchase(context)
    const valuation = buildFinalBuyerCommitmentValuation(purchase.valuation, new Date(startedAt))
    if (!context.market_id) return refuse()
    const market = await this.deps.markets.getMarket(
      context.market_id,
      await this.deps.tokens.getAccessToken(),
      this.request.correlationId,
    )
    const policy = await loadBuyerOperationPolicy(this.deps.policies, {
      organisationId: context.buyer_organisation_id,
      membershipId: context.buyer_membership_id,
      marketKey: purchase.marketKey,
      siteIds: [...new Set(purchase.sites.map((site) => site.siteId))],
      reservationId: purchase.reservationId,
      now: new Date((this.deps.now ?? Date.now)()),
    })
    const now = (this.deps.now ?? Date.now)()
    const expiresAt = Math.min(
      Date.parse(context.expires_at),
      startedAt + 30_000,
      ...(policy.reservation && policy.reservation !== "UNAVAILABLE"
        ? [policy.reservation.expiresAt.getTime()]
        : []),
      ...(market.effective_to ? [Date.parse(market.effective_to)] : []),
    )
    if (
      !Number.isFinite(now) ||
      now < startedAt ||
      !Number.isFinite(expiresAt) ||
      now >= expiresAt ||
      market.market_id !== context.market_id ||
      market.owner_tenant_id !== context.tenant_id ||
      market.status !== "ACTIVE" ||
      !Number.isSafeInteger(market.revision) ||
      market.revision < 1 ||
      !(Date.parse(market.effective_from) <= now) ||
      market.canonical_key !== purchase.marketKey ||
      !(market.countries ?? []).includes(country) ||
      !(market.allowed_currencies ?? []).includes(valuation.currency) ||
      purchase.native.currency !== valuation.currency ||
      !policy.reservation ||
      policy.reservation === "UNAVAILABLE" ||
      policy.reservation.status !== "ACTIVE" ||
      policy.reservation.reservationId !== purchase.reservationId ||
      policy.reservation.tenantId !== context.tenant_id ||
      policy.reservation.purchaseReference !== valuation.resource_id ||
      policy.reservation.holdRevision !== purchase.holdRevision ||
      policy.reservation.amountMinor !== BigInt(valuation.buyer_commitment_amount_minor) ||
      !purchase.reservationId ||
      !Number.isSafeInteger(purchase.holdRevision) ||
      purchase.holdRevision < 1
    )
      return refuse()
    // The CP runtime context proves current buyer participation; the fresh
    // canonical Market read supplies its key, lifecycle, currency and revision.
    // A local market breadcrumb can never set marketAuthority=ATTESTED.
    const decision = evaluateBuyerOperation({
      ...policy,
      operation: "trade.order.commit",
      now: new Date(now),
      principalId: context.actor_principal_id,
      organisationId: context.buyer_organisation_id,
      membershipId: context.buyer_membership_id,
      membership: {
        status: "ACTIVE",
        effectiveFrom: new Date(context.evaluated_at),
        effectiveUntil: new Date(expiresAt),
      },
      marketKey: market.canonical_key,
      marketAuthority: "ATTESTED",
      sites: purchase.sites,
      transaction: {
        amountMinor: BigInt(valuation.buyer_commitment_amount_minor),
        currencyCode: valuation.currency,
        transactionDigest: valuation.transaction_digest,
        resourceVersion: String(valuation.resource_version),
        agreementReference: purchase.agreementReference,
      },
      purchaseOrder:
        policy.purchaseOrderRule === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : {
              rule: policy.purchaseOrderRule,
              number: purchase.purchaseOrderNumber,
            },
      // No approval supplied by the caller is trusted. The existing evaluator
      // refuses purchases needing an approval until live approver re-evaluation
      // is connected; a missing approval is never a threshold exemption.
    })
    if (decision.outcome !== "ALLOW") return refuse()
    return {
      context,
      purchase,
      valuation,
      now,
      expiresAt,
      marketRevision: market.revision,
      marketId: market.market_id,
    }
  }

  /** Obtain an operation-specific buyer ALLOW before asking the seller PEP. */
  async authorizeNow(): Promise<AuthorizedCommitment> {
    try {
      const { context, purchase, valuation, expiresAt, marketId } = await this.currentPurchase()
      const seller = await enforceOrderAuthority(
        "trade.order.commit",
        { type: "cart", id: valuation.resource_id },
        purchase.native,
        purchase.operationReference,
        this.deps.seller,
      )
      const now = (this.deps.now ?? Date.now)()
      const until = Math.min(expiresAt, Date.parse(seller.lease_expires_at))
      if (
        !Number.isFinite(now) ||
        now < Date.parse(context.evaluated_at) ||
        !Number.isFinite(until) ||
        now >= until ||
        seller.tenant_id !== context.tenant_id ||
        seller.market !== this.request.requestedCountryCode ||
        seller.currency !== valuation.currency
      )
        return refuse()
      const evaluatedAt = new Date(now).toISOString()
      const expires = new Date(until).toISOString()
      const authorized: AuthorizedCommitment = {
        context: {
          ...context,
          market_id: marketId,
          decision: { outcome: "ALLOW", reasons: [] },
          resource_id: valuation.resource_id,
          resource_version: valuation.resource_version,
          transaction_digest: valuation.transaction_digest,
          amount_minor: valuation.buyer_commitment_amount_minor,
          currency: valuation.currency,
          valuation_digest: valuation.valuation_digest,
          seller_legal_entity_id: seller.responsible_legal_entity_id,
          seller_binding_reference: {
            binding_id: seller.binding_id,
            binding_version: seller.binding_version,
          },
          evaluated_at: evaluatedAt,
          expires_at: expires,
        },
        seller,
        valuation,
        operationDecision: {
          outcome: "ALLOW",
          decisionId: context.decision_id,
          operation: "trade.order.commit",
          principalId: context.actor_principal_id,
          transactionDigest: valuation.transaction_digest,
          amountMinor: valuation.buyer_commitment_amount_minor,
          resourceVersion: valuation.resource_version,
          evaluatedAt,
          expiresAt: expires,
        },
        receipt: {
          receipt_id: randomUUID(),
          correlation_id: context.correlation_id,
          context_id: context.context_id,
          decision_id: context.decision_id,
          operation: "trade.order.commit",
          operation_reference: purchase.operationReference,
          actor_principal_id: context.actor_principal_id,
          tenant_id: context.tenant_id,
          canonical_organisation_id: context.canonical_organisation_id,
          buyer_organisation_id: context.buyer_organisation_id,
          buyer_membership_id: context.buyer_membership_id,
          membership_revision: context.membership_revision,
          market_id: marketId,
          resource_id: valuation.resource_id,
          resource_version: valuation.resource_version,
          transaction_digest: valuation.transaction_digest,
          amount_minor: valuation.buyer_commitment_amount_minor,
          currency: valuation.currency,
          valuation_digest: valuation.valuation_digest,
          policy_revision: context.policy_revision,
          approval_references: [],
          spend_reservation_id: purchase.reservationId,
          spend_hold_revision: purchase.holdRevision,
          seller_legal_entity_id: seller.responsible_legal_entity_id,
          seller_binding_reference: {
            binding_id: seller.binding_id,
            binding_version: seller.binding_version,
          },
          evaluated_at: evaluatedAt,
          expires_at: expires,
          evidence_references: [
            ...context.evidence_references,
            `cp-order-authority:${seller.decision_id}`,
          ],
        },
      }
      if (
        !buyerAuthorityReceiptSchema(authorized.receipt) ||
        !buyerExecutionContextSchema(authorized.context)
      )
        return refuse()
      return authorized
    } catch {
      return refuse()
    }
  }

  /**
   * Fresh online buyer + native policy + CP seller decision under the spend
   * lock. Do NOT record a second live seller receipt: the TA-07 native fence
   * must consume the single original receipt, without ambiguous candidates.
   */
  async recheckAuthorityNow(
    original: AuthorizedCommitment,
  ): Promise<NativeCommitAuthorityReadback> {
    try {
      const current = await this.currentPurchase()
      const seller = original.seller
      const configured = await resolveNativeConfiguration(
        current.purchase.native,
        this.deps.seller.engineInstanceId,
        this.deps.seller.attested,
        this.deps.seller.facts,
      )
      if (
        configured.digest !== seller.native_configuration_digest ||
        configured.tenantId !== seller.tenant_id ||
        configured.organisationId !== seller.operating_organisation_id ||
        configured.market !== seller.market ||
        configured.currency !== seller.currency ||
        current.purchase.operationReference !== seller.operation_reference
      )
        return refuse()
      const request = {
        context_id: seller.context_id,
        engine_instance_id: this.deps.seller.engineInstanceId,
        operation_class: "trade.order.commit" as const,
        seller_operating_binding_reference: {
          binding_id: seller.binding_id,
          binding_version: seller.binding_version,
        },
        native_configuration_digest: configured.digest,
        currency: configured.currency,
        operation_reference: current.purchase.operationReference,
      }
      const { decision, receivedAt } = await this.deps.seller.authority.resolveOrderAuthority(
        request,
        await this.deps.seller.tokens.getAccessToken(),
        this.request.correlationId,
      )
      const now = (this.deps.now ?? Date.now)()
      const until = Math.min(current.expiresAt, Date.parse(decision.expires_at ?? ""))
      if (
        !isDecisionFor(decision, request) ||
        !isCurrentOrderAuthority(decision, receivedAt, now) ||
        !Number.isFinite(until) ||
        now < current.now ||
        now >= until ||
        decision.tenant_id !== seller.tenant_id ||
        decision.operating_organisation_id !== seller.operating_organisation_id ||
        decision.market !== seller.market ||
        decision.legal_actor_role !== "SELLER_OF_RECORD" ||
        decision.mandate_id !== seller.mandate_id ||
        decision.responsible_legal_entity_id !== seller.responsible_legal_entity_id
      )
        return refuse()
      const { context: c, purchase: p, valuation: v } = current
      const readback: NativeCommitAuthorityReadback = {
        outcome: "ALLOW",
        actorStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        sellerMandateStatus: "ACTIVE",
        tenantId: c.tenant_id,
        principalId: c.actor_principal_id,
        canonicalOrganisationId: c.canonical_organisation_id,
        buyerOrganisationId: c.buyer_organisation_id,
        membershipId: c.buyer_membership_id,
        membershipRevision: c.membership_revision,
        marketId: current.marketId,
        operation: "trade.order.commit",
        resourceId: v.resource_id,
        resourceVersion: v.resource_version,
        transactionDigest: v.transaction_digest,
        amountMinor: v.buyer_commitment_amount_minor,
        currency: v.currency,
        spendReservationId: p.reservationId,
        spendHoldRevision: p.holdRevision,
        sellerBindingId: seller.binding_id,
        sellerBindingVersion: seller.binding_version,
        sellerMandateId: seller.mandate_id,
        sellerLegalEntityId: seller.responsible_legal_entity_id,
        checkedAt: new Date(now).toISOString(),
        expiresAt: new Date(until).toISOString(),
        evidenceReferences: [
          `cp-principal-resolution:${c.external_identity_id}`,
          `cp-context:${c.cp_context_id}`,
          `cp-order-authority:${decision.decision_id}`,
          `cp-market:${c.market_id}@r${current.marketRevision}`,
          `trade-buyer-operation:${c.decision_id}`,
        ],
      }
      requireCurrentNativeCommitAuthority(original, readback, now)
      return readback
    } catch {
      return refuse()
    }
  }
}
