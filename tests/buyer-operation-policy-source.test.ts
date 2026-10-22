import { describe, expect, it } from "vitest"
import {
  loadBuyerOperationPolicy,
  toMinorUnits,
  type B2BPolicyStore,
} from "../src/baobab/b2b/buyer-operation-policy-source"

/** ADR-SHARED-042 CAA-05: the Trade-owned policy facts, loaded fail-closed. Synthetic rows only. */
const ORG = "b2borg_buyer000001"
const budgetRow = (change: Record<string, unknown> = {}) =>
  ({
    id: "b2bbud_member000001",
    revision: 2,
    status: "ACTIVE",
    scope: "MEMBERSHIP",
    membership_id: "b2bmem_alice00001",
    agreement_reference: null,
    market_key: "ZA",
    currency_code: "ZAR",
    limit_minor: { value: "10000000" },
    effective_from: "2026-01-01T00:00:00Z",
    effective_until: null,
    ...change,
  }) as Awaited<ReturnType<B2BPolicyStore["listSpendBudgetPolicies"]>>[number]
const balanceRow = (
  startsAt: string,
  endsAt: string,
  committed: string,
  reserved: string | { value: string },
) => ({
  budget_policy_id: "b2bbud_member000001",
  period_starts_at: startsAt,
  period_ends_at: endsAt,
  committed_minor: committed,
  reserved_minor: reserved,
})
const store = (change: Partial<B2BPolicyStore> = {}): B2BPolicyStore => ({
  listBuyerRoles: async () => [
    { id: "b2brole_buyer", role: "BUYER" },
    { id: "b2brole_approver", role: "APPROVER" },
  ],
  listBuyerRoleMarketScopes: async () => [
    {
      buyer_role_id: "b2brole_buyer",
      market_key: "ZA",
      status: "ACTIVE",
      effective_from: null,
      effective_until: null,
    },
    {
      buyer_role_id: "b2brole_approver",
      market_key: "KE",
      status: "PENDING",
      effective_from: "2026-10-01T00:00:00Z",
      effective_until: null,
    },
  ],
  listBuyerRoleSiteScopes: async () => [
    {
      buyer_role_id: "b2brole_buyer",
      delivery_site_id: "b2bsite_dc00000001",
      status: "ACTIVE",
      effective_from: null,
      effective_until: null,
    },
  ],
  listDeliverySites: async () => [
    {
      id: "b2bsite_dc00000001",
      organisation_id: ORG,
      market_key: "ZA",
      status: "ACTIVE",
      allow_shipping: true,
      allow_billing: false,
    },
  ],
  listSpendLimits: async () => [
    {
      market_key: "ZA",
      currency_code: "ZAR",
      order_limit_minor: 100000,
      approval_limit_minor: { value: "500000" },
      effective_from: null,
      effective_until: null,
    },
    {
      market_key: "KE",
      currency_code: "KES",
      order_limit_minor: "12.5",
      approval_limit_minor: null,
      effective_from: null,
      effective_until: null,
    },
  ],
  listApprovalPolicies: async () => [
    { market_key: "ZA", currency_code: "ZAR", threshold_minor: "50000", enabled: true },
    { market_key: "KE", currency_code: "KES", threshold_minor: 1.5, enabled: true },
  ],
  listPurchaseOrderRequirements: async () => [
    { market_key: null, required: true, format_pattern: null },
    { market_key: "ZA", required: true, format_pattern: "PO-[0-9]+" },
  ],
  listSpendBudgetPolicies: async () => [budgetRow()],
  listSpendBudgetBalances: async () => [
    balanceRow("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "9000000", "0"),
    balanceRow("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "5500000", { value: "3000000" }),
  ],
  listSpendReservations: async () => [
    {
      id: "b2bres_cart000001",
      organisation_id: ORG,
      membership_id: "b2bmem_alice00001",
      market_key: "ZA",
      currency_code: "ZAR",
      agreement_reference: null,
      transaction_digest: `sha256:${"a".repeat(64)}`,
      resource_version: 3,
      status: "ACTIVE",
      expires_at: "2026-10-29T00:00:00Z",
    },
  ],
  listSpendReservationHolds: async () => [
    {
      budget_policy_id: "b2bbud_member000001",
      policy_revision: 2,
      period_starts_at: "2026-10-01T00:00:00Z",
      reserved_minor: "2000000",
    },
  ],
  ...change,
})
const request = {
  organisationId: ORG,
  membershipId: "b2bmem_alice00001",
  marketKey: "ZA",
  siteIds: ["b2bsite_dc00000001"],
  now: new Date("2026-10-22T12:00:00Z"),
}

describe("loadBuyerOperationPolicy", () => {
  it("keeps each grant on its own role and never upgrades an unknown status", async () => {
    const facts = await loadBuyerOperationPolicy(store(), request)
    expect(facts.roles).toEqual([
      {
        roleId: "b2brole_buyer",
        role: "BUYER",
        markets: [{ key: "ZA", status: "ACTIVE", effectiveFrom: null, effectiveUntil: null }],
        sites: [
          {
            key: "b2bsite_dc00000001",
            status: "ACTIVE",
            effectiveFrom: null,
            effectiveUntil: null,
          },
        ],
      },
      {
        roleId: "b2brole_approver",
        role: "APPROVER",
        markets: [
          {
            key: "KE",
            status: "SUSPENDED",
            effectiveFrom: new Date("2026-10-01T00:00:00Z"),
            effectiveUntil: null,
          },
        ],
        sites: [],
      },
    ])
  })

  it("drops malformed money rather than repairing it", async () => {
    const facts = await loadBuyerOperationPolicy(store(), request)
    expect(facts.spendAuthorities).toEqual([
      {
        marketKey: "ZA",
        currencyCode: "ZAR",
        orderLimitMinor: 100000n,
        approvalLimitMinor: 500000n,
        effectiveFrom: null,
        effectiveUntil: null,
      },
    ])
    expect(facts.approvalPolicies).toEqual([
      { marketKey: "ZA", currencyCode: "ZAR", thresholdMinor: 50000n, enabled: true },
    ])
    for (const value of ["12.5", 1.5, "1e3", " 5", "01", Number.MAX_SAFE_INTEGER + 2]) {
      expect(typeof toMinorUnits(value)).toBe("symbol")
    }
    expect(toMinorUnits(null)).toBeNull()
  })

  it("applies the Market-specific purchase-order rule, else the organisation-wide one", async () => {
    expect((await loadBuyerOperationPolicy(store(), request)).purchaseOrderRule).toEqual({
      required: true,
      formatPattern: "PO-[0-9]+",
    })
    expect(
      (await loadBuyerOperationPolicy(store(), { ...request, marketKey: "KE" })).purchaseOrderRule,
    ).toEqual({ required: true, formatPattern: null })
    expect(
      (
        await loadBuyerOperationPolicy(
          store({ listPurchaseOrderRequirements: async () => [] }),
          request,
        )
      ).purchaseOrderRule,
    ).toBeNull()
  })

  it("reports each failing source as UNAVAILABLE, never as an empty answer", async () => {
    const down = async () => {
      throw new Error("database unavailable")
    }
    const facts = await loadBuyerOperationPolicy(
      store({
        listBuyerRoleSiteScopes: down,
        listDeliverySites: down,
        listSpendLimits: down,
        listApprovalPolicies: down,
        listPurchaseOrderRequirements: down,
        listSpendBudgetBalances: down,
        listSpendReservationHolds: down,
      }),
      { ...request, reservationId: "b2bres_cart000001" },
    )
    expect(facts).toEqual({
      roles: "UNAVAILABLE",
      siteRecords: "UNAVAILABLE",
      spendAuthorities: "UNAVAILABLE",
      approvalPolicies: "UNAVAILABLE",
      purchaseOrderRule: "UNAVAILABLE",
      budgets: "UNAVAILABLE",
      reservation: "UNAVAILABLE",
    })
  })

  it("loads each budget with its current-period balance only", async () => {
    const facts = await loadBuyerOperationPolicy(store(), request)
    expect(facts.budgets).toEqual([
      {
        policyId: "b2bbud_member000001",
        revision: 2,
        status: "ACTIVE",
        scope: "MEMBERSHIP",
        membershipId: "b2bmem_alice00001",
        agreementReference: null,
        marketKey: "ZA",
        currencyCode: "ZAR",
        limitMinor: 10_000_000n,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveUntil: null,
        period: {
          startsAt: new Date("2026-10-01T00:00:00Z"),
          endsAt: new Date("2026-11-01T00:00:00Z"),
        },
        committedMinor: 5_500_000n,
        reservedMinor: 3_000_000n,
      },
    ])
    // A new month starts from nothing consumed; September never carries over.
    const november = await loadBuyerOperationPolicy(store(), {
      ...request,
      now: new Date("2026-11-01T00:00:00Z"),
    })
    expect(november.budgets).toMatchObject([
      { period: null, committedMinor: 0n, reservedMinor: 0n },
    ])
    expect(facts.reservation).toBeUndefined()
  })

  it("never drops a malformed budget, which would remove a ceiling", async () => {
    for (const change of [
      { limit_minor: "12.5" },
      { limit_minor: null },
      { limit_minor: 0 },
      { status: "PAUSED" },
      { scope: "ROLE" },
      { revision: 0 },
    ]) {
      const facts = await loadBuyerOperationPolicy(
        store({
          listSpendBudgetPolicies: async () => [
            budgetRow(),
            budgetRow({
              id: "b2bbud_org00000001",
              scope: "ORGANISATION",
              membership_id: null,
              ...change,
            }),
          ],
        }),
        request,
      )
      expect(facts.budgets).toBe("UNAVAILABLE")
    }
    const negative = await loadBuyerOperationPolicy(
      store({
        listSpendBudgetBalances: async () => [
          balanceRow("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "-1", "0"),
        ],
      }),
      request,
    )
    expect(negative.budgets).toBe("UNAVAILABLE")
  })

  it("loads the named reservation of this Organisation only, with its holds", async () => {
    const asked: unknown[] = []
    const facts = await loadBuyerOperationPolicy(
      store({
        listSpendReservations: async (filter) => {
          asked.push(filter)
          return (await store().listSpendReservations(filter)).filter((r) => r.id === filter.id)
        },
      }),
      { ...request, reservationId: "b2bres_cart000001" },
    )
    expect(asked).toEqual([{ id: "b2bres_cart000001", organisation_id: ORG }])
    expect(facts.reservation).toEqual({
      status: "ACTIVE",
      membershipId: "b2bmem_alice00001",
      marketKey: "ZA",
      currencyCode: "ZAR",
      agreementReference: null,
      transactionDigest: `sha256:${"a".repeat(64)}`,
      resourceVersion: "3",
      expiresAt: new Date("2026-10-29T00:00:00Z"),
      holds: [
        {
          policyId: "b2bbud_member000001",
          policyRevision: 2,
          periodStartsAt: new Date("2026-10-01T00:00:00Z"),
          reservedMinor: 2_000_000n,
        },
      ],
    })
    const missing = await loadBuyerOperationPolicy(
      store({ listSpendReservations: async () => [] }),
      {
        ...request,
        reservationId: "b2bres_cart000001",
      },
    )
    expect(missing.reservation).toBeUndefined()
  })

  it("asks only this Organisation for the referenced Sites", async () => {
    const asked: unknown[] = []
    await loadBuyerOperationPolicy(
      store({ listDeliverySites: async (filter) => (asked.push(filter), []) }),
      request,
    )
    expect(asked).toEqual([{ id: ["b2bsite_dc00000001"], organisation_id: ORG }])
  })
})
