/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. Gate 22: gives the deterministic
 * Thamani simulation pack (`src/baobab/thamani/simulation`) real, persisted
 * consequences rather than the fabricated `SIM:...` literals the ZuriBeans
 * Gate 18 version stopped at. Creates all 50 simulation consumers as real
 * Customers (idempotent, left durable — matching the catalogue/supplier
 * data's own convention), then runs the three order scenarios through
 * Medusa's own Store-API-shaped checkout end to end: a domestic Uganda
 * order (captured payment), a domestic South Africa order that is then
 * returned and refunded (the first real exercise of a return/refund
 * workflow anywhere in this codebase), and a Uganda order sourced from an
 * import-origin supplier (cross-border consequence). Each produces a real
 * stock decrement and real ERP projections.
 *
 * Medusa provides no way to delete an order, only to cancel one; all three
 * orders this script completes are cancelled in `finally` so they don't
 * linger as fulfillable/payable, matching every other regression script
 * here. A fresh CI database is expected on every run.
 */
import {
  addShippingMethodToCartWorkflow,
  cancelOrderWorkflow,
  capturePaymentWorkflow,
  completeCartWorkflow,
  createAndCompleteReturnOrderWorkflow,
  createCartWorkflow,
  createCustomersWorkflow,
  createInventoryLevelsWorkflow,
  createOrderFulfillmentWorkflow,
  createPaymentCollectionForCartWorkflow,
  createShippingOptionsWorkflow,
  refundPaymentWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  ICustomerModuleService,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DurableErpIntegrationAdapter, erpProjectionDigest } from "../baobab/erp-integration"
import type { ErpProjectionCommand } from "../baobab/erp-integration"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { createThamaniErpProjection } from "../baobab/thamani/erp-integration"
import {
  assertThamaniSimulationDataset,
  THAMANI_SIMULATION_CONSUMERS,
  THAMANI_SIMULATION_ORDER_SCENARIOS,
  THAMANI_SIMULATION_VERSION,
  type ThamaniSimulationOrderScenario,
} from "../baobab/thamani/simulation"
import { getThamaniSupplierConfig } from "../baobab/thamani/suppliers"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
import type ThamaniModuleService from "../modules/thamani/service"

const REGRESSION_POLICY_REFERENCE = "regression:thamani-simulation-pack"
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222"

function required<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message)
  return value
}

async function ensureSimulationConsumers(
  container: ExecArgs["container"],
  customerService: ICustomerModuleService,
) {
  const emails = THAMANI_SIMULATION_CONSUMERS.map((consumer) => consumer.email)
  const existing = await customerService.listCustomers({ email: emails })
  const existingEmails = new Set(existing.map((customer) => customer.email))
  const missing = THAMANI_SIMULATION_CONSUMERS.filter(
    (consumer) => !existingEmails.has(consumer.email),
  )
  if (missing.length === 0) return
  await createCustomersWorkflow(container).run({
    input: {
      customersData: missing.map((consumer) => ({
        email: consumer.email,
        first_name: consumer.firstName,
        last_name: consumer.lastName,
        phone: consumer.phone,
        metadata: {
          simulation_reference: consumer.reference,
          simulation_market: consumer.marketKey,
        },
      })),
    },
  })
}

async function resolveVariant(productService: IProductModuleService, productHandle: string) {
  const [product] = await productService.listProducts(
    { handle: productHandle },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!variant?.sku || !product)
    throw new Error(`No product/variant found for handle "${productHandle}"`)
  return { id: variant.id, sku: variant.sku, productId: product.id }
}

async function ensureMarketEligibility(
  thamani: ThamaniModuleService,
  productId: string,
  marketKey: string,
): Promise<boolean> {
  const [existing] = await thamani.listMarketProductEligibilities({
    product_id: productId,
    market_key: marketKey,
  })
  if (existing) return false
  await thamani.createMarketProductEligibilities({
    product_id: productId,
    market_key: marketKey,
    status: "ACTIVE",
    policy_reference: REGRESSION_POLICY_REFERENCE,
  })
  return true
}

