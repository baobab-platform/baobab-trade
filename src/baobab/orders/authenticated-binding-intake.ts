import type {
  BindingAuthorityClient,
  BindingAdmission,
  BindingOperation,
} from "./binding-authority-client"
import { assertBindingAdmission, bindingCommandDigest } from "./binding-authority-client"
import {
  parseBindingTimestamp,
  type BindingProposal,
  type GovernedBindingScope,
} from "./governed-binding-command-policy"
import type { VerifiedActor, VerifiedEvidence } from "./governed-binding-service"
import type { PostgresGovernedBindingPersistence } from "./postgres-governed-binding-persistence"
import {
  isValidPlatformContextResolutionResponse,
  type RawPlatformContextResolutionResponse,
} from "../contracts/platform-context"
import type { LegalActorDecision } from "../control-plane/legal-actor-assessment"
import { assertCurrentSellerMarketContext } from "./seller-market-context"
import { assertFreshSellerFact } from "./governed-legal-seller"

export const BINDING_ACTIVITY = "B2B_COFFEE_SALE"
export const BINDING_CAPABILITY = "commerce.order.create"
export type BindingActivation = {
  scope: GovernedBindingScope
  revision: number
  actor: VerifiedActor
  admission: BindingAdmission
  context: RawPlatformContextResolutionResponse
  legalDecision: LegalActorDecision
}
export type NativeBindingCoordinates = {
  salesChannelId: string
  regionId: string
  currencyCode: string
  completed: boolean
}
export type BindingIntakeInput = {
  tenantId?: string
  organisationId?: string
  responsibleLegalEntityId?: string
  marketCode?: string
  expiresAt?: string
  revision?: number
  reason?: string
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return deny()
  return value
}
function deny(): never {
  throw new Error("Authenticated binding intake denied")
}
const actorOf = (a: BindingAdmission): VerifiedActor => ({
  subject: a.principal_id,
  issuer: a.issuer,
  tokenId: a.token_id,
  tenantId: a.scope.tenantId,
  organisationId: a.scope.organisationId,
  audience: "baobab-control-plane",
  scopes: [a.scope_name],
})
const evidenceOf = (a: BindingAdmission): VerifiedEvidence => ({
  reference: `cp/trade-binding/${a.decision_id}`,
  decisionId: a.decision_id,
  verifiedAt: a.evaluated_at,
  admission: a,
})

/** Intake accepts intent, never a maker/checker/context/CP response. Stored
 * history, native cart coordinates and actual CP identities determine facts. */
