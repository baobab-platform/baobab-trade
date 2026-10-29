import type { PgClient, PgPool } from "../orders/postgres-governed-binding-persistence"
import {
  commercialContext,
  commercialDigest,
  createRfq,
  issueQuotation,
  refuseCommercial,
  sameCommercialScope,
  transitionQuotation,
  transitionRfq,
  type CommercialContext,
  type CommercialResource,
  type Quotation,
  type Rfq,
} from "./commercial-lifecycle"

export type CommercialAction =
  | "RFQ_READ"
  | "QUOTATION_READ"
  | "RFQ_CREATE"
  | "RFQ_SUBMIT"
  | "RFQ_REVIEW"
  | "RFQ_DECLINE"
  | "RFQ_WITHDRAW"
  | "RFQ_EXPIRE"
  | "RFQ_CLOSE"
  | "QUOTATION_ISSUE"
  | "QUOTATION_REJECT"
  | "QUOTATION_WITHDRAW"
  | "QUOTATION_EXPIRE"
export type CommercialAuthorization = {
  action: CommercialAction
  context: CommercialContext
  decisionId: string
  evidenceReference: string
  evaluatedAt: Date
  expiresAt: Date
  relationshipRevision: number
  canonicalOrganisationId: string
  /** Seller/reconciliation authority is independently resolved, never a buyer role. */
  actor: { kind: "BUYER"; membershipId: string; revision: number } | { kind: "SELLER" | "SYSTEM" }
}
/** Trusted owner port; request data can never supply an ALLOW or an authority object.
 * Its implementation must join current IAM/CP/operation policy and independent
 * seller/capability authority for the action. There is deliberately no default.
 */
export interface CommercialAuthorityPort {
  authorize(
    action: CommercialAction,
    scope: CommercialContext,
    resource: CommercialResource | null,
  ): Promise<CommercialAuthorization>
}
type Command = {
  action: CommercialAction
  scope: CommercialContext
  idempotencyKey: string
  resourceId?: string
  expectedVersion?: number
  payload?: unknown
}
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BUYER_ACTIONS = new Set<CommercialAction>([
  "RFQ_READ",
  "QUOTATION_READ",
  "RFQ_CREATE",
  "RFQ_SUBMIT",
  "RFQ_WITHDRAW",
  "QUOTATION_REJECT",
])
const SYSTEM_ACTIONS = new Set<CommercialAction>(["RFQ_EXPIRE", "QUOTATION_EXPIRE"])
const COMMANDS = new Set<CommercialAction>([
  "RFQ_CREATE",
  "RFQ_SUBMIT",
  "RFQ_REVIEW",
  "RFQ_DECLINE",
  "RFQ_WITHDRAW",
  "RFQ_EXPIRE",
  "RFQ_CLOSE",
  "QUOTATION_ISSUE",
  "QUOTATION_REJECT",
  "QUOTATION_WITHDRAW",
  "QUOTATION_EXPIRE",
])
const scopeValues = (s: CommercialContext) => [
  s.tenant_id,
  s.buyer_organisation_id,
  s.digital_estate_id,
  s.market_id,
  s.legal_entity_id,
]
const SCOPED =
  "tenant_id=$1 AND buyer_organisation_id=$2 AND digital_estate_id=$3 AND market_id=$4 AND legal_entity_id=$5"

/** Native transaction custody, optimistic versions, exact idempotency and an
 * append-only history. No network effects or independent transaction callback is
 * exposed; quote acceptance stays outside this non-binding command catalogue.
 */
export class PostgresCommercialLifecycle {
  constructor(
    private readonly pool: PgPool,
    private readonly authorities: CommercialAuthorityPort,
  ) {}

