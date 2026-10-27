import { createHash, randomUUID } from "node:crypto"
import type { PgClient, PgPool } from "../orders/postgres-governed-binding-persistence"
import type { DecisionReason } from "./buyer-authority"

/**
 * ADR-SHARED-042 section 14, Decision 5 / CAA-06: the spend reservation
 * commands over the Decision 5 ledger (Migration20261022150000 and
 * Migration20261022180000; Trade ADR-0033).
 *
 * Each command is one PostgreSQL transaction. The ledger trigger is the
 * capacity authority: these commands choose which policies apply, write
 * one ledger entry per policy in budget_policy_id order (so row locks are
 * always taken in the same order) and move the reservation's status. A
 * refusal rolls the whole transaction back, so no ceiling is ever applied
 * partially.
 *
 * Every command carries an idempotency key. A retry with the same request
 * returns the original result (REPLAYED); the same key with a different
 * request is a CONFLICT. Refusals are not recorded, so a retry re-evaluates.
 *
 * These commands move capacity only. Whether the buyer may submit or commit
 * at all is the operation policy (buyer-operation-policy.ts), and executing
 * an order also needs the seller decision and the native commit fence.
 */

export type ReservationStatus = "ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED"
export type SpendRefusal = Extract<
  DecisionReason,
  | "BUYER_NOT_AUTHORISED"
  | "SPEND_POLICY_NOT_CONFIGURED"
  | "SPEND_LIMIT_EXCEEDED"
  | "TRANSACTION_CHANGED"
  | "CONTEXT_NOT_USABLE"
  | "SOURCE_UNAVAILABLE"
>
export type SpendCommandResult =
  | {
      outcome: "APPLIED" | "REPLAYED"
      reservationId: string
      status: ReservationStatus
      /**
       * The reservation's hold revision. A rollover that moves a hold
       * advances it, so an approval or buyer receipt bound to the former
       * hold must be revalidated before commit.
       */
      holdRevision: number
      /** ROLLOVER moved a hold: any approval bound to the former period or policy must be revalidated. */
      approvalRevalidationRequired?: boolean
    }
  | { outcome: "REFUSED"; reason: SpendRefusal; detail?: "ROLLOVER_REQUIRED" }
  | { outcome: "CONFLICT" }

/** A purchase formally submitted for approval or commitment (Decision 5 item 2). */
export type SubmitCommand = {
  idempotencyKey: string
  /**
   * The stable identity of the purchase across its versions (the cart, draft
   * order, RFQ or quotation), from Trade's own record. One ACTIVE
   * reservation exists per purchase, and only a later version of the same
   * purchase may supersede it.
   */
  purchaseReference: string
  tenantId: string
  organisationId: string
  membershipId: string
  actorPrincipalId: string
  marketKey: string
  currencyCode: string
  agreementReference: string | null
  transactionDigest: string
  resourceVersion: number
  amountMinor: bigint
  expiresAt: Date
}
type ReservationCommand = {
  idempotencyKey: string
  organisationId: string
  reservationId: string
  actorPrincipalId: string
}
export type CommitCommand = ReservationCommand & {
  /** The hold revision the approvals and buyer receipt were bound to. */
  holdRevision: number
  transactionDigest: string
  resourceVersion: number
  amountMinor: bigint
  commitmentReference: string
}
export type ReleaseCommand = ReservationCommand & { reason: "REJECTED" | "CANCELLED" }

/** The longest a reservation may be held before governed expiry. */
export const MAX_RESERVATION_HOLD_MS = 30 * 24 * 60 * 60 * 1000

const KEY = /^[A-Za-z0-9._:-]{16,128}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const CURRENCY = /^[A-Z]{3}$/

class Refused extends Error {
  constructor(
    readonly reason: SpendRefusal,
    readonly detail?: "ROLLOVER_REQUIRED",
  ) {
    super(reason)
  }
}
class Conflict extends Error {}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const minor = (value: unknown): bigint => BigInt(String(value))
const requestDigest = (kind: string, request: object) =>
  `sha256:${sha256(
    JSON.stringify({ kind, ...request }, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v,
    ),
  )}`
/** The reservation a submission creates, derived so a retry finds the same one. */
const reservationIdFor = (organisationId: string, key: string) =>
  `b2bres_${sha256(`${organisationId}|${key}`).slice(0, 40)}`
