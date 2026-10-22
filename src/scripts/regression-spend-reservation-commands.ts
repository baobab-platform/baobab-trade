/**
 * ADR-SHARED-042 section 14, Decision 5 / CAA-06: the spend reservation
 * commands on a disposable PostgreSQL 17 database with the real b2b
 * migrations. Synthetic Organisations, memberships and budgets only: this
 * proves the ledger and the commands, never IAM, CP, the seller decision,
 * the native commit fence or connected acceptance.
 *
 * Refuses a non-test or unmarked database. Rows are append-only and stay
 * until CI disposes the database.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import type { PgPool } from "../baobab/orders/postgres-governed-binding-persistence"
import {
  PostgresSpendReservationCommands,
  type SpendCommandResult,
  type SubmitCommand,
} from "../baobab/b2b/spend-reservation-commands"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const digest = (seed: string) =>
  `sha256:${seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "a")}`

export async function runSpendReservationRegression(pool: Pool): Promise<string[]> {
  const commands = new PostgresSpendReservationCommands(pool as unknown as PgPool)
  const passed: string[] = []
  const pass = (name: string) => passed.push(name)
  const run = randomUUID().replaceAll("-", "").slice(0, 12)
  const tenant = `tn_spend_${run}`
  const actor = randomUUID()
  const sql = (text: string, values: unknown[] = []) => pool.query(text, values)
  let seq = 0
  const key = (label: string) => `regression.${run}.${label}.${++seq}`

  const organisation = async (suffix: string) => {
    const id = `b2borg_${run}${suffix}`
    await sql(
      `insert into "b2b_organisation" ("id", "tenant_id", "legal_name", "status") values ($1, $2, $3, 'ACTIVE')`,
      [id, tenant, `Synthetic buyer ${suffix}`],
    )
    return id
  }
  const membership = async (org: string, suffix: string) => {
    const id = `b2bmem_${run}${suffix}`
    await sql(
      `insert into "b2b_buyer_membership" ("id", "organisation_id", "status") values ($1, $2, 'ACTIVE')`,
      [id, org],
    )
    return id
  }
  const budget = async (
    org: string,
    scope: "MEMBERSHIP" | "ORGANISATION",
    member: string | null,
    limit: bigint,
    suffix: string,
  ) => {
    const id = `b2bbud_${run}${suffix}`
    await sql(
      `insert into "b2b_spend_budget_policy" ("id", "scope", "tenant_id", "organisation_id", "membership_id",
         "market_key", "currency_code", "period_kind", "timezone", "limit_minor", "raw_limit_minor",
         "effective_from", "evidence_reference")
       values ($1, $2, $3, $4, $5, 'ZA', 'ZAR', 'CALENDAR_MONTH', 'Africa/Johannesburg', $6, '{}',
               now() - interval '1 day', 'synthetic/regression')`,
      [id, scope, tenant, org, member, limit.toString()],
    )
    return id
  }
  const balance = async (policy: string) => {
    const { rows } = await sql(
      `select "committed_minor", "reserved_minor" from "b2b_spend_budget_balance" where "budget_policy_id" = $1`,
      [policy],
    )
    return rows[0] ? [BigInt(rows[0].committed_minor), BigInt(rows[0].reserved_minor)] : [0n, 0n]
  }
  const submission = (
    org: string,
    member: string,
    amount: bigint,
    seed: string,
    change: Partial<SubmitCommand> = {},
  ): SubmitCommand => ({
    idempotencyKey: key(`submit-${seed}`),
    tenantId: tenant,
    organisationId: org,
    membershipId: member,
    actorPrincipalId: actor,
    marketKey: "ZA",
    currencyCode: "ZAR",
    agreementReference: null,
    transactionDigest: digest(seed),
    resourceVersion: 1,
    amountMinor: amount,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...change,
  })
  const applied = (result: SpendCommandResult) => {
    assert.ok(result.outcome === "APPLIED", JSON.stringify(result))
    return result
  }
  const commitOf = (
    org: string,
    reservationId: string,
    s: SubmitCommand,
    change: Record<string, unknown> = {},
  ) => ({
    idempotencyKey: key("commit"),
    organisationId: org,
    reservationId,
    actorPrincipalId: actor,
    transactionDigest: s.transactionDigest,
    resourceVersion: s.resourceVersion,
    amountMinor: s.amountMinor,
    commitmentReference: `order_synthetic_${run}`,
    ...change,
  })

  // The Decision 5 worked example: R100,000 limit, R55,000 committed, R30,000 reserved.
  const org = await organisation("a")
  const alice = await membership(org, "alice")
  const member = await budget(org, "MEMBERSHIP", alice, 10_000_000n, "alice")
  const first = submission(org, alice, 5_500_000n, "1")
  const firstRes = applied(await commands.submit(first))
  applied(await commands.commit(commitOf(org, firstRes.reservationId, first)))
  applied(await commands.submit(submission(org, alice, 3_000_000n, "2")))
  assert.deepEqual(await balance(member), [5_500_000n, 3_000_000n])

  const tooMuch = submission(org, alice, 2_000_000n, "3")
  assert.deepEqual(await commands.submit(tooMuch), {
    outcome: "REFUSED",
    reason: "SPEND_LIMIT_EXCEEDED",
  })
  const left = await sql(`select 1 from "b2b_spend_reservation" where "transaction_digest" = $1`, [
    tooMuch.transactionDigest,
  ])
  assert.equal(left.rowCount, 0)
  assert.deepEqual(await balance(member), [5_500_000n, 3_000_000n])
  pass("a shortfall is SPEND_LIMIT_EXCEEDED and leaves nothing behind")

  const fits = submission(org, alice, 1_500_000n, "4")
  const fitsRes = applied(await commands.submit(fits))
  assert.deepEqual(await commands.submit(fits), { ...fitsRes, outcome: "REPLAYED" })
  assert.deepEqual(await commands.submit({ ...fits, amountMinor: 1_000_000n }), {
    outcome: "CONFLICT",
  })
  assert.deepEqual(await commands.submit({ ...fits, idempotencyKey: key("other") }), {
    outcome: "CONFLICT",
  })
  assert.deepEqual(await balance(member), [5_500_000n, 4_500_000n])
  pass("submission is idempotent and a purchase holds one reservation")

  const commit = commitOf(org, fitsRes.reservationId, fits)
  assert.deepEqual(await commands.commit({ ...commit, amountMinor: 1_400_000n }), {
    outcome: "REFUSED",
    reason: "TRANSACTION_CHANGED",
  })
  const committed = applied(await commands.commit(commit))
  assert.equal(committed.status, "COMMITTED")
  assert.deepEqual(await commands.commit(commit), { ...committed, outcome: "REPLAYED" })
  assert.deepEqual(await commands.commit({ ...commit, idempotencyKey: key("again") }), {
    outcome: "REFUSED",
    reason: "CONTEXT_NOT_USABLE",
  })
  assert.deepEqual(await balance(member), [7_000_000n, 3_000_000n])
  pass("commit converts reserved to committed exactly once")

  // A second member with room of their own, under a nearly exhausted organisation budget.
  const bob = await membership(org, "bob")
  const bobBudget = await budget(org, "MEMBERSHIP", bob, 5_000_000n, "bob")
  const shared = await budget(org, "ORGANISATION", null, 500_000n, "org")
  const overShared = submission(org, bob, 600_000n, "5")
  assert.deepEqual(await commands.submit(overShared), {
    outcome: "REFUSED",
    reason: "SPEND_LIMIT_EXCEEDED",
  })
  assert.deepEqual(await balance(bobBudget), [0n, 0n])
  const bobFits = submission(org, bob, 400_000n, "6")
  const bobRes = applied(await commands.submit(bobFits))
  assert.deepEqual(await balance(shared), [0n, 400_000n])
  pass("every applicable ceiling passes or none is touched")

  assert.deepEqual(
    await commands.submit(submission(org, await membership(org, "carol"), 1n, "7")),
    { outcome: "REFUSED", reason: "SPEND_POLICY_NOT_CONFIGURED" },
  )
  pass("a member without a monthly budget is SPEND_POLICY_NOT_CONFIGURED")

  // Resubmission: the old hold is released before the new one is taken.
  const grown = submission(org, bob, 500_000n, "6", { resourceVersion: 2 })
  const grownRes = applied(await commands.resubmit({ ...grown, supersedes: bobRes.reservationId }))
  assert.deepEqual(await balance(shared), [0n, 500_000n])
  assert.deepEqual(
    await commands.resubmit({
      ...submission(org, bob, 400_000n, "6", { resourceVersion: 3 }),
      supersedes: bobRes.reservationId,
    }),
    { outcome: "REFUSED", reason: "CONTEXT_NOT_USABLE" },
  )
  pass("resubmission needs capacity for the difference only and never reuses a closed reservation")

  const released = applied(
    await commands.release({
      idempotencyKey: key("release"),
      organisationId: org,
      reservationId: grownRes.reservationId,
      actorPrincipalId: actor,
      reason: "CANCELLED",
    }),
  )
  assert.equal(released.status, "RELEASED")
  assert.deepEqual(await balance(shared), [0n, 0n])
  assert.deepEqual(await balance(bobBudget), [0n, 0n])
  pass("release returns every unused hold")

  // An expired reservation never authorises commitment and is released by governed expiry.
  const brief = submission(org, bob, 100_000n, "8", { expiresAt: new Date(Date.now() + 1500) })
  const briefRes = applied(await commands.submit(brief))
  await sleep(2000)
  assert.deepEqual(await commands.commit(commitOf(org, briefRes.reservationId, brief)), {
    outcome: "REFUSED",
    reason: "CONTEXT_NOT_USABLE",
  })
  const expired = applied(
    await commands.expire({
      idempotencyKey: key("expire"),
      organisationId: org,
      reservationId: briefRes.reservationId,
      actorPrincipalId: actor,
    }),
  )
  assert.equal(expired.status, "EXPIRED")
  assert.deepEqual(await balance(bobBudget), [0n, 0n])
  pass("an expired hold never commits and expiry returns its capacity")

  // A revised budget invalidates the hold until it is rolled over.
  const held = submission(org, bob, 200_000n, "9")
  const heldRes = applied(await commands.submit(held))
  await sql(
    `update "b2b_spend_budget_policy" set "limit_minor" = 6000000, "raw_limit_minor" = '{}' where "id" = $1`,
    [bobBudget],
  )
  assert.deepEqual(await commands.commit(commitOf(org, heldRes.reservationId, held)), {
    outcome: "REFUSED",
    reason: "CONTEXT_NOT_USABLE",
    detail: "ROLLOVER_REQUIRED",
  })
  const rolled = applied(
    await commands.rollover({
      idempotencyKey: key("rollover"),
      organisationId: org,
      reservationId: heldRes.reservationId,
      actorPrincipalId: actor,
    }),
  )
  assert.equal(rolled.approvalRevalidationRequired, true)
  assert.deepEqual(await balance(bobBudget), [0n, 200_000n])
  applied(await commands.commit(commitOf(org, heldRes.reservationId, held)))
  assert.deepEqual(await balance(bobBudget), [200_000n, 0n])
  pass("a policy revision requires rollover before commit and rollover reacquires capacity")

  // Concurrent submissions that together exceed capacity: exactly one wins.
  const raceOrg = await organisation("c")
  const racer = await membership(raceOrg, "dave")
  const raceBudget = await budget(raceOrg, "MEMBERSHIP", racer, 1_000_000n, "dave")
  const results = await Promise.all(
    ["a", "b", "c", "d"].map((seed) =>
      commands.submit(submission(raceOrg, racer, 600_000n, `race${seed}`)),
    ),
  )
  assert.equal(results.filter((r) => r.outcome === "APPLIED").length, 1)
  assert.equal(
    results.filter((r) => r.outcome === "REFUSED" && r.reason === "SPEND_LIMIT_EXCEEDED").length,
    3,
  )
  assert.deepEqual(await balance(raceBudget), [0n, 600_000n])
  pass("concurrent submissions never exceed capacity")

  // A reservation of another Organisation is never disclosed or moved.
  const other = await organisation("b")
  assert.deepEqual(
    await commands.release({
      idempotencyKey: key("foreign"),
      organisationId: other,
      reservationId: heldRes.reservationId,
      actorPrincipalId: actor,
      reason: "CANCELLED",
    }),
    { outcome: "REFUSED", reason: "BUYER_NOT_AUTHORISED" },
  )
  pass("a foreign reservation is BUYER_NOT_AUTHORISED")

  return passed
}

export default async function () {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_SPEND_LEDGER_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Spend reservation regression requires the explicitly marked disposable test database",
    )
  }
  const pool = new Pool({ connectionString: url, max: 6 })
  try {
    for (const name of await runSpendReservationRegression(pool)) console.log(`PASS ${name}`)
  } finally {
    await pool.end()
  }
}
