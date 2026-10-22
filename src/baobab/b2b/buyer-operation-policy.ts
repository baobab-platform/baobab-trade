import type { BuyerOperation } from "../auth/buyer-assurance"
import type { DecisionOutcome, DecisionReason } from "./buyer-authority"
import { B2B_ROLES, type B2BRole } from "./types"

/**
 * ADR-SHARED-042 CAA-05 operation policy (Platform Owner ruling of
 * 2026-10-22, ADR-SHARED-042 section 14; Trade ADR-0033).
 *
 * The evaluator decides one buyer operation from facts the server loaded
 * itself. It is pure: no I/O, no clock of its own, no defaults. Roles are
 * necessary, never sufficient; the absence of a limit, grant or policy is
 * never permission. It returns the first refusal it finds, in a fixed order,
 * using only the closed trade/v2 decision reasons.
 *
 * Its ALLOW is one input among several: assurance (buyer-assurance.ts), the
 * buyer context (buyer-authority.ts), the seller decision (ADR-SHARED-039)
 * and a native fence (CAA-06) are each still required. Nothing here
 * activates an operation.
 */
export const BUYER_OPERATION_POLICY_REVISION = "trade.buyer-operation-policy:v1"

const ALL_ROLES: readonly B2BRole[] = B2B_ROLES
const PURCHASING: readonly B2BRole[] = [
  "BUYER",
  "SENIOR_BUYER",
  "PROCUREMENT_MANAGER",
  "ACCOUNT_ADMIN",
]
const APPROVING: readonly B2BRole[] = ["APPROVER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"]

type OperationRule = {
  /** Roles of which the SAME assignment must also hold the Market and Site grants. */
  roles: readonly B2BRole[]
  market: boolean
  /** REQUIRED: the operation must name at least one delivery Site. */
  site: "NONE" | "IF_REFERENCED" | "REQUIRED"
  kind: "READ" | "CHANGE" | "COMMITMENT" | "APPROVAL" | "GOVERNED"
}

/**
 * The exhaustive, versioned operation -> role mapping. A new Shared operation
 * fails to compile until it is given a rule here.
 *
 * GOVERNED operations are evaluated for role only and then refused with
 * OPERATION_NOT_ACTIVATED: invitation acceptance needs its own single-use
 * recipient evaluator, and member management its governed administrative
 * scope, neither of which this revision implements.
 */
export const BUYER_OPERATION_RULES = {
  "trade.buyer-context.resolve": { roles: ALL_ROLES, market: false, site: "NONE", kind: "READ" },
  "trade.private-catalogue.view": {
    roles: ALL_ROLES,
    market: true,
    site: "IF_REFERENCED",
    kind: "READ",
  },
  "trade.contract-price.view": {
    roles: ALL_ROLES,
    market: true,
    site: "IF_REFERENCED",
    kind: "READ",
  },
  "trade.rfq.submit": { roles: PURCHASING, market: true, site: "IF_REFERENCED", kind: "CHANGE" },
  "trade.cart.modify": { roles: PURCHASING, market: true, site: "IF_REFERENCED", kind: "CHANGE" },
  "trade.quotation.accept": {
    roles: PURCHASING,
    market: true,
    site: "IF_REFERENCED",
    kind: "COMMITMENT",
  },
  "trade.order.commit": { roles: PURCHASING, market: true, site: "REQUIRED", kind: "COMMITMENT" },
  "trade.draft-order.finalize": {
    roles: PURCHASING,
    market: true,
    site: "REQUIRED",
    kind: "COMMITMENT",
  },
  "trade.purchase-approval.decide": {
    roles: APPROVING,
    market: true,
    site: "IF_REFERENCED",
    kind: "APPROVAL",
  },
  "trade.buyer-member.manage": {
    roles: ["ACCOUNT_ADMIN"],
    market: false,
    site: "NONE",
    kind: "GOVERNED",
  },
  "trade.buyer-invitation.accept": { roles: [], market: false, site: "NONE", kind: "GOVERNED" },
} as const satisfies Record<BuyerOperation, OperationRule>

export type GrantStatus = "ACTIVE" | "SUSPENDED" | "REVOKED"

/** One Market or Site grant of one role assignment. */
export type ScopeGrant = {
  key: string
  status: GrantStatus
  effectiveFrom: Date | null
  effectiveUntil: Date | null
}

export type RoleAssignment = {
  roleId: string
  /** As stored. A value outside the vocabulary never grants anything. */
  role: string
  markets: ScopeGrant[]
  sites: ScopeGrant[]
}

export type SiteUse = { siteId: string; use: "SHIPPING" | "BILLING" }

export type SiteRecord = {
  id: string
  organisationId: string
  marketKey: string
  status: "ACTIVE" | "SUSPENDED" | "CLOSED"
  allowShipping: boolean
  allowBilling: boolean
}