/**
 * The single global lock order for budgets: every command writes its ledger
 * entries by budget_policy_id in code-point order, releases before
 * reservations within one budget, so two commands never lock the same
 * budgets in opposite orders.
 */
const byPolicy = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** One ledger idempotency key per command, policy and step. */
const entryKey = (kind: string, commandKey: string, policyId: string, step: string) =>
  `${kind.toLowerCase()}.${sha256(`${commandKey}|${policyId}|${step}`).slice(0, 48)}`

type PolicyRow = {
  id: string
  revision: number
  scope: "MEMBERSHIP" | "AGREEMENT" | "ORGANISATION"
  period_starts_at: Date
}
type HoldRow = {
  budget_policy_id: string
  policy_revision: number
  period_starts_at: Date
  reserved_minor: bigint
}
type ReservationRow = {
  id: string
  purchase_reference: string
  submitted_by_principal_id: string
  hold_revision: number
  tenant_id: string
  organisation_id: string
  membership_id: string
  market_key: string
  currency_code: string
  agreement_reference: string | null
  transaction_digest: string
  resource_version: number
  amount_minor: bigint
  status: ReservationStatus
  expired: boolean
}

export class PostgresSpendReservationCommands {
  constructor(private readonly pool: PgPool) {}

  /** Reserve the full amount against every applicable budget (formal submission). */
  submit(command: SubmitCommand): Promise<SpendCommandResult> {
    assertSubmit(command)
    return this.run("SUBMIT", command, command.organisationId, (db) => this.reserveNew(db, command))
  }

  /**
   * Replace the ACTIVE reservation of a purchase by a later version of the
   * same purchase, in one transaction. Only the Principal who submitted it
   * may supersede it, and only for the same purchase reference, membership,
   * Market, currency and agreement. Within each budget the old hold is
   * released before the new one is taken, so an increase needs capacity for
   * the difference only and a reduction returns only the unused portion.
   */
  resubmit(command: SubmitCommand & { supersedes: string }): Promise<SpendCommandResult> {
    assertSubmit(command)
    return this.run("RESUBMIT", command, command.organisationId, async (db) => {
      const old = await this.lockReservation(db, command.organisationId, command.supersedes)
      if (old.status !== "ACTIVE") throw new Refused("CONTEXT_NOT_USABLE")
      if (old.submitted_by_principal_id !== command.actorPrincipalId) {
        throw new Refused("BUYER_NOT_AUTHORISED")
      }
      if (
        old.purchase_reference !== command.purchaseReference ||
        old.tenant_id !== command.tenantId ||
        old.membership_id !== command.membershipId ||
        old.market_key !== command.marketKey ||
        old.currency_code !== command.currencyCode ||
        old.agreement_reference !== command.agreementReference ||
        command.resourceVersion <= old.resource_version
      ) {
        throw new Refused("TRANSACTION_CHANGED")
      }
      // The superseded version is cancelled; a smaller new version is a reduction.
      const reason = command.amountMinor < old.amount_minor ? "AMOUNT_REDUCED" : "CANCELLED"
      const oldHolds = await this.holds(db, old.id)
      // Close the old version first: one ACTIVE reservation per purchase.
      await db.query(`update "b2b_spend_reservation" set "status" = 'RELEASED' where "id" = $1`, [
        old.id,
      ])
      const reservation = await this.insertReservation(db, command, old.id)
      const policies = await this.applicablePolicies(db, reservation)
      await this.inPolicyOrder(
        db,
        command,
        "resubmit",
        oldHolds.map((hold) => ({ reservationId: old.id, hold, reason })),
        policies.map((policy) => ({
          reservationId: reservation.id,
          policy,
          amount: command.amountMinor,
        })),
      )
      return { reservationId: reservation.id, status: "ACTIVE" as const, holdRevision: 1 }
    })
  }

  /**
   * Convert the reservation into committed consumption at order commit. The
   * reservation must be ACTIVE, unexpired and bound to exactly this
   * purchase, and every currently applicable budget must hold the full
   * amount in its current period at its current revision; otherwise the
   * reservation must be rolled over or resubmitted first.
   */
  commit(command: CommitCommand): Promise<SpendCommandResult> {
    return this.commitCapacity(command)
  }