export class AuthenticatedBindingIntake {
  constructor(
    private readonly cp: BindingAuthorityClient,
    private readonly persistence: PostgresGovernedBindingPersistence,
    private readonly native: (cartId: string) => Promise<NativeBindingCoordinates>,
    private readonly workloadToken: () => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}
  private async currentNative(scope: GovernedBindingScope): Promise<void> {
    const c = await this.native(scope.cartId)
    if (
      c.completed ||
      c.salesChannelId !== scope.salesChannelId ||
      c.regionId !== scope.regionId ||
      c.currencyCode !== scope.currencyCode
    )
      deny()
  }
  private assertLegal(
    scope: GovernedBindingScope,
    context: RawPlatformContextResolutionResponse,
    legalDecision: LegalActorDecision,
  ): void {
    if (!isValidPlatformContextResolutionResponse(context)) deny()
    assertCurrentSellerMarketContext(context, scope, this.now())
    if (!context.expires_at || Date.parse(context.expires_at) <= this.now() || !context.market_id)
      deny()
    assertFreshSellerFact(
      legalDecision,
      {
        ...scope,
        legalContextId: context.context_id,
        legalSellerKey: scope.responsibleLegalEntityId,
        legalActivity: BINDING_ACTIVITY,
        legalCapability: BINDING_CAPABILITY,
        marketKey: context.market_id,
        orderReference: `cart/${scope.cartId}/complete`,
        correlationId: crypto.randomUUID(),
        idempotencyKey: `native-checkout/${scope.cartId}`,
        totalMinor: 0,
      },
      this.now(),
    )
  }
  private async legal(scope: GovernedBindingScope) {
    const token = await this.workloadToken()
    const context = await this.cp.resolve(scope, token)
    if (!isValidPlatformContextResolutionResponse(context)) deny()
    assertCurrentSellerMarketContext(context, scope, this.now())
    // CP assessment itself redeems ownership, purpose and current lifecycle.
    if (!context.expires_at || Date.parse(context.expires_at) <= this.now() || !context.market_id)
      deny()
    const request = {
      context_id: context.context_id,
      role: "SELLER_OF_RECORD" as const,
      activity: BINDING_ACTIVITY,
      market: scope.marketCode,
      capability: BINDING_CAPABILITY,
      operation_reference: `cart/${scope.cartId}/complete`,
    }
    const legalDecision = await this.cp.assess(request, token)
    this.assertLegal(scope, context, legalDecision)
    return { context, legalDecision }
  }
  async execute(
    operation: BindingOperation,
    cartId: string,
    input: unknown,
    token: string,
  ): Promise<void> {
    if (
      !cartId ||
      cartId.length > 255 ||
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    )
      deny()
    const body = input as BindingIntakeInput
    const keys =
      operation === "propose"
        ? ["tenantId", "organisationId", "responsibleLegalEntityId", "marketCode", "expiresAt"]
        : operation === "revoke"
          ? ["revision", "reason"]
          : ["revision"]
    if (Object.keys(body).length !== keys.length || !keys.every((k) => Object.hasOwn(body, k)))
      deny()
    let scope: GovernedBindingScope
    let proposal: BindingProposal | undefined
    let revision = -1
    let approvedBy: string | undefined
    if (operation === "propose") {
      if (
        ![body.tenantId, body.organisationId, body.responsibleLegalEntityId, body.marketCode].every(
          (v) => typeof v === "string" && v.trim(),
        )
      )
        deny()
      const expires = parseBindingTimestamp(body.expiresAt)
      if (
        !Number.isFinite(expires) ||
        expires <= this.now() ||
        expires > this.now() + 15 * 60 * 1000
      )
        deny()
      const c = await this.native(cartId)
      if (c.completed) deny()
      scope = {
        cartId,
        tenantId: requiredString(body.tenantId),
        organisationId: requiredString(body.organisationId),
        responsibleLegalEntityId: requiredString(body.responsibleLegalEntityId),
        marketCode: requiredString(body.marketCode),
        currencyCode: c.currencyCode,
        salesChannelId: c.salesChannelId,
        regionId: c.regionId,
      }
    } else {
      const stored = await this.persistence.load(cartId)
      if (!stored || !Number.isSafeInteger(body.revision) || body.revision !== stored.revision)
        deny()
      scope = stored.proposal.scope
      proposal = stored.proposal
      revision = stored.revision
      approvedBy = stored.approvedBy
      if (operation === "approve" && (stored.status !== "PROPOSED" || approvedBy)) deny()
      if (operation === "activate" && (stored.status !== "PROPOSED" || !approvedBy)) deny()
      if (
        operation === "revoke" &&
        (!["PROPOSED", "ACTIVE"].includes(stored.status) ||
          typeof body.reason !== "string" ||
          !body.reason.trim() ||
          body.reason.length > 1000)
      )
        deny()
    }
    const digest = bindingCommandDigest({
      operation,
      scope,
      input: body,
      revision,
      proposal: proposal ?? null,
    })
    const first = await this.cp.authorize(token, operation, scope, digest)
    assertBindingAdmission(first, operation, scope, digest, this.now())
    const actor = actorOf(first)
    if (
      (operation === "approve" && actor.subject === proposal?.maker.subject) ||
      (operation === "activate" && [proposal?.maker.subject, approvedBy].includes(actor.subject))
    )
      deny()
    let proof: Awaited<ReturnType<AuthenticatedBindingIntake["legal"]>> | undefined
    // Withdrawal remains possible after legal/context/tenant expiry. It needs
    // current independent command authority, never the revoked original mandate.
    if (operation !== "revoke") {
      await this.currentNative(scope)
      proof = await this.legal(scope)
    }
    const final = await this.cp.authorize(token, operation, scope, digest)
    assertBindingAdmission(final, operation, scope, digest, this.now())
    if (
      final.principal_id !== first.principal_id ||
      final.issuer !== first.issuer ||
      final.token_id !== first.token_id
    )
      deny()
    if (operation !== "revoke") await this.currentNative(scope)
    assertBindingAdmission(final, operation, scope, digest, this.now())
    if (proof) this.assertLegal(scope, proof.context, proof.legalDecision)
    const evidence = { ...evidenceOf(final), expectedRevision: revision }
    if (operation === "propose")
      await this.persistence.propose(
        {
          scope,
          maker: actor,
          proposedAt: new Date(this.now()).toISOString(),
          expiresAt: requiredString(body.expiresAt),
          evidenceReference: evidence.reference,
        },
        evidence,
      )
    else if (operation === "approve") {
      if (!proposal) deny()
      await this.persistence.approve(
        {
          proposal,
          checker: actor,
          approvedAt: new Date(this.now()).toISOString(),
          approvalReference: evidence.reference,
        },
        evidence,
      )
    } else if (operation === "revoke")
      await this.persistence.revoke(scope, actor, requiredString(body.reason), evidence)
    else {
      if (!proof) deny()
      await this.persistence.activate({ scope, revision, actor, admission: final, ...proof })
    }
  }
}