export type Transaction = {
  amountMinor: bigint
  currencyCode: string
  transactionDigest: string
  resourceVersion: string
}

/** The membership's SpendLimit rows: order limits for commitments, approval limits for approvers. */
export type SpendAuthority = {
  marketKey: string | null
  currencyCode: string
  orderLimitMinor: bigint | null
  approvalLimitMinor: bigint | null
  effectiveFrom: Date | null
  effectiveUntil: Date | null
}

export type ApprovalPolicyRecord = {
  marketKey: string | null
  currencyCode: string
  thresholdMinor: bigint | null
  enabled: boolean
}

export type PurchaseOrderRule = { required: boolean; formatPattern: string | null }

/** A purchase approval with its section 8 binding facts. */
export type BoundApproval = {
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  organisationId: string
  initiatorPrincipalId: string | null
  approverPrincipalId: string | null
  marketKey: string | null
  amountMinor: bigint
  currencyCode: string
  transactionDigest: string | null
  resourceVersion: string | null
  policyRevision: string | null
}

type Source<T> = T | "UNAVAILABLE"

export type BuyerOperationFacts = {
  operation: BuyerOperation
  now: Date
  /** The canonical human Principal from CP resolution (buyer-authority.ts). */
  principalId: string
  /** The selected, CP-attested Trade buyer Organisation. */
  organisationId: string
  membership: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null }
  roles: Source<RoleAssignment[]>
  /** Trade's market_key of the operation; mapping to a canonical CP Market is governed separately. */
  marketKey?: string
  /**
   * CP's current answer to whether this Market is active and permitted for the
   * seller-side Tenant and this buyer relationship. Trade has no such source
   * yet, so callers supply UNAVAILABLE and market-scoped operations cannot
   * ALLOW.
   */
  marketAuthority: "ATTESTED" | "DENIED" | "UNAVAILABLE"
  sites: SiteUse[]
  /** The referenced Sites as loaded, by id, from this Organisation only. */
  siteRecords: Source<SiteRecord[]>
  transaction?: Transaction
  spendAuthorities: Source<SpendAuthority[]>
  approvalPolicies: Source<ApprovalPolicyRecord[]>
  purchaseOrder: Source<{ rule: PurchaseOrderRule | null; number?: string }>
  /** For a commitment: the approval it relies on. For an approval decision: the approval decided. */
  approval?: BoundApproval
  /**
   * For a commitment relying on an approval: the approver's current
   * re-evaluation of trade.purchase-approval.decide for this transaction, so
   * an approval whose authority has since lapsed no longer applies.
   */
  approverReevaluation?: BuyerOperationDecision
}

export type BuyerOperationDecision = { outcome: DecisionOutcome; reasons: DecisionReason[] }

const allow = (): BuyerOperationDecision => ({ outcome: "ALLOW", reasons: [] })
const refuse = (outcome: Exclude<DecisionOutcome, "ALLOW">, ...reasons: DecisionReason[]) => ({
  outcome,
  reasons,
})
const deny = (reason: DecisionReason) => refuse("DENY", reason)
const unavailable = () => refuse("UNAVAILABLE", "SOURCE_UNAVAILABLE")

const inEffect = (now: Date, from: Date | null, until: Date | null) =>
  (from === null || from <= now) && (until === null || now < until)

const activeGrant = (grants: ScopeGrant[], key: string, now: Date) =>
  grants.some(
    (g) =>
      g.key === key && g.status === "ACTIVE" && inEffect(now, g.effectiveFrom, g.effectiveUntil),
  )

const isRole = (value: string): value is B2BRole => (B2B_ROLES as readonly string[]).includes(value)

/** Exactly one record applies, or none; two is ambiguous and never resolved by picking one. */
const single = <T>(records: T[]): T | "NONE" | "AMBIGUOUS" =>
  records.length === 0 ? "NONE" : records.length === 1 ? records[0] : "AMBIGUOUS"

const PO_NUMBER = /^[\x21-\x7e](?:[\x20-\x7e]{0,62}[\x21-\x7e])?$/