  /**
   * Compose a trusted owner's database mutation with the spend conversion.
   * The callback must use only this query interface for database writes; it
   * must not open another connection, finish the transaction or perform an
   * external side effect. The database's native receipt fence remains required.
   * A replay never calls the mutation again. Its digest is distinct from a
   * capacity-only COMMIT, so an old ledger command cannot claim a native write.
   */
  commitWithMutation(
    command: CommitCommand,
    mutation: (db: Pick<PgClient, "query">) => Promise<void>,
  ): Promise<SpendCommandResult> {
    if (typeof mutation !== "function") throw new TypeError("a database mutation is required")
    return this.commitCapacity(command, mutation)
  }

  private commitCapacity(
    command: CommitCommand,
    mutation?: (db: Pick<PgClient, "query">) => Promise<void>,
  ): Promise<SpendCommandResult> {
    assertReservationCommand(command)
    if (
      !DIGEST.test(command.transactionDigest) ||
      command.commitmentReference.length === 0 ||
      !Number.isSafeInteger(command.holdRevision) ||
      command.holdRevision < 1
    ) {
      throw new TypeError("invalid commit command")
    }
    const request = mutation ? { ...command, execution: "ATOMIC_DATABASE_MUTATION" } : command
    return this.run("COMMIT", request, command.organisationId, async (db) => {
      const reservation = await this.lockReservation(
        db,
        command.organisationId,
        command.reservationId,
      )
      if (reservation.status !== "ACTIVE" || reservation.expired) {
        throw new Refused("CONTEXT_NOT_USABLE")
      }
      if (
        reservation.transaction_digest !== command.transactionDigest ||
        reservation.resource_version !== command.resourceVersion ||
        reservation.amount_minor !== command.amountMinor ||
        reservation.hold_revision !== command.holdRevision
      ) {
        throw new Refused("TRANSACTION_CHANGED")
      }
      const policies = await this.applicablePolicies(db, reservation)
      const holds = await this.holds(db, reservation.id)
      // Commit never moves a hold. Every applicable budget must hold the
      // full amount now, and no held budget may be stale, retired or no
      // longer applicable: only an explicit rollover (which advances the
      // hold revision and so forces revalidation) may change that.
      for (const policy of policies) {
        const hold = currentHold(holds, policy)
        if (!hold || hold.reserved_minor !== reservation.amount_minor) {
          throw new Refused("CONTEXT_NOT_USABLE", "ROLLOVER_REQUIRED")
        }
      }
      if (holds.some((h) => h.reserved_minor > 0n && !policies.some((p) => currentHold([h], p)))) {
        throw new Refused("CONTEXT_NOT_USABLE", "ROLLOVER_REQUIRED")
      }
      for (const policy of policies) {
        await db.query(
          `insert into "b2b_spend_ledger_entry" ("id", "entry_kind", "reservation_id", "budget_policy_id",
             "policy_revision", "amount_minor", "raw_amount_minor", "commitment_reference",
             "idempotency_key", "actor_principal_id")
           values ($1, 'COMMIT', $2, $3, $4, $5, '{}', $6, $7, $8)`,
          [
            `b2bled_${randomUUID().replaceAll("-", "")}`,
            reservation.id,
            policy.id,
            policy.revision,
            reservation.amount_minor.toString(),
            command.commitmentReference,
            entryKey("COMMIT", command.idempotencyKey, policy.id, "commit"),
            command.actorPrincipalId,
          ],
        )
      }
      await db.query(`update "b2b_spend_reservation" set "status" = 'COMMITTED' where "id" = $1`, [
        reservation.id,
      ])
      // Bound to the same connected transaction; do not expose release().
      if (mutation) await mutation({ query: db.query.bind(db) })
      return {
        reservationId: reservation.id,
        status: "COMMITTED" as const,
        holdRevision: reservation.hold_revision,
      }
    })
  }

  /** Release every unused hold on rejection or cancellation. */
  release(command: ReleaseCommand): Promise<SpendCommandResult> {
    assertReservationCommand(command)
    if (command.reason !== "REJECTED" && command.reason !== "CANCELLED") {
      throw new TypeError("invalid release reason")
    }
    return this.close(command, "RELEASE", command.reason, "RELEASED", false)
  }