async function ensureInventoryLevel(
  container: ExecArgs["container"],
  inventoryService: IInventoryService,
  sku: string,
  stockLocationId: string,
  stockedQuantity: number,
) {
  const [inventoryItem] = await inventoryService.listInventoryItems({ sku })
  if (!inventoryItem) throw new Error(`No inventory item for SKU "${sku}"`)
  const [existingLevel] = await inventoryService.listInventoryLevels({
    inventory_item_id: inventoryItem.id,
    location_id: stockLocationId,
  })
  if (existingLevel) return existingLevel.stocked_quantity - existingLevel.reserved_quantity
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItem.id,
          location_id: stockLocationId,
          stocked_quantity: stockedQuantity,
        },
      ],
    },
  })
  return stockedQuantity
}

/**
 * `createAndCompleteReturnOrderWorkflow` needs a shipping option flagged
 * `is_return` to build the return's fulfillment — Thamani's market bootstrap
 * only ever provisions the outbound "standard delivery" option, so this is
 * the first Gate that needs a return-eligible one. Scoped to the same
 * service zone/profile/provider as the outbound option (already bound to
 * this Market's stock location and fulfillment provider) so it inherits the
 * same location the return fulfillment resolves against.
 */
async function ensureReturnShippingOption(
  container: ExecArgs["container"],
  fulfillmentService: IFulfillmentModuleService,
  outboundShippingOption: {
    service_zone_id: string
    shipping_profile_id: string
    provider_id: string
  },
  name: string,
  currencyCode: string,
) {
  const [existing] = await fulfillmentService.listShippingOptions({
    name,
    service_zone: { id: outboundShippingOption.service_zone_id },
  })
  if (existing) return existing
  const { result: created } = await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name,
        service_zone_id: outboundShippingOption.service_zone_id,
        shipping_profile_id: outboundShippingOption.shipping_profile_id,
        provider_id: outboundShippingOption.provider_id,
        type: { label: "Return", description: "Return shipping", code: "return" },
        price_type: "flat",
        prices: [{ amount: 0, currency_code: currencyCode }],
        rules: [{ attribute: "is_return", operator: "eq", value: "true" }],
      },
    ],
  })
  return created[0]
}

/**
 * The real stock consequence to check is the reservation the order actually
 * created, not the available quantity at whichever stock location we
 * happened to seed — Thamani's UG and ZA Markets share one Sales Channel,
 * so Medusa's own reservation strategy is free to reserve against either
 * linked Stock Location, not necessarily the one this script guessed.
 */
async function readReservedQuantityForLineItem(
  inventoryService: IInventoryService,
  lineItemId: string,
) {
  const reservations = await inventoryService.listReservationItems({ line_item_id: lineItemId })
  return reservations.reduce((total, reservation) => total + Number(reservation.quantity), 0)
}

type QueriedOrder = {
  id: string
  items?: { id: string }[]
  payment_collections?: {
    payments?: { id: string; captured_at: string | null; amount: number }[]
  }[]
}

async function readOrder(container: ExecArgs["container"], orderId: string): Promise<QueriedOrder> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "payment_collections.payments.id",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.amount",
    ],
    filters: { id: [orderId] },
  })
  return data[0] as QueriedOrder
}

