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
import type { ExecArgs, IOrderModuleService, OrderTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import {
  nativeXid32,
  withNativeMedusaOrderTransaction,
} from "../baobab/b2b/medusa-native-transaction-owner"

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
  let committedId: string | undefined
  try {
    const version = await pool.query("SELECT current_setting('server_version_num')::int AS v")
    assert.equal(Math.floor(version.rows[0].v / 10000), 17)
    const rolledBackId = id()
    await assert.rejects(
      withNativeMedusaOrderTransaction(orders, async ({ manager, db, xid }) => {
        const result = await orders.createOrders(input(rolledBackId), {
          transactionManager: manager,
        } as never)
        assert.equal(result.id, rolledBackId, "Medusa must retain its native order ID")
        const row = await db.query(
          'SELECT xmin::text AS xid FROM "order" WHERE id=$1 AND deleted_at IS NULL',
          [rolledBackId],
        )
        assert.equal(row.rowCount, 1)
        assert.equal(row.rows[0].xid, nativeXid32(xid), "Order escaped Medusa's owner transaction")
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
          'SELECT xmin::text AS xid FROM "order" WHERE id=$1 AND deleted_at IS NULL',
          [nativeId],
        )
        assert.equal(orderRow.rowCount, 1)
        assert.equal(orderRow.rows[0].xid, nativeXid32(xid))
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
      'SELECT xmin::text AS xid FROM "order" WHERE id=$1 AND deleted_at IS NULL',
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
          native_module_create_orders_executed: true,
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
    if (committedId) await orders.deleteOrders([committedId]).catch(() => undefined)
    await pool.end()
  }
}