  /** Governed expiry: an expired reservation returns its unused holds and never authorises commitment. */
  expire(command: ReservationCommand): Promise<SpendCommandResult> {
    assertReservationCommand(command)
    return this.close(command, "EXPIRE", "EXPIRED", "EXPIRED", true)
  }

  /**
   * Month rollover and policy revision (Decision 5 item 3): release every
   * hold that is in a past period, on a superseded revision or on a budget
   * that no longer applies, and reacquire the full amount from each
   * currently applicable budget, atomically. A shortfall refuses the whole
   * rollover and the old hold, which cannot authorise commitment, stays.
   */
  rollover(command: ReservationCommand): Promise<SpendCommandResult> {
    assertReservationCommand(command)
    return this.run("ROLLOVER", command, command.organisationId, async (db) => {
      const reservation = await this.lockReservation(
        db,
        command.organisationId,
        command.reservationId,
      )
      if (reservation.status !== "ACTIVE" || reservation.expired) {
        throw new Refused("CONTEXT_NOT_USABLE")
      }
      const policies = await this.applicablePolicies(db, reservation)
      const holds = await this.holds(db, reservation.id)
      const releases = holds.flatMap((hold) => {
        if (hold.reserved_minor === 0n) return []
        const policy = policies.find((p) => p.id === hold.budget_policy_id)
        if (policy && currentHold([hold], policy)) return []
        const pastPeriod = policy !== undefined && hold.policy_revision === policy.revision
        return [
          {
            reservationId: reservation.id,
            hold,
            reason: pastPeriod ? "PERIOD_ROLLOVER" : "POLICY_REVISED",
          },
        ]
      })
      const reserves = policies.flatMap((policy) => {
        const amount = reservation.amount_minor - (currentHold(holds, policy)?.reserved_minor ?? 0n)
        return amount > 0n ? [{ reservationId: reservation.id, policy, amount }] : []
      })
      const moved = releases.length > 0 || reserves.length > 0
      await this.inPolicyOrder(db, command, "rollover", releases, reserves)
      if (moved) {
        await db.query(
          `update "b2b_spend_reservation" set "hold_revision" = "hold_revision" + 1 where "id" = $1`,
          [reservation.id],
        )
      }
      return {
        reservationId: reservation.id,
        status: "ACTIVE" as const,
        holdRevision: reservation.hold_revision + (moved ? 1 : 0),
        approvalRevalidationRequired: moved,
      }
    })
  }

  private async reserveNew(
    db: PgClient,
    command: SubmitCommand,
  ): Promise<{ reservationId: string; status: ReservationStatus; holdRevision: number }> {
    const reservation = await this.insertReservation(db, command, null)
    const policies = await this.applicablePolicies(db, reservation)
    await this.inPolicyOrder(
      db,
      command,
      "submit",
      [],
      policies.map((policy) => ({
        reservationId: reservation.id,
        policy,
        amount: command.amountMinor,
      })),
    )
    return { reservationId: reservation.id, status: "ACTIVE", holdRevision: 1 }
  }

