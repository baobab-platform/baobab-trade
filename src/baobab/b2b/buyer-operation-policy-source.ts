import type {
  ApprovalPolicyRecord,
  BudgetFact,
  BuyerOperationFacts,
  GrantStatus,
  PurchaseOrderRule,
  ReservationFact,
  RoleAssignment,
  ScopeGrant,
  SiteRecord,
  SpendAuthority,
} from "./buyer-operation-policy"

/**
 * Loads the Trade-owned CAA-05 policy facts for one membership in one buyer
 * Organisation (buyer-operation-policy.ts). Each source fails independently
 * to UNAVAILABLE, never to an empty answer that could read as "no
 * restriction".
 *
 * Money rows that are not whole minor units are dropped, never repaired.
 * That fails closed: a dropped spend limit is SPEND_POLICY_NOT_CONFIGURED and
 * a dropped approval policy permits no escalation. Cumulative budgets are the
 * exception: dropping an ORGANISATION or AGREEMENT budget would remove a
 * ceiling, so any malformed budget or balance row makes the whole budget
 * source UNAVAILABLE instead.
 */
export type B2BPolicyStore = {
  listBuyerRoles(filter: { membership_id: string }): Promise<Array<{ id: string; role: string }>>
  listBuyerRoleMarketScopes(filter: { buyer_role_id: string[] }): Promise<ScopeRow<"market_key">[]>
  listBuyerRoleSiteScopes(filter: {
    buyer_role_id: string[]
  }): Promise<ScopeRow<"delivery_site_id">[]>
  listDeliverySites(filter: { id: string[]; organisation_id: string }): Promise<SiteRow[]>
  listSpendLimits(filter: { membership_id: string }): Promise<SpendLimitRow[]>
  listApprovalPolicies(filter: { organisation_id: string }): Promise<ApprovalPolicyRow[]>
  listPurchaseOrderRequirements(filter: { organisation_id: string }): Promise<PurchaseOrderRow[]>
  listSpendBudgetPolicies(filter: { organisation_id: string }): Promise<BudgetPolicyRow[]>
  listSpendBudgetBalances(filter: { budget_policy_id: string[] }): Promise<BalanceRow[]>
  listSpendReservations(filter: { id: string; organisation_id: string }): Promise<ReservationRow[]>
  listSpendReservationHolds(filter: { reservation_id: string }): Promise<HoldRow[]>
}

type ScopeRow<K extends string> = {
  buyer_role_id: string
  status: string
  effective_from: Date | string | null
  effective_until: Date | string | null
} & Record<K, string>
type SiteRow = {
  id: string
  organisation_id: string
  market_key: string
  status: string
  allow_shipping: boolean
  allow_billing: boolean
}
type Money = number | string | bigint | { value: string } | null
type SpendLimitRow = {
  market_key: string | null
  currency_code: string
  order_limit_minor: Money
  approval_limit_minor: Money
  effective_from: Date | string | null
  effective_until: Date | string | null
}
type ApprovalPolicyRow = {
  market_key: string | null
  currency_code: string
  threshold_minor: Money
  enabled: boolean
}
type PurchaseOrderRow = {
  market_key: string | null
  required: boolean
  format_pattern: string | null
}

type BudgetPolicyRow = {
  id: string
  revision: number
  status: string
  scope: string
  membership_id: string | null
  agreement_reference: string | null
  market_key: string
  currency_code: string
  limit_minor: Money
  effective_from: Date | string
  effective_until: Date | string | null
}
type BalanceRow = {
  budget_policy_id: string
  period_starts_at: Date | string
  period_ends_at: Date | string
  committed_minor: Money
  reserved_minor: Money
}
type ReservationRow = {
  id: string
  organisation_id: string
  membership_id: string
  market_key: string
  currency_code: string
  agreement_reference: string | null
  transaction_digest: string
  resource_version: number
  status: string
  expires_at: Date | string
}
type HoldRow = {
  budget_policy_id: string
  policy_revision: number
  period_starts_at: Date | string
  reserved_minor: Money
}

export type PolicySourceRequest = {
  organisationId: string
  membershipId: string
  marketKey?: string
  siteIds: string[]
  /** The evaluation instant, which selects each budget's current-period balance. */
  now: Date
  /** The purchase's own reservation, from its immutable purchase record, once formally submitted. */
  reservationId?: string
}

export type LoadedPolicyFacts = Pick<
  BuyerOperationFacts,
  "roles" | "siteRecords" | "spendAuthorities" | "approvalPolicies" | "budgets"
