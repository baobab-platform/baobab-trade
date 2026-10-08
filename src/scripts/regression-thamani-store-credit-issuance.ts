/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It completes a real Thamani order
 * through Medusa's own Store-API-shaped checkout (create cart, add
 * shipping method, create payment collection, create payment session,
 * complete cart), then issues three real native Order Credit Lines against
 * it — one per Gate 17 Store Credit reason (REFUND, SERVICE, PROMOTIONAL) —
 * through `issueThamaniStoreCreditWorkflow`
 * (`src/workflows/thamani-store-credit-issuance.ts`), and asserts each
 * produces a distinct, correctly-tagged ERP accounting consequence.
 *
 * Medusa provides no way to delete an order, only to cancel one; the order
 * this script completes is cancelled in `finally` so it doesn't linger as
 * fulfillable/payable, but it is not removed — a fresh CI database is
 * expected on every run, matching every other regression script here.
 *
 * `thamani-cart-eligibility-guard.ts` (Gate 14) rejects the test item
 * without an ACTIVE Market eligibility — gives it a disposable one, scoped
 * to this regression's own `policy_reference`, cleaned up in `finally`.
 */
import {
  addShippingMethodToCartWorkflow,
  cancelOrderWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createInventoryLevelsWorkflow,
  createPaymentCollectionForCartWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { DurableErpIntegrationAdapter, erpProjectionDigest } from "../baobab/erp-integration"
import type { ErpProjectionCommand } from "../baobab/erp-integration"
import {
  buildThamaniStoreCreditOrderChangeInput,
  createThamaniStoreCreditErpProjection,
  THAMANI_STORE_CREDIT_REASON_CONFIG,
  type ThamaniStoreCreditReason,
} from "../baobab/thamani/store-credit"
import { issueThamaniStoreCreditWorkflow } from "../workflows/thamani-store-credit-issuance"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
import type ThamaniModuleService from "../modules/thamani/service"

const REGRESSION_POLICY_REFERENCE = "regression:thamani-store-credit-issuance"

type OrderCreditLine = {
  id: string
  amount: number
  reference: string | null
  reference_id: string | null
}
type OrderWithCreditLines = { id: string; credit_lines?: OrderCreditLine[] }

async function resolveVariant(productService: IProductModuleService, productHandle: string) {
  const [product] = await productService.listProducts(
    { handle: productHandle },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!variant?.sku || !product) {
    throw new Error(`No product/variant found for handle "${productHandle}"`)
  }
  return { id: variant.id, sku: variant.sku, productId: product.id }
}

async function ensureInventoryLevel(
  container: ExecArgs["container"],
  inventoryService: IInventoryService,
  sku: string,
  stockLocationId: string,
) {
  const [inventoryItem] = await inventoryService.listInventoryItems({ sku })
  if (!inventoryItem) throw new Error(`No inventory item for SKU "${sku}"`)
  const [existingLevel] = await inventoryService.listInventoryLevels({
    inventory_item_id: inventoryItem.id,
    location_id: stockLocationId,
  })
  if (existingLevel) return
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItem.id,
          location_id: stockLocationId,
          stocked_quantity: 100,
        },
      ],
    },
  })
}

async function readOrderCreditLines(
  container: ExecArgs["container"],
  orderId: string,
): Promise<readonly OrderCreditLine[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "credit_lines.id",
      "credit_lines.amount",
      "credit_lines.reference",
      "credit_lines.reference_id",
    ],
    filters: { id: [orderId] },
  })
  return (data[0] as OrderWithCreditLines | undefined)?.credit_lines ?? []
}