  /** A new ACTIVE reservation for an ACTIVE, in-effect member of this Organisation. */
  private async insertReservation(
    db: PgClient,
    command: SubmitCommand,
    supersedes: string | null,
  ): Promise<ReservationRow> {
    const member = await db.query(
      `select 1 from "b2b_buyer_membership" m join "b2b_organisation" o on o."id" = m."organisation_id"
        where m."id" = $1 and m."organisation_id" = $2 and o."tenant_id" = $3
          and m."status" = 'ACTIVE' and m."deleted_at" is null
          and (m."effective_from" is null or m."effective_from" <= now())
          and (m."effective_until" is null or now() < m."effective_until")`,
      [command.membershipId, command.organisationId, command.tenantId],
    )
    if (member.rowCount !== 1) throw new Refused("BUYER_NOT_AUTHORISED")
    const reservationId = reservationIdFor(command.organisationId, command.idempotencyKey)
    try {
      await db.query(
        `insert into "b2b_spend_reservation" ("id", "tenant_id", "organisation_id", "membership_id",
           "submitted_by_principal_id", "market_key", "currency_code", "agreement_reference",
           "transaction_digest", "resource_version", "amount_minor", "expires_at",
           "purchase_reference", "supersedes_reservation_id")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          reservationId,
          command.tenantId,
          command.organisationId,
          command.membershipId,
          command.actorPrincipalId,
          command.marketKey,
          command.currencyCode,
          command.agreementReference,
          command.transactionDigest,
          command.resourceVersion,
          command.amountMinor.toString(),
          command.expiresAt,
          command.purchaseReference,
          supersedes,
        ],
      )
    } catch (error) {
      // The purchase already holds an ACTIVE reservation under another key.
      if (pgCode(error) === "23505") throw new Conflict()
      throw error
    }
    return this.lockReservation(db, command.organisationId, reservationId)
  }

  /**
   * Write releases and reservations in the single global budget order
   * (byPolicy), releases first within a budget.
   */
  private async inPolicyOrder(
    db: PgClient,
    command: ReservationCommand | SubmitCommand,
    step: string,
    releases: Array<{ reservationId: string; hold: HoldRow; reason: string }>,
    reserves: Array<{ reservationId: string; policy: PolicyRow; amount: bigint }>,
  ) {
    const ids = [
      ...new Set([
        ...releases.map((r) => r.hold.budget_policy_id),
        ...reserves.map((r) => r.policy.id),
      ]),
    ].sort(byPolicy)
    for (const id of ids) {
      for (const r of releases.filter((x) => x.hold.budget_policy_id === id)) {
        await this.releaseHold(db, r.reservationId, r.hold, command, r.reason)
      }
      for (const r of reserves.filter((x) => x.policy.id === id)) {
        await this.reserveEntry(db, r.reservationId, r.policy, r.amount, command, step)
      }
    }
  }

  private async reserveEntry(
    db: PgClient,
    reservationId: string,
    policy: PolicyRow,
    amount: bigint,
    command: ReservationCommand | SubmitCommand,
    step: string,
  ) {
    await db.query(
      `insert into "b2b_spend_ledger_entry" ("id", "entry_kind", "reservation_id", "budget_policy_id",
         "policy_revision", "amount_minor", "raw_amount_minor", "idempotency_key", "actor_principal_id")
       values ($1, 'RESERVE', $2, $3, $4, $5, '{}', $6, $7)`,
      [
        `b2bled_${randomUUID().replaceAll("-", "")}`,
        reservationId,
        policy.id,
        policy.revision,
        amount.toString(),
        entryKey("RESERVE", command.idempotencyKey, policy.id, step),
        command.actorPrincipalId,
      ],
    )
  }

  private async releaseHold(
    db: PgClient,
    reservationId: string,
    hold: HoldRow,
    command: ReservationCommand | SubmitCommand,
    reason: string,
  ) {
    if (hold.reserved_minor === 0n) return
    await db.query(
      `insert into "b2b_spend_ledger_entry" ("id", "entry_kind", "reservation_id", "budget_policy_id",
         "policy_revision", "period_starts_at", "amount_minor", "raw_amount_minor", "release_reason",
         "idempotency_key", "actor_principal_id")
       values ($1, 'RELEASE', $2, $3, $4, $5, $6, '{}', $7, $8, $9)`,
      [
        `b2bled_${randomUUID().replaceAll("-", "")}`,
        reservationId,
        hold.budget_policy_id,
        hold.policy_revision,
        hold.period_starts_at,
        hold.reserved_minor.toString(),
        reason,
        entryKey(
          "RELEASE",
          command.idempotencyKey,
          hold.budget_policy_id,
          `${reservationId}|${hold.period_starts_at.toISOString()}`,
        ),
        command.actorPrincipalId,
      ],
    )
  }

  private close(
    command: ReservationCommand,
    kind: "RELEASE" | "EXPIRE",
    reason: string,
    status: "RELEASED" | "EXPIRED",
    mustBeExpired: boolean,
  ): Promise<SpendCommandResult> {
    return this.run(kind, command, command.organisationId, async (db) => {
      const reservation = await this.lockReservation(
        db,
        command.organisationId,
        command.reservationId,
      )
      if (reservation.status !== "ACTIVE") throw new Refused("CONTEXT_NOT_USABLE")
      if (mustBeExpired && !reservation.expired) throw new Refused("CONTEXT_NOT_USABLE")
      const holds = await this.holds(db, reservation.id)
      await this.inPolicyOrder(
        db,
        command,
        "release",
        holds.map((hold) => ({ reservationId: reservation.id, hold, reason })),
        [],
      )
      await db.query(`update "b2b_spend_reservation" set "status" = $2 where "id" = $1`, [
        reservation.id,
        status,
      ])
      return { reservationId: reservation.id, status, holdRevision: reservation.hold_revision }
    })
  }

  /** Lock a reservation of this Organisation; a foreign or unknown one is never disclosed. */
  private async lockReservation(
    db: PgClient,
    organisationId: string,
    reservationId: string,
  ): Promise<ReservationRow> {
    const { rows } = await db.query(
      `select "id", "purchase_reference", "submitted_by_principal_id", "hold_revision",
              "tenant_id", "organisation_id", "membership_id", "market_key", "currency_code",
              "agreement_reference", "transaction_digest", "resource_version", "amount_minor", "status",
              (now() >= "expires_at") as "expired"
         from "b2b_spend_reservation"
        where "id" = $1 and "organisation_id" = $2 and "deleted_at" is null
        for update`,
      [reservationId, organisationId],
    )
    const [row] = rows
    if (!row || row.amount_minor === null || row.purchase_reference === null) {
      throw new Refused("BUYER_NOT_AUTHORISED")
    }
    return {
      ...(row as Omit<ReservationRow, "amount_minor" | "resource_version" | "hold_revision">),
      resource_version: Number(row.resource_version),
      hold_revision: Number(row.hold_revision),
      amount_minor: minor(row.amount_minor),
    }
  }

  /**
   * The budgets that apply now, in budget_policy_id order, each with its
   * current period start in its own time zone. Exactly one MEMBERSHIP
   * budget is mandatory; AGREEMENT and ORGANISATION budgets bind when
   * configured.
   */
  private async applicablePolicies(db: PgClient, r: ReservationRow): Promise<PolicyRow[]> {
    const { rows } = await db.query(
      `select "id", "revision", "scope",
              case when "period_kind" = 'CALENDAR_MONTH'
                   then date_trunc('month', now() at time zone "timezone") at time zone "timezone"
                   else "effective_from" end as "period_starts_at"
         from "b2b_spend_budget_policy"
        where "tenant_id" = $1 and "organisation_id" = $2 and "market_key" = $3 and "currency_code" = $4
          and "status" = 'ACTIVE' and "deleted_at" is null
          and "effective_from" <= now() and ("effective_until" is null or now() < "effective_until")
          and (("scope" = 'MEMBERSHIP' and "membership_id" = $5)
               or "scope" = 'ORGANISATION'
               or ("scope" = 'AGREEMENT' and "agreement_reference" = $6))
        order by "id" collate "C"
        for share`,
      [
        r.tenant_id,
        r.organisation_id,
        r.market_key,
        r.currency_code,
        r.membership_id,
        r.agreement_reference,
      ],
    )
    const policies = rows
      .map((row) => ({
        id: String(row.id),
        revision: Number(row.revision),
        scope: row.scope as PolicyRow["scope"],
        period_starts_at: new Date(row.period_starts_at as string | Date),
      }))
      .sort((a, b) => byPolicy(a.id, b.id))
    const members = policies.filter((p) => p.scope === "MEMBERSHIP").length
    if (members === 0) throw new Refused("SPEND_POLICY_NOT_CONFIGURED")
    if (
      members > 1 ||
      policies.filter((p) => p.scope === "ORGANISATION").length > 1 ||
      policies.filter((p) => p.scope === "AGREEMENT").length > 1
    ) {
      throw new Refused("CONTEXT_NOT_USABLE")
    }
    return policies
  }

  private async holds(db: PgClient, reservationId: string): Promise<HoldRow[]> {
    const { rows } = await db.query(
      `select "budget_policy_id", "policy_revision", "period_starts_at", "reserved_minor"
         from "b2b_spend_reservation_hold" where "reservation_id" = $1
        order by "budget_policy_id" collate "C", "period_starts_at"`,
      [reservationId],
    )
    return rows.map((row) => ({
      budget_policy_id: String(row.budget_policy_id),
      policy_revision: Number(row.policy_revision),
      period_starts_at: new Date(row.period_starts_at as string | Date),
      reserved_minor: minor(row.reserved_minor),
    }))
  }

  /**
   * One transaction per command, serialized per idempotency key. The
   * command record is written last, so a refusal leaves nothing behind.
   */
  private async run(
    kind: string,
    request: object,
    organisationId: string,
    execute: (db: PgClient) => Promise<{
      reservationId: string
      status: ReservationStatus
      holdRevision: number
      approvalRevalidationRequired?: boolean
    }>,
  ): Promise<SpendCommandResult> {
    const key = (request as { idempotencyKey: string }).idempotencyKey
    const actor = (request as { actorPrincipalId: string }).actorPrincipalId
    const digest = requestDigest(kind, request)
    let db: PgClient
    try {
      db = await this.pool.connect()
    } catch {
      return { outcome: "REFUSED", reason: "SOURCE_UNAVAILABLE" }
    }
    try {
      await db.query("BEGIN")
      await db.query("SET LOCAL lock_timeout = '3s'")
      await db.query("SET LOCAL statement_timeout = '5s'")
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `spend-command/${key}`,
      ])
      const prior = await db.query(
        `select "command_kind", "organisation_id", "request_digest", "result"
           from "b2b_spend_command" where "idempotency_key" = $1`,
        [key],
      )
      if (prior.rows[0]) {
        await db.query("ROLLBACK")
        const row = prior.rows[0]
        if (
          row.command_kind !== kind ||
          row.organisation_id !== organisationId ||
          row.request_digest !== digest
        ) {
          return { outcome: "CONFLICT" }
        }
        return { ...(row.result as object), outcome: "REPLAYED" } as SpendCommandResult
      }
      const result = await execute(db)
      await db.query(
        `insert into "b2b_spend_command" ("id", "idempotency_key", "command_kind", "organisation_id",
           "request_digest", "reservation_id", "result", "actor_principal_id")
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `b2bcmd_${randomUUID().replaceAll("-", "")}`,
          key,
          kind,
          organisationId,
          digest,
          result.reservationId,
          JSON.stringify(result),
          actor,
        ],
      )
      await db.query("COMMIT")
      return { outcome: "APPLIED", ...result }
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined)
      if (error instanceof Refused) {
        return error.detail
          ? { outcome: "REFUSED", reason: error.reason, detail: error.detail }
          : { outcome: "REFUSED", reason: error.reason }
      }
      if (error instanceof Conflict) return { outcome: "CONFLICT" }
      return { outcome: "REFUSED", reason: refusalFor(error) }
    } finally {
      db.release()
    }
  }
}

