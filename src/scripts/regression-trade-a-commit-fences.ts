/**
 * ADR-SHARED-039 Trade-A TA-07 disposable PostgreSQL / real Medusa acceptance
 * for the native order commit fences (Migration20261021090000).
 *
 * Real Thamani carts, the real completeCartWorkflow, createOrderWorkflow and
 * convertDraftOrderWorkflow, and the real attestation, attribution, receipt
 * and commitment stores. The TA-05 PEP runs in explicit local enforcement;
 * only its CP and IAM ports are EXPLICITLY SYNTHETIC. Direct SQL proves the
 * fences hold without Medusa: a session opts into the ENFORCED posture, which
 * it may strengthen but never weaken.
 *
 * LOCAL_TESTED, engine-local evidence (EA v2.3 §3.3): not L4, not EA Gate D,
 * not protected staging. Refuses a non-test or unmarked database.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool, type PoolClient } from "pg"
import { asValue } from "@medusajs/framework/awilix"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  convertDraftOrderWorkflow,
  createCartWorkflow,
  createInventoryLevelsWorkflow,
  createOrderWorkflow,
  createPaymentCollectionForCartWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  ICartModuleService,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { TradeBuyerExecutionContext } from "../baobab/b2b/buyer-authority"
import {
  PostgresBuyerAuthorityReceiptStore,
  type BuyerAuthorityReceipt,
} from "../baobab/b2b/buyer-authority-receipt-store"
import { PostgresSpendReservationCommands } from "../baobab/b2b/spend-reservation-commands"
import type { TradeAOperationClass } from "../baobab/control-plane/trade-order-authority"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { PostgresCommitmentAttributionStore } from "../baobab/orders/commitment-attribution"
import { medusaNativeSellerFacts } from "../baobab/orders/medusa-native-seller-facts"
import {
  attestNativeSellerConfiguration,
  PostgresNativeConfigurationAttestationStore,
} from "../baobab/orders/native-configuration-attestation"
import {
  classifyNativeCommitment,
  PostgresClassificationStore,
} from "../baobab/orders/native-commitment-classification"
import { PostgresAttestedNativeConfigurationReader } from "../baobab/orders/native-configuration-resolver"
import {
  PostgresOrderAuthorityReceiptStore,
  type OrderAuthorityEnforcementDependencies,
} from "../baobab/orders/order-authority-enforcement"
import type { PgPool } from "../baobab/orders/postgres-governed-binding-persistence"
import {
  governOrderEntry,
  TRADE_A_ENFORCEMENT_ENV,
  tradeAEnvironment,
  tradeAOperationReference,
} from "../baobab/orders/trade-a-entry-points"
import { TRADE_A_DEPENDENCY_KEY } from "../baobab/orders/trade-a-runtime"
import type ThamaniModuleService from "../modules/thamani/service"

const POLICY_REFERENCE = "regression:trade-a-ta07-commit-fences"
const ENGINE = "ei_ta07regression"
const TENANT = "tn_ta07regression"
// Decision 8: an EXPLICITLY SYNTHETIC estate, CP Market ids and profiles.
const ESTATE = "estate_ta07regression"
const ACTIVITY: Record<TradeAOperationClass, string> = {
  "trade.order.commit": "CHECKOUT_ORDER_COMMITMENT",
  "trade.order.create": "DIRECT_ORDER_COMMITMENT",
  "trade.draft-order.finalize": "DRAFT_ORDER_FINALISATION",
}

/** Workflow failures are rethrown serialised ({ message, ... }), not as Error. */
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | undefined)?.message ?? "")

const refused = async (what: string, run: () => Promise<unknown>, pattern: RegExp) => {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  )
  assert.ok(error, `${what} was not refused`)
  assert.match(messageOf(error), pattern, `${what}: wrong refusal`)
}

