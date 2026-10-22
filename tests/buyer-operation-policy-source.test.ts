import { describe, expect, it } from "vitest"
import {
  loadBuyerOperationPolicy,
  toMinorUnits,
  type B2BPolicyStore,
} from "../src/baobab/b2b/buyer-operation-policy-source"

/** ADR-SHARED-042 CAA-05: the Trade-owned policy facts, loaded fail-closed. Synthetic rows only. */
const ORG = "b2borg_buyer000001"
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
  ...change,
})
const request = {
  organisationId: ORG,
  membershipId: "b2bmem_alice00001",
  marketKey: "ZA",
  siteIds: ["b2bsite_dc00000001"],
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
      }),
      request,
    )
    expect(facts).toEqual({
      roles: "UNAVAILABLE",
      siteRecords: "UNAVAILABLE",
      spendAuthorities: "UNAVAILABLE",
      approvalPolicies: "UNAVAILABLE",
      purchaseOrderRule: "UNAVAILABLE",
    })
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
