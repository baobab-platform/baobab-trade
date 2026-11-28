import assert from "node:assert/strict"
import pg from "pg"

const url = new URL(process.env.DATABASE_URL ?? "")
assert.equal(url.pathname, "/baobab_trade_test", "requires the disposable Trade database")
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname))
const client = new pg.Client({ connectionString: url.toString() })
await client.connect()

try {
  const version = await client.query("SHOW server_version_num")
  assert.equal(Math.trunc(Number(version.rows[0].server_version_num) / 10000), 17)
  const installed = await client.query(`
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'b2b_purchase_approval'::regclass
      AND tgfoid = 'b2b_purchase_approval_stamp_revision()'::regprocedure
      AND tgname = 'b2b_purchase_approval_stamp_revision'
      AND tgenabled = 'O'`)
  assert.equal(installed.rowCount, 1)

  // Reuse the migrated row shape and production trigger without introducing
  // synthetic approval data into the runtime table.
  await client.query("BEGIN")
  await client.query(`
    CREATE TEMP TABLE approval_probe
    (LIKE b2b_purchase_approval INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
    CREATE TRIGGER approval_probe_revision BEFORE INSERT OR UPDATE ON approval_probe
    FOR EACH ROW EXECUTE FUNCTION b2b_purchase_approval_stamp_revision();
  `)
  let result = await client.query(`
    INSERT INTO approval_probe
      (id, organisation_id, requested_by_membership_id, amount_minor, raw_amount_minor,
       currency_code, reason, resource_version, revision)
    VALUES ('approval-test', 'organisation-test', 'membership-test', 1000, '{}',
            'ZAR', 'disposable revision test', '42', 9000)
    RETURNING revision, resource_version`)
  assert.deepEqual(result.rows, [{ revision: 1, resource_version: "42" }])
  await client.query("SAVEPOINT before_change")
  result = await client.query(`
    UPDATE approval_probe SET status='CANCELLED', revision=1
    WHERE id='approval-test' AND status='PENDING' AND revision=1
    RETURNING revision, resource_version`)
  assert.deepEqual(result.rows, [{ revision: 2, resource_version: "42" }])
  result = await client.query(`
    UPDATE approval_probe SET status='APPROVED'
    WHERE id='approval-test' AND status='PENDING' AND revision=1`)
  assert.equal(result.rowCount, 0)
  await client.query("ROLLBACK TO SAVEPOINT before_change")
  result = await client.query("SELECT revision, status FROM approval_probe")
  assert.deepEqual(result.rows, [{ revision: 1, status: "PENDING" }])
  await client.query("ROLLBACK")
} finally {
  await client.end()
}
