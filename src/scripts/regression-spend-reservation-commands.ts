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
import type { PgClient, PgPool } from "../baobab/orders/postgres-governed-binding-persistence"
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
  const policy = async (row: {
    id: string
    org: string
    scope: "MEMBERSHIP" | "ORGANISATION" | "AGREEMENT"
    member?: string | null
    agreement?: string | null
    limit: bigint
  }) => {
    const agreement = row.scope === "AGREEMENT"
    await sql(
      `insert into "b2b_spend_budget_policy" ("id", "scope", "tenant_id", "organisation_id", "membership_id",
         "agreement_reference", "market_key", "currency_code", "period_kind", "timezone", "limit_minor",
         "raw_limit_minor", "effective_from", "effective_until", "evidence_reference")
       values ($1, $2, $3, $4, $5, $6, 'ZA', 'ZAR', $7, 'UTC', $8, '{}', now() - interval '1 day',
               $9, 'synthetic/regression')`,
      [
        row.id,
        row.scope,
        tenant,
        row.org,
        row.member ?? null,
        row.agreement ?? null,
        agreement ? "AGREEMENT_TERM" : "CALENDAR_MONTH",
        row.limit.toString(),
        agreement ? new Date(Date.now() + 365 * 86_400_000) : null,
      ],
    )
    return row.id
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
    purchaseReference: `cart_${run}_${seed}`,
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
    holdRevision: 1,
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
  assert.deepEqual(await commands.commit(commitOf(org, heldRes.reservationId, held)), {
    outcome: "REFUSED",
    reason: "TRANSACTION_CHANGED",
  })
  applied(await commands.commit(commitOf(org, heldRes.reservationId, held, { holdRevision: 2 })))
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

  // Review finding: retiring a budget that held the purchase never lets it commit unseen.
  const retiring = await organisation("d")
  const erin = await membership(retiring, "erin")
  const erinBudget = await budget(retiring, "MEMBERSHIP", erin, 5_000_000n, "erin")
  const retiringOrg = await budget(retiring, "ORGANISATION", null, 5_000_000n, "dorg")
  const underBoth = submission(retiring, erin, 300_000n, "10")
  const underBothRes = applied(await commands.submit(underBoth))
  assert.deepEqual(await balance(retiringOrg), [0n, 300_000n])
  await sql(`update "b2b_spend_budget_policy" set "status" = 'RETIRED' where "id" = $1`, [
    retiringOrg,
  ])
  assert.deepEqual(
    await commands.commit(commitOf(retiring, underBothRes.reservationId, underBoth)),
    { outcome: "REFUSED", reason: "CONTEXT_NOT_USABLE", detail: "ROLLOVER_REQUIRED" },
  )
  assert.deepEqual(await balance(retiringOrg), [0n, 300_000n])
  const afterRetire = applied(
    await commands.rollover({
      idempotencyKey: key("retire-rollover"),
      organisationId: retiring,
      reservationId: underBothRes.reservationId,
      actorPrincipalId: actor,
    }),
  )
  assert.equal(afterRetire.holdRevision, 2)
  assert.equal(afterRetire.approvalRevalidationRequired, true)
  assert.deepEqual(await balance(retiringOrg), [0n, 0n])
  assert.deepEqual(
    await commands.commit(commitOf(retiring, underBothRes.reservationId, underBoth)),
    { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" },
  )
  applied(
    await commands.commit(
      commitOf(retiring, underBothRes.reservationId, underBoth, { holdRevision: 2 }),
    ),
  )
  assert.deepEqual(await balance(erinBudget), [300_000n, 0n])
  pass("a retired budget forces rollover and a new hold revision before commit")

  // Review finding: only a later version of the same purchase, by its submitter, may supersede it.
  const purchaseOne = submission(retiring, erin, 100_000n, "11")
  const purchaseOneRes = applied(await commands.submit(purchaseOne))
  assert.deepEqual(
    await commands.resubmit({
      ...submission(retiring, erin, 50_000n, "12", { resourceVersion: 2 }),
      supersedes: purchaseOneRes.reservationId,
    }),
    { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" },
  )
  assert.deepEqual(
    await commands.resubmit({
      ...submission(retiring, erin, 50_000n, "11", {
        resourceVersion: 2,
        actorPrincipalId: randomUUID(),
      }),
      supersedes: purchaseOneRes.reservationId,
    }),
    { outcome: "REFUSED", reason: "BUYER_NOT_AUTHORISED" },
  )
  assert.deepEqual(
    await commands.resubmit({
      ...submission(retiring, erin, 50_000n, "11"),
      supersedes: purchaseOneRes.reservationId,
    }),
    { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" },
  )
  assert.deepEqual(await balance(erinBudget), [300_000n, 100_000n])
  const { rows: stillActive } = await sql(
    `select "status" from "b2b_spend_reservation" where "id" = $1`,
    [purchaseOneRes.reservationId],
  )
  assert.equal(stillActive[0].status, "ACTIVE")
  const reduced = applied(
    await commands.resubmit({
      ...submission(retiring, erin, 60_000n, "11", { resourceVersion: 2 }),
      supersedes: purchaseOneRes.reservationId,
    }),
  )
  const { rows: lineage } = await sql(
    `select "supersedes_reservation_id", "purchase_reference" from "b2b_spend_reservation" where "id" = $1`,
    [reduced.reservationId],
  )
  assert.deepEqual(lineage[0], {
    supersedes_reservation_id: purchaseOneRes.reservationId,
    purchase_reference: purchaseOne.purchaseReference,
  })
  assert.deepEqual(await balance(erinBudget), [300_000n, 60_000n])
  pass("another purchase or another Principal can never supersede a reservation")

  // Review finding: one global budget lock order. A rollover that releases a
  // stale high-ID budget and reserves a new low-ID one runs against
  // submissions that take both: none may deadlock or fail.
  const locking = await organisation("e")
  const agreementRef = `AGR-${run}`
  const owner = await membership(locking, "owner")
  await policy({
    id: `b2bbud_${run}m0owner`,
    org: locking,
    scope: "MEMBERSHIP",
    member: owner,
    limit: 50_000_000n,
  })
  const high = await policy({
    id: `b2bbud_${run}zorg`,
    org: locking,
    scope: "ORGANISATION",
    limit: 500_000_000n,
  })
  const rolling = submission(locking, owner, 100_000n, "13", { agreementReference: agreementRef })
  const rollingRes = applied(await commands.submit(rolling))
  const low = await policy({
    id: `b2bbud_${run}0agr`,
    org: locking,
    scope: "AGREEMENT",
    agreement: agreementRef,
    limit: 500_000_000n,
  })
  const buyers = await Promise.all(
    ["f", "g", "h", "i"].map(async (suffix) => {
      const id = await membership(locking, suffix)
      await policy({
        id: `b2bbud_${run}m1${suffix}`,
        org: locking,
        scope: "MEMBERSHIP",
        member: id,
        limit: 50_000_000n,
      })
      return id
    }),
  )
  let revision = 1
  for (let round = 0; round < 3; round += 1) {
    await sql(
      `update "b2b_spend_budget_policy" set "limit_minor" = "limit_minor" + 1, "raw_limit_minor" = '{}' where "id" = $1`,
      [high],
    )
    const [rolled, ...submitted] = await Promise.all([
      commands.rollover({
        idempotencyKey: key(`order-rollover-${round}`),
        organisationId: locking,
        reservationId: rollingRes.reservationId,
        actorPrincipalId: actor,
      }),
      ...buyers.map((buyer, i) =>
        commands.submit(
          submission(locking, buyer, 1_000n, `lock${round}${i}`, {
            agreementReference: agreementRef,
          }),
        ),
      ),
    ])
    revision += 1
    assert.ok(
      rolled.outcome === "APPLIED" && rolled.holdRevision === revision,
      JSON.stringify(rolled),
    )
    for (const result of submitted) assert.equal(result.outcome, "APPLIED", JSON.stringify(result))
  }
  assert.deepEqual(await balance(low), [0n, 100_000n + 12n * 1_000n])
  assert.deepEqual(await balance(high), [0n, 100_000n + 12n * 1_000n])
  pass("rollover and concurrent submissions take budget locks in one order")

  // A budget revision racing a commit: the commit either applies or asks for rollover, never fails.
  const racing = submission(locking, owner, 2_000n, "14", { agreementReference: agreementRef })
  const racingRes = applied(await commands.submit(racing))
  const [raced] = await Promise.all([
    commands.commit(commitOf(locking, racingRes.reservationId, racing)),
    sql(
      `update "b2b_spend_budget_policy" set "limit_minor" = "limit_minor" + 1, "raw_limit_minor" = '{}' where "id" = $1`,
      [high],
    ),
  ])
  assert.ok(
    raced.outcome === "APPLIED" ||
      (raced.outcome === "REFUSED" && raced.detail === "ROLLOVER_REQUIRED"),
    JSON.stringify(raced),
  )
  pass("a budget revision racing a commit never fails open or closed by error")

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

  // Same-connection composition, against real PG17. This isolated probe is
  // deliberately not a native order or a buyer/seller authority receipt.
  await sql(`create table if not exists dev07_atomic_spend_probe (
    id text primary key, transaction_id text not null,
    unique_value text unique deferrable initially deferred)`)
  const atomicOrg = await organisation("atomic")
  const atomicMember = await membership(atomicOrg, "atomic")
  const atomicBudget = await budget(atomicOrg, "MEMBERSHIP", atomicMember, 100_000n, "atomic")
  const atomicSubmission = submission(atomicOrg, atomicMember, 10_000n, "atomic")
  const atomicReservation = applied(await commands.submit(atomicSubmission))
  const atomicCommand = commitOf(atomicOrg, atomicReservation.reservationId, atomicSubmission)
  const count = async (text: string, values: unknown[]) => (await sql(text, values)).rowCount
  let attempts = 0
  const write = async (db: Pick<PgClient, "query">) => {
    attempts += 1
    await db.query(
      `insert into dev07_atomic_spend_probe (id,transaction_id,unique_value)
       values ($1,pg_current_xact_id()::text,$1)`,
      [atomicCommand.commitmentReference],
    )
  }
  // An application refusal after a write must undo both the mutation and ledger.
  assert.deepEqual(
    await commands.commitWithMutation(atomicCommand, async (db) => {
      await write(db)
      throw new Error("synthetic mutation refusal")
    }),
    { outcome: "REFUSED", reason: "SOURCE_UNAVAILABLE" },
  )
  assert.deepEqual(await balance(atomicBudget), [0n, 10_000n])
  assert.equal(
    await count("select 1 from dev07_atomic_spend_probe where id=$1", [
      atomicCommand.commitmentReference,
    ]),
    0,
  )
  assert.equal(
    await count('select 1 from "b2b_spend_command" where "idempotency_key"=$1', [
      atomicCommand.idempotencyKey,
    ]),
    0,
  )
  // A deferred constraint can reject COMMIT after the callback returned. It
  // must also undo the mutation, spend entries, status and idempotency result.
  assert.deepEqual(
    await commands.commitWithMutation(atomicCommand, async (db) => {
      await write(db)
      await db.query(
        `insert into dev07_atomic_spend_probe (id,transaction_id,unique_value)
         values ($1,pg_current_xact_id()::text,$2)`,
        [atomicCommand.commitmentReference + "-duplicate", atomicCommand.commitmentReference],
      )
    }),
    { outcome: "REFUSED", reason: "SOURCE_UNAVAILABLE" },
  )
  assert.deepEqual(await balance(atomicBudget), [0n, 10_000n])
  assert.equal(
    await count("select 1 from dev07_atomic_spend_probe where unique_value=$1", [
      atomicCommand.commitmentReference,
    ]),
    0,
  )
  const afterRollback = await sql('select "status" from "b2b_spend_reservation" where "id"=$1', [
    atomicReservation.reservationId,
  ])
  assert.equal(afterRollback.rows[0].status, "ACTIVE")
  assert.equal(
    await count(
      `select 1 from "b2b_spend_ledger_entry" where "reservation_id"=$1 and "entry_kind"='COMMIT'`,
      [atomicReservation.reservationId],
    ),
    0,
  )
  const composed = await Promise.all([
    commands.commitWithMutation(atomicCommand, write),
    commands.commitWithMutation(atomicCommand, write),
  ])
  assert.deepEqual(composed.map((result) => result.outcome).sort(), ["APPLIED", "REPLAYED"])
  assert.deepEqual(await balance(atomicBudget), [10_000n, 0n])
  const sameTransaction = await sql(
    `select p.transaction_id, p.xmin::text as mutation_xid, r.xmin::text as reservation_xid,
       c.xmin::text as command_xid, l.xmin::text as ledger_xid
     from dev07_atomic_spend_probe p
     join "b2b_spend_reservation" r on r.id=$2
     join "b2b_spend_command" c on c.idempotency_key=$3
     join "b2b_spend_ledger_entry" l on l.reservation_id=r.id and l.entry_kind='COMMIT'
     where p.id=$1`,
    [
      atomicCommand.commitmentReference,
      atomicReservation.reservationId,
      atomicCommand.idempotencyKey,
    ],
  )
  assert.equal(sameTransaction.rowCount, 1)
  const tx = sameTransaction.rows[0]
  assert.ok(
    [tx.mutation_xid, tx.reservation_xid, tx.command_xid, tx.ledger_xid].every(
      (xid) => xid === tx.transaction_id,
    ),
  )
  assert.equal((await commands.commitWithMutation(atomicCommand, write)).outcome, "REPLAYED")
  assert.equal(attempts, 3)
  // The capacity-only API and the composed API cannot replay each other.
  assert.deepEqual(await commands.commit(atomicCommand), { outcome: "CONFLICT" })
  pass("same-transaction mutation and spend; callback/deferred refusal rolls back; replay writes once")

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
