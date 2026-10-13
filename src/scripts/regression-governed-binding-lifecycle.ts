/**
 * P0-04B-01 disposable PostgreSQL 17 / real Medusa module acceptance.
 * Synthetic principals/evidence exercise STORAGE ONLY, never IAM, CP, signing,
 * merchant certification or successful native checkout. No fixture is ACTIVE.
 * Refuses a non-test or unmarked database; append-only receipts remain until CI
 * disposes the database (they are not deleted through an audit bypass).
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import type { ExecArgs } from "@medusajs/framework/types"
import type NativeSellerCheckoutModuleService from "../modules/legal-seller-checkout/service"
import { NATIVE_SELLER_DEPENDENCY_KEY } from "../baobab/orders/native-cart-legal-seller"
import { PostgresGovernedBindingPersistence } from "../baobab/orders/postgres-governed-binding-persistence"
import type {
  BindingProposal,
  BindingApproval,
} from "../baobab/orders/governed-binding-command-policy"
import type { VerifiedActor, VerifiedEvidence } from "../baobab/orders/governed-binding-service"

export default async function ({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Binding lifecycle regression requires the explicitly marked disposable test database",
    )
  }
  const native = container.resolve<NativeSellerCheckoutModuleService>(NATIVE_SELLER_DEPENDENCY_KEY)
  const persistence = native.bindingPersistence
  const pool = new Pool({ connectionString: url, max: 4 })
  const fixture = (leaseMs = 120_000) => {
    const key = randomUUID()
    const scope = {
      cartId: `regression-binding-${key}`,
      tenantId: `tn_test_${key}`,
      organisationId: randomUUID(),
      responsibleLegalEntityId: `LE-SYNTHETIC-${key}`,
      marketCode: "ZA",
      currencyCode: "ZAR",
      salesChannelId: `channel-${key}`,
      regionId: `region-${key}`,
    }
    const maker: VerifiedActor = {
      subject: `synthetic-maker-${key}`,
      tenantId: scope.tenantId,
      organisationId: scope.organisationId,
      audience: "baobab-trade",
      scopes: ["trade:legal-seller-binding:propose"],
      issuer: "synthetic-storage-fixture",
      tokenId: key,
    }
    const proposal: BindingProposal = {
      scope,
      maker,
      proposedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + leaseMs).toISOString(),
      evidenceReference: `synthetic/proposal/${key}`,
    }
    const evidence: VerifiedEvidence = {
      reference: proposal.evidenceReference,
      decisionId: randomUUID(),
      verifiedAt: new Date().toISOString(),
    }
    const approval = (suffix = "one"): BindingApproval => ({
      proposal,
      checker: {
        ...maker,
        subject: `synthetic-checker-${suffix}-${key}`,
        scopes: ["trade:legal-seller-binding:approve"],
      },
      approvedAt: new Date().toISOString(),
      approvalReference: `synthetic/approval/${suffix}/${key}`,
    })
    const approvedEvidence = (command: BindingApproval) => ({
      ...evidence,
      reference: command.approvalReference,
    })
    return { scope, maker, proposal, evidence, approval, approvedEvidence }
  }
  const receipts = async (cart: string) =>
    (
      await pool.query(
        `SELECT count(*)::int AS count FROM la05_binding_decision WHERE cart_id=$1`,
        [cart],
      )
    ).rows[0].count as number
  const row = async (cart: string) =>
    (await native.listNativeSellerCartBindings({ cart_id: cart }))[0]
  try {
    const ordinary = fixture()
    await persistence.propose(ordinary.proposal, ordinary.evidence)
    let stored = await row(ordinary.scope.cartId)
    assert.equal(stored.status, "PROPOSED")
    assert.equal(stored.context_id, "PENDING")
    assert.equal(stored.revision, 0)
    assert.deepEqual(stored.proposal_snapshot, ordinary.proposal)
    const command = ordinary.approval()
    // Caller cannot rewrite expiry, original evidence or maker token provenance.
    for (const forged of [
      {
        ...command,
        proposal: { ...ordinary.proposal, expiresAt: new Date(Date.now() + 240_000).toISOString() },
      },
      { ...command, proposal: { ...ordinary.proposal, evidenceReference: "synthetic/foreign" } },
      {
        ...command,
        proposal: { ...ordinary.proposal, maker: { ...ordinary.maker, tokenId: "foreign-token" } },
      },
    ])
      await assert.rejects(persistence.approve(forged, ordinary.approvedEvidence(command)))
    assert.equal(await receipts(ordinary.scope.cartId), 1)
    await persistence.approve(command, ordinary.approvedEvidence(command))
    stored = await row(ordinary.scope.cartId)
    assert.equal(stored.status, "PROPOSED") // Approval is explicitly not activation.
    assert.equal(stored.approved_by, command.checker.subject)
    assert.equal(stored.revision, 1)
    assert.equal(await receipts(ordinary.scope.cartId), 2)
    await assert.rejects(persistence.approve(command, ordinary.approvedEvidence(command)))
    await assert.rejects(
      pool.query("UPDATE native_seller_cart_binding SET status='ACTIVE' WHERE cart_id=$1", [
        ordinary.scope.cartId,
      ]),
    )
    await assert.rejects(
      pool.query("UPDATE native_seller_cart_binding SET tenant_id='foreign' WHERE cart_id=$1", [
        ordinary.scope.cartId,
      ]),
    )
    await assert.rejects(
      pool.query("UPDATE la05_binding_decision SET reason='rewritten' WHERE cart_id=$1", [
        ordinary.scope.cartId,
      ]),
    )
    await assert.rejects(
      pool.query("DELETE FROM native_seller_cart_binding WHERE cart_id=$1", [
        ordinary.scope.cartId,
      ]),
    )
    await persistence.revoke(
      ordinary.scope,
      { ...ordinary.maker, scopes: ["trade:legal-seller-binding:revoke"] },
      "synthetic authority withdrawn",
      { ...ordinary.evidence, reference: "synthetic/revocation" },
    )
    assert.equal((await row(ordinary.scope.cartId)).status, "REVOKED")
    assert.equal(await receipts(ordinary.scope.cartId), 3)
    await assert.rejects(persistence.propose(ordinary.proposal, ordinary.evidence))
    await assert.rejects(
      persistence.revoke(
        ordinary.scope,
        { ...ordinary.maker, scopes: ["trade:legal-seller-binding:revoke"] },
        "duplicate",
        ordinary.evidence,
      ),
    )

    const duplicate = fixture()
    const proposals = await Promise.allSettled([
      persistence.propose(duplicate.proposal, duplicate.evidence),
      persistence.propose(duplicate.proposal, duplicate.evidence),
    ])
    assert.equal(proposals.filter((p) => p.status === "fulfilled").length, 1)
    assert.equal(await receipts(duplicate.scope.cartId), 1)
    const checks = [duplicate.approval("one"), duplicate.approval("two")]
    const approvals = await Promise.allSettled(
      checks.map((c) => persistence.approve(c, duplicate.approvedEvidence(c))),
    )
    assert.equal(approvals.filter((p) => p.status === "fulfilled").length, 1)
    assert.equal(await receipts(duplicate.scope.cartId), 2)

    const raced = fixture()
    await persistence.propose(raced.proposal, raced.evidence)
    const raceApproval = raced.approval()
    const race = await Promise.allSettled([
      persistence.approve(raceApproval, raced.approvedEvidence(raceApproval)),
      persistence.revoke(
        raced.scope,
        { ...raced.maker, scopes: ["trade:legal-seller-binding:revoke"] },
        "synthetic withdrawal",
        raced.evidence,
      ),
    ])
    assert.equal(race[1].status, "fulfilled")
    assert.equal((await row(raced.scope.cartId)).status, "REVOKED")
    assert.ok([2, 3].includes(await receipts(raced.scope.cartId)))

    // A missing audit write cannot leave an independently approved binding.
    const unaudited = fixture()
    await persistence.propose(unaudited.proposal, unaudited.evidence)
    const direct = await pool.connect()
    try {
      await direct.query("BEGIN")
      await direct.query(
        `UPDATE native_seller_cart_binding SET approved_by='synthetic-unaudited',
        approved_at=clock_timestamp(),approval_reference='synthetic/missing-receipt' WHERE cart_id=$1`,
        [unaudited.scope.cartId],
      )
      await assert.rejects(direct.query("COMMIT"))
      await direct.query("ROLLBACK")
    } finally {
      direct.release()
    }
    assert.equal((await row(unaudited.scope.cartId)).approved_by, null)
    assert.equal(await receipts(unaudited.scope.cartId), 1)

    // Actual row-lock wait crosses expiry AFTER the approval transaction begins.
    const expiry = fixture(2_000)
    await persistence.propose(expiry.proposal, expiry.evidence)
    const lock = await pool.connect()
    try {
      await lock.query("BEGIN")
      await lock.query("SELECT id FROM native_seller_cart_binding WHERE cart_id=$1 FOR UPDATE", [
        expiry.scope.cartId,
      ])
      const c = expiry.approval()
      const denied = assert.rejects(persistence.approve(c, expiry.approvedEvidence(c)))
      await lock.query("SELECT pg_sleep(2.2)")
      await lock.query("COMMIT")
      await denied
    } finally {
      await lock.query("ROLLBACK")
      lock.release()
    }
    assert.equal((await row(expiry.scope.cartId)).approved_by, null)
    assert.equal(await receipts(expiry.scope.cartId), 1)

    // Expiry after audit insertion rolls back the proposal and both receipts.
    const slow = fixture(2_000)
    const delayed = new PostgresGovernedBindingPersistence({
      connect: async () => {
        const client = await pool.connect()
        return {
          release: () => client.release(),
          query: async (sql, values) => {
            const result = await client.query(sql, values ? [...values] : [])
            if (sql.includes("INSERT INTO la05_binding_outbox"))
              await client.query("SELECT pg_sleep(2.2)")
            return result
          },
        }
      },
    })
    await assert.rejects(delayed.propose(slow.proposal, slow.evidence))
    assert.equal(
      (await native.listNativeSellerCartBindings({ cart_id: slow.scope.cartId })).length,
      0,
    )
    assert.equal(await receipts(slow.scope.cartId), 0)

    // Receipt enforcement is independent of the application adapter: a direct
    // deletion or approval cannot bypass the same applied database constraints.
    const invalid = await pool.query(`SELECT count(*)::int AS count FROM la05_binding_decision d
      LEFT JOIN la05_binding_outbox o ON o.decision_id=d.id WHERE o.id IS NULL`)
    assert.equal(invalid.rows[0].count, 0)
    console.log(
      "P0-04B-01: native Medusa/PostgreSQL binding lifecycle, races, immutable snapshots and atomic expiry/receipts passed; no ACTIVE fixture",
    )
  } finally {
    await pool.end()
    await native.__hooks.onApplicationShutdown()
  }
}
