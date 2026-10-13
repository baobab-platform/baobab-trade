/** Test-only migration acceptance: seed an expired ACTIVE row in the original
 * owner schema, apply the actual governance migrations, then withdraw it through
 * authenticated intake. Receipts remain until disposal of the marked CI DB. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { Migration20261010013000 } from "../modules/legal-seller-checkout/migrations/Migration20261010013000"
import { Migration20261013130000 } from "../modules/legal-seller-checkout/migrations/Migration20261013130000"
import { Migration20261013150000 } from "../modules/legal-seller-checkout/migrations/Migration20261013150000"
import { PostgresGovernedBindingPersistence } from "../baobab/orders/postgres-governed-binding-persistence"
import { AuthenticatedBindingIntake } from "../baobab/orders/authenticated-binding-intake"
import type { BindingAuthorityClient } from "../baobab/orders/binding-authority-client"

export async function acceptLegacyBindingUpgrade(
  rootPool: Pool,
  cp: BindingAuthorityClient,
  salesChannelId: string,
  regionId: string,
): Promise<void> {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  )
    throw new Error("Legacy migration acceptance requires the marked disposable database")
  const schema = `legacy_binding_${randomUUID().replace(/-/g, "")}`
  await rootPool.query(`CREATE SCHEMA ${schema}`)
  const scopedUrl = new URL(url)
  scopedUrl.searchParams.set("options", `-c search_path=${schema},public`)
  const pool = new Pool({
    connectionString: scopedUrl.toString(),
    max: 2,
    connectionTimeoutMillis: 3000,
  })
  const cartId = `legacy-cart-${randomUUID()}`
  const bindingId = `lsbind_legacy_${randomUUID().replace(/-/g, "")}`
  try {
    // These owner migrations only queue SQL. Their original SQL is applied in
    // this isolated schema in the same order as the real Medusa migration run.
    const initial = new Migration20261010013000(undefined as never, undefined as never)
    await initial.up()
    for (const sql of initial.getQueries()) {
      if (typeof sql !== "string") throw new Error("Expected owner SQL")
      await pool.query(sql)
    }
    await pool.query(
      `INSERT INTO native_seller_cart_binding
      (id,cart_id,tenant_id,organisation_id,context_id,responsible_legal_entity_id,sales_channel_id,region_id,
       market_code,market_key,legal_activity,legal_capability,currency_code,approval_reference,approval_scope,
       proposed_by,proposed_at,approved_by,approved_at,expires_at,status,correlation_id)
      VALUES ($1,$2,'tn_synthetic01','00000000-0000-4000-8000-000000000001','legacy-unqualified-context',
       'LE-SYNTHETIC-SELLER',$3,$4,'ZA','legacy_market','LEGACY_UNQUALIFIED','commerce.order.create','ZAR',
       'legacy-original-approval','SELLER_OF_RECORD_CART_BINDING','legacy-maker',clock_timestamp()-interval '2 minutes',
       'legacy-checker',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 second','ACTIVE','legacy-original-correlation')`,
      [bindingId, cartId, salesChannelId, regionId],
    )
    const original = (
      await pool.query("SELECT * FROM native_seller_cart_binding WHERE id=$1", [bindingId])
    ).rows[0]
    for (const Type of [Migration20261013130000, Migration20261013150000]) {
      const migration = new Type(undefined as never, undefined as never)
      await migration.up()
      for (const sql of migration.getQueries()) {
        if (typeof sql !== "string") throw new Error("Expected owner SQL")
        await pool.query(sql)
      }
    }
    const persistence = new PostgresGovernedBindingPersistence({
      connect: async () => {
        const client = await pool.connect()
        return {
          query: (sql, values) => client.query(sql, values ? [...values] : []),
          release: () => client.release(),
        }
      },
    })
    const loaded = await persistence.load(cartId)
    assert.ok(loaded)
    assert.equal(loaded.proposal, undefined)
    assert.equal(loaded.revision, 0)
    assert.equal(loaded.status, "ACTIVE")
    const intake = new AuthenticatedBindingIntake(
      cp,
      persistence,
      async () => {
        throw new Error("Legacy native cart unavailable")
      },
      async () => {
        throw new Error("Legacy workload credential unavailable")
      },
    )
    await assert.rejects(
      intake.execute("approve", cartId, { revision: 0 }, "synthetic-human-token"),
    )
    await assert.rejects(
      intake.execute("activate", cartId, { revision: 0 }, "synthetic-human-token"),
    )
    await intake.execute(
      "revoke",
      cartId,
      { revision: 0, reason: "retire expired legacy binding" },
      "synthetic-human-token",
    )
    const revoked = (
      await pool.query("SELECT * FROM native_seller_cart_binding WHERE id=$1", [bindingId])
    ).rows[0]
    assert.equal(revoked.status, "REVOKED")
    assert.equal(revoked.revision, 1)
    assert.equal(revoked.proposal_snapshot, null)
    assert.equal(revoked.activation_snapshot, null)
    for (const key of Object.keys(original).filter((k) => !["status", "updated_at"].includes(k)))
      assert.deepEqual(revoked[key], original[key], key)
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM la05_binding_decision WHERE binding_id=$1",
          [bindingId],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM la05_binding_outbox")).rows[0].n,
      1,
    )
    console.log(
      "P0-04B-02: actual legacy schema upgrade preserves historical fields, denies approval/activation and admits current human withdrawal without a fabricated proposal",
    )
  } finally {
    await pool.end()
  }
}