export function evaluateBuyerOperation(facts: BuyerOperationFacts): BuyerOperationDecision {
  const rule: OperationRule | undefined = (BUYER_OPERATION_RULES as Record<string, OperationRule>)[
    facts.operation
  ]
  if (!rule) return deny("ROLE_NOT_PERMITTED")
  const { now } = facts
  // Invitation acceptance precedes membership: it belongs to the single-use
  // recipient evaluator this revision does not implement.
  if (facts.operation === "trade.buyer-invitation.accept") return deny("OPERATION_NOT_ACTIVATED")

  // 1. The membership itself. A failure here is never more specific than
  //    BUYER_NOT_AUTHORISED (section 6).
  if (
    facts.membership.status !== "ACTIVE" ||
    !inEffect(now, facts.membership.effectiveFrom, facts.membership.effectiveUntil)
  ) {
    return deny("BUYER_NOT_AUTHORISED")
  }

  // 2. Roles: the operation's permitted roles actually held. Unknown values grant nothing.
  if (facts.roles === "UNAVAILABLE") return unavailable()
  const permitted = facts.roles.filter((r) => isRole(r.role) && rule.roles.includes(r.role))
  if (permitted.length === 0) return deny("ROLE_NOT_PERMITTED")
  if (rule.kind === "GOVERNED") return deny("OPERATION_NOT_ACTIVATED")

  // 3. Market: present, and CP's current authority for it.
  if (rule.market) {
    if (!facts.marketKey) return deny("CONTEXT_NOT_USABLE")
    if (facts.marketAuthority === "UNAVAILABLE") return unavailable()
    if (facts.marketAuthority !== "ATTESTED") return deny("MARKET_NOT_PERMITTED")
  }

  // 4. Sites: each referenced Site belongs to this Organisation, is ACTIVE, is
  //    in the operation's Market and supports its use.
  if (rule.site === "NONE" && facts.sites.length > 0) return deny("CONTEXT_NOT_USABLE")
  if (rule.site === "REQUIRED" && !facts.sites.some((s) => s.use === "SHIPPING"))
    return deny("CONTEXT_NOT_USABLE")
  if (facts.sites.length > 0) {
    if (facts.siteRecords === "UNAVAILABLE") return unavailable()
    for (const use of facts.sites) {
      const site = facts.siteRecords.find((s) => s.id === use.siteId)
      if (!site || site.organisationId !== facts.organisationId) return deny("BUYER_NOT_AUTHORISED")
      const usable = use.use === "SHIPPING" ? site.allowShipping : site.allowBilling
      if (site.status !== "ACTIVE" || site.marketKey !== facts.marketKey || !usable)
        return deny("SITE_NOT_PERMITTED")
    }
  }

  // 5. Role-bound scope: ONE permitted assignment must hold the Market grant
  //    and every Site grant itself; permissions never compose across roles.
  const marketKey = facts.marketKey
  const withMarket = rule.market
    ? permitted.filter((r) => marketKey !== undefined && activeGrant(r.markets, marketKey, now))
    : permitted
  if (withMarket.length === 0) return deny("MARKET_NOT_PERMITTED")
  const scoped = withMarket.filter((r) =>
    facts.sites.every((s) => activeGrant(r.sites, s.siteId, now)),
  )
  if (scoped.length === 0) return deny("SITE_NOT_PERMITTED")

  if (rule.kind === "COMMITMENT") return evaluateCommitment(facts)
  if (rule.kind === "APPROVAL") return evaluateApprovalDecision(facts)
  return allow()
}

function evaluateCommitment(facts: BuyerOperationFacts): BuyerOperationDecision {
  const tx = facts.transaction
  const marketKey = facts.marketKey
  if (!tx || tx.amountMinor <= 0n || !marketKey) return deny("CONTEXT_NOT_USABLE")

  // Purchase-order requirement: a restriction, so its absence requires nothing.
  if (facts.purchaseOrder === "UNAVAILABLE") return unavailable()
  const po = facts.purchaseOrder.rule
  if (po?.required) {
    const number = facts.purchaseOrder.number
    if (!number || !PO_NUMBER.test(number)) return deny("PURCHASE_ORDER_REQUIRED")
    if (po.formatPattern !== null) {
      let pattern: RegExp
      try {
        pattern = new RegExp(`^(?:${po.formatPattern})$`, "u")
      } catch {
        return deny("CONTEXT_NOT_USABLE")
      }
      if (!pattern.test(number)) return deny("PURCHASE_ORDER_REQUIRED")
    }
  }

  // Spend authority: exactly one in-effect limit for this Market and
  // currency, with an explicit positive order limit. Absent is never unlimited.
  if (facts.spendAuthorities === "UNAVAILABLE") return unavailable()
  const limit = single(
    facts.spendAuthorities.filter(
      (s) =>
        s.marketKey === facts.marketKey &&
        s.currencyCode === tx.currencyCode &&
        inEffect(facts.now, s.effectiveFrom, s.effectiveUntil),
    ),
  )
  if (limit === "AMBIGUOUS") return deny("CONTEXT_NOT_USABLE")
  if (limit === "NONE" || limit.orderLimitMinor === null || limit.orderLimitMinor <= 0n) {
    return deny("SPEND_POLICY_NOT_CONFIGURED")
  }

  // Escalation exists only under an explicit, enabled approval policy for
  // this exact Market and currency; organisation-wide rows do not apply.
  if (facts.approvalPolicies === "UNAVAILABLE") return unavailable()
  const policy = single(
    facts.approvalPolicies.filter(
      (p) => p.enabled && p.marketKey === facts.marketKey && p.currencyCode === tx.currencyCode,
    ),
  )
  if (policy === "AMBIGUOUS") return deny("CONTEXT_NOT_USABLE")
  const overLimit = tx.amountMinor > limit.orderLimitMinor
  if (overLimit && policy === "NONE") return deny("SPEND_LIMIT_EXCEEDED")
  const overThreshold =
    policy !== "NONE" && policy.thresholdMinor !== null && tx.amountMinor > policy.thresholdMinor
  if (!overLimit && !overThreshold) return allow()

  const reasons: DecisionReason[] = []
  if (overLimit) reasons.push("SPEND_LIMIT_EXCEEDED")
  if (overThreshold) reasons.push("APPROVAL_THRESHOLD_EXCEEDED")
  const approval = facts.approval
  if (!approval || approval.status !== "APPROVED") return refuse("APPROVAL_REQUIRED", ...reasons)
  return applyApproval(facts, tx, marketKey, approval, reasons)
}