> & {
  purchaseOrderRule: PurchaseOrderRule | null | "UNAVAILABLE"
  /** Absent when no reservation was named or found; UNAVAILABLE when it could not be read. */
  reservation?: ReservationFact | "UNAVAILABLE"
}

const MALFORMED = Symbol("malformed")

/** A whole number of minor units, null, or MALFORMED. */
export const toMinorUnits = (value: Money): bigint | null | typeof MALFORMED => {
  if (value === null || value === undefined) return null
  const raw = typeof value === "object" && typeof value !== "bigint" ? value.value : value
  if (typeof raw === "bigint") return raw
  const text =
    typeof raw === "number" ? (Number.isSafeInteger(raw) ? String(raw) : "") : String(raw)
  return /^-?(0|[1-9][0-9]{0,30})$/.test(text) ? BigInt(text) : MALFORMED
}

const toDate = (value: Date | string | null): Date | null =>
  value === null ? null : new Date(value)

class MalformedRow extends Error {}

/** A non-negative whole number of minor units, or throws so the source becomes UNAVAILABLE. */
const strictMinorUnits = (value: Money): bigint => {
  const minor = toMinorUnits(value)
  if (minor === null || minor === MALFORMED || minor < 0n) throw new MalformedRow()
  return minor
}

const oneOf = <T extends string>(value: string, allowed: readonly T[]): T => {
  if (!(allowed as readonly string[]).includes(value)) throw new MalformedRow()
  return value as T
}

const toBudget = (row: BudgetPolicyRow, balances: BalanceRow[], now: Date): BudgetFact => {
  const limitMinor = strictMinorUnits(row.limit_minor)
  if (limitMinor <= 0n || !Number.isSafeInteger(row.revision) || row.revision < 1) {
    throw new MalformedRow()
  }
  const current = balances.filter(
    (b) =>
      b.budget_policy_id === row.id &&
      new Date(b.period_starts_at) <= now &&
      now < new Date(b.period_ends_at),
  )
  if (current.length > 1) throw new MalformedRow()
  const [balance] = current
  return {
    policyId: row.id,
    revision: row.revision,
    status: oneOf(row.status, ["ACTIVE", "SUSPENDED", "RETIRED"] as const),
    scope: oneOf(row.scope, ["MEMBERSHIP", "AGREEMENT", "ORGANISATION"] as const),
    membershipId: row.membership_id,
    agreementReference: row.agreement_reference,
    marketKey: row.market_key,
    currencyCode: row.currency_code,
    limitMinor,
    effectiveFrom: new Date(row.effective_from),
    effectiveUntil: toDate(row.effective_until),
    period: balance
      ? { startsAt: new Date(balance.period_starts_at), endsAt: new Date(balance.period_ends_at) }
      : null,
    committedMinor: balance ? strictMinorUnits(balance.committed_minor) : 0n,
    reservedMinor: balance ? strictMinorUnits(balance.reserved_minor) : 0n,
  }
}

const GRANT_STATUSES: readonly string[] = ["ACTIVE", "SUSPENDED", "REVOKED"]
type GrantRow = Pick<ScopeRow<never>, "status" | "effective_from" | "effective_until">
const toGrant = (key: string, row: GrantRow): ScopeGrant => ({
  key,
  // An unknown status is never ACTIVE.
  status: (GRANT_STATUSES.includes(row.status) ? row.status : "SUSPENDED") as GrantStatus,
  effectiveFrom: toDate(row.effective_from),
  effectiveUntil: toDate(row.effective_until),
})

const attempt = async <T>(load: () => Promise<T>): Promise<T | "UNAVAILABLE"> => {
  try {
    return await load()
  } catch {
    return "UNAVAILABLE"
  }
}