export default async function regressionTradeACommitFences({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_LA05_NATIVE_CHECKOUT_GUARD === "true" ||
    process.env.BAOBAB_ENVIRONMENT !== undefined ||
    process.env.BAOBAB_DEPLOYMENT_ENV !== undefined ||
    process.env[TRADE_A_ENFORCEMENT_ENV] !== undefined ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Trade-A commit-fence regression requires the explicitly marked disposable test database",
    )
  }
  const pool = new Pool({ connectionString: url, max: 6 })
  const pg: PgPool = {
    connect: async () => {
      const client = await pool.connect()
      return {
        query: (sql, values) => client.query(sql, values ? [...values] : []),
        release: () => client.release(),
      }
    },
  }
  const carts = container.resolve<ICartModuleService>(Modules.CART)
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const locations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  const fulfillment = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const payments = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const uganda = findByCountryCode(
    await regions.listRegions({}, { relations: ["countries"] }),
    "UG",
  )
  const channel = findByMetadataKey(
    await channels.listSalesChannels({}),
    "baobab_sales_channel_key",
    "thamani_b2c",
  )
  const location = findByMarketKey(await locations.listStockLocations({}), "thamani_ug")
  const [shipping] = await fulfillment.listShippingOptions({
    name: "Thamani Uganda Standard Shipping (development placeholder rate)",
  })
  if (!uganda || !channel || !location || !shipping)
    throw new Error("Run the Thamani market, catalogue and fulfilment bootstraps first")
  const [product] = await products.listProducts(
    { handle: "thamani-instant-coffee-200g" },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!product || !variant?.sku) throw new Error("Thamani regression product missing")
  const [item] = await inventory.listInventoryItems({ sku: variant.sku })
  const [level] = item
    ? await inventory.listInventoryLevels({ inventory_item_id: item.id, location_id: location.id })
    : []
  if (item && !level)
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: [
          { inventory_item_id: item.id, location_id: location.id, stocked_quantity: 100 },
        ],
      },
    })
  const [eligible] = await thamani.listMarketProductEligibilities({
    product_id: product.id,
    market_key: "thamani_ug",
  })
  if (!eligible)
    await thamani.createMarketProductEligibilities({
      product_id: product.id,
      market_key: "thamani_ug",
      status: "ACTIVE",
      policy_reference: POLICY_REFERENCE,
    })

  const organisationId = randomUUID()
  const bindingId = randomUUID()
  const context = (tenantId: string, orgId: string, country?: string) => ({
    context_id: randomUUID(),
    tenant_id: tenantId,
    organisation_id: orgId,
    organisation_type: "ORGANISATION",
    country_code: country ?? "UG",
    resolved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  })

  // Trade attests the live Thamani Uganda configuration (synthetic CP ports).
  await attestNativeSellerConfiguration(
    {
      reference: `trade/native-seller-configuration/ta07-${randomUUID()}`,
      tenantId: TENANT,
      organisationId,
      market: "UG",
      engineInstanceId: ENGINE,
      currencyScope: ["UGX"],
      salesChannelIds: [channel.id],
      regionIds: [uganda.id],
    },
    {
      facts: medusaNativeSellerFacts(container),
      store: new PostgresNativeConfigurationAttestationStore(pg),
      tokens: { getAccessToken: async () => "synthetic-workload-token" },
      controlPlane: {
        resolvePlatformContext: async (tenantId, orgId, _t, _c, _type, country) =>
          context(tenantId, orgId, country),
      },
      attestations: {
        attest: async (request, scope) => ({
          attestation_id: randomUUID(),
          tenant_id: scope.tenantId,
          operating_organisation_id: scope.organisationId,
          market: scope.market,
          engine_instance_id: request.engine_instance_id,
          native_configuration_reference: request.native_configuration_reference,
          native_configuration_digest: request.native_configuration_digest,
          currency_scope: request.currency_scope,
          attested_at: request.attested_at,
          recorded_at: new Date().toISOString(),
        }),
      },
      environment: { node: "test", enabled: "true" },
    },
  )

  /** Real stores and readers; only CP and IAM answers are synthetic. */
  let leaseMs = 20_000
  const dependencies: OrderAuthorityEnforcementDependencies = {
    engineInstanceId: ENGINE,
    environment: {},
    attested: new PostgresAttestedNativeConfigurationReader(pg),
    facts: medusaNativeSellerFacts(container),
    tokens: { getAccessToken: async () => "synthetic-workload-token" },
    controlPlane: {
      resolvePlatformContext: async (tenantId, orgId, _t, _c, _type, country) =>
        context(tenantId, orgId, country),
    },
    authority: {
      resolveBinding: async (req) => ({
        resolution_id: randomUUID(),
        ...req,
        outcome: "RESOLVED" as const,
        binding_reference: { binding_id: bindingId, binding_version: 1 },
        status: "ACTIVE" as const,
        effective_from: new Date(Date.now() - 60_000).toISOString(),
        resolved_at: new Date().toISOString(),
        provider_permissions_granted: false as const,
      }),
      resolveOrderAuthority: async (req) => {
        const now = Date.now()
        return {
          receivedAt: now,
          decision: {
            decision_id: randomUUID(),
            ...req,
            outcome: "AUTHORIZED" as const,
            tenant_id: TENANT,
            operating_organisation_id: organisationId,
            market: "UG",
            legal_actor_role: "SELLER_OF_RECORD" as const,
            activity: ACTIVITY[req.operation_class],
            mandate_id: randomUUID(),
            responsible_legal_entity_id: "SYNTHETIC-LE-TA07",
            evidence_references: ["synthetic:mandate-evidence/ta07"],
            mandate_effective_from: new Date(now - 60_000).toISOString(),
            evaluated_at: new Date(now).toISOString(),
            expires_at: new Date(now + leaseMs).toISOString(),
            policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
            provider_permissions_granted: false as const,
          },
        } as never
      },
    },
    store: new PostgresCommitmentAttributionStore(pg),
    receipts: new PostgresOrderAuthorityReceiptStore(pg),
  }
  container.register(TRADE_A_DEPENDENCY_KEY, asValue(dependencies))

  /** A real, completable Thamani Uganda cart with a pending payment session. */
  const payableCart = async (email = `ta07-${randomUUID()}@example.invalid`) => {
    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        items: [{ variant_id: variant.id, quantity: 1 }],
        email,
      },
    })
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: cart.id, options: [{ id: shipping.id }] },
    })
    const collection = await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })
    await payments.createPaymentSession(collection.result.id, {
      provider_id: "pp_system_default",
      currency_code: cart.currency_code,
      amount: collection.result.amount ?? cart.total ?? 0,
      data: {},
    })
    return cart.id
  }
  const enforced = async <T>(run: () => Promise<T>): Promise<T> => {
    process.env[TRADE_A_ENFORCEMENT_ENV] = "true"
    try {
      return await run()
    } finally {
      Reflect.deleteProperty(process.env, TRADE_A_ENFORCEMENT_ENV)
    }
  }
  /** What the hook does: attribute the cart and record a receipt, no commitment. */
  const authorise = async (cls: TradeAOperationClass, type: "cart" | "draft_order", id: string) =>
    enforced(async () => {
      const native =
        type === "cart"
          ? await carts.retrieveCart(id)
          : (
              await query.graph({
                entity: "order",
                fields: ["sales_channel_id", "region_id", "currency_code"],
                filters: { id },
              })
            ).data[0]
      return governOrderEntry(
        cls,
        { type, id },
        {
          salesChannelId: String(native.sales_channel_id),
          regionId: String(native.region_id),
          currency: String(native.currency_code),
        },
        tradeAOperationReference({ type, id }, "regression"),
        () => dependencies,
        tradeAEnvironment(),
      )
    })
  const complete = (id: string) => completeCartWorkflow(container).run({ input: { id } })

  /**
   * Decision 8: classify the record from a synthetic CP commerce profile
   * answer and Trade's own (synthetic) buyer relationship, as the CAA-06b
   * composition will before commit.
   */
  const attributions = new PostgresCommitmentAttributionStore(pg)
  const classifications = new PostgresClassificationStore(pg)
  type Scope = { profile: string; market: string }
  const scopes = {
    B2C: { profile: randomUUID(), market: "ta07_b2c_ug" },
    B2B: { profile: randomUUID(), market: "ta07_b2b_ug" },
    denied: { profile: randomUUID(), market: "ta07_denied_ug" },
  }
  let profileLifetimeMs = 60_000
  const classifyAs = async (
    model: "B2B" | "B2C",
    type: "cart" | "draft_order",
    id: string,
    scope: Scope = scopes[model],
  ) => {
    const attribution = await attributions.current({ type, id })
    assert.ok(attribution, `${id} is not attributed`)
    const binding = randomUUID()
    const now = Date.now()
    const result = await classifyNativeCommitment(
      {
        engineInstanceId: ENGINE,
        store: classifications,
        profiles: {
          resolve: async (request) => ({
            attestationId: randomUUID(),
            commerceProfileId: scope.profile,
            profileRevision: 1,
            digitalEstateId: ESTATE,
            tenantId: TENANT,
            engineInstanceId: ENGINE,
            marketId: request.marketId,
            commerceModel: model,
            issuedAt: new Date(now),
            expiresAt: new Date(now + profileLifetimeMs),
            profileEffectiveUntil: null,
            evidenceReference: "synthetic:ta07-commerce-profile",
          }),
        },
      },
      {
        resource: { type, id },
        attribution,
        sellerContext: { contextId: attribution.context_id, marketId: scope.market },
        estate: {
          kind: "ESTATE_CLIENT_BINDING",
          bindingId: binding,
          revision: 1,
          digitalEstateId: ESTATE,
          tenantId: TENANT,
          engineInstanceId: ENGINE,
          expiresAt: new Date(now + 60_000),
        },
        buyer:
          model === "B2C"
            ? { model: "CONSUMER", consumerReference: `consumer:ta07-${id}` }
            : {
                model: "BUYER_ORGANISATION",
                context: {
                  context_id: randomUUID(),
                  digital_estate_id: ESTATE,
                  tenant_id: TENANT,
                  engine_instance_id: ENGINE,
                  buyer_organisation_id: "b2borg_ta07regression",
                  buyer_membership_id: "b2bmem_ta07regression",
                  expires_at: new Date(now + 60_000).toISOString(),
                  evidence_references: [`cp-estate-binding:${binding}@r1`],
                } as TradeBuyerExecutionContext,
              },
        correlationId: randomUUID(),
      },
    )
    assert.equal(result.outcome, "CLASSIFIED", JSON.stringify(result))
    return result
  }
  /** Attribute, receipt and classify a cart as B2C, ready to complete. */
  const ready = async (id: string) => {
    await authorise("trade.order.commit", "cart", id)
    await classifyAs("B2C", "cart", id)
  }
  const one = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
    (await pool.query(sql, values)).rows[0] as T
  const linkedOrder = async (cartId: string) => {
    const { data } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    })
    return data.map((link: { order_id: string }) => link.order_id)
  }
  /** A session that opts into ENFORCED, as every protected database is. */
  const enforcedSql = async (run: (db: PoolClient) => Promise<unknown>) => {
    const db = await pool.connect()
    try {
      await db.query("SET baobab.trade_a_posture = 'ENFORCED'")
      return await run(db)
    } finally {
      await db.query("RESET baobab.trade_a_posture").catch(() => undefined)
      db.release()
    }
  }
  const rawOrder = (db: PoolClient, cart: Record<string, unknown>, draft = false) =>
    db.query(
      `INSERT INTO "order" (id, region_id, sales_channel_id, customer_id, email, currency_code, is_draft_order, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        `order_ta07raw${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        cart.region_id,
        cart.sales_channel_id,
        cart.customer_id ?? null,
        cart.email ?? null,
        cart.currency_code,
        draft,
        draft ? "draft" : "pending",
      ],
    )

  /**
   * Decision 9: the fence ships behind an inactive gate (SHADOW). These
   * checks prove what ENFORCED refuses, then return the gate to SHADOW and
   * prove SHADOW records the same verdict without refusing.
   */
  const gate = async (mode: "SHADOW" | "ENFORCED", reference: string) =>
    pool.query(
      `UPDATE trade_commit_fence_enforcement SET mode = $1, revision = revision + 1, change_reference = $2`,
      [mode, `${reference}:${randomUUID()}`],
    )
  const verdicts = async (id: string) =>
    (
      await pool.query(
        `SELECT outcome, enforcement_mode FROM trade_commit_fence_decision WHERE subject_id = $1
          ORDER BY decided_at`,
        [id],
      )
    ).rows as { outcome: string; enforcement_mode: string }[]
  assert.equal(
    (await one<{ mode: string }>("SELECT mode FROM trade_commit_fence_enforcement")).mode,
    "SHADOW",
    "the fence must ship behind an inactive gate",
  )
  await gate("ENFORCED", "regression:ta07-enforced")
  try {
    // Setup is SANDBOX posture (the migration ran under the test profile).
    assert.equal(
      (await one<{ posture: string }>("SELECT posture FROM trade_a_persistence_posture")).posture,
      "SANDBOX",
    )

    // 1. Authorised cart commitment through the real workflow: the order
    //    INSERT consumes the hook's receipt and records one commitment for
    //    exactly this cart; completion then passes the cart fence.
    const first = await payableCart()
    await ready(first)
    const { result: order } = await enforced(() => complete(first))
    assert.deepEqual(await linkedOrder(first), [order.id])
    const commitment = await one<{ receipt_id: string; subject_id: string }>(
      "SELECT receipt_id, subject_id FROM trade_order_commitment WHERE order_id = $1",
      [order.id],
    )
    assert.equal(commitment?.subject_id, first)
    assert.ok(
      (
        await one<{ consumed_at: Date | null }>(
          "SELECT consumed_at FROM trade_order_authority_receipt WHERE receipt_id = $1",
          [commitment.receipt_id],
        )
      ).consumed_at,
    )
    // A replay resolves to the same order without a second commitment.
    const { result: replay } = await enforced(() => complete(first))
    assert.equal(replay.id, order.id)
    assert.equal(
      (
        await one<{ n: number }>(
          "SELECT count(*)::int AS n FROM trade_order_commitment WHERE subject_id = $1",
          [first],
        )
      ).n,
      1,
    )

    // 2. Two concurrent authorised completions bind each order to its own cart.
    const [a, b] = [await payableCart(), await payableCart()]
    await ready(a)
    await ready(b)
    const [ra, rb] = await enforced(() => Promise.all([complete(a), complete(b)]))
    for (const [cartId, created] of [
      [a, ra.result],
      [b, rb.result],
    ] as const) {
      assert.deepEqual(await linkedOrder(cartId), [created.id])
      assert.equal(
        (
          await one<{ subject_id: string }>(
            "SELECT subject_id FROM trade_order_commitment WHERE order_id = $1",
            [created.id],
          )
        ).subject_id,
        cartId,
      )
    }

    // 3. ENFORCED: no authority, no order, whatever the writer. An
    //    unattributed cart (the never-activated binding case) cannot complete.
    const bare = await payableCart()
    const bareCart = await one("SELECT * FROM cart WHERE id = $1", [bare])
    await refused(
      "direct order INSERT without authority",
      () => enforcedSql((db) => rawOrder(db, bareCart)),
      /no current trade\.order\.commit authority/,
    )
    await refused(
      "completion of an unattributed cart",
      () =>
        enforcedSql((db) =>
          db.query("UPDATE cart SET completed_at = clock_timestamp() WHERE id = $1", [bare]),
        ),
      /cart completion requires a committed, authorised order/,
    )
    // A consumed receipt is never reused for a second order.
    const firstCart = await one("SELECT * FROM cart WHERE id = $1", [first])
    await refused(
      "reuse of a consumed receipt",
      () => enforcedSql((db) => rawOrder(db, { ...firstCart, completed_at: null })),
      /no current trade\.order\.commit authority/,
    )

    // 4. An attributed cart cannot complete without a commitment, even in SANDBOX.
    const held = await payableCart()
    const heldReceipt = await authorise("trade.order.commit", "cart", held)
    assert.ok(heldReceipt)
    // Classified, so the content check below is what refuses it.
    await classifyAs("B2C", "cart", held)
    await refused(
      "attributed cart completion without a committed order",
      () => pool.query("UPDATE cart SET completed_at = clock_timestamp() WHERE id = $1", [held]),
      /cart completion requires a committed, authorised order/,
    )

    // 5. A live receipt cannot authorise different contents: an order with
    //    the cart's scope but not its lines is refused at COMMIT, and the
    //    receipt stays unconsumed.
    const heldCart = await one("SELECT * FROM cart WHERE id = $1", [held])
    await refused(
      "order whose lines differ from the authorised cart",
      () =>
        enforcedSql(async (db) => {
          await db.query("BEGIN")
          try {
            await rawOrder(db, heldCart)
            await db.query("COMMIT")
          } catch (error) {
            await db.query("ROLLBACK")
            throw error
          }
        }),
      /committed order lines differ from the authorised cart/,
    )
    assert.equal(
      (
        await one<{ consumed_at: Date | null }>(
          "SELECT consumed_at FROM trade_order_authority_receipt WHERE receipt_id = $1",
          [heldReceipt.receipt_id],
        )
      ).consumed_at,
      null,
    )

    // 6. Two open carts with the same scope and live receipts are ambiguous:
    //    the database refuses rather than guess, and nothing commits.
    const shared = `ta07-shared-${randomUUID()}@example.invalid`
    const [x, y] = [await payableCart(shared), await payableCart(shared)]
    await authorise("trade.order.commit", "cart", y)
    await refused(
      "ambiguous authority",
      () => enforced(() => complete(x)),
      /ambiguous between carts/,
    )
    assert.deepEqual(await linkedOrder(x), [])
    assert.equal((await carts.retrieveCart(x)).completed_at, null)

    // 7. An expired lease authorises nothing.
    leaseMs = 1_200
    const late = await payableCart()
    await authorise("trade.order.commit", "cart", late)
    leaseMs = 20_000
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    const lateCart = await one("SELECT * FROM cart WHERE id = $1", [late])
    await refused(
      "order after the lease expired",
      () => enforcedSql((db) => rawOrder(db, lateCart)),
      /no current trade\.order\.commit authority/,
    )

    // 8. Draft finalisation consumes a receipt for exactly that draft.
    const draftInput = (email: string) => ({
      input: {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        email,
        currency_code: "ugx",
        items: [{ variant_id: variant.id, quantity: 1, title: product.title, unit_price: 10000 }],
        is_draft_order: true,
        status: "draft" as const,
      },
    })
    const { result: draft } = await createOrderWorkflow(container).run(
      draftInput(`ta07-draft-${randomUUID()}@example.invalid`),
    )
    await authorise("trade.draft-order.finalize", "draft_order", draft.id)
    await classifyAs("B2C", "draft_order", draft.id)
    await convertDraftOrderWorkflow(container).run({ input: { id: draft.id } })
    assert.equal(
      (
        await one<{ is_draft_order: boolean }>('SELECT is_draft_order FROM "order" WHERE id = $1', [
          draft.id,
        ])
      ).is_draft_order,
      false,
    )
    assert.ok(
      await one(
        "SELECT 1 FROM trade_order_commitment WHERE operation_class = 'trade.draft-order.finalize' AND order_id = $1",
        [draft.id],
      ),
    )
    // An attributed draft without a live receipt cannot be finalised, even in SANDBOX.
    const { result: unauthorised } = await createOrderWorkflow(container).run(
      draftInput(`ta07-draft-${randomUUID()}@example.invalid`),
    )
    leaseMs = 1_200
    await authorise("trade.draft-order.finalize", "draft_order", unauthorised.id)
    leaseMs = 20_000
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await refused(
      "attributed draft finalisation without current authority",
      () => convertDraftOrderWorkflow(container).run({ input: { id: unauthorised.id } }),
      /no current trade\.draft-order\.finalize authority/,
    )
    // ENFORCED: an unattributed draft cannot become an order by direct SQL.
    const { result: plain } = await createOrderWorkflow(container).run(
      draftInput(`ta07-draft-${randomUUID()}@example.invalid`),
    )
    await refused(
      "direct draft finalisation without authority",
      () =>
        enforcedSql((db) =>
          db.query(`UPDATE "order" SET is_draft_order = false, status = 'pending' WHERE id = $1`, [
            plain.id,
          ]),
        ),
      /no current trade\.draft-order\.finalize authority/,
    )

    // 8b. Decision 8: the commit check selects the regime from the classification.
    const notCompleted = async (id: string) => {
      assert.deepEqual(await linkedOrder(id), [])
      assert.equal((await carts.retrieveCart(id)).completed_at, null)
    }
    const unclassified = await payableCart()
    await authorise("trade.order.commit", "cart", unclassified)
    await refused(
      "an unclassified commitment",
      () => enforced(() => complete(unclassified)),
      /CLASSIFICATION_ABSENT/,
    )
    await notCompleted(unclassified)

    const business = await payableCart()
    await authorise("trade.order.commit", "cart", business)
    await classifyAs("B2B", "cart", business)
    await refused(
      "a B2B commitment without buyer authority",
      () => enforced(() => complete(business)),
      /BUYER_AUTHORITY_ABSENT/,
    )
    await notCompleted(business)

    const changed = await payableCart()
    await ready(changed)
    await pool.query(
      `UPDATE trade_native_commitment_classification SET status = 'QUARANTINED', revision = revision + 1
        WHERE resource_type = 'cart' AND resource_id = $1 AND status = 'ACTIVE'`,
      [changed],
    )
    await refused(
      "a commitment whose classification was retired",
      () => enforced(() => complete(changed)),
      /CLASSIFICATION_CHANGED/,
    )
    await notCompleted(changed)

    // A stale profile attestation refuses until Trade re-resolves it.
    profileLifetimeMs = 1_200
    const stale = await payableCart()
    await ready(stale)
    profileLifetimeMs = 60_000
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await refused(
      "a commitment on an expired profile attestation",
      () => enforced(() => complete(stale)),
      /PROFILE_NOT_ACTIVE/,
    )
    await notCompleted(stale)
    await classifyAs("B2C", "cart", stale)
    const { result: refreshed } = await enforced(() => complete(stale))
    assert.deepEqual(await linkedOrder(stale), [refreshed.id])

    // A later CP answer that is not ATTESTED withdraws the profile.
    const withdrawn = await payableCart()
    await authorise("trade.order.commit", "cart", withdrawn)
    await classifyAs("B2C", "cart", withdrawn, scopes.denied)
    await pool.query(
      `INSERT INTO trade_commerce_profile_observation (digital_estate_id, engine_instance_id, market_id,
         estate_provenance_kind, estate_provenance_reference, outcome, correlation_id)
       VALUES ($1, $2, $3, 'ESTATE_CLIENT_BINDING', $4, 'PROFILE_NOT_ACTIVE', $5)`,
      [ESTATE, ENGINE, scopes.denied.market, randomUUID(), randomUUID()],
    )
    await refused(
      "a commitment after CP withdrew the profile",
      () => enforced(() => complete(withdrawn)),
      /PROFILE_NOT_ACTIVE/,
    )
    await notCompleted(withdrawn)

    const { result: unclassifiedDraft } = await createOrderWorkflow(container).run(
      draftInput(`ta07-draft-${randomUUID()}@example.invalid`),
    )
    await authorise("trade.draft-order.finalize", "draft_order", unclassifiedDraft.id)
    await refused(
      "an unclassified draft finalisation",
      () => convertDraftOrderWorkflow(container).run({ input: { id: unclassifiedDraft.id } }),
      /CLASSIFICATION_ABSENT/,
    )
    assert.equal(
      (
        await one<{ is_draft_order: boolean }>('SELECT is_draft_order FROM "order" WHERE id = $1', [
          unclassifiedDraft.id,
        ])
      ).is_draft_order,
      true,
    )

    // 8d. Decision 6: a B2B commitment consumes one current buyer receipt for
    // the seller receipt's exact operation reference and converts its spend
    // reservation to committed consumption, in the order's own transaction.
    const buyerOrg = "b2borg_ta07regression"
    const buyerMember = "b2bmem_ta07regression"
    const canonicalOrg = randomUUID()
    await pool.query(
      `INSERT INTO b2b_organisation (id, tenant_id, legal_name, status) VALUES ($1, $2, 'Synthetic TA-07 buyer', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [buyerOrg, TENANT],
    )
    await pool.query(
      `INSERT INTO b2b_buyer_membership (id, organisation_id, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [buyerMember, buyerOrg],
    )
    await pool.query(
      `INSERT INTO b2b_spend_budget_policy (id, scope, tenant_id, organisation_id, membership_id, market_key, currency_code,
         period_kind, timezone, limit_minor, raw_limit_minor, effective_from, evidence_reference)
       VALUES ('b2bbud_ta07regression', 'MEMBERSHIP', $1, $2, $3, 'UG', 'UGX', 'CALENDAR_MONTH', 'UTC', 100000000, '{}',
               now() - interval '1 day', 'synthetic/ta07-regression') ON CONFLICT (id) DO NOTHING`,
      [TENANT, buyerOrg, buyerMember],
    )
    const spend = new PostgresSpendReservationCommands(pg)
    const buyerReceipts = new PostgresBuyerAuthorityReceiptStore(pg)
    const actor = randomUUID()
    const amount = 125_000
    /** Seller receipt, B2B classification, ACTIVE reservation and buyer receipt for one cart. */
    const b2bReady = async (change: Partial<BuyerAuthorityReceipt> = {}, lifetimeMs = 50_000) => {
      const id = await payableCart()
      const seller = await authorise("trade.order.commit", "cart", id)
      assert.ok(seller)
      const { operation_reference, binding_id, binding_version, responsible_legal_entity_id } =
        await one<{
          operation_reference: string
          binding_id: string
          binding_version: number
          responsible_legal_entity_id: string
        }>(
          `SELECT operation_reference, binding_id::text, binding_version, responsible_legal_entity_id
           FROM trade_order_authority_receipt WHERE receipt_id = $1`,
          [seller.receipt_id],
        )
      await classifyAs("B2B", "cart", id)
      const transactionDigest = `sha256:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`
      const reserved = await spend.submit({
        idempotencyKey: `ta07.reserve.${randomUUID().replaceAll("-", "")}`,
        purchaseReference: id,
        tenantId: TENANT,
        organisationId: buyerOrg,
        membershipId: buyerMember,
        actorPrincipalId: actor,
        marketKey: "UG",
        currencyCode: "UGX",
        agreementReference: null,
        transactionDigest,
        resourceVersion: 1,
        amountMinor: BigInt(amount),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      assert.equal(reserved.outcome, "APPLIED", JSON.stringify(reserved))
      if (reserved.outcome !== "APPLIED") throw new Error("unreachable")
      const now = Date.now()
      const membership = await one<{ revision: number }>(
        "SELECT revision FROM b2b_buyer_membership WHERE id = $1",
        [buyerMember],
      )
      const receipt: BuyerAuthorityReceipt = {
        receipt_id: randomUUID(),
        context_id: randomUUID(),
        decision_id: randomUUID(),
        correlation_id: randomUUID(),
        operation: "trade.order.commit",
        operation_reference,
        actor_principal_id: actor,
        tenant_id: TENANT,
        canonical_organisation_id: canonicalOrg,
        buyer_organisation_id: buyerOrg,
        buyer_membership_id: buyerMember,
        membership_revision: membership.revision,
        market_id: scopes.B2B.market,
        resource_id: id,
        resource_version: 1,
        transaction_digest: transactionDigest,
        amount_minor: amount,
        valuation_digest: `sha256:${"a".repeat(64)}`,
        currency: "UGX",
        policy_revision: 1,
        spend_reservation_id: reserved.reservationId,
        spend_hold_revision: reserved.holdRevision,
        seller_legal_entity_id: responsible_legal_entity_id,
        seller_binding_reference: { binding_id, binding_version },
        evaluated_at: new Date(now).toISOString(),
        expires_at: new Date(now + lifetimeMs).toISOString(),
        ...change,
      }
      await buyerReceipts.record(receipt)
      return { id, receipt, reservationId: reserved.reservationId }
    }
    const reservationStatus = async (reservationId: string) =>
      (
        await one<{ status: string }>("SELECT status FROM b2b_spend_reservation WHERE id = $1", [
          reservationId,
        ])
      ).status

    const committed = await b2bReady()
    const { result: b2bOrder } = await enforced(() => complete(committed.id))
    assert.deepEqual(await linkedOrder(committed.id), [b2bOrder.id])
    assert.equal(await reservationStatus(committed.reservationId), "COMMITTED")
    assert.equal(
      (
        await one<{ n: number }>(
          "SELECT count(*)::int AS n FROM trade_buyer_authority_consumption WHERE receipt_id = $1",
          [committed.receipt.receipt_id],
        )
      ).n,
      1,
    )
    assert.deepEqual(await verdicts(committed.id), [
      { outcome: "ALLOWED", enforcement_mode: "ENFORCED" },
    ])

    for (const [what, setup, reason] of [
      [
        "a receipt for another Market",
        () => b2bReady({ market_id: "ta07_other_ug" }),
        /FOREIGN_RECEIPT/,
      ],
      [
        "an expired receipt",
        async () => {
          const ready = await b2bReady({}, 1_200)
          await new Promise((resolve) => setTimeout(resolve, 1_600))
          return ready
        },
        /RECEIPT_EXPIRED/,
      ],
      [
        "a revised membership",
        async () => {
          const ready = await b2bReady()
          await pool.query(
            "UPDATE b2b_buyer_membership SET revision = revision + 1 WHERE id = $1",
            [buyerMember],
          )
          return ready
        },
        /MEMBERSHIP_REVISED/,
      ],
      [
        "a released reservation",
        async () => {
          const ready = await b2bReady()
          const released = await spend.release({
            idempotencyKey: `ta07.release.${randomUUID().replaceAll("-", "")}`,
            organisationId: buyerOrg,
            reservationId: ready.reservationId,
            actorPrincipalId: actor,
            reason: "CANCELLED",
          })
          assert.equal(released.outcome, "APPLIED")
          return ready
        },
        /RESERVATION_NOT_CURRENT/,
      ],
    ] as const) {
      const ready = await setup()
      await refused(what, () => enforced(() => complete(ready.id)), reason)
      await notCompleted(ready.id)
    }
    await refused(
      "a buyer receipt for a reservation that does not hold its purchase",
      () => b2bReady({ amount_minor: amount + 1 }),
      /not recorded/,
    )
    await refused(
      "a consumption outside the fence",
      () =>
        pool.query(
          `INSERT INTO trade_buyer_authority_consumption (receipt_id, operation_reference, seller_receipt_id,
             spend_reservation_id, commitment_reference) VALUES ($1, 'x', $2, $3, 'x')`,
          [committed.receipt.receipt_id, randomUUID(), committed.reservationId],
        ),
      /consumed only at the native commit fence/,
    )
    await refused(
      "a rewritten buyer receipt",
      () =>
        pool.query(
          "UPDATE trade_buyer_authority_receipt SET amount_minor = 1 WHERE receipt_id = $1",
          [committed.receipt.receipt_id],
        ),
      /immutable/,
    )

    // 8c. Decision 9: SHADOW records the verdict and refuses nothing; the gate
    // changes only by a governed revision and is never removed.
    await gate("SHADOW", "regression:ta07-shadow")
    const shadowed = await payableCart()
    await authorise("trade.order.commit", "cart", shadowed)
    const { result: shadowOrder } = await enforced(() => complete(shadowed))
    assert.deepEqual(await linkedOrder(shadowed), [shadowOrder.id])
    assert.deepEqual(await verdicts(shadowed), [
      { outcome: "CLASSIFICATION_ABSENT", enforcement_mode: "SHADOW" },
    ])
    assert.deepEqual(await verdicts(first), [{ outcome: "ALLOWED", enforcement_mode: "ENFORCED" }])
    // A refused B2B composition in SHADOW changes nothing: the order proceeds,
    // the verdict is recorded and the reservation stays ACTIVE.
    const shadowB2b = await b2bReady({ market_id: "ta07_other_ug" })
    await enforced(() => complete(shadowB2b.id))
    assert.deepEqual(await verdicts(shadowB2b.id), [
      { outcome: "FOREIGN_RECEIPT", enforcement_mode: "SHADOW" },
    ])
    assert.equal(await reservationStatus(shadowB2b.reservationId), "ACTIVE")
    await refused(
      "an unversioned gate change",
      () => pool.query("UPDATE trade_commit_fence_enforcement SET mode = 'ENFORCED'"),
      /next revision and its own evidence reference/,
    )
    await refused(
      "a gate removal",
      () => pool.query("DELETE FROM trade_commit_fence_enforcement"),
      /one governed row/,
    )
    await refused(
      "a second gate",
      () =>
        pool.query(
          "INSERT INTO trade_commit_fence_enforcement (singleton, mode, revision, change_reference) VALUES (true, 'SHADOW', 9, 'x')",
        ),
      /one governed row/,
    )
    await refused(
      "a forged verdict",
      () =>
        pool.query(
          `INSERT INTO trade_commit_fence_decision (subject_type, subject_id, receipt_id, outcome, enforcement_mode,
             enforcement_revision) VALUES ('cart', $1, $2, 'CLASSIFICATION_ABSENT', 'SHADOW', 1)`,
          [held, heldReceipt.receipt_id],
        ),
      /written only by the commit fence/,
    )
    await refused(
      "a rewritten verdict",
      () => pool.query("UPDATE trade_commit_fence_decision SET outcome = 'ALLOWED'"),
      /append-only evidence/,
    )
    await refused(
      "a deleted verdict",
      () => pool.query("DELETE FROM trade_commit_fence_decision"),
      /append-only evidence/,
    )
    await gate("ENFORCED", "regression:ta07-enforced-again")

    // 9. Evidence is written only by the fences and never rewritten.
    await refused(
      "a receipt consumed outside the fence",
      () =>
        pool.query(
          "UPDATE trade_order_authority_receipt SET consumed_at = clock_timestamp() WHERE receipt_id = $1",
          [heldReceipt.receipt_id],
        ),
      /consumed only at the commit fence/,
    )
    await refused(
      "a forged commitment",
      () =>
        pool.query(
          `INSERT INTO trade_order_commitment (receipt_id, operation_class, subject_type, subject_id, order_id)
           VALUES ($1, 'trade.order.commit', 'cart', $2, 'order_forged')`,
          [heldReceipt.receipt_id, held],
        ),
      /written only by the commit fence/,
    )
    for (const [what, sql] of [
      ["commitment UPDATE", "UPDATE trade_order_commitment SET order_id = 'order_other'"],
      ["commitment DELETE", "DELETE FROM trade_order_commitment"],
      ["commitment TRUNCATE", "TRUNCATE trade_order_commitment"],
    ] as const)
      await refused(what, () => pool.query(sql), /written only by the commit fence/)

    // 10. The posture only strengthens: no downgrade, deletion or truncation.
    const db = await pool.connect()
    try {
      await db.query("BEGIN")
      await db.query("UPDATE trade_a_persistence_posture SET posture = 'ENFORCED'")
      await refused(
        "posture downgrade",
        () => db.query("UPDATE trade_a_persistence_posture SET posture = 'SANDBOX'"),
        /only moves from SANDBOX to ENFORCED/,
      )
    } finally {
      // Leave the disposable database as the fence ships: SHADOW.
      await gate("SHADOW", "regression:ta07-restore").catch(() => undefined)
      await db.query("ROLLBACK")
      db.release()
    }
    for (const sql of [
      "DELETE FROM trade_a_persistence_posture",
      "TRUNCATE trade_a_persistence_posture",
    ])
      await refused(sql, () => pool.query(sql), /only moves from SANDBOX to ENFORCED/)

    console.log(
      "Trade-A TA-07: native commit fences on real completeCartWorkflow/convertDraftOrderWorkflow (single consumption, cart binding, replay, concurrency, content binding at COMMIT, ambiguity, lease expiry, unattributed cart, draft finalisation, Decision 8 classification regime, forged and rewritten evidence, posture) passed with synthetic CP/IAM; LOCAL_TESTED, not EA Gate D, not L4",
    )
  } finally {
    if (!eligible)
      await thamani
        .listMarketProductEligibilities({
          product_id: product.id,
          policy_reference: POLICY_REFERENCE,
        })
        .then((rows) => thamani.deleteMarketProductEligibilities(rows.map((row) => row.id)))
    await pool.end()
  }
}
