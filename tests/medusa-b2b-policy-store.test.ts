import { describe, expect, it, vi } from "vitest"
import type B2BModuleService from "../src/modules/b2b/service"
import { medusaB2BPolicyStore } from "../src/baobab/b2b/medusa-b2b-policy-store"
import { loadBuyerOperationPolicy } from "../src/baobab/b2b/buyer-operation-policy-source"

/** Actual service method calls, not a second role or budget evaluator. */
const METHODS = [
  "listBuyerRoles", "listBuyerRoleMarketScopes", "listBuyerRoleSiteScopes",
  "listDeliverySites", "listSpendLimits", "listApprovalPolicies",
  "listPurchaseOrderRequirements", "listSpendBudgetPolicies",
  "listSpendBudgetBalances", "listSpendReservations", "listSpendReservationHolds",
] as const

const fixture = () => {
  const module = Object.fromEntries(METHODS.map((name) => [
    name, vi.fn(async () => []),
  ])) as Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>
  return module
}

describe("DEV-07 buyer operation authority: live Medusa policy source", () => {
  it("declines to construct a reader with incomplete native B2B service", () => {
    expect(() => medusaB2BPolicyStore({} as B2BModuleService))
      .toThrow("NATIVE_B2B_POLICY_STORE_UNAVAILABLE")
    for (const name of METHODS) {
      const module = fixture()
      Reflect.deleteProperty(module, name)
      expect(() => medusaB2BPolicyStore(module as unknown as B2BModuleService))
        .toThrow("NATIVE_B2B_POLICY_STORE_UNAVAILABLE")
    }
  })
  it("uses current rows, not fixture permissions or implied zero spending limits", async () => {
    const module = fixture()
    module.listBuyerRoles.mockResolvedValueOnce([{
      id: "b2brole_active1", role: "BUYER",
    }])
    module.listBuyerRoleMarketScopes.mockResolvedValueOnce([])
    module.listBuyerRoleSiteScopes.mockResolvedValueOnce([])
    const source = medusaB2BPolicyStore(module as unknown as B2BModuleService)
    const facts = await loadBuyerOperationPolicy(source, {
      organisationId: "b2borg_exact",
      membershipId: "b2bmem_exact",
      marketKey: "ZA",
      siteIds: ["b2bsite_actual"],
      now: new Date("2026-11-05T10:00:00Z"),
    })
    expect(module.listBuyerRoles).toHaveBeenCalledWith({membership_id:"b2bmem_exact"})
    expect(module.listDeliverySites).toHaveBeenCalledWith({
      id:["b2bsite_actual"],organisation_id:"b2borg_exact",
    })
    expect(facts.roles).toHaveLength(1)
    expect(facts.spendAuthorities).toEqual([])
    expect(facts.budgets).toEqual([])
    expect(facts.roles[0].sites).toEqual([])
    expect(facts.roles[0].markets).toEqual([])
  })
  it("does not turn an unavailable spend source into unlimited authority", async () => {
    const module = fixture()
    module.listSpendLimits.mockRejectedValueOnce(new Error("native B2B DB unavailable"))
    const facts = await loadBuyerOperationPolicy(
      medusaB2BPolicyStore(module as unknown as B2BModuleService), {
        organisationId:"b2borg_exact",membershipId:"b2bmem_exact",
        marketKey:"ZA",siteIds:[],now:new Date(),
      },
    )
    expect(facts.spendAuthorities).toBe("UNAVAILABLE")
  })
})
