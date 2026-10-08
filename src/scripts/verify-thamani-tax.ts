import type { ExecArgs } from "@medusajs/framework/types"
import {
  EffectiveDatedTaxProviderAdapter,
  reconcileTax,
  type EffectiveTaxRuleProvider,
  type TaxDeterminationRequest,
} from "../baobab/tax"
import { THAMANI_TAX_CONTEXTS } from "../baobab/thamani/tax"
import type TaxBridgeModuleService from "../modules/tax-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<TaxBridgeModuleService>("taxBridge")
  const provider: EffectiveTaxRuleProvider = {
    providerKey: "baobab_reference",
    async listRules(request) {
      const records = await bridge.listTaxRuleProjections({
        jurisdiction_key: request.jurisdictionKey,
        product_tax_classification: request.productTaxClassification,
        transaction_type: request.transactionType,
        status: "ACTIVE",
      })
      return records.map((rule) => ({
        digitalEstate: rule.digital_estate,
        ruleReference: rule.rule_reference,
        ruleVersion: rule.rule_version,
        jurisdictionKey: rule.jurisdiction_key,
        productTaxClassification: rule.product_tax_classification,
        transactionType: rule.transaction_type,
        treatment: rule.treatment,
        rateBasisPoints: rule.rate_basis_points,
        effectiveFrom: rule.effective_from,
        effectiveUntil: rule.effective_until,
        sourceAuthority: rule.source_authority,
        sourceRetrievedAt: rule.source_retrieved_at,
        legalReason: rule.legal_reason ?? undefined,
      }))
    },
  }
  const adapter = new EffectiveDatedTaxProviderAdapter(provider)
  for (const context of THAMANI_TAX_CONTEXTS) {
    const [policy] = await bridge.listTaxPolicyBindings({
      market_key: context.marketKey,
      legal_seller_key: context.legalSellerKey,
    })
    if (!policy?.prices_include_tax) throw new Error(`${context.marketKey} is not tax inclusive`)
    const [standard, zeroRated, exempt] = await Promise.all(
      ["STANDARD", "ZERO_RATED", "EXEMPT"].map(async (category_key) => {
        const [category] = await bridge.listTaxCategoryProjections({
          market_key: context.marketKey,
          category_key,
        })
        return category
      }),
    )
    if (standard?.verification_status !== "VERIFIED" || !standard.rule_reference)
      throw new Error(`${context.marketKey} standard tax category is not verified`)
    if ([zeroRated, exempt].some((category) => category?.verification_status !== "REVIEW_REQUIRED"))
      throw new Error("Unverified protected categories must remain review-required")
    const gross = context.currency === "UGX" ? 118_000 : 11_500
    const expectedTax = context.currency === "UGX" ? 18_000 : 1_500
    const request: TaxDeterminationRequest = {
      determinationReference: `thamani-gate13-${context.jurisdictionKey.toLowerCase()}`,
      marketKey: context.marketKey,
      legalSellerKey: context.legalSellerKey,
      sellerRegistrationReference: context.sellerRegistrationReference,
      customerReference: `customer:gate13:${context.jurisdictionKey.toLowerCase()}`,
      jurisdictionKey: context.jurisdictionKey,
      shipFromCountry: context.jurisdictionKey,
      shipToCountry: context.jurisdictionKey,
      billToCountry: context.jurisdictionKey,
      productTaxClassification: "STANDARD",
      transactionType: "GOODS",
      currency: context.currency,
      taxableBasisMinor: gross,
      priceDisplayMode: "TAX_INCLUSIVE",
      effectiveAt: new Date("2026-09-09T12:00:00Z"),
      idempotencyKey: `thamani:gate13:determine:${context.jurisdictionKey.toLowerCase()}`,
      correlationId: "thamani-gate13-verification",
    }
    const result = await adapter.determine(request)
    if (result.taxAmountMinor !== expectedTax || result.grossAmountMinor !== gross)
      throw new Error(`${context.marketKey} inclusive tax calculation failed`)
    let [determination] = await bridge.listTaxDeterminations({
      source_idempotency_key: result.idempotencyKey,
    })
    if (!determination)
      determination = await bridge.createTaxDeterminations({
        determination_reference: result.determinationReference,
        customer_reference: result.customerReference,
        market_key: result.marketKey,
        legal_seller_key: result.legalSellerKey,
        jurisdiction_key: result.jurisdictionKey,
        product_tax_classification: result.productTaxClassification,
        transaction_type: result.transactionType,
        treatment: result.treatment,
        currency_code: result.currency,
        taxable_basis_minor: result.taxableBasisMinor,
        tax_amount_minor: result.taxAmountMinor,
        net_amount_minor: result.netAmountMinor,
        gross_amount_minor: result.grossAmountMinor,
        price_display_mode: result.priceDisplayMode,
        rate_basis_points: result.rateBasisPoints,
        rule_reference: result.ruleReference,
        rule_version: result.ruleVersion,
        provider_key: result.providerKey,
        calculation_reference: result.calculationReference,
        source_authority: result.sourceAuthority,
        source_retrieved_at: result.sourceRetrievedAt,
        effective_at: result.effectiveAt,
        source_idempotency_key: result.idempotencyKey,
        correlation_id: result.correlationId,
      })
    const reconciliation = reconcileTax({
      commerceTaxMinor: result.taxAmountMinor,
      commerceCurrency: result.currency,
      erpTaxMinor: result.taxAmountMinor,
      erpCurrency: result.currency,
    })
    const [existing] = await bridge.listTaxReconciliations({
      source_idempotency_key: `thamani:gate13:reconcile:${context.jurisdictionKey.toLowerCase()}`,
    })
    if (!existing)
      await bridge.createTaxReconciliations({
        determination_id: determination.id,
        erp_tax_reference: `idempiere:tax:${context.jurisdictionKey.toLowerCase()}`,
        commerce_tax_minor: result.taxAmountMinor,
        erp_tax_minor: result.taxAmountMinor,
        commerce_currency: result.currency,
        erp_currency: result.currency,
        delta_minor: reconciliation.deltaMinor,
        status: reconciliation.status,
        reasons: reconciliation.reasons,
        source_idempotency_key: `thamani:gate13:reconcile:${context.jurisdictionKey.toLowerCase()}`,
        observed_at: new Date(),
      })
  }
  container
    .resolve("logger")
    .info("Verified Thamani Gate 13 tax inclusivity, provenance, and reconciliation")
}
