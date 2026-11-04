/**
 * CAA-06b / DEV-07 -> DEV-11: real PostgreSQL 17 refusal drill for the
 * buyer-authority consumption fence. Medusa migrations must already be applied.
 *
 * Every identity and business fact below is synthetic. A correctly shaped
 * buyer receipt is not IAM/CP permission and, by itself, MUST NOT be enough
 * to consume seller authority, spend, native order or the canonical event.
 *
 * No success-path fixture, fake Medusa order or staging switch is produced.
 * The entire exercise rolls back, and the original refusal evidence is
 * retained separately from the future genuine connected positive.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { Pool, type PoolClient } from "pg"

type Negative = { case: string; result: "REFUSED" }

function disposableDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_DEV07_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_DEPLOYMENT_ENV !== undefined ||
    process.env.BAOBAB_ENVIRONMENT !== undefined ||
    !expected ||
    !url ||
    new URL(url).pathname !== "/" + expected
  ) {
    throw new Error("CAA-06b native guard drill requires its explicitly named disposable test database")
  }
  return url
}

async function mustRefuse(
  db: PoolClient,
  cases: Negative[],
  code: string,
  sql: string,
  parameters: unknown[],
  expected: RegExp,
): Promise<void> {
  await db.query("SAVEPOINT caa06b_expected_refusal")
  let refused = false
  try {
    await db.query(sql, parameters)
  } catch (error) {
    assert.match(error instanceof Error ? error.message : "", expected, code)
    refused = true
  } finally {
    // PostgreSQL marks a transaction aborted after a trigger exception;
    // clearing this savepoint is required before checking the next boundary.
    await db.query("ROLLBACK TO SAVEPOINT caa06b_expected_refusal")
    await db.query("RELEASE SAVEPOINT caa06b_expected_refusal")
  }
  assert.ok(refused, "CAA-06b unexpectedly accepted: " + code)
  cases.push({ case: code, result: "REFUSED" })
}

export async function runNativeBuyerGuardRegression(pool: Pool): Promise<Negative[]> {
  const version = await pool.query("SELECT current_setting('server_version_num')::int AS version")
  assert.ok(
    version.rows[0].version >= 170000 && version.rows[0].version < 180000,
    "CAA-06b drill requires PostgreSQL 17",
  )
  const expectedTriggers = [
    ["trade_buyer_authority_receipt", "trade_buyer_authority_receipt_guard"],
    ["trade_buyer_authority_receipt", "trade_buyer_receipt_immutable"],
    ["trade_buyer_authority_receipt", "trade_buyer_receipt_no_truncate"],
    ["trade_buyer_authority_consumption", "trade_buyer_authority_consumption_guard"],
    ["trade_buyer_authority_consumption", "trade_buyer_consumption_immutable"],
    ["trade_buyer_authority_consumption", "trade_buyer_consumption_no_truncate"],
    ["trade_order_commitment", "trade_order_commitment_classification"],
  ] as const
  for (const [relation, trigger] of expectedTriggers) {
    const found = await pool.query(
      "SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid = to_regclass($1) AND t.tgname = $2 AND NOT t.tgisinternal",
      [relation, trigger],
    )
    assert.equal(found.rows.length, 1, "Missing real CAA-06b/Decision 9 trigger: " + trigger)
    assert.equal(found.rows[0].tgenabled, "O", "Disabled CAA-06b/Decision 9 trigger: " + trigger)
  }
  const gate = await pool.query("SELECT mode FROM trade_commit_fence_enforcement WHERE singleton")
  assert.equal(gate.rows.length, 1)
  assert.equal(gate.rows[0].mode, "SHADOW", "Unqualified CAA-06b gate must remain SHADOW")

  const runId = randomUUID().replaceAll("-", "")
  const receiptId = randomUUID()
  const sellerId = randomUUID()
  const eventId = randomUUID()
  const evaluatedAt = new Date(Date.now() - 5_000).toISOString()
  const expiresAt = new Date(Date.now() + 40_000).toISOString()
  const payload = {
    receipt_id: receiptId,
    context_id: randomUUID(),
    decision_id: randomUUID(),
    correlation_id: randomUUID(),
    operation: "trade.order.commit",
    operation_reference: "trade/native-regression/" + runId,
    actor_principal_id: randomUUID(),
    tenant_id: "tn_native_guard_" + runId,
    canonical_organisation_id: randomUUID(),
    buyer_organisation_id: "b2borg_missing_" + runId,
    buyer_membership_id: "b2bmem_missing_" + runId,
    membership_revision: 1,
    market_id: "market_missing",
    resource_id: "cart_missing_" + runId,
    resource_version: 1,
    transaction_digest: "sha256:" + "a".repeat(64),
    amount_minor: 100,
    currency: "ZAR",
    valuation_digest: "sha256:" + "b".repeat(64),
    policy_revision: "synthetic/regression",
    spend_reservation_id: "b2bres_missing_" + runId,
    spend_hold_revision: 1,
    seller_legal_entity_id: "synthetic-legal-entity",
    seller_binding_reference: { binding_id: randomUUID(), binding_version: 1 },
    evaluated_at: evaluatedAt,
    expires_at: expiresAt,
  }
  const db = await pool.connect()
  const cases: Negative[] = []
  try {
    await db.query("BEGIN")
    await db.query("SET LOCAL lock_timeout = '3s'")
    await db.query("SET LOCAL statement_timeout = '5s'")

    const insert = "INSERT INTO trade_buyer_authority_receipt (receipt_id,payload,evaluated_at,expires_at) VALUES ($1::uuid,$2::jsonb,$3::timestamptz,$4::timestamptz)"
    await mustRefuse(
      db,
      cases,
      "missing-buyer-evidence-fields",
      insert,
      [randomUUID(), "{}", evaluatedAt, expiresAt],
      /incomplete or expired buyer authority/,
    )
    const expiredId = randomUUID()
    await mustRefuse(
      db,
      cases,
      "expired-buyer-evidence",
      insert,
      [
        expiredId,
        JSON.stringify({
          ...payload,
          receipt_id: expiredId,
          expires_at: evaluatedAt,
        }),
        evaluatedAt,
        evaluatedAt,
      ],
      /incomplete or expired buyer authority|check constraint/,
    )
    // This is only a syntactically valid payload. It is not a real issuer
    // receipt; all referenced authoritative records are deliberately absent.
    await db.query(insert, [
      receiptId,
      JSON.stringify(payload),
      evaluatedAt,
      expiresAt,
    ])
    await mustRefuse(
      db,
      cases,
      "immutable-buyer-receipt-update",
      "UPDATE trade_buyer_authority_receipt SET payload = '{}'::jsonb WHERE receipt_id=$1::uuid",
      [receiptId],
      /authority and consumption history are immutable/,
    )
    await mustRefuse(
      db,
      cases,
      "immutable-buyer-receipt-delete",
      "DELETE FROM trade_buyer_authority_receipt WHERE receipt_id=$1::uuid",
      [receiptId],
      /authority and consumption history are immutable/,
    )
    await mustRefuse(
      db,
      cases,
      "immutable-buyer-receipt-truncate",
      "TRUNCATE trade_buyer_authority_receipt, trade_buyer_authority_consumption",
      [],
      /authority and consumption history are immutable/,
    )
    await mustRefuse(
      db,
      cases,
      "no-unattributed-native-buyer-consumption",
      "INSERT INTO trade_buyer_authority_consumption (receipt_id,seller_receipt_id,spend_reservation_id,operation_reference,order_id,event_id) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)",
      [
        receiptId,
        sellerId,
        payload.spend_reservation_id,
        payload.operation_reference,
        "order_missing_" + runId,
        eventId,
      ],
      /buyer\/native\/spend\/outbox transaction not proven/,
    )
    const noConsumption = await db.query(
      "SELECT count(*)::int AS n FROM trade_buyer_authority_consumption WHERE receipt_id=$1::uuid",
      [receiptId],
    )
    assert.equal(noConsumption.rows[0].n, 0, "Refused consumption had a business effect")
  } finally {
    // The only new receipt was synthetic; never persist it or its context.
    await db.query("ROLLBACK").catch(() => undefined)
    db.release()
  }
  const residue = await pool.query(
    "SELECT count(*)::int AS n FROM trade_buyer_authority_receipt WHERE receipt_id=$1::uuid",
    [receiptId],
  )
  assert.equal(residue.rows[0].n, 0, "Disposable buyer receipt was retained")
  assert.equal(cases.length, 6)
  return cases
}

export default async function () {
  const pool = new Pool({ connectionString: disposableDatabaseUrl(), max: 2 })
  try {
    const cases = await runNativeBuyerGuardRegression(pool)
    mkdirSync("artifacts/dev07-native-buyer-guard", { recursive: true })
    writeFileSync(
      "artifacts/dev07-native-buyer-guard/receipt.json",
      JSON.stringify(
        {
          profile: "CAA-06b-native-PG17-negative-only",
          native_order_created: false,
          buyer_IAM_CP_authorized: false,
          rabbit_ERP_consequence_proven: false,
          l4_ops_01: "BLOCKED",
          cases,
        },
        null,
        2,
      ) + "\n",
    )
    for (const result of cases) console.log("PASS " + result.case)
  } finally {
    await pool.end()
  }
}