export async function loadBuyerOperationPolicy(
  store: B2BPolicyStore,
  request: PolicySourceRequest,
): Promise<LoadedPolicyFacts> {
  const roles = await attempt(async (): Promise<RoleAssignment[]> => {
    const assigned = await store.listBuyerRoles({ membership_id: request.membershipId })
    const ids = assigned.map((r) => r.id)
    if (ids.length === 0) return []
    const [markets, sites] = await Promise.all([
      store.listBuyerRoleMarketScopes({ buyer_role_id: ids }),
      store.listBuyerRoleSiteScopes({ buyer_role_id: ids }),
    ])
    return assigned.map((r) => ({
      roleId: r.id,
      role: r.role,
      markets: markets.filter((g) => g.buyer_role_id === r.id).map((g) => toGrant(g.market_key, g)),
      sites: sites
        .filter((g) => g.buyer_role_id === r.id)
        .map((g) => toGrant(g.delivery_site_id, g)),
    }))
  })

  const siteRecords = await attempt(async (): Promise<SiteRecord[]> => {
    if (request.siteIds.length === 0) return []
    const rows = await store.listDeliverySites({
      id: request.siteIds,
      organisation_id: request.organisationId,
    })
    return rows.map((s) => ({
      id: s.id,
      organisationId: s.organisation_id,
      marketKey: s.market_key,
      status: s.status === "ACTIVE" || s.status === "CLOSED" ? s.status : "SUSPENDED",
      allowShipping: s.allow_shipping === true,
      allowBilling: s.allow_billing === true,
    }))
  })

  const spendAuthorities = await attempt(async (): Promise<SpendAuthority[]> => {
    const rows = await store.listSpendLimits({ membership_id: request.membershipId })
    return rows.flatMap((row) => {
      const order = toMinorUnits(row.order_limit_minor)
      const approval = toMinorUnits(row.approval_limit_minor)
      if (order === MALFORMED || approval === MALFORMED) return []
      return [
        {
          marketKey: row.market_key,
          currencyCode: row.currency_code,
          orderLimitMinor: order,
          approvalLimitMinor: approval,
          effectiveFrom: toDate(row.effective_from),
          effectiveUntil: toDate(row.effective_until),
        },
      ]
    })
  })

  const approvalPolicies = await attempt(async (): Promise<ApprovalPolicyRecord[]> => {
    const rows = await store.listApprovalPolicies({ organisation_id: request.organisationId })
    return rows.flatMap((row) => {
      const threshold = toMinorUnits(row.threshold_minor)
      if (threshold === MALFORMED) return []
      return [
        {
          marketKey: row.market_key,
          currencyCode: row.currency_code,
          thresholdMinor: threshold,
          enabled: row.enabled === true,
        },
      ]
    })
  })

  // A purchase-order requirement is a restriction, so an organisation-wide
  // row applies wherever no Market-specific row exists.
  const purchaseOrderRule = await attempt(async (): Promise<PurchaseOrderRule | null> => {
    const rows = await store.listPurchaseOrderRequirements({
      organisation_id: request.organisationId,
    })
    const row =
      rows.find((r) => r.market_key !== null && r.market_key === request.marketKey) ??
      rows.find((r) => r.market_key === null)
    return row ? { required: row.required === true, formatPattern: row.format_pattern } : null
  })

  const budgets = await attempt(async (): Promise<BudgetFact[]> => {
    const rows = await store.listSpendBudgetPolicies({ organisation_id: request.organisationId })
    if (rows.length === 0) return []
    const balances = await store.listSpendBudgetBalances({
      budget_policy_id: rows.map((r) => r.id),
    })
    return rows.map((row) => toBudget(row, balances, request.now))
  })

  // The reservation credits capacity, so a malformed one credits nothing:
  // it is UNAVAILABLE, never repaired.
  const reservationId = request.reservationId
  const reservation =
    reservationId === undefined
      ? undefined
      : await attempt(async (): Promise<ReservationFact | undefined> => {
          const [row] = await store.listSpendReservations({
            id: reservationId,
            organisation_id: request.organisationId,
          })
          if (!row) return undefined
          const holds = await store.listSpendReservationHolds({ reservation_id: row.id })
          return {
            status: oneOf(row.status, ["ACTIVE", "COMMITTED", "RELEASED", "EXPIRED"] as const),
            membershipId: row.membership_id,
            marketKey: row.market_key,
            currencyCode: row.currency_code,
            agreementReference: row.agreement_reference,
            transactionDigest: row.transaction_digest,
            // Shared trade/v2 resource_version is an integer; the transaction
            // must carry the same canonical form or it is TRANSACTION_CHANGED.
            resourceVersion: String(row.resource_version),
            expiresAt: new Date(row.expires_at),
            holds: holds.map((h) => ({
              policyId: h.budget_policy_id,
              policyRevision: h.policy_revision,
              periodStartsAt: new Date(h.period_starts_at),
              reservedMinor: strictMinorUnits(h.reserved_minor),
            })),
          }
        })

  return {
    roles,
    siteRecords,
    spendAuthorities,
    approvalPolicies,
    purchaseOrderRule,
    budgets,
    reservation,
  }
}
