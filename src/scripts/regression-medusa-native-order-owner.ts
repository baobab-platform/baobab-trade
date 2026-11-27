/**
 * DEV-07 CAA-06b: real Medusa 2.21.2 Order Module transaction smoke.
 *
 * Runs only under the explicitly named disposable PostgreSQL 17 CI database.
 * It exercises actual createOrders with Medusa's own transaction manager,
 * verifies row versions and native child item storage on the same XID,
 * witnesses native rollback, then exercises native cleanup.
 *
 * It does NOT substitute synthetic IAM/CP facts for current buyer authority,
 * make a commitment, publish an event, or mark L4-OPS-01 accepted.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import type {
  ExecArgs,
  ICartModuleService,
  IOrderModuleService,
  OrderTypes,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import {
  nativeXid32,
  withNativeMedusaOrderTransaction,
} from "../baobab/b2b/medusa-native-transaction-owner"

import { medusaNativeOrderFactsSource } from "../baobab/b2b/medusa-native-order-source"
import type { FinalNativeValuationFacts } from "../baobab/b2b/buyer-commitment-valuation"
import { nativeMedusaCartPriceReadback } from "../baobab/b2b/medusa-final-cart-pricing"

const ROLLBACK = "DEV07_NATIVE_OWNER_EXPECTED_ROLLBACK"

export default async function qualifyNativeOrderModule({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_DEV07_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_ENVIRONMENT !== undefined ||
    process.env.BAOBAB_DEPLOYMENT_ENV !== undefined ||
    !url ||
    !expected ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error("Native Medusa owner qualification requires the disposable test database")
  }
  const pool = new Pool({ connectionString: url, max: 2 })
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
  const id = () => "order_dev07" + randomUUID().replaceAll("-", "").slice(0, 22)
  const input = (nativeId: string) =>
    ({
      id: nativeId,
      currency_code: "UGX",
      status: "draft",
      is_draft_order: true,
      email: "dev07-native-order@example.invalid",
      items: [
        {
          title: "Disposable Medusa native owner qualification item",
          quantity: 1,
          unit_price: 12000,
        },
      ],
    }) as OrderTypes.CreateOrderDTO
  const carts = container.resolve<ICartModuleService>(Modules.CART)
  let cartId: string | undefined
  let committedId: string | undefined
  let ownedProfile: { id: string; productId: string } | undefined
  try {
    const version = await pool.query("SELECT current_setting('server_version_num')::int AS v")
    assert.equal(Math.floor(version.rows[0].v / 10000), 17)
    const productId = "prod_" + randomUUID().replaceAll("-", "")
    const site = { address_1: "Disposable Medusa Site", city: "Cape Town", country_code: "za" }
    const cart = await carts.createCarts({
      email: "dev07-native-order@example.invalid",
      region_id: "reg_dev07_native_probe",
      sales_channel_id: "sc_dev07_native_probe",
      shipping_address: site,
      billing_address: site,
      currency_code: "ZAR",
      customer_id: "cus_" + randomUUID().replaceAll("-", ""),
      items: [
        {
          title: "Disposable native Cart Module price probe",
          variant_id: "variant_" + randomUUID().replaceAll("-", ""),
          product_id: productId,
          quantity: 2,
          unit_price: 10.25,
          tax_lines: [{ code: "DEV07_TAX_PROBE", rate: 20 }],
        },
      ],
    })
    cartId = cart.id
    await carts.addShippingMethods(cart.id, [
      {
        name: "Disposable pickup",
        amount: 0,
        shipping_option_id: "so_dev07_native_probe",
      },
    ])
    const newRevision = "2026-11-05T08:00:00.182396Z"
    const nativeCartPrice = nativeMedusaCartPriceReadback(
      carts,
      async () => 2,
      async () => {
        throw new Error("The missing charge package must prevent a CP issuer call")
      },
    )
    await assert.rejects(
      withNativeMedusaOrderTransaction(orders, async ({ db, manager }) => {
        await db.query("UPDATE cart SET updated_at=$2::timestamptz WHERE id=$1", [
          cart.id,
          newRevision,
        ])
        const observer = await pool.query("SELECT updated_at FROM cart WHERE id=$1", [cart.id])
        assert.notEqual(
          observer.rows[0].updated_at.toISOString(),
          new Date(newRevision).toISOString(),
        )
        // Getting to the expected missing-evidence refusal proves that the
        // Cart Module read the uncommitted revision, produced exact native
        // totals, and did not borrow a second connection or bypass pricing.
        await assert.rejects(
          nativeCartPrice(
            db,
            "unused_before_order_creation",
            {
              receipt: {
                resource_id: cart.id,
                tenant_id: "tn_dev07_native_probe",
                market_id: "market_dev07_native_probe",
                seller_legal_entity_id: "LE-DEV07-NATIVE-PROBE",
                currency: "ZAR",
              },
            },
            manager,
          ),
          /NATIVE_FINAL_CART_CHARGE_DETERMINATION_MISSING/,
        )
        throw new Error(ROLLBACK)
      }),
      new RegExp(ROLLBACK),
    )
    const afterCart = await pool.query("SELECT updated_at FROM cart WHERE id=$1", [cart.id])
    assert.notEqual(afterCart.rows[0].updated_at.toISOString(), new Date(newRevision).toISOString())
    // Component drill only. The pricing and CP checks above remain closed.
    // Here a rollback-only native order proves the DTO/SQL compatibility
    // against real Medusa tables without claiming IAM/CP authority or spend.
    const componentOrderId = id()
    const valuation: FinalNativeValuationFacts = {
      resource_id: cart.id,
      resource_version: 1,
      transaction_digest: "sha256:" + "1".repeat(64),
      currency: "ZAR",
      basis: "FINAL_PRICED",
      components: [
        {
          component_kind: "MERCHANDISE",
          amount_minor: 2050,
          determination: "FINAL",
          source_reference: "native:component-merchandise",
        },
        {
          component_kind: "TAX",
          amount_minor: 410,
          determination: "FINAL",
          source_reference: "native:component-tax",
        },
      ],
    }
    const facts = {
      receipt: {
        resource_id: cart.id,
        currency: "ZAR",
        amount_minor: 2460,
        market_id: "market_dev07_native_probe",
      },
      seller: { responsible_legal_entity_id: "LE-DEV07-NATIVE-PROBE" },
      valuation,
    }
    const source = medusaNativeOrderFactsSource()
    await assert.rejects(
      withNativeMedusaOrderTransaction(orders, async ({ db, manager }) => {
        await db.query(
          `INSERT INTO b2b_product_trade_profile
        (id,product_id,canonical_product_key,country_of_origin,hs_classification_reference,commodity_category,
         trade_uom,net_weight_kg,gross_weight_kg,packaging,export_eligibility_reference,commodity_attributes)
        VALUES ($1,$2,$2,'ZA','native-component-probe','component-probe','BAG',1,1,'BAG','component-probe','{}')`,
          ["b2bprod_" + productId, productId],
        )
        const candidate = await source.orderInput(db, componentOrderId, facts)
        const order = await orders.createOrders(candidate, { transactionManager: manager } as never)
        assert.equal(order.id, componentOrderId)
        const snapshot = await source.readFinal(db, componentOrderId, facts)
        assert.equal(snapshot.erp.totals.grand_total.amount, "24.60")
        assert.equal(snapshot.erp.totals.quoted_tax.amount, "4.10")
        throw new Error(ROLLBACK)
      }),
      new RegExp(ROLLBACK),
    )
    assert.equal(
      (await pool.query('SELECT 1 FROM "order" WHERE id=$1', [componentOrderId])).rowCount,
      0,
    )

    // Positive native *component* witness: persist the exact non-draft Order
    // Module business DTO and original line items through the same owner XID.
    // There is intentionally no buyer receipt, budget ledger or event here.
    // Those belong to the separately authorised connected buyer transaction.
    const nonDraftId = id()
    const profileId = "b2bprod_" + productId
    committedId = nonDraftId
    ownedProfile = { id: profileId, productId }
    const committedNonDraft = await withNativeMedusaOrderTransaction(
      orders,
      async ({ db, manager, xid }) => {
        await db.query(
          `INSERT INTO b2b_product_trade_profile
        (id,product_id,canonical_product_key,country_of_origin,hs_classification_reference,commodity_category,
         trade_uom,net_weight_kg,gross_weight_kg,packaging,export_eligibility_reference,commodity_attributes)
        VALUES ($1,$2,$2,'ZA','native-component-probe','component-probe','BAG',1,1,'BAG','component-probe','{}')`,
          [profileId, productId],
        )
        const candidate = await source.orderInput(db, nonDraftId, facts)
        assert.equal(candidate.is_draft_order, false)
        assert.equal(candidate.status, "pending")
        const created = await orders.createOrders(candidate, {
          transactionManager: manager,
        } as never)
        assert.equal(created.id, nonDraftId)
        const row = await db.query(
          'SELECT xmin::text AS xid, is_draft_order,status FROM "order" WHERE id=$1 AND deleted_at IS NULL',
          [nonDraftId],
        )
        assert.equal(row.rowCount, 1)
        assert.equal(row.rows[0].xid, nativeXid32(xid))
        assert.equal(row.rows[0].is_draft_order, false)
        assert.equal(row.rows[0].status, "pending")
        const snapshot = await source.readFinal(db, nonDraftId, facts)
        assert.equal(snapshot.erp.totals.grand_total.amount, "24.60")
        assert.equal(snapshot.erp.totals.quoted_tax.amount, "4.10")
        const items = await db.query(
          `SELECT oi.xmin::text AS item_xid, li.xmin::text AS line_xid
           FROM order_item oi JOIN order_line_item li ON li.id=oi.item_id
           WHERE oi.order_id=$1 AND oi.deleted_at IS NULL AND li.deleted_at IS NULL`,
          [nonDraftId],
        )
        assert.equal(items.rowCount, 1)
        assert.equal(items.rows[0].item_xid, nativeXid32(xid))
        assert.equal(items.rows[0].line_xid, nativeXid32(xid))
        return { xid: nativeXid32(xid), total: snapshot.erp.totals.grand_total.amount }
      },
    )
    committedId = nonDraftId
    const persistedNonDraft = await pool.query(
      'SELECT xmin::text AS xid,is_draft_order,status FROM "order" WHERE id=$1 AND deleted_at IS NULL',
      [nonDraftId],
    )
    assert.equal(persistedNonDraft.rowCount, 1)
    assert.equal(persistedNonDraft.rows[0].xid, committedNonDraft.xid)
    assert.equal(persistedNonDraft.rows[0].is_draft_order, false)
    assert.equal(persistedNonDraft.rows[0].status, "pending")
    assert.equal(committedNonDraft.total, "24.60")
    await orders.deleteOrders([nonDraftId])
    assert.equal(
      (await pool.query('SELECT 1 FROM "order" WHERE id=$1 AND deleted_at IS NULL', [nonDraftId]))
        .rowCount,
      0,
    )
    committedId = undefined
    // Custom trade-profile fixture is test-owned; delete by the exact random
    // product key and profile ID, never by tenant/global wildcard.
    await pool.query("DELETE FROM b2b_product_trade_profile WHERE id=$1 AND product_id=$2", [
      profileId,
      productId,
    ])
    ownedProfile = undefined
    await carts.deleteCarts([cart.id])
    cartId = undefined

    const rolledBackId = id()
    await assert.rejects(
      withNativeMedusaOrderTransaction(orders, async ({ manager, db, xid }) => {
        const result = await orders.createOrders(input(rolledBackId), {
          transactionManager: manager,
        } as never)
        assert.equal(result.id, rolledBackId, "Medusa must retain its native order ID")
        const row = await db.query(
          'SELECT xmin::text AS xid, is_draft_order FROM "order" WHERE id=$1 AND deleted_at IS NULL',
          [rolledBackId],
        )
        assert.equal(row.rowCount, 1)
        assert.equal(row.rows[0].xid, nativeXid32(xid), "Order escaped Medusa's owner transaction")
        assert.equal(
          row.rows[0].is_draft_order,
          true,
          "Medusa must persist the synthetic draft flag",
        )
        throw new Error(ROLLBACK)
      }),
      new RegExp(ROLLBACK),
    )
    assert.equal(
      (await pool.query('SELECT 1 FROM "order" WHERE id=$1', [rolledBackId])).rowCount,
      0,
      "A rejected Medusa native order cannot survive owner rollback",
    )

    const nativeId = id()
    const witnessed = await withNativeMedusaOrderTransaction(
      orders,
      async ({ manager, db, xid }) => {
        const order = await orders.createOrders(input(nativeId), {
          transactionManager: manager,
        } as never)
        assert.equal(order.id, nativeId)
        const orderRow = await db.query(
          'SELECT xmin::text AS xid, is_draft_order FROM "order" WHERE id=$1 AND deleted_at IS NULL',
          [nativeId],
        )
        assert.equal(orderRow.rowCount, 1)
        assert.equal(orderRow.rows[0].xid, nativeXid32(xid))
        assert.equal(orderRow.rows[0].is_draft_order, true)
        const items = await db.query(
          `SELECT oi.xmin::text AS item_xid, li.xmin::text AS line_xid
           FROM order_item oi JOIN order_line_item li ON li.id=oi.item_id
           WHERE oi.order_id=$1 AND oi.deleted_at IS NULL AND li.deleted_at IS NULL`,
          [nativeId],
        )
        assert.equal(items.rowCount, 1, "Real Medusa line item must be persisted")
        assert.equal(items.rows[0].item_xid, nativeXid32(xid))
        assert.equal(items.rows[0].line_xid, nativeXid32(xid))
        return { itemCount: items.rowCount, sameXid: true }
      },
    )
    committedId = nativeId
    const independent = await pool.query(
      'SELECT xmin::text AS xid, is_draft_order FROM "order" WHERE id=$1 AND deleted_at IS NULL',
      [nativeId],
    )
    assert.equal(independent.rowCount, 1, "Owner transaction must genuinely COMMIT")
    assert.equal(witnessed.itemCount, 1)
    assert.equal(witnessed.sameXid, true)
    // A real Medusa module API performs cleanup; direct SQL deletes cannot
    // stand in for the engine lifecycle and might bypass module relations.
    await orders.deleteOrders([nativeId])
    const afterDelete = await pool.query(
      'SELECT 1 FROM "order" WHERE id=$1 AND deleted_at IS NULL',
      [nativeId],
    )
    assert.equal(afterDelete.rowCount, 0, "Real native order cleanup was incomplete")
    committedId = undefined

    mkdirSync("artifacts/dev07-native-medusa-owner", { recursive: true })
    writeFileSync(
      "artifacts/dev07-native-medusa-owner/receipt.json",
      JSON.stringify(
        {
          schema: "baobab-trade.dev07-medusa-owned-transaction.v1",
          profile: "DISPOSABLE_POSTGRES17_MEDUSA_2_21_2",
          native_cart_totals_read_in_order_xid: true,
          absent_charge_evidence_refused: true,
          native_module_create_orders_executed: true,
          native_order_facts_adapter_rolled_back: true,
          independent_non_draft_native_order_and_lines_committed: true,
          native_non_draft_order_deleted_by_order_module: true,
          genuine_native_order_and_line_same_xid: true,
          rejected_native_order_rolled_back: true,
          independent_committed_native_order_readback: true,
          native_module_cleanup: true,
          iam_cp_operation_authority_proven: false,
          buyer_spend_and_native_order_same_xid_proven: false,
          trade_event_to_erp_proven: false,
          l4_ops_01: "BLOCKED",
        },
        null,
        2,
      ) + "\n",
    )
    console.log("PASS DEV07 real native Medusa 2.21.2 Order Module transaction/rollback/cleanup")
  } finally {
    // Only disposable records named by this run may be cleaned.
    if (cartId) await carts.deleteCarts([cartId]).catch(() => undefined)
    if (committedId) await orders.deleteOrders([committedId]).catch(() => undefined)
    if (ownedProfile)
      await pool
        .query("DELETE FROM b2b_product_trade_profile WHERE id=$1 AND product_id=$2", [
          ownedProfile.id,
          ownedProfile.productId,
        ])
        .catch(() => undefined)
    await pool.end()
  }
}
