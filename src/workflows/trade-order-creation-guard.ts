/**
 * ADR-SHARED-039 Trade-A TA-06: Medusa's createOrderWorkflow (direct order
 * creation, and the admin draft-order create route) is registered here as
 * a side effect of import, like the other workflow guards.
 *
 * Its only pre-commit hook, setPricingContext, runs before createOrdersStep
 * but sees neither the order's sales channel, currency nor identity, so it
 * cannot attribute or authorise a commitment. Outside the explicit local
 * sandbox the workflow is therefore denied before any order row is written.
 * Returning no pricing context leaves native pricing unchanged.
 */
import { createOrderWorkflow } from "@medusajs/core-flows"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  assertUngovernedOrderCreationDenied,
  tradeAEnvironment,
} from "../baobab/orders/trade-a-entry-points"

createOrderWorkflow.hooks.setPricingContext(async () => {
  assertUngovernedOrderCreationDenied(tradeAEnvironment())
  return new StepResponse(undefined)
})
