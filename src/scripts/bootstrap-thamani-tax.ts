import type { ExecArgs } from "@medusajs/framework/types"
import {
  THAMANI_STANDARD_TAX_RULES,
  THAMANI_TAX_CATEGORIES,
  THAMANI_TAX_CONTEXTS,
  THAMANI_TAX_SOURCE_RETRIEVED_AT,
  categoryVerificationStatus,
} from "../baobab/thamani/tax"
import type TaxBridgeModuleService from "../modules/tax-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<TaxBridgeModuleService>("taxBridge")
  for (const context of THAMANI_TAX_CONTEXTS) {
    const [existing] = await bridge.listTaxPolicyBindings({
      market_key: context.marketKey,
      legal_seller_key: context.legalSellerKey,
    })
    if (!existing)
      await bridge.createTaxPolicyBindings({
        market_key: context.marketKey,
        jurisdiction_key: context.jurisdictionKey,
        currency_code: context.currency,
        legal_seller_key: context.legalSellerKey,
        provider_key: context.providerKey,
        seller_registration_reference: context.sellerRegistrationReference,
        prices_include_tax: context.pricesIncludeTax,
        fail_closed: context.failClosed,
        status: "ACTIVE",
      })
  }
  for (const rule of THAMANI_STANDARD_TAX_RULES) {
    const [existing] = await bridge.listTaxRuleProjections({
      digital_estate: rule.digitalEstate,
      rule_reference: rule.ruleReference,
      rule_version: rule.ruleVersion,
    })
    if (!existing)
      await bridge.createTaxRuleProjections({
        digital_estate: rule.digitalEstate,
        rule_reference: rule.ruleReference,
        rule_version: rule.ruleVersion,
        jurisdiction_key: rule.jurisdictionKey,
        product_tax_classification: rule.productTaxClassification,
        transaction_type: rule.transactionType,
        treatment: rule.treatment,
        rate_basis_points: rule.rateBasisPoints,
        effective_from: rule.effectiveFrom,
        source_authority: rule.sourceAuthority,
        source_retrieved_at: rule.sourceRetrievedAt,
        status: "ACTIVE",
      })
  }
  for (const context of THAMANI_TAX_CONTEXTS)
    for (const category of THAMANI_TAX_CATEGORIES) {
      const [existing] = await bridge.listTaxCategoryProjections({
        market_key: context.marketKey,
        category_key: category,
      })
      if (existing) continue
      const rule = THAMANI_STANDARD_TAX_RULES.find(
        (candidate) =>
          candidate.jurisdictionKey === context.jurisdictionKey && category === "STANDARD",
      )
      await bridge.createTaxCategoryProjections({
        market_key: context.marketKey,
        category_key: category,
        treatment: category,
        rule_reference: rule?.ruleReference,
        verification_status: categoryVerificationStatus(category),
        source_authority: rule?.sourceAuthority,
        source_retrieved_at: THAMANI_TAX_SOURCE_RETRIEVED_AT,
      })
    }
  container
    .resolve("logger")
    .info("Bootstrapped Thamani Gate 13 effective tax rules and governed categories")
}