export default async function regressionThamaniStoreCreditIssuance({
  container,
}: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const paymentService = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")

  const regions = await regionService.listRegions({}, { relations: ["countries"] })
  const ugandaRegion = findByCountryCode(regions, "UG")
  if (!ugandaRegion) throw new Error("No Uganda region provisioned — run bootstrap:market first")

  const salesChannels = await salesChannelService.listSalesChannels({})
  const thamaniSalesChannel = findByMetadataKey(
    salesChannels,
    "baobab_sales_channel_key",
    "thamani_b2c",
  )
  if (!thamaniSalesChannel) throw new Error("Run bootstrap:thamani-market before this regression")

  const stockLocations = await stockLocationService.listStockLocations({})
  const thamaniUgandaStockLocation = findByMarketKey(stockLocations, "thamani_ug")
  if (!thamaniUgandaStockLocation)
    throw new Error("No Thamani Uganda stock location — run bootstrap:thamani-market first")

  const [shippingOption] = await fulfillmentService.listShippingOptions({
    name: "Thamani Uganda Standard Shipping (development placeholder rate)",
  })
  if (!shippingOption)
    throw new Error("Thamani Uganda has no shipping option — run bootstrap:thamani-market first")

  const variant = await resolveVariant(productService, "thamani-instant-coffee-200g")
  await ensureInventoryLevel(
    container,
    inventoryService,
    variant.sku,
    thamaniUgandaStockLocation.id,
  )

  const [existingEligibility] = await thamani.listMarketProductEligibilities({
    product_id: variant.productId,
    market_key: "thamani_ug",
  })
  if (!existingEligibility) {
    await thamani.createMarketProductEligibilities({
      product_id: variant.productId,
      market_key: "thamani_ug",
      status: "ACTIVE",
      policy_reference: REGRESSION_POLICY_REFERENCE,
    })
  }

  let orderId: string | undefined
  try {
    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: ugandaRegion.id,
        sales_channel_id: thamaniSalesChannel.id,
        items: [{ variant_id: variant.id, quantity: 1 }],
        email: "regression-store-credit@example.invalid",
      },
    })
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: cart.id, options: [{ id: shippingOption.id }] },
    })
    const paymentCollection = await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })
    const session = await paymentService.createPaymentSession(paymentCollection.result.id, {
      provider_id: "pp_system_default",
      currency_code: cart.currency_code,
      amount: paymentCollection.result.amount ?? cart.total ?? 0,
      data: {},
    })
    if (session.status !== "pending")
      throw new Error(`Expected a pending payment session, got ${session.status}`)
    const { result: order } = await completeCartWorkflow(container).run({ input: { id: cart.id } })
    orderId = order.id

    const adapter = new DurableErpIntegrationAdapter({
      async findByIdempotencyKey(key) {
        const [item] = await erp.listErpProjections({ source_idempotency_key: key })
        if (!item) return undefined
        return {
          id: item.id,
          commandDigest:
            item.command_digest ??
            erpProjectionDigest({
              kind: item.kind,
              commerceReference: item.commerce_reference,
              canonicalEntityId: item.canonical_entity_id,
              legalSellerKey: item.legal_seller_key,
              marketKey: item.market_key,
              payload: item.payload as Record<string, unknown>,
              idempotencyKey: item.source_idempotency_key,
              correlationId: item.correlation_id,
            }),
        }
      },
      async create(command: ErpProjectionCommand & { commandDigest: string }) {
        return erp.createErpProjections({
          kind: command.kind,
          commerce_reference: command.commerceReference,
          canonical_entity_id: command.canonicalEntityId,
          legal_seller_key: command.legalSellerKey,
          market_key: command.marketKey,
          owner_legal_entity_id: "canonical:legal-entity:thamani",
          digital_estate: "estate:thamani-b2c",
          payload: command.payload,
          status: "PENDING",
          source_idempotency_key: command.idempotencyKey,
          command_digest: command.commandDigest,
          correlation_id: command.correlationId,
        })
      },
    })

    const issuances: {
      reason: ThamaniStoreCreditReason
      referenceId?: string
      amountMinor: number
    }[] = [
      { reason: "REFUND", referenceId: "return_gate17_regression", amountMinor: 1_000 },
      { reason: "SERVICE", amountMinor: 500 },
      {
        reason: "PROMOTIONAL",
        referenceId: "policy:thamani_ug:promo:gate17_regression",
        amountMinor: 250,
      },
    ]
    for (const issuance of issuances) {
      const { result: issuedCreditLine } = await issueThamaniStoreCreditWorkflow(container).run({
        input: {
          orderId: order.id,
          amountMinor: issuance.amountMinor,
          reason: issuance.reason,
          referenceId: issuance.referenceId,
          serviceJustification:
            issuance.reason === "SERVICE" ? "Late delivery goodwill credit" : undefined,
        },
      })
      const config = THAMANI_STORE_CREDIT_REASON_CONFIG[issuance.reason]
      if (issuedCreditLine.reference !== config.reference)
        throw new Error(`Workflow returned the wrong reference tag for ${issuance.reason}`)
    }

    const creditLines = await readOrderCreditLines(container, order.id)
    if (creditLines.length !== 3)
      throw new Error(`Expected 3 order credit lines, found ${creditLines.length}`)
    for (const issuance of issuances) {
      const config = THAMANI_STORE_CREDIT_REASON_CONFIG[issuance.reason]
      const line = creditLines.find((candidate) => candidate.reference === config.reference)
      if (!line) throw new Error(`Missing order credit line for reason ${issuance.reason}`)
      if (line.reference !== config.reference)
        throw new Error(`Wrong reference tag on ${issuance.reason} credit line`)
      if (Number(line.amount) !== issuance.amountMinor)
        throw new Error(`Wrong amount on ${issuance.reason} credit line`)
      if (issuance.referenceId && line.reference_id !== issuance.referenceId)
        throw new Error(`Wrong referenceId on ${issuance.reason} credit line`)

      const command = createThamaniStoreCreditErpProjection({
        reason: issuance.reason,
        orderId: order.id,
        creditLineId: line.id,
        legalSellerKey: "thamani-uganda",
        marketKey: "thamani_ug",
        amountMinor: issuance.amountMinor,
        currency: "UGX",
        sourceVersion: 1,
        correlationId: "17171717-1717-4717-8717-171717171717",
      })
      const first = await adapter.queue(command)
      if ((await adapter.queue(command)).id !== first.id)
        throw new Error(`${issuance.reason} store credit ERP projection is not replay-safe`)
      const [projected] = await erp.listErpProjections({ id: first.id })
      const payload = projected.payload as Record<string, unknown>
      if (payload.erp_financial_consequence !== config.erpFinancialConsequence)
        throw new Error(
          `${issuance.reason} store credit projected the wrong ERP financial consequence`,
        )
    }

    let rejectedNonPositiveAmount = false
    try {
      buildThamaniStoreCreditOrderChangeInput({
        orderId: order.id,
        amountMinor: 0,
        reason: "SERVICE",
      })
    } catch {
      rejectedNonPositiveAmount = true
    }
    if (!rejectedNonPositiveAmount) throw new Error("Expected a non-positive amount to be rejected")

    let rejectedMissingReferenceId = false
    try {
      buildThamaniStoreCreditOrderChangeInput({
        orderId: order.id,
        amountMinor: 100,
        reason: "REFUND",
      })
    } catch {
      rejectedMissingReferenceId = true
    }
    if (!rejectedMissingReferenceId)
      throw new Error("Expected a REFUND credit with no referenceId to be rejected")

    let rejectedMissingServiceJustification = false
    try {
      buildThamaniStoreCreditOrderChangeInput({
        orderId: order.id,
        amountMinor: 100,
        reason: "SERVICE",
      })
    } catch {
      rejectedMissingServiceJustification = true
    }
    if (!rejectedMissingServiceJustification)
      throw new Error("Expected a SERVICE credit with no referenceId/justification to be rejected")
  } finally {
    if (orderId) await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
    if (!existingEligibility) {
      const disposable = await thamani.listMarketProductEligibilities({
        product_id: variant.productId,
        market_key: "thamani_ug",
        policy_reference: REGRESSION_POLICY_REFERENCE,
      })
      if (disposable.length)
        await thamani.deleteMarketProductEligibilities(disposable.map((e) => e.id))
    }
  }

  container
    .resolve("logger")
    .info(
      "Verified Gate 17 Thamani store credit: three reasoned Order Credit Lines with distinct, replay-safe ERP financial consequences",
    )
}
