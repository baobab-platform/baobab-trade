/** Actual migrated PostgreSQL only; synthetic authority is labelled and cannot
 * qualify IAM/CP, supplier, provider, commitment or complete INT-05 readiness.
 */
import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { Pool } from "pg"
import {
  PostgresCommercialLifecycle,
  type CommercialAuthorization,
  type CommercialAction,
} from "../baobab/b2b/postgres-commercial-lifecycle"
import type { CommercialContext, Rfq, Quotation } from "../baobab/b2b/commercial-lifecycle"
import type { PgPool } from "../baobab/orders/postgres-governed-binding-persistence"

export async function runCommercialLifecycleRegression(pool: Pool) {
  const run = randomUUID().replaceAll("-", "")
  const scope: CommercialContext = {
    principal_id: randomUUID(),
    tenant_id: "tn_commercial" + run,
    legal_entity_id: "SYNTHETIC",
    digital_estate_id: "synthetic_estate",
    market_id: "market_synthetic",
    buyer_organisation_id: "b2borg_" + run,
  }
  const membership = "b2bmem_" + run,
    canonical = randomUUID()
  await pool.query(
    "INSERT INTO b2b_organisation(id,tenant_id,legal_name,status,canonical_organisation_id,link_provenance) VALUES($1,$2,'Synthetic lifecycle buyer','ACTIVE',$3,'synthetic-native-regression')",
    [scope.buyer_organisation_id, scope.tenant_id, canonical],
  )
  await pool.query(
    "INSERT INTO b2b_buyer_membership(id,organisation_id,principal_id,status) VALUES($1,$2,$3,'ACTIVE')",
    [membership, scope.buyer_organisation_id, scope.principal_id],
  )
  const org = (
    await pool.query("SELECT relationship_revision FROM b2b_organisation WHERE id=$1", [
      scope.buyer_organisation_id,
    ])
  ).rows[0]
  const member = (
    await pool.query("SELECT revision FROM b2b_buyer_membership WHERE id=$1", [membership])
  ).rows[0]
  let denied = false,
    expired = false
  const buyerActions = [
    "RFQ_READ",
    "QUOTATION_READ",
    "RFQ_CREATE",
    "RFQ_SUBMIT",
    "RFQ_WITHDRAW",
    "QUOTATION_REJECT",
  ]
  const authority = {
    // Explicitly synthetic policy fixture. Production never installs this port.
    async authorize(
      action: CommercialAction,
      context: CommercialContext,
    ): Promise<CommercialAuthorization> {
      if (denied) throw new Error("synthetic authority unavailable")
      return {
        action,
        context,
        decisionId: randomUUID(),
        evidenceReference: "synthetic-native-regression",
        evaluatedAt: new Date(Date.now() - 100),
        expiresAt: new Date(Date.now() + (expired ? -1 : 30000)),
        relationshipRevision: Number(org.relationship_revision),
        canonicalOrganisationId: canonical,
        actor: buyerActions.includes(action)
          ? { kind: "BUYER", membershipId: membership, revision: Number(member.revision) }
          : action.endsWith("EXPIRE")
            ? { kind: "SYSTEM" }
            : { kind: "SELLER" },
      }
    },
  }
  const service = new PostgresCommercialLifecycle(pool as unknown as PgPool, authority)
  let sequence = 0
  const key = () => "commercial." + run + "." + ++sequence
  const input = {
    context: scope,
    lines: [
      {
        client_line_id: "line_one",
        variant_id: "variant_one",
        quantity: { value: "3", unit: "KG" },
      },
    ],
  }
  const create = { action: "RFQ_CREATE" as const, scope, idempotencyKey: key(), payload: input }
  const first = await service.execute(create)
  assert.equal(first.outcome, "APPLIED")
  assert.equal(first.resource.status, "DRAFT")
  const replay = await service.execute(create)
  assert.equal(replay.outcome, "REPLAYED")
  assert.deepEqual(replay.resource, first.resource)
  await assert.rejects(
    service.execute({ ...create, payload: { ...input, notes: "changed" } }),
    /CONFLICT/,
  )
  const rfq = first.resource as Rfq
  const submit = {
    action: "RFQ_SUBMIT" as const,
    scope,
    idempotencyKey: key(),
    resourceId: rfq.rfq_id,
    expectedVersion: rfq.version,
  }
  const race = await Promise.allSettled([
    service.execute(submit),
    service.execute({ ...submit, idempotencyKey: key() }),
  ])
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 1)
  assert.equal(race.filter((x) => x.status === "rejected").length, 1)
  const reviewed = (
    await service.execute({
      action: "RFQ_REVIEW",
      scope,
      idempotencyKey: key(),
      resourceId: rfq.rfq_id,
      expectedVersion: 2,
    })
  ).resource as Rfq
  const quote = (
    await service.execute({
      action: "QUOTATION_ISSUE",
      scope,
      idempotencyKey: key(),
      resourceId: rfq.rfq_id,
      expectedVersion: reviewed.version,
      payload: {
        currency: "ZAR",
        lines: [
          {
            line_id: "line_one",
            variant_id: "variant_one",
            quantity: { value: "3", unit: "KG" },
            unit_price: { amount: "0.1", currency: "ZAR" },
            line_total: { amount: "0.3", currency: "ZAR" },
          },
        ],
        total: { amount: "0.3", currency: "ZAR" },
        valid_until: new Date(Date.now() + 60000).toISOString(),
      },
    })
  ).resource as Quotation
  assert.equal(quote.status, "ISSUED")
  assert.equal((await service.read(scope, "RFQ", rfq.rfq_id))[0].status, "QUOTED")
  for (const field of [
    "tenant_id",
    "buyer_organisation_id",
    "digital_estate_id",
    "market_id",
    "legal_entity_id",
  ] as const)
    await assert.rejects(
      service.execute({
        ...submit,
        idempotencyKey: key(),
        scope: { ...scope, [field]: "foreign_value" },
      }),
      /NOT_FOUND/,
    )
  expired = true
  await assert.rejects(service.execute({ ...create, idempotencyKey: key() }), /AUTHORITY_DENIED/)
  expired = false
  denied = true
  await assert.rejects(service.execute(create))
  denied = false
  const history = await pool.query(
    "SELECT version,document,xmin::text AS xid FROM trade_commercial_event WHERE resource_id=$1 ORDER BY version",
    [rfq.rfq_id],
  )
  assert.deepEqual(
    history.rows.map((x) => x.version),
    [1, 2, 3, 4],
  )
  const issued = await pool.query(
    "SELECT xmin::text AS xid FROM trade_commercial_event WHERE resource_id IN ($1,$2) AND ((resource_id=$1 AND version=4) OR resource_id=$2)",
    [rfq.rfq_id, quote.quotation_id],
  )
  assert.equal(issued.rowCount, 2)
  assert.equal(issued.rows[0].xid, issued.rows[1].xid)
  await assert.rejects(
    pool.query(
      "UPDATE trade_commercial_resource SET status='ACCEPTED',version=version+1,document=jsonb_set(jsonb_set(document,'{status}','\"ACCEPTED\"'),'{version}',to_jsonb(version+1)) WHERE resource_id=$1",
      [quote.quotation_id],
    ),
    /invalid lifecycle/,
  )
  await assert.rejects(
    pool.query("UPDATE trade_commercial_event SET document='{}' WHERE resource_id=$1", [
      rfq.rfq_id,
    ]),
    /immutable/,
  )
  await assert.rejects(
    pool.query(
      "INSERT INTO trade_commercial_event(resource_id,version,document) VALUES($1,99,'{}')",
      [rfq.rfq_id],
    ),
    /originate/,
  )
  const withdrawn = (
    await service.execute({
      action: "RFQ_WITHDRAW",
      scope,
      idempotencyKey: key(),
      resourceId: rfq.rfq_id,
      expectedVersion: 4,
    })
  ).resource
  assert.equal(withdrawn.status, "WITHDRAWN")
  assert.equal((await service.read(scope, "QUOTATION", quote.quotation_id))[0].status, "WITHDRAWN")
  await assert.rejects(
    service.execute({ ...submit, idempotencyKey: key(), expectedVersion: 5 }),
    /CONFLICT/,
  )
  // Readback and independent cleanup of owned membership/account activity.
  await pool.query("UPDATE b2b_buyer_membership SET status='REVOKED' WHERE id=$1", [membership])
  await assert.rejects(service.read(scope, "RFQ", rfq.rfq_id), /AUTHORITY_DENIED/)
  await pool.query("UPDATE b2b_organisation SET status='CLOSED' WHERE id=$1", [
    scope.buyer_organisation_id,
  ])
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM b2b_organisation WHERE id=$1 AND status='ACTIVE'",
        [scope.buyer_organisation_id],
      )
    ).rows[0].n,
    0,
  )
  return {
    schema: "trade.dev07.commercial-native.v1",
    run_id: run,
    evidence_class: "NATIVE_POSTGRES_SYNTHETIC_AUTHORITY",
    checks: {
      draft_and_idempotency: true,
      conflicting_replay_denied: true,
      concurrent_submit_one_winner: true,
      rfq_and_quote_atomic_history: true,
      scope_isolation: true,
      current_authority_required: true,
      immutable_history: true,
      direct_sql_acceptance_denied: true,
      parent_withdrawal_closes_offer: true,
      terminal_reopen_denied: true,
      native_cleanup_readback: true,
    },
    iam_cp_qualified: false,
    provider_qualified: false,
    native_commitment_qualified: false,
    int05_qualified: false,
    production_authorized: false,
  }
}
export default async function () {
  const url = process.env.DATABASE_URL,
    expected = process.env.BAOBAB_DEV07_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !url ||
    !expected ||
    !expected.endsWith("_test") ||
    new URL(url).pathname !== "/" + expected
  )
    throw new Error("Commercial regression requires the explicitly marked disposable test database")
  const folder = "artifacts/dev07-commercial"
  await mkdir(folder, { recursive: true })
  await rm(folder + "/report.json", { force: true })
  await rm(folder + "/report.sha256.json", { force: true })
  const pool = new Pool({ connectionString: url, max: 6 })
  try {
    const result = await runCommercialLifecycleRegression(pool),
      raw = JSON.stringify(result, null, 2) + "\n"
    await writeFile(folder + "/report.json", raw)
    await writeFile(
      folder + "/report.sha256.json",
      JSON.stringify({ sha256: createHash("sha256").update(raw).digest("hex") }) + "\n",
    )
    console.log("DEV07_COMMERCIAL_NATIVE_COMPONENT_PASS")
  } finally {
    await pool.end()
  }
}
