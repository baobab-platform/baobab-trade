import type { ExecArgs } from "@medusajs/framework/types"
import type B2BModuleService from "../modules/b2b/service"

export default async function verifyB2BModule({ container }: ExecArgs): Promise<void> {
  const b2b = container.resolve<B2BModuleService>("b2b")

  await Promise.all([
    b2b.listB2BOrganisations({}, { take: 1 }),
    b2b.listBuyerMemberships({}, { take: 1 }),
    b2b.listBuyerRoles({}, { take: 1 }),
    b2b.listApprovalPolicies({}, { take: 1 }),
    b2b.listSpendLimits({}, { take: 1 }),
    b2b.listPurchaseOrderRequirements({}, { take: 1 }),
    b2b.listCreditTerms({}, { take: 1 }),
    b2b.listCommercialTerms({}, { take: 1 }),
    b2b.listTaxRegistrations({}, { take: 1 }),
    b2b.listDeliverySites({}, { take: 1 }),
    b2b.listPurchaseApprovals({}, { take: 1 }),
    b2b.listPurchaseOrderReferences({}, { take: 1 }),
    b2b.listProductTradeProfiles({}, { take: 1 }),
    b2b.listMarketProductEligibilities({}, { take: 1 }),
    b2b.listPurchaseConstraints({}, { take: 1 }),
    b2b.listContractPrices({}, { take: 1 }),
  ])

  container.resolve("logger").info("Verified Gate 5 B2B module persistence")
}