/** An approval releases a commitment only while it is bound to exactly this transaction and its approver still holds authority. */
function applyApproval(
  facts: BuyerOperationFacts,
  tx: Transaction,
  marketKey: string,
  approval: BoundApproval,
  reasons: DecisionReason[],
) {
  if (approval.organisationId !== facts.organisationId) return deny("BUYER_NOT_AUTHORISED")
  if (
    !approval.initiatorPrincipalId ||
    !approval.approverPrincipalId ||
    approval.policyRevision === null
  ) {
    return deny("CONTEXT_NOT_USABLE")
  }
  if (approval.initiatorPrincipalId !== facts.principalId) return deny("BUYER_NOT_AUTHORISED")
  if (approval.approverPrincipalId === approval.initiatorPrincipalId)
    return deny("SEPARATION_OF_DUTIES")
  if (
    !boundTo(approval, tx, marketKey) ||
    approval.policyRevision !== BUYER_OPERATION_POLICY_REVISION
  ) {
    return deny("TRANSACTION_CHANGED")
  }
  if (!facts.approverReevaluation) return unavailable()
  if (facts.approverReevaluation.outcome === "UNAVAILABLE") return unavailable()
  if (facts.approverReevaluation.outcome !== "ALLOW") return refuse("APPROVAL_REQUIRED", ...reasons)
  return allow()
}

const boundTo = (approval: BoundApproval, tx: Transaction, marketKey: string) =>
  approval.transactionDigest === tx.transactionDigest &&
  approval.resourceVersion === tx.resourceVersion &&
  approval.amountMinor === tx.amountMinor &&
  approval.currencyCode === tx.currencyCode &&
  approval.marketKey === marketKey

function evaluateApprovalDecision(facts: BuyerOperationFacts): BuyerOperationDecision {
  const tx = facts.transaction
  const approval = facts.approval
  if (!tx || !approval || tx.amountMinor <= 0n || !facts.marketKey)
    return deny("CONTEXT_NOT_USABLE")
  if (approval.organisationId !== facts.organisationId) return deny("BUYER_NOT_AUTHORISED")
  if (!approval.initiatorPrincipalId) return deny("CONTEXT_NOT_USABLE")
  // Separation of duties: whatever roles they hold, nobody approves their own transaction.
  if (approval.initiatorPrincipalId === facts.principalId) return deny("SEPARATION_OF_DUTIES")
  if (!boundTo(approval, tx, facts.marketKey)) return deny("TRANSACTION_CHANGED")
  // Deciding is for a PENDING approval; re-evaluating at commit is for an APPROVED one by its own approver.
  const reevaluation =
    approval.status === "APPROVED" && approval.approverPrincipalId === facts.principalId
  if (approval.status !== "PENDING" && !reevaluation) return deny("CONTEXT_NOT_USABLE")

  // Approver authority: exactly one in-effect approval limit for this Market
  // and currency. Absent or NULL is never unlimited, and never APPROVAL_REQUIRED.
  if (facts.spendAuthorities === "UNAVAILABLE") return unavailable()
  const limit = single(
    facts.spendAuthorities.filter(
      (s) =>
        s.marketKey === facts.marketKey &&
        s.currencyCode === tx.currencyCode &&
        inEffect(facts.now, s.effectiveFrom, s.effectiveUntil),
    ),
  )
  if (limit === "AMBIGUOUS") return deny("CONTEXT_NOT_USABLE")
  if (limit === "NONE" || limit.approvalLimitMinor === null || limit.approvalLimitMinor <= 0n) {
    return deny("APPROVAL_AUTHORITY_NOT_CONFIGURED")
  }
  if (tx.amountMinor > limit.approvalLimitMinor) return deny("APPROVAL_THRESHOLD_EXCEEDED")
  return allow()
}
