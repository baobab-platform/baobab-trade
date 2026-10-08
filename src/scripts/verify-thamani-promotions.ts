import type { ExecArgs, IPromotionModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_PROMOTIONS } from "../baobab/thamani/promotions"

/**
 * Read-only — safe to run against any environment, including production.
 * Checks only that `bootstrap-thamani-promotions.ts` provisioned each
 * demonstration Promotion with the configuration Gate 9 declares (code,
 * `active` status, correct `application_method` type/value/currency). It
 * never creates a Cart or applies a code: that mutation is isolated in
 * `regression-thamani-promotion-application.ts`, following the same
 * separation `verify-thamani-search.ts`/`regression-thamani-eligibility-sync.ts`
 * established for Gate 7.
 */
export default async function verifyThamaniPromotions({ container }: ExecArgs): Promise<void> {
  const promotionService = container.resolve<IPromotionModuleService>(Modules.PROMOTION)

  for (const config of THAMANI_PROMOTIONS) {
    const [promotion] = await promotionService.listPromotions(
      { code: config.code },
      { relations: ["application_method"] },
    )
    if (!promotion) throw new Error(`Expected Promotion "${config.code}" to exist`)
    if (promotion.status !== "active") {
      throw new Error(`Expected Promotion "${config.code}" to be active, got ${promotion.status}`)
    }
    if (promotion.is_automatic) {
      throw new Error(
        `Expected Promotion "${config.code}" to require an explicit code, not apply automatically`,
      )
    }

    const method = promotion.application_method
    if (!method) throw new Error(`Promotion "${config.code}" has no application_method`)
    if (method.type !== config.applicationType) {
      throw new Error(
        `Expected Promotion "${config.code}" to be ${config.applicationType}, got ${method.type}`,
      )
    }
    if (method.value !== config.value) {
      throw new Error(
        `Expected Promotion "${config.code}" value ${config.value}, got ${method.value}`,
      )
    }
    if (method.currency_code !== config.currencyCode) {
      throw new Error(
        `Expected Promotion "${config.code}" currency ${config.currencyCode}, got ${method.currency_code}`,
      )
    }
    if (method.target_type !== "items") {
      throw new Error(
        `Expected Promotion "${config.code}" to target items, got ${method.target_type}`,
      )
    }
  }

  container.resolve("logger").info("Verified Gate 9 Thamani B2C promotion configuration")
}
