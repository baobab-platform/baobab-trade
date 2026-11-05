import type B2BModuleService from "../../modules/b2b/service"
import type { B2BPolicyStore } from "./buyer-operation-policy-source"

/**
 * DEV-07 native CAA-05 policy source. Reuses the existing Medusa B2B module
 * and the existing restrictive evaluator; no parallel role tables, policy
 * fixtures, HTTP override, or permissive fallback.
 *
 * Each request reads live records. Medusa errors must reject the operation;
 * loadBuyerOperationPolicy translates the affected source to UNAVAILABLE.
 */
export function medusaB2BPolicyStore(module: B2BModuleService): B2BPolicyStore {
  if (!module ||
      typeof module.listBuyerRoles !== "function" ||
      typeof module.listBuyerRoleMarketScopes !== "function" ||
      typeof module.listBuyerRoleSiteScopes !== "function" ||
      typeof module.listDeliverySites !== "function" ||
      typeof module.listSpendLimits !== "function" ||
      typeof module.listApprovalPolicies !== "function" ||
      typeof module.listPurchaseOrderRequirements !== "function" ||
      typeof module.listSpendBudgetPolicies !== "function" ||
      typeof module.listSpendBudgetBalances !== "function" ||
      typeof module.listSpendReservations !== "function" ||
      typeof module.listSpendReservationHolds !== "function") {
    throw new Error("NATIVE_B2B_POLICY_STORE_UNAVAILABLE")
  }
  // Service models are the owning native schema. The policy source's
  // normaliser validates statuses, role scopes, periods and minor-unit values.
  // Cast only across Medusa's generated service DTOs, never across permissions.
  return {
    listBuyerRoles: (filter) => module.listBuyerRoles(filter) as ReturnType<B2BPolicyStore["listBuyerRoles"]>,
    listBuyerRoleMarketScopes: (filter) =>
      module.listBuyerRoleMarketScopes(filter) as ReturnType<B2BPolicyStore["listBuyerRoleMarketScopes"]>,
    listBuyerRoleSiteScopes: (filter) =>
      module.listBuyerRoleSiteScopes(filter) as ReturnType<B2BPolicyStore["listBuyerRoleSiteScopes"]>,
    listDeliverySites: (filter) =>
      module.listDeliverySites(filter) as ReturnType<B2BPolicyStore["listDeliverySites"]>,
    listSpendLimits: (filter) =>
      module.listSpendLimits(filter) as ReturnType<B2BPolicyStore["listSpendLimits"]>,
    listApprovalPolicies: (filter) =>
      module.listApprovalPolicies(filter) as ReturnType<B2BPolicyStore["listApprovalPolicies"]>,
    listPurchaseOrderRequirements: (filter) =>
      module.listPurchaseOrderRequirements(filter) as ReturnType<B2BPolicyStore["listPurchaseOrderRequirements"]>,
    listSpendBudgetPolicies: (filter) =>
      module.listSpendBudgetPolicies(filter) as ReturnType<B2BPolicyStore["listSpendBudgetPolicies"]>,
    listSpendBudgetBalances: (filter) =>
      module.listSpendBudgetBalances(filter) as ReturnType<B2BPolicyStore["listSpendBudgetBalances"]>,
    listSpendReservations: (filter) =>
      module.listSpendReservations(filter) as ReturnType<B2BPolicyStore["listSpendReservations"]>,
    listSpendReservationHolds: (filter) =>
      module.listSpendReservationHolds(filter) as ReturnType<B2BPolicyStore["listSpendReservationHolds"]>,
  }
}
