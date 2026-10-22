import type {
  ApprovalPolicyRecord,
  BuyerOperationFacts,
  GrantStatus,
  PurchaseOrderRule,
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
 * a dropped approval policy permits no escalation.
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

export type PolicySourceRequest = {
  organisationId: string
  membershipId: string
  marketKey?: string
  siteIds: string[]
}

export type LoadedPolicyFacts = Pick<
  BuyerOperationFacts,
  "roles" | "siteRecords" | "spendAuthorities" | "approvalPolicies"
> & {
  purchaseOrderRule: PurchaseOrderRule | null | "UNAVAILABLE"
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

  return { roles, siteRecords, spendAuthorities, approvalPolicies, purchaseOrderRule }
}