  /** Bounded collections and single-resource reads always use all five scope
   * keys before access. A sibling member needs their own fresh authority.
   */
  async read(
    scope: CommercialContext,
    kind: "RFQ" | "QUOTATION",
    resourceId?: string,
  ): Promise<CommercialResource[]> {
    commercialContext(scope)
    if (kind !== "RFQ" && kind !== "QUOTATION") return refuseCommercial("INVALID_REQUEST")
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      await db.query("SET LOCAL lock_timeout='3s'")
      await db.query("SET LOCAL statement_timeout='5s'")
      const action = kind === "RFQ" ? "RFQ_READ" : "QUOTATION_READ"
      const auth = await this.authorities.authorize(action, scope, null)
      await this.authorized(db, action, scope, auth)
      const rows = await db.query(
        `SELECT document FROM trade_commercial_resource WHERE ${SCOPED} AND kind=$6 AND ($7::text IS NULL OR resource_id=$7) ORDER BY resource_id LIMIT 100`,
        [...scopeValues(scope), kind, resourceId ?? null],
      )
      if (resourceId && !rows.rows.length) return refuseCommercial("NOT_FOUND")
      await this.authorized(db, action, scope, auth)
      await db.query("COMMIT")
      return rows.rows.map((row) => row.document as CommercialResource)
    } catch (error) {
      try {
        await db.query("ROLLBACK")
      } catch {
        /* Preserve the original refusal. */
      }
      throw error
    } finally {
      db.release()
    }
  }

  async execute(
    command: Command,
  ): Promise<{ outcome: "APPLIED" | "REPLAYED"; resource: CommercialResource }> {
    const scope = commercialContext(command.scope)
    if (
      !COMMANDS.has(command.action) ||
      !KEY.test(command.idempotencyKey) ||
      (command.action !== "RFQ_CREATE" &&
        (!command.resourceId ||
          !Number.isSafeInteger(command.expectedVersion) ||
          (command.expectedVersion ?? 0) < 1))
    )
      return refuseCommercial("INVALID_REQUEST")
    const scopeDigest = commercialDigest(scope)
    // An explicit normalized envelope avoids absent/undefined JSON ambiguities.
    const digest = commercialDigest({
      action: command.action,
      scope,
      resourceId: command.resourceId ?? null,
      expectedVersion: command.expectedVersion ?? null,
      payload: command.payload ?? null,
    })
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      await db.query("SET LOCAL lock_timeout='3s'")
      await db.query("SET LOCAL statement_timeout='5s'")
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "commercial/" + scopeDigest + "/" + command.idempotencyKey,
      ])
      const previous = await db.query(
        "SELECT request_digest,response FROM trade_commercial_command WHERE scope_digest=$1 AND idempotency_key=$2",
        [scopeDigest, command.idempotencyKey],
      )
      if (previous.rows.length && previous.rows[0].request_digest !== digest)
        return refuseCommercial("CONFLICT")
      // Parent first, then quotation, throughout all command paths. Even a
      // replay repeats current authorization; retained receipts are not grants.
      const resource = command.resourceId ? await this.lock(db, scope, command.resourceId) : null
      const auth = await this.authorities.authorize(command.action, scope, resource)
      await this.authorized(db, command.action, scope, auth)
      if (previous.rows.length) {
        await this.authorized(db, command.action, scope, auth)
        await db.query("COMMIT")
        return { outcome: "REPLAYED", resource: previous.rows[0].response as CommercialResource }
      }
      const now = (await db.query("SELECT clock_timestamp() AS now")).rows[0].now as Date
      let result: CommercialResource
      if (command.action === "RFQ_CREATE") {
        result = await this.insert(
          db,
          createRfq(command.payload, scope, new Date(now)),
          "RFQ",
          null,
        )
      } else {
        if (!resource || resource.version !== command.expectedVersion)
          return refuseCommercial("CONFLICT")
        if (command.action === "QUOTATION_ISSUE") {
          if (!("rfq_id" in resource) || "quotation_id" in resource)
            return refuseCommercial("CONFLICT")
          const quote = issueQuotation(command.payload, resource, new Date(now))
          result = await this.insert(db, quote, "QUOTATION", resource.rfq_id)
          await this.update(db, transitionRfq(resource, "QUOTED", resource.version, new Date(now)))
        } else if (command.action.startsWith("RFQ_")) {
          if ("quotation_id" in resource) return refuseCommercial("CONFLICT")
          const target = {
            RFQ_SUBMIT: "SUBMITTED",
            RFQ_REVIEW: "UNDER_REVIEW",
            RFQ_DECLINE: "DECLINED",
            RFQ_WITHDRAW: "WITHDRAWN",
            RFQ_EXPIRE: "EXPIRED",
            RFQ_CLOSE: "CLOSED",
          } as const
          const next = target[command.action as keyof typeof target]
          if (!next) return refuseCommercial("INVALID_REQUEST")
          if (next === "WITHDRAWN" || next === "EXPIRED") {
            const children = await db.query(
              "SELECT document FROM trade_commercial_resource WHERE parent_id=$1 AND kind='QUOTATION' AND status='ISSUED' ORDER BY resource_id FOR UPDATE",
              [resource.rfq_id],
            )
            for (const child of children.rows) {
              const quote = child.document as Quotation
              await this.update(
                db,
                transitionQuotation(
                  quote,
                  new Date(now).getTime() >= Date.parse(quote.valid_until)
                    ? "EXPIRED"
                    : "WITHDRAWN",
                  quote.version,
                  new Date(now),
                ),
              )
            }
          }
          result = await this.update(
            db,
            transitionRfq(resource, next, resource.version, new Date(now)),
          )
        } else {
          if (!("quotation_id" in resource)) return refuseCommercial("CONFLICT")
          const next = {
            QUOTATION_REJECT: "REJECTED",
            QUOTATION_WITHDRAW: "WITHDRAWN",
            QUOTATION_EXPIRE: "EXPIRED",
          } as const
          const status = next[command.action as keyof typeof next]
          if (!status) return refuseCommercial("INVALID_REQUEST")
          result = await this.update(
            db,
            transitionQuotation(resource, status, resource.version, new Date(now)),
          )
        }
      }
      // Recheck after all SQL and locks; transaction-start time cannot extend
      // evidence lifetime. Native membership/relationship locks remain held.
      await this.authorized(db, command.action, scope, auth)
      await db.query(
        "INSERT INTO trade_commercial_command(scope_digest,idempotency_key,request_digest,response,action,actor_principal_id,decision_id,evidence_reference) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)",
        [
          scopeDigest,
          command.idempotencyKey,
          digest,
          JSON.stringify(result),
          command.action,
          scope.principal_id,
          auth.decisionId,
          auth.evidenceReference,
        ],
      )
      await db.query("COMMIT")
      return { outcome: "APPLIED", resource: result }
    } catch (error) {
      try {
        await db.query("ROLLBACK")
      } catch {
        /* Preserve the original refusal. */
      }
      throw error
    } finally {
      db.release()
    }
  }

  private async authorized(
    db: PgClient,
    action: CommercialAction,
    scope: CommercialContext,
    auth: CommercialAuthorization,
  ) {
    const now = new Date(
      (await db.query("SELECT clock_timestamp() AS now")).rows[0].now as string,
    ).getTime()
    if (
      !auth ||
      auth.action !== action ||
      !sameCommercialScope(auth.context, scope) ||
      auth.context.principal_id !== scope.principal_id ||
      !UUID.test(auth.decisionId) ||
      !auth.evidenceReference?.trim() ||
      !Number.isFinite(auth.evaluatedAt.getTime()) ||
      !Number.isFinite(auth.expiresAt.getTime()) ||
      auth.evaluatedAt.getTime() > now ||
      auth.expiresAt.getTime() <= now ||
      auth.expiresAt.getTime() - auth.evaluatedAt.getTime() > 60000
    )
      return refuseCommercial("AUTHORITY_DENIED")
    const kind = BUYER_ACTIONS.has(action)
      ? "BUYER"
      : SYSTEM_ACTIONS.has(action)
        ? "SYSTEM"
        : "SELLER"
    if (auth.actor.kind !== kind) return refuseCommercial("AUTHORITY_DENIED")
    const org = await db.query(
      `SELECT * FROM b2b_organisation WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR SHARE`,
      [scope.buyer_organisation_id, scope.tenant_id],
    )
    const row = org.rows[0]
    if (
      !row ||
      row.status !== "ACTIVE" ||
      row.canonical_organisation_id !== auth.canonicalOrganisationId ||
      Number(row.relationship_revision) !== auth.relationshipRevision
    )
      return refuseCommercial("AUTHORITY_DENIED")
    if (auth.actor.kind === "BUYER") {
      const membership = await db.query(
        "SELECT * FROM b2b_buyer_membership WHERE id=$1 AND organisation_id=$2 AND principal_id=$3 AND deleted_at IS NULL FOR SHARE",
        [auth.actor.membershipId, scope.buyer_organisation_id, scope.principal_id],
      )
      const member = membership.rows[0]
      if (
        !member ||
        member.status !== "ACTIVE" ||
        Number(member.revision) !== auth.actor.revision ||
        (member.effective_from && new Date(member.effective_from as string).getTime() > now) ||
        (member.effective_until && new Date(member.effective_until as string).getTime() <= now)
      )
        return refuseCommercial("AUTHORITY_DENIED")
    }
  }

  private async lock(
    db: PgClient,
    scope: CommercialContext,
    resourceId: string,
  ): Promise<CommercialResource> {
    const first = await db.query(
      `SELECT parent_id FROM trade_commercial_resource WHERE ${SCOPED} AND resource_id=$6`,
      [...scopeValues(scope), resourceId],
    )
    if (!first.rows.length) return refuseCommercial("NOT_FOUND")
    if (first.rows[0].parent_id)
      await db.query(
        `SELECT resource_id FROM trade_commercial_resource WHERE ${SCOPED} AND resource_id=$6 FOR UPDATE`,
        [...scopeValues(scope), first.rows[0].parent_id],
      )
    const row = await db.query(
      `SELECT document FROM trade_commercial_resource WHERE ${SCOPED} AND resource_id=$6 FOR UPDATE`,
      [...scopeValues(scope), resourceId],
    )
    if (!row.rows.length) return refuseCommercial("NOT_FOUND")
    return row.rows[0].document as CommercialResource
  }
  private async insert(
    db: PgClient,
    resource: CommercialResource,
    kind: "RFQ" | "QUOTATION",
    parent: string | null,
  ) {
    const id = "quotation_id" in resource ? resource.quotation_id : resource.rfq_id
    const values = [
      id,
      kind,
      ...scopeValues(resource.context),
      parent,
      resource.version,
      resource.status,
      JSON.stringify(resource),
    ]
    const result = await db.query(
      `INSERT INTO trade_commercial_resource(resource_id,kind,tenant_id,buyer_organisation_id,digital_estate_id,market_id,legal_entity_id,parent_id,version,status,document)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING document`,
      values,
    )
    return result.rows[0].document as CommercialResource
  }
  private async update(db: PgClient, resource: Rfq | Quotation) {
    const id = "quotation_id" in resource ? resource.quotation_id : resource.rfq_id
    const result = await db.query(
      "UPDATE trade_commercial_resource SET version=$2,status=$3,document=$4::jsonb WHERE resource_id=$1 AND version=$5 RETURNING document",
      [id, resource.version, resource.status, JSON.stringify(resource), resource.version - 1],
    )
    if (result.rowCount !== 1) return refuseCommercial("CONFLICT")
    return result.rows[0].document as CommercialResource
  }
}
