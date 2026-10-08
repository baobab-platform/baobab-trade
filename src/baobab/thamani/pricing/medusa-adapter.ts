import { QueryContext } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/framework/types"
import type ThamaniModuleService from "../../../modules/thamani/service"
import {
  assertCurrencyAllowedForMarket,
  ThamaniPricingUnavailableError,
  ThamaniProductNotEligibleForMarketError,
  toThamaniPricingDecision,
  type ThamaniPricingDecision,
  type ThamaniPricingDecisionPort,
  type ThamaniPricingDecisionRequest,
} from "./decision-port"

/**
 * The initial `ThamaniPricingDecisionPort` implementation (spec §30): reads
 * Medusa's native Pricing calculation directly. Medusa resolves an
 * effective-dated `sale` Price List entirely in its own query — this
 * adapter does no date arithmetic of its own, it only classifies the result
 * (see `toThamaniPricingDecision`).
 *
 * A future `Cart -> PricingDecisionPort -> Baobab Pricing Engine` swap
 * replaces this class; `ThamaniPricingDecisionPort` callers do not change.
 */
export class MedusaThamaniPricingDecisionPort implements ThamaniPricingDecisionPort {
  constructor(
    private readonly query: RemoteQueryFunction,
    private readonly thamani: ThamaniModuleService,
  ) {}

  async decide(request: ThamaniPricingDecisionRequest): Promise<ThamaniPricingDecision> {
    // Fail closed before touching Pricing at all: Gate 6 gives every
    // variant independent UGX/ZAR prices, including single-Market SKUs, so
    // nothing else stops a caller from combining a Market with a currency
    // — or a product — it does not authorize (spec §36 Market isolation).
    assertCurrencyAllowedForMarket(request.marketKey, request.currencyCode)

    // Identity only, no `calculated_price` field: ADR-0012 PRC-COM-016
    // requires eligibility to be checked *before* price optimisation, not
    // merely before the caller sees the result. Asking Medusa to resolve
    // `calculated_price` in the same query would compute it for every
    // request, including an ineligible one.
    const { data: identityData } = await this.query.graph({
      entity: "variants",
      fields: ["id", "product_id"],
      filters: { id: [request.variantId] },
    })
    const variant = identityData[0] as { product_id?: string | null } | undefined

    if (!variant) {
      throw new ThamaniPricingUnavailableError(request.variantId, request.currencyCode)
    }
    // A returned variant with no product is not exempt from the eligibility
    // check — it cannot possess an ACTIVE Market eligibility either, so it
    // fails closed the same as an explicitly ineligible product.
    if (!variant.product_id) {
      throw new ThamaniProductNotEligibleForMarketError(request.variantId, request.marketKey)
    }

    const eligibility = await this.thamani.listMarketProductEligibilities({
      product_id: variant.product_id,
      market_key: request.marketKey,
    })
    const isEligible = eligibility.some((record) => record.status === "ACTIVE")
    if (!isEligible) {
      throw new ThamaniProductNotEligibleForMarketError(request.variantId, request.marketKey)
    }

    const { data } = await this.query.graph({
      entity: "variants",
      fields: ["id", "calculated_price.*"],
      filters: { id: [request.variantId] },
      context: {
        calculated_price: QueryContext({ currency_code: request.currencyCode }),
      },
    })

    const priced = data[0] as
      | {
          calculated_price?: {
            calculated_amount: number | null
            original_amount: number | null
            currency_code: string | null
            calculated_price?: {
              price_list_id: string | null
              price_list_type: string | null
            } | null
          }
        }
      | undefined

    return toThamaniPricingDecision(
      request,
      priced?.calculated_price ?? {
        calculated_amount: null,
        original_amount: null,
        currency_code: null,
      },
    )
  }
}
