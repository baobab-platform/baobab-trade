import type {
  ITaxProvider,
  ItemTaxCalculationLine,
  ItemTaxLineDTO,
  ShippingTaxCalculationLine,
  ShippingTaxLineDTO,
  TaxCalculationContext,
} from "@medusajs/framework/types"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../../baobab/context/digital-estates"
import { selectEffectiveRule } from "../../baobab/tax"
import { THAMANI_STANDARD_TAX_RULES } from "../../baobab/thamani/tax"

export type ThamaniProductTaxCategory = "STANDARD" | "ZERO_RATED" | "EXEMPT"

export type ThamaniTaxLineContext = {
  digitalEstate: typeof THAMANI_DIGITAL_ESTATE_CANONICAL_ID
  itemTaxCategoryByLineItemId: Record<string, ThamaniProductTaxCategory>
}

const isThamaniTaxContext = (value: unknown): value is ThamaniTaxLineContext =>
  typeof value === "object" &&
  value !== null &&
  (value as { digitalEstate?: unknown }).digitalEstate === THAMANI_DIGITAL_ESTATE_CANONICAL_ID

/**
 * Wraps Baobab's own reference GOODS tax rules (Gate 13,
 * `THAMANI_STANDARD_TAX_RULES`) so a Thamani B2C cart's item tax is computed
 * from real, sourced VAT rates instead of Medusa's default 0% — no
 * `tax_rate` row is ever seeded for either Market (see `provisioning.ts`),
 * so without this provider every cart's tax is silently zero.
 *
 * A Tax Provider's own container is module-isolated (`moduleProviderLoader`
 * gives it only its own module's resources, never a sibling module's
 * service), so it cannot itself resolve the `thamani` or `sales-channel`
 * services to determine which cart this is or what a line item's product is
 * classified as. Both are resolved instead by `thamani-tax-guard.ts`'s
 * `setTaxLineContext` workflow hook — which runs with full app-container
 * access — and handed to this provider through `additional_context`. This
 * provider only ever reads `additional_context`; it never reaches outside
 * its own module.
 *
 * Medusa enforces exactly one Tax Region (and so one provider) per country,
 * and ZuriBeans shares that same Tax Region with Thamani in both launch
 * countries. Any item this provider cannot positively identify as Thamani's
 * (no entry in `itemTaxCategoryByLineItemId` — a non-Thamani cart, a line
 * the hook could not classify) is passed straight through using its
 * already-matched native `rates`, replicating the bundled `SystemTaxService`
 * exactly, so ZuriBeans' tax computation never changes. Shipping tax is
 * always native passthrough too, for both Digital Estates: no `SHIPPING`
 * transaction rules exist yet in `THAMANI_STANDARD_TAX_RULES` — that remains
 * a later, separate gate, not something to invent here.
 */
export default class ThamaniTaxProviderService implements ITaxProvider {
  static identifier = "thamani_effective_dated"

  getIdentifier(): string {
    return ThamaniTaxProviderService.identifier
  }

  async getTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const thamaniContext = isThamaniTaxContext(context.additional_context)
      ? context.additional_context
      : undefined
    const jurisdictionKey = context.address.country_code.toUpperCase()

    const itemTaxLines: ItemTaxLineDTO[] = itemLines.flatMap((line): ItemTaxLineDTO[] => {
      const category = thamaniContext?.itemTaxCategoryByLineItemId[line.line_item.id]
      if (!category) {
        return line.rates.map((rate) => ({
          rate_id: rate.id,
          rate: rate.rate || 0,
          name: rate.name,
          code: rate.code,
          line_item_id: line.line_item.id,
          provider_id: this.getIdentifier(),
        }))
      }

      // Fails closed (throws, aborting the whole tax calculation) when no
      // single effective rule matches — e.g. a ZERO_RATED/EXEMPT item today,
      // since only STANDARD GOODS rules have been sourced and verified so
      // far. That is a real, acknowledged gap in the rule set, not something
      // this provider should paper over with an invented rate.
      const rule = selectEffectiveRule(
        THAMANI_STANDARD_TAX_RULES.filter(
          (candidate) =>
            candidate.jurisdictionKey === jurisdictionKey &&
            candidate.productTaxClassification === category &&
            candidate.transactionType === "GOODS",
        ),
        new Date(),
        THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
      )
      return [
        {
          rate: rule.rateBasisPoints / 100,
          code: rule.ruleReference,
          name: `Thamani ${category} VAT (${jurisdictionKey})`,
          line_item_id: line.line_item.id,
          provider_id: this.getIdentifier(),
        },
      ]
    })

    const shippingTaxLines: ShippingTaxLineDTO[] = shippingLines.flatMap((line) =>
      line.rates.map((rate) => ({
        rate_id: rate.id,
        rate: rate.rate || 0,
        name: rate.name,
        code: rate.code,
        shipping_line_id: line.shipping_line.id,
        provider_id: this.getIdentifier(),
      })),
    )

    return [...itemTaxLines, ...shippingTaxLines]
  }
}
