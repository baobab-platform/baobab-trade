import { describe, expect, it, vi } from "vitest"
import {
  PostgresGovernedBindingPersistence,
  type PgClient,
  type PgPool,
} from "../src/baobab/orders/postgres-governed-binding-persistence"

const scope = {
  cartId: "cart-test",
  tenantId: "tenant-test",
  organisationId: "org-test",
  responsibleLegalEntityId: "legal-test",
  marketCode: "ZA",
  currencyCode: "ZAR",
  salesChannelId: "channel-test",
  regionId: "region-test",
}
const actor = {
  subject: "maker",
  tenantId: "tenant-test",
  organisationId: "org-test",
  audience: "baobab-trade",
  scopes: ["trade:legal-seller-binding:propose"],
  issuer: "iam",
  tokenId: "jwt",
}
const evidence = {
  reference: "evidence/test",
  decisionId: "test-decision",
  verifiedAt: "2026-10-10T06:00:00Z",
}
function mockDb(existing: Record<string, unknown>[] = [], updateCount = 1) {
  const queries: string[] = []
  const params: unknown[][] = []
  const client: PgClient = {
    query: vi.fn().mockImplementation(async (sql: string, values: unknown[] = []) => {
      queries.push(sql)
      params.push(values)
      if (sql.startsWith("SELECT")) return { rows: existing, rowCount: existing.length }
      if (sql.includes("RETURNING id"))
        return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 }
      if (sql.trimStart().startsWith("UPDATE")) return { rows: [], rowCount: updateCount }
      return { rows: [], rowCount: 1 }
    }),
    release: vi.fn(),
  }
  const pool: PgPool = { connect: vi.fn().mockResolvedValue(client) }
  return { pool, client, queries, params }
}
describe("LA-05C5 PostgreSQL transaction boundary", () => {
  it("commits proposed binding, decision and outbox atomically", async () => {
    const db = mockDb()
    await new PostgresGovernedBindingPersistence(db.pool).propose(
      {
        scope,
        maker: actor,
        proposedAt: "2026-10-10T05:00:00Z",
        expiresAt: "2026-10-11T05:00:00Z",
        evidenceReference: evidence.reference,
      },
      evidence,
    )
    expect(db.queries[0]).toBe("BEGIN")
    expect(db.queries.at(-1)).toBe("COMMIT")
    expect(db.queries.some((q) => q.includes("la05_binding_outbox"))).toBe(true)
    expect(db.client.release).toHaveBeenCalledOnce()
  })
  it("rolls back duplicate cart proposals", async () => {
    const db = mockDb([{ cart_id: scope.cartId }])
    await expect(
      new PostgresGovernedBindingPersistence(db.pool).propose(
        {
          scope,
          maker: actor,
          proposedAt: "2026-10-10T05:00:00Z",
          expiresAt: "2026-10-11T05:00:00Z",
          evidenceReference: evidence.reference,
        },
        evidence,
      ),
    ).rejects.toThrow("transition rejected")
    expect(db.queries).toContain("ROLLBACK")
    expect(db.queries).not.toContain("COMMIT")
  })
  const stored = {
    cart_id: scope.cartId,
    tenant_id: scope.tenantId,
    organisation_id: scope.organisationId,
    responsible_legal_entity_id: scope.responsibleLegalEntityId,
    market_code: scope.marketCode,
    currency_code: scope.currencyCode,
    sales_channel_id: scope.salesChannelId,
    region_id: scope.regionId,
    proposed_by: actor.subject,
    status: "PROPOSED",
  }
  const approval = {
    proposal: {
      scope,
      maker: actor,
      proposedAt: "2026-10-10T05:00:00Z",
      expiresAt: "2026-10-11T05:00:00Z",
      evidenceReference: evidence.reference,
    },
    checker: { ...actor, subject: "checker" },
    approvedAt: "2026-10-10T05:30:00Z",
    approvalReference: "review/test",
  }
  it("records the approval on the binding row without activating it", async () => {
    const db = mockDb([stored])
    await new PostgresGovernedBindingPersistence(db.pool).approve(approval, evidence)
    const update = db.queries.find((q) => q.startsWith("UPDATE native_seller_cart_binding"))
    expect(update).toContain("approved_by = $2")
    expect(update).toContain("approved_by IS NULL")
    expect(update).toContain("proposed_by <> $2")
    expect(update).toContain("expires_at > transaction_timestamp()")
    expect(db.queries.some((q) => /status = 'ACTIVE'/.test(q))).toBe(false)
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
  it("rolls back approval when the guarded update matches no row (replay, self-approval or expired)", async () => {
    const db = mockDb([stored], 0)
    await expect(
      new PostgresGovernedBindingPersistence(db.pool).approve(approval, evidence),
    ).rejects.toThrow("transition rejected")
    expect(db.queries).toContain("ROLLBACK")
    expect(db.queries.some((q) => q.includes("la05_binding_outbox"))).toBe(false)
  })
  it("persists the revocation reason with the decision", async () => {
    const db = mockDb([{ ...stored, status: "ACTIVE" }])
    await new PostgresGovernedBindingPersistence(db.pool).revoke(
      scope,
      { ...actor, scopes: ["trade:legal-seller-binding:revoke"] },
      "mandate withdrawn by CP",
      evidence,
    )
    const index = db.queries.findIndex((q) => q.includes("'REVOKED',$6,$7,$8,$9"))
    expect(index).toBeGreaterThan(-1)
    expect(db.params[index]).toContain("mandate withdrawn by CP")
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
})
