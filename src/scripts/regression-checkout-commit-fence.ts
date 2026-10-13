/**
 * P0-04B-03 disposable PostgreSQL / real Medusa completeCartWorkflow acceptance
 * for the commit-point checkout fence. Real Thamani carts, applied migrations
 * and the real completion saga; CP and Payments are EXPLICITLY SYNTHETIC ports
 * and the LA-05 hook flag stays off, so the database fence is proved alone.
 * This is not IAM, mandate, merchant or provider certification.
 * Refuses a non-test or unmarked database; receipts stay until CI disposes it.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createInventoryLevelsWorkflow,
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
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { AuthenticatedBindingIntake } from "../baobab/orders/authenticated-binding-intake"
import type { BindingAuthorityClient } from "../baobab/orders/binding-authority-client"
import type { NativeCheckoutAuthorization } from "../baobab/orders/native-cart-legal-seller"
import { NATIVE_SELLER_DEPENDENCY_KEY } from "../baobab/orders/native-cart-legal-seller"
import type NativeSellerCheckoutModuleService from "../modules/legal-seller-checkout/service"
import type ThamaniModuleService from "../modules/thamani/service"

const POLICY_REFERENCE = "regression:p0-04b-03-checkout-commit-fence"
const SELLER = "LE-SYNTHETIC-SELLER"
const MANDATE = "00000000-0000-4000-8000-000000000002"

export default async function regressionCheckoutCommitFence({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_LA05_NATIVE_CHECKOUT_GUARD === "true" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Checkout commit fence regression requires the explicitly marked disposable test database",
    )
  }
  const native = container.resolve<NativeSellerCheckoutModuleService>(NATIVE_SELLER_DEPENDENCY_KEY)
  const persistence = native.bindingPersistence
  const pool = new Pool({ connectionString: url, max: 4 })
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

  // Synthetic CP: storage/fence proof only, never live authority.
  let subject = "synthetic-cp-maker"
  const cp: BindingAuthorityClient = {
    authorize: async (_token, operation, scope, digest) => ({
      scope,
      command_digest: digest,
      decision_id: randomUUID(),
      principal_id: subject,
      issuer: "https://synthetic-iam.example.test",
      token_id: `synthetic-token-${subject}`,
      scope_name: `trade-binding:${operation}`,
      evaluated_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 5000).toISOString(),
      matched_grant_ids: ["synthetic-exact-grant"],
      provider_permissions_granted: false,
    }),
    resolve: async (scope) => ({
      context_id: randomUUID(),
      tenant_id: scope.tenantId,
      organisation_id: scope.organisationId,
      organisation_type: "ORGANISATION",
      country_code: "UG",
      currency_code: "UGX",
      market_id: "synthetic_market_ug",
      resolved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    }),
    assess: async (req) => ({
      context_id: req.context_id,
      operation_reference: req.operation_reference,
      provider_permissions_granted: false,
      legal_actor_resolution: {
        outcome: "AUTHORIZED",
        evaluated_at: new Date().toISOString(),
        valid_until: new Date(Date.now() + 30_000).toISOString(),
        policy_reference: "synthetic-storage-only",
        mandate_id: MANDATE,
        responsible_legal_entity_id: SELLER,
        evidence_references: ["synthetic-verified-evidence"],
      },
    }),
  }
  const coordinates = async (id: string) => {
    const c = await carts.retrieveCart(id)
    if (!c.region_id || !c.sales_channel_id) throw new Error("Native cart missing coordinates")
    return {
      salesChannelId: c.sales_channel_id,
      regionId: c.region_id,
      currencyCode: c.currency_code.toUpperCase(),
      completed: Boolean(c.completed_at),
    }
  }
  const intake = (
    operation: "propose" | "approve" | "activate" | "revoke",
    id: string,
    input: unknown,
  ) =>
    new AuthenticatedBindingIntake(
      cp,
      persistence,
      coordinates,
      async () => "synthetic-workload-token",
    ).execute(operation, id, input, "synthetic-human-token")

  /** A real, completable Thamani Uganda cart with a pending payment session. */
  const checkoutCart = async () => {
    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        items: [{ variant_id: variant.id, quantity: 1 }],
        email: "regression-checkout-fence@example.invalid",
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
  /** Independent maker, checker and operator activate a seller binding. */
  const activated = async () => {
    const id = await checkoutCart()
    subject = "synthetic-cp-maker"
    await intake("propose", id, {
      tenantId: "tn_synthetic01",
      organisationId: "00000000-0000-4000-8000-000000000001",
      responsibleLegalEntityId: SELLER,
      marketCode: "UG",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    subject = "synthetic-cp-checker"
    await intake("approve", id, { revision: 0 })
    subject = "synthetic-cp-operator"
    await intake("activate", id, { revision: 1 })
    return id
  }
  const binding = async (id: string) =>
    (await pool.query("SELECT * FROM native_seller_cart_binding WHERE cart_id=$1", [id])).rows[0]
  /** What the validate hook records after its CP and Payments assessment. */
  const authorize = async (id: string, leaseMs = 15_000) => {
    const row = await binding(id)
    const until = new Date(Date.now() + leaseMs).toISOString()
    const authorization: NativeCheckoutAuthorization = {
      cartId: id,
      contextId: row.context_id,
      responsibleLegalEntityId: SELLER,
      mandateId: MANDATE,
      legalValidUntil: until,
      providerCertificationReference: "synthetic/provider-certification",
      merchantActivationReference: "synthetic/merchant-activation",
      policyReference: "synthetic/payments-policy",
      readinessValidUntil: until,
      idempotencyKey: `native-checkout/${id}`,
    }
    await persistence.record(authorization)
  }
  const receipts = async (id: string) =>
    (
      await pool.query(
        "SELECT consumed_at,released_at FROM la05_checkout_authorization WHERE cart_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows as Array<{ consumed_at: Date | null; released_at: Date | null }>
  const orders = async (id: string) => {
    const { data } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: id },
    })
    return data.map((link: { order_id: string }) => link.order_id)
  }
  const complete = (id: string) => completeCartWorkflow(container).run({ input: { id } })
  /** Workflow failures are rethrown serialised ({ message, ... }), not as Error. */
  const denied = async (attempt: Promise<unknown>, pattern: RegExp) => {
    const outcome = await attempt.then(
      () => undefined,
      (error: unknown) => error,
    )
    const message =
      outcome instanceof Error
        ? outcome.message
        : String((outcome as { message?: unknown } | undefined)?.message ?? "")
    assert.match(message, pattern, "expected the commit-point fence to deny")
  }
  const completedAt = async (id: string) => (await carts.retrieveCart(id)).completed_at

  try {
    // 1. An activated cart cannot complete without a recorded authorization;
    //    the saga compensates: no order link, cart reopened, no receipt.
    const unauthorized = await activated()
    await denied(complete(unauthorized), /current checkout authorization required/)
    assert.equal(await completedAt(unauthorized), null)
    assert.deepEqual(await orders(unauthorized), [])

    // 2. A current authorization is consumed exactly once by a real completion,
    //    and a completeCart replay resolves to the same order without consuming again.
    const ordinary = await activated()
    await authorize(ordinary)
    const { result: first } = await complete(ordinary)
    assert.ok(await completedAt(ordinary))
    assert.deepEqual(await orders(ordinary), [first.id])
    let stored = await receipts(ordinary)
    assert.equal(stored.length, 1)
    assert.ok(stored[0].consumed_at)
    assert.equal(stored[0].released_at, null)
    const { result: replay } = await complete(ordinary)
    assert.equal(replay.id, first.id)
    assert.deepEqual(await orders(ordinary), [first.id])
    assert.equal((await receipts(ordinary)).length, 1)
    // The validate hook also runs on a replay: recording is an idempotent no-op
    // for a committed checkout, while the database refuses any new receipt for a
    // completed cart. Receipts cannot be rewritten or deleted.
    await authorize(ordinary)
    assert.equal((await receipts(ordinary)).length, 1)
    await assert.rejects(
      pool.query(
        `INSERT INTO la05_checkout_authorization (cart_id,binding_id,binding_revision,context_id,
          responsible_legal_entity_id,mandate_id,legal_valid_until,provider_certification_reference,
          merchant_activation_reference,policy_reference,readiness_valid_until,lease_expires_at,idempotency_key)
        SELECT cart_id,id,revision,context_id,responsible_legal_entity_id,$2,now()+interval '10 seconds',
          'x','x','x',now()+interval '10 seconds',now()+interval '10 seconds','native-checkout/'||cart_id
        FROM native_seller_cart_binding WHERE cart_id=$1`,
        [ordinary, MANDATE],
      ),
      /open native cart required/,
    )
    await assert.rejects(
      pool.query(
        "UPDATE la05_checkout_authorization SET released_at=clock_timestamp() WHERE cart_id=$1",
        [ordinary],
      ),
      /append-only/,
    )
    await assert.rejects(
      pool.query("DELETE FROM la05_checkout_authorization WHERE cart_id=$1", [ordinary]),
      /cannot be deleted/,
    )

    // 3. Revocation committed after the hook's authorization denies completion.
    const revoked = await activated()
    await authorize(revoked)
    subject = "synthetic-cp-operator"
    await intake("revoke", revoked, { revision: 2, reason: "synthetic mandate withdrawn" })
    assert.equal((await binding(revoked)).status, "REVOKED")
    await denied(complete(revoked), /current checkout authorization required/)
    assert.equal(await completedAt(revoked), null)
    assert.deepEqual(await orders(revoked), [])
    assert.equal((await receipts(revoked))[0].consumed_at, null)

    // 4. A CP/Payments lease that expires before the commit point denies.
    const expiring = await activated()
    await authorize(expiring, 1500)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await denied(complete(expiring), /current checkout authorization required/)
    assert.deepEqual(await orders(expiring), [])

    // 5. Direct completion bypassing the workflow is fenced the same way.
    const bypass = await activated()
    await assert.rejects(
      pool.query("UPDATE cart SET completed_at=now() WHERE id=$1", [bypass]),
      /current checkout authorization required/,
    )
    await assert.rejects(
      pool.query(
        `INSERT INTO la05_checkout_authorization (cart_id,binding_id,binding_revision,context_id,
          responsible_legal_entity_id,mandate_id,legal_valid_until,provider_certification_reference,
          merchant_activation_reference,policy_reference,readiness_valid_until,lease_expires_at,
          idempotency_key,consumed_at)
        SELECT cart_id,id,revision,context_id,responsible_legal_entity_id,$2,now()+interval '10 seconds',
          'x','x','x',now()+interval '10 seconds',now()+interval '10 seconds','native-checkout/'||cart_id,now()
        FROM native_seller_cart_binding WHERE cart_id=$1`,
        [bypass, MANDATE],
      ),
      /current and unconsumed/,
    )

    // 6. Saga compensation that reopens the cart releases (never reuses) the
    //    receipt; completing again needs a fresh authorization.
    const compensated = await activated()
    await authorize(compensated)
    await carts.updateCarts(compensated, { completed_at: new Date() })
    await carts.updateCarts(compensated, { completed_at: null })
    stored = await receipts(compensated)
    assert.ok(stored[0].consumed_at && stored[0].released_at)
    await assert.rejects(
      pool.query("UPDATE cart SET completed_at=now() WHERE id=$1", [compensated]),
      /current checkout authorization required/,
    )
    await authorize(compensated)
    const { result: retried } = await complete(compensated)
    assert.deepEqual(await orders(compensated), [retried.id])
    stored = await receipts(compensated)
    assert.equal(stored.length, 2)
    assert.ok(stored[1].consumed_at && !stored[1].released_at)

    // 7. Concurrent completions of one authorized cart place exactly one order.
    const raced = await activated()
    await authorize(raced)
    const outcomes = await Promise.allSettled([complete(raced), complete(raced)])
    const ids = new Set(
      outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value.result.id] : [],
      ),
    )
    assert.equal(ids.size, 1)
    assert.equal((await orders(raced)).length, 1)
    assert.equal((await receipts(raced)).filter((r) => r.consumed_at && !r.released_at).length, 1)

    console.log(
      "P0-04B-03: real completeCartWorkflow commit-point fence (authorization required, single consumption, replay, revocation, lease expiry, direct bypass, compensation release, concurrency) passed with synthetic CP/Payments; no live authority or checkout certification",
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