/** The ledger trigger's refusals, as closed reasons; anything else is UNAVAILABLE, never success. */
export function refusalFor(error: unknown): SpendRefusal {
  const message = error instanceof Error ? error.message : ""
  if (/insufficient budget capacity/.test(message)) return "SPEND_LIMIT_EXCEEDED"
  if (
    /not in effect at this revision|budget changed|not active|expired or closed|outside this budget|outside the budget period|terminal|immutable purchase/.test(
      message,
    )
  ) {
    return "CONTEXT_NOT_USABLE"
  }
  return "SOURCE_UNAVAILABLE"
}

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code

const currentHold = (holds: HoldRow[], policy: PolicyRow) =>
  holds.find(
    (h) =>
      h.budget_policy_id === policy.id &&
      h.policy_revision === policy.revision &&
      h.period_starts_at.getTime() === policy.period_starts_at.getTime(),
  )

function assertReservationCommand(command: ReservationCommand) {
  if (
    !KEY.test(command.idempotencyKey) ||
    !command.organisationId ||
    !/^b2bres_[0-9A-Za-z]{6,64}$/.test(command.reservationId) ||
    !command.actorPrincipalId
  ) {
    throw new TypeError("invalid spend reservation command")
  }
}

function assertSubmit(command: SubmitCommand) {
  const hold = command.expiresAt.getTime() - Date.now()
  if (
    !KEY.test(command.idempotencyKey) ||
    !(command.purchaseReference.trim().length > 0 && command.purchaseReference.length <= 200) ||
    !command.tenantId ||
    !command.organisationId ||
    !command.membershipId ||
    !command.actorPrincipalId ||
    !command.marketKey ||
    !CURRENCY.test(command.currencyCode) ||
    !DIGEST.test(command.transactionDigest) ||
    !Number.isSafeInteger(command.resourceVersion) ||
    command.resourceVersion < 1 ||
    command.amountMinor <= 0n ||
    !(hold > 0 && hold <= MAX_RESERVATION_HOLD_MS)
  ) {
    throw new TypeError("invalid spend submission")
  }
}
