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
  audience: "baobab-control-plane",
  scopes: ["trade-binding:propose"],
  issuer: "iam",
  tokenId: "jwt",
}
const evidence = {
  reference: "evidence/test",
  decisionId: "test-decision",
  verifiedAt: "2026-10-10T06:00:00Z",
}
function mockDb(
  existing: Record<string, unknown>[] = [],
  updateCount = 1,
  committedReceipts: Record<string, unknown>[] = [],
) {
  const queries: string[] = []
  const params: unknown[][] = []
  const client: PgClient = {
    query: vi.fn().mockImplementation(async (sql: string, values: unknown[] = []) => {
      queries.push(sql)
      params.push(values)
      if (sql.includes("la05_checkout_authorization receipt"))
        return { rows: committedReceipts, rowCount: committedReceipts.length }
      if (sql.includes("AS valid")) return { rows: [{ valid: true }], rowCount: 1 }
      if (sql.trimStart().startsWith("UPDATE"))
        return { rows: [{ id: "lsbind_test", revision: 1 }], rowCount: updateCount }
      if (sql.startsWith("SELECT")) return { rows: existing, rowCount: existing.length }
      if (sql.includes("RETURNING id"))
        return { rows: [{ id: "00000000-0000-4000-8000-000000000001", revision: 0 }], rowCount: 1 }
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
    await new PostgresGovernedBindingPersistence(db.pool, () =>
      Date.parse("2026-10-10T06:00:00Z"),
    ).propose(
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
      new PostgresGovernedBindingPersistence(db.pool, () =>
        Date.parse("2026-10-10T06:00:00Z"),
      ).propose(
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
    checker: { ...actor, subject: "checker", scopes: ["trade-binding:approve"] },
    approvedAt: "2026-10-10T05:30:00Z",
    approvalReference: "review/test",
  }
  it("records the approval on the binding row without activating it", async () => {
    const db = mockDb([stored])
    await new PostgresGovernedBindingPersistence(db.pool, () =>
      Date.parse("2026-10-10T06:00:00Z"),
    ).approve(approval, { ...evidence, reference: approval.approvalReference })
    const update = db.queries.find((q) => q.startsWith("UPDATE native_seller_cart_binding"))
    expect(update).toContain("approved_by=$2")
    expect(update).toContain("approved_by IS NULL")
    expect(update).toContain("proposed_by<>$2")
    expect(update).toContain("expires_at>clock_timestamp()")
    expect(update).toContain("proposal_snapshot=$4::jsonb")
    expect(db.queries.some((q) => /status = 'ACTIVE'/.test(q))).toBe(false)
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
  it("rolls back approval when the guarded update matches no row (replay, self-approval or expired)", async () => {
    const db = mockDb([stored], 0)
    await expect(
      new PostgresGovernedBindingPersistence(db.pool, () =>
        Date.parse("2026-10-10T06:00:00Z"),
      ).approve(approval, { ...evidence, reference: approval.approvalReference }),
    ).rejects.toThrow("transition rejected")
    expect(db.queries).toContain("ROLLBACK")
    expect(db.queries.some((q) => q.includes("la05_binding_outbox"))).toBe(false)
  })
  it("persists the revocation reason with the decision", async () => {
    const db = mockDb([{ ...stored, status: "ACTIVE" }])
    await new PostgresGovernedBindingPersistence(db.pool, () =>
      Date.parse("2026-10-10T06:00:00Z"),
    ).revoke(
      scope,
      { ...actor, scopes: ["trade-binding:revoke"] },
      "mandate withdrawn by CP",
      evidence,
    )
    const index = db.queries.findIndex((q) => q.includes("INSERT INTO la05_binding_decision"))
    expect(index).toBeGreaterThan(-1)
    expect(db.params[index]).toContain("mandate withdrawn by CP")
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
})

describe("P0-04B-03 checkout authorization receipt", () => {
  const at = Date.parse("2026-10-14T09:00:00Z")
  const authorization = {
    cartId: scope.cartId,
    contextId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
    responsibleLegalEntityId: scope.responsibleLegalEntityId,
    mandateId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
    legalValidUntil: "2026-10-14T09:00:20Z",
    providerCertificationReference: "synthetic/provider-certification",
    merchantActivationReference: "synthetic/merchant-activation",
    policyReference: "synthetic/payments-policy",
    readinessValidUntil: "2026-10-14T09:00:15Z",
    idempotencyKey: `native-checkout/${scope.cartId}`,
  }
  it("inserts under the seller-binding fence against the current ACTIVE revision", async () => {
    const db = mockDb([{ id: "lsbind_test", revision: 2 }])
    await new PostgresGovernedBindingPersistence(db.pool, () => at).record(authorization)
    expect(db.queries[0]).toBe("BEGIN")
    const lock = db.queries.findIndex((q) => q.includes("pg_advisory_xact_lock"))
    expect(db.params[lock]).toEqual([`seller-binding/${scope.cartId}`])
    const insert = db.queries.findIndex((q) =>
      q.includes("INSERT INTO la05_checkout_authorization"),
    )
    expect(insert).toBeGreaterThan(lock)
    expect(db.queries[insert]).toContain("LEAST($7::timestamptz,$11::timestamptz)")
    expect(db.params[insert].slice(0, 3)).toEqual([scope.cartId, "lsbind_test", 2])
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
  it("records nothing for a completeCart replay of an already committed checkout", async () => {
    const db = mockDb([{ id: "lsbind_test", revision: 2 }], 1, [{ "?column?": 1 }])
    await new PostgresGovernedBindingPersistence(db.pool, () => at).record(authorization)
    const replay = db.queries.findIndex((q) => q.includes("la05_checkout_authorization receipt"))
    expect(db.params[replay]).toEqual([`native-checkout/${scope.cartId}`])
    expect(db.queries.some((q) => q.includes("INSERT INTO la05_checkout_authorization"))).toBe(
      false,
    )
    expect(db.queries.at(-1)).toBe("COMMIT")
  })
  it("rolls back when no ACTIVE binding exists", async () => {
    const db = mockDb([])
    await expect(
      new PostgresGovernedBindingPersistence(db.pool, () => at).record(authorization),
    ).rejects.toThrow("no ACTIVE seller binding")
    expect(db.queries).toContain("ROLLBACK")
    expect(db.queries.some((q) => q.includes("INSERT INTO la05_checkout_authorization"))).toBe(
      false,
    )
  })
  it("refuses incomplete, foreign-keyed or already-expired authorizations before any I/O", async () => {
    for (const change of [
      { idempotencyKey: "native-checkout/another-cart" },
      { mandateId: " " },
      { merchantActivationReference: "" },
      { legalValidUntil: "not-a-time" },
      { readinessValidUntil: "2026-10-14T09:00:00Z" },
      { legalValidUntil: "2026-10-14T08:59:59Z" },
    ]) {
      const db = mockDb([{ id: "lsbind_test", revision: 2 }])
      await expect(
        new PostgresGovernedBindingPersistence(db.pool, () => at).record({
          ...authorization,
          ...change,
        }),
      ).rejects.toThrow("checkout authorization incomplete or expired")
      expect(db.pool.connect).not.toHaveBeenCalled()
    }
  })
})