export default async function regressionThamaniSimulationPack({
  container,
}: ExecArgs): Promise<void> {
  assertThamaniSimulationDataset()

  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const paymentService = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const customerService = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")

  await ensureSimulationConsumers(container, customerService)

  const regions = await regionService.listRegions({}, { relations: ["countries"] })
  const salesChannels = await salesChannelService.listSalesChannels({})
  const thamaniSalesChannelId = required(
    findByMetadataKey(salesChannels, "baobab_sales_channel_key", "thamani_b2c")?.id,
    "Run bootstrap:thamani-market before this regression",
  )

  const stockLocations = await stockLocationService.listStockLocations({})
  const [ugShippingOption] = await fulfillmentService.listShippingOptions({
    name: "Thamani Uganda Standard Shipping (development placeholder rate)",
  })
  const [zaShippingOption] = await fulfillmentService.listShippingOptions({
    name: "Thamani South Africa Standard Shipping (development placeholder rate)",
  })
  const ugRegion = required(
    findByCountryCode(regions, "UG"),
    "No Uganda region — run bootstrap:market first",
  )
  const zaRegion = required(
    findByCountryCode(regions, "ZA"),
    "No South Africa region — run bootstrap:market first",
  )
  const requiredUgShippingOption = required(
    ugShippingOption,
    "No Thamani Uganda shipping option — run bootstrap:thamani-market first",
  )
  const requiredZaShippingOption = required(
    zaShippingOption,
    "No Thamani South Africa shipping option — run bootstrap:thamani-market first",
  )
  const ugReturnShippingOption = await ensureReturnShippingOption(
    container,
    fulfillmentService,
    requiredUgShippingOption,
    "Thamani Uganda Return Shipping (development placeholder rate)",
    ugRegion.currency_code,
  )
  const zaReturnShippingOption = await ensureReturnShippingOption(
    container,
    fulfillmentService,
    requiredZaShippingOption,
    "Thamani South Africa Return Shipping (development placeholder rate)",
    zaRegion.currency_code,
  )

  const marketContext = {
    thamani_ug: {
      region: ugRegion,
      stockLocation: required(
        findByMarketKey(stockLocations, "thamani_ug"),
        "No Thamani Uganda stock location — run bootstrap:thamani-market first",
      ),
      shippingOption: requiredUgShippingOption,
      returnShippingOption: ugReturnShippingOption,
      legalSellerKey: "thamani-uganda" as const,
    },
    thamani_za: {
      region: zaRegion,
      stockLocation: required(
        findByMarketKey(stockLocations, "thamani_za"),
        "No Thamani South Africa stock location — run bootstrap:thamani-market first",
      ),
      shippingOption: requiredZaShippingOption,
      returnShippingOption: zaReturnShippingOption,
      legalSellerKey: "thamani-south-africa" as const,
    },
  }

  const createdOrderIds: string[] = []
  const createdEligibility: { productId: string; marketKey: string }[] = []

  async function runScenario(scenario: ThamaniSimulationOrderScenario) {
    const { region, stockLocation, shippingOption, returnShippingOption, legalSellerKey } =
      marketContext[scenario.marketKey]

    const consumer = THAMANI_SIMULATION_CONSUMERS.find(
      (candidate) => candidate.reference === scenario.consumerReference,
    )
    if (!consumer) throw new Error(`Unknown simulation consumer for ${scenario.reference}`)
    const supplier = getThamaniSupplierConfig(scenario.supplierKey)
    const variant = await resolveVariant(productService, scenario.productHandle)

    const createdThisEligibility = await ensureMarketEligibility(
      thamani,
      variant.productId,
      scenario.marketKey,
    )
    if (createdThisEligibility)
      createdEligibility.push({ productId: variant.productId, marketKey: scenario.marketKey })

    await ensureInventoryLevel(container, inventoryService, variant.sku, stockLocation.id, 50)

    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: thamaniSalesChannelId,
        items: [{ variant_id: variant.id, quantity: scenario.quantity }],
        email: consumer.email,
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
      throw new Error(`Expected a pending payment session for ${scenario.reference}`)
    const { result: order } = await completeCartWorkflow(container).run({ input: { id: cart.id } })
    createdOrderIds.push(order.id)

    const queried = await readOrder(container, order.id)
    const payment = queried.payment_collections?.[0]?.payments?.[0]
    if (!payment) throw new Error(`No payment found for ${scenario.reference}`)

    await capturePaymentWorkflow(container).run({ input: { payment_id: payment.id } })
    const afterCapture = await readOrder(container, order.id)
    const capturedPayment = afterCapture.payment_collections?.[0]?.payments?.[0]
    if (!capturedPayment?.captured_at)
      throw new Error(`Payment did not capture for ${scenario.reference}`)

    const lineItemId = afterCapture.items?.[0]?.id
    if (!lineItemId) throw new Error(`No order line item found for ${scenario.reference}`)
    const reservedQuantity = await readReservedQuantityForLineItem(inventoryService, lineItemId)
    if (reservedQuantity !== scenario.quantity)
      throw new Error(
        `Stock reservation is wrong for ${scenario.reference}: expected ${scenario.quantity}, got ${reservedQuantity}`,
      )

    const erpBase = {
      legalSellerKey,
      marketKey: scenario.marketKey,
      sourceVersion: 1,
      correlationId: CORRELATION_ID,
    } as const
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

    await adapter.queue(
      createThamaniErpProjection({
        ...erpBase,
        kind: "ORDER",
        commerceReference: scenario.erp.order,
        canonicalEntityId: `canonical:thamani:order:${scenario.reference}`,
        payload: {
          order_id: order.id,
          supplier_key: scenario.supplierKey,
          cross_border_import: scenario.crossBorderImport,
          supplier_origin_country: supplier.originCountry,
        },
      }),
    )
    await adapter.queue(
      createThamaniErpProjection({
        ...erpBase,
        kind: "PAYMENT",
        commerceReference: scenario.erp.payment,
        canonicalEntityId: `canonical:thamani:payment:${scenario.reference}`,
        payload: { order_id: order.id, payment_id: payment.id, status: "CAPTURED" },
      }),
    )

    if (scenario.outcome === "REFUNDED") {
      // A return can only be requested for a fulfilled quantity — Medusa's
      // own `create-complete-return` workflow validates against
      // `fulfilled_quantity`, which stays zero until a real fulfillment
      // exists. Every other scenario in this pack stops at "captured" on
      // purpose, so this only runs for the one scenario that actually
      // exercises the return/refund path.
      await createOrderFulfillmentWorkflow(container).run({
        input: {
          order_id: order.id,
          items: [{ id: lineItemId, quantity: scenario.quantity }],
        },
      })
      await createAndCompleteReturnOrderWorkflow(container).run({
        input: {
          order_id: order.id,
          items: [{ id: lineItemId, quantity: scenario.quantity }],
          return_shipping: { option_id: returnShippingOption.id },
        },
      })
      await refundPaymentWorkflow(container).run({
        input: { payment_id: capturedPayment.id, amount: capturedPayment.amount },
      })
      if (!scenario.erp.returnRefund)
        throw new Error(
          `Simulation scenario ${scenario.reference} is missing its ERP return/refund expectation`,
        )
      await adapter.queue(
        createThamaniErpProjection({
          ...erpBase,
          kind: "RETURN_REFUND",
          commerceReference: scenario.erp.returnRefund,
          canonicalEntityId: `canonical:thamani:return-refund:${scenario.reference}`,
          payload: {
            order_id: order.id,
            payment_id: payment.id,
            refunded_amount: capturedPayment.amount,
          },
        }),
      )
    }
  }

  try {
    for (const scenario of THAMANI_SIMULATION_ORDER_SCENARIOS) {
      await runScenario(scenario)
    }
  } finally {
    for (const orderId of createdOrderIds) {
      await cancelOrderWorkflow(container)
        .run({ input: { order_id: orderId } })
        .catch(() => undefined)
    }
    for (const { productId, marketKey } of createdEligibility) {
      const disposable = await thamani.listMarketProductEligibilities({
        product_id: productId,
        market_key: marketKey,
        policy_reference: REGRESSION_POLICY_REFERENCE,
      })
      if (disposable.length)
        await thamani.deleteMarketProductEligibilities(disposable.map((e) => e.id))
    }
  }

  container
    .resolve("logger")
    .info(
      `Verified ${THAMANI_SIMULATION_VERSION}: ${THAMANI_SIMULATION_CONSUMERS.length} consumers persisted, ${THAMANI_SIMULATION_ORDER_SCENARIOS.length} orders completed with captured payments, ${THAMANI_SIMULATION_ORDER_SCENARIOS.filter((s) => s.outcome === "REFUNDED").length} returned and refunded, ${THAMANI_SIMULATION_ORDER_SCENARIOS.filter((s) => s.crossBorderImport).length} cross-border import, and real ERP consequences queued for each`,
    )
}
