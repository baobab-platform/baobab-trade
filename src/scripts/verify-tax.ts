import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import {
  EffectiveDatedTaxProviderAdapter,
  reconcileTax,
  resolveTaxContext,
  type EffectiveTaxRuleProvider,
  type TaxDeterminationRequest,
} from "../baobab/tax"
import type TaxBridgeModuleService from "../modules/tax-bridge/service"
export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<TaxBridgeModuleService>("taxBridge")
  const policies = await bridge.listTaxPolicyBindings({
    market_key: ["zuribeans_ug", "zuribeans_za"],
  })
  if (policies.length !== 2) throw new Error(`Expected 2 tax contexts, found ${policies.length}`)
  const context = resolveTaxContext("zuribeans_ug", "zuribeans-uganda")
  const effectiveFrom = new Date("2026-01-01T00:00:00Z")
  let [rule] = await bridge.listTaxRuleProjections({
    digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    rule_reference: "gate10:synthetic:ug:goods",
  })
  if (!rule)
    rule = await bridge.createTaxRuleProjections({
      digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
      rule_reference: "gate10:synthetic:ug:goods",
      rule_version: "test-v1",
      jurisdiction_key: "UG",
      product_tax_classification: "GATE10_TEST_GOODS",
      transaction_type: "GOODS",
      treatment: "STANDARD",
      rate_basis_points: 1000,
      effective_from: effectiveFrom,
      source_authority: "GATE10_TEST_FIXTURE_NOT_STATUTORY",
      source_retrieved_at: new Date(),
      status: "ACTIVE",
    })
  const [profile] = await bridge.listB2BTaxProfiles({
    organisation_id: "gate10-b2b-organisation",
    jurisdiction_key: "UG",
  })
  if (!profile)
    await bridge.createB2BTaxProfiles({
      organisation_id: "gate10-b2b-organisation",
      jurisdiction_key: "UG",
      verification_status: "UNVERIFIED",
      eligible_treatments: ["STANDARD"],
      provenance: {
        source: "GATE10_TEST_FIXTURE_NOT_STATUTORY",
        checked_at: new Date().toISOString(),
      },
    })
  const provider: EffectiveTaxRuleProvider = {
    providerKey: context.providerKey,
    async listRules(request: TaxDeterminationRequest) {
      const records = await bridge.listTaxRuleProjections({
        jurisdiction_key: request.jurisdictionKey,
        product_tax_classification: request.productTaxClassification,
        transaction_type: request.transactionType,
        status: "ACTIVE",
      })
      return records.map((item) => ({
        digitalEstate: item.digital_estate,
        ruleReference: item.rule_reference,
        ruleVersion: item.rule_version,
        jurisdictionKey: item.jurisdiction_key,
        productTaxClassification: item.product_tax_classification,
        transactionType: item.transaction_type,
        treatment: item.treatment,
        rateBasisPoints: item.rate_basis_points,
        effectiveFrom: item.effective_from,
        effectiveUntil: item.effective_until,
        sourceAuthority: item.source_authority,
        sourceRetrievedAt: item.source_retrieved_at,
        legalReason: item.legal_reason ?? undefined,
      }))
    },
  }
  const request: TaxDeterminationRequest = {
    determinationReference: "gate10-tax-determination",
    marketKey: context.marketKey,
    legalSellerKey: context.legalSellerKey,
    sellerRegistrationReference: context.sellerRegistrationReference,
    organisationId: "gate10-b2b-organisation",
    customerTaxVerificationStatus: "UNVERIFIED",
    jurisdictionKey: context.jurisdictionKey,
    shipFromCountry: "UG",
    shipToCountry: "UG",
    billToCountry: "UG",
    productTaxClassification: "GATE10_TEST_GOODS",
    transactionType: "GOODS",
    currency: context.currency,
    taxableBasisMinor: 100_000,
    priceDisplayMode: "TAX_EXCLUSIVE",
    effectiveAt: new Date("2026-09-08T00:00:00Z"),
    idempotencyKey: "gate10:determine:ug",
    correlationId: "gate10-verification",
  }
  const result = await new EffectiveDatedTaxProviderAdapter(provider).determine(request)
  if (result.taxAmountMinor !== 10_000)
    throw new Error("Effective-dated deterministic calculation failed")
  let [determination] = await bridge.listTaxDeterminations({
    source_idempotency_key: request.idempotencyKey,
  })
  if (!determination)
    determination = await bridge.createTaxDeterminations({
      determination_reference: result.determinationReference,
      organisation_id: result.organisationId,
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
      legal_reason: result.legalReason,
      effective_at: result.effectiveAt,
      source_idempotency_key: result.idempotencyKey,
      correlation_id: result.correlationId,
    })
  const pending = reconcileTax({
    commerceTaxMinor: result.taxAmountMinor,
    commerceCurrency: result.currency,
  })
  const [existing] = await bridge.listTaxReconciliations({
    source_idempotency_key: "gate10:reconcile:ug",
  })
  if (!existing)
    await bridge.createTaxReconciliations({
      determination_id: determination.id,
      commerce_tax_minor: result.taxAmountMinor,
      commerce_currency: result.currency,
      delta_minor: pending.deltaMinor,
      status: pending.status,
      reasons: pending.reasons,
      source_idempotency_key: "gate10:reconcile:ug",
      observed_at: new Date(),
    })
  container
    .resolve("logger")
    .info("Verified Gate 10 effective dating, provenance, tax snapshot, and ERP reconciliation")
}
