/** P0-04B-02 native storage/intake acceptance. Real Medusa carts and applied
 * PostgreSQL migrations; CP ports are explicitly synthetic. This does not
 * establish a live human grant, legal mandate, workload or provider acceptance. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import type {
  ExecArgs,
  ICartModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { Pool } from "pg"
import { AuthenticatedBindingIntake } from "../baobab/orders/authenticated-binding-intake"
import type { BindingAuthorityClient } from "../baobab/orders/binding-authority-client"
import { PostgresGovernedBindingPersistence } from "../baobab/orders/postgres-governed-binding-persistence"

export async function acceptAuthenticatedBindingIntake(
  container: ExecArgs["container"],
  persistence: PostgresGovernedBindingPersistence,
  pool: Pool,
): Promise<void> {
  const carts = container.resolve<ICartModuleService>(Modules.CART)
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  const channel = await channels.createSalesChannels({ name: `synthetic binding ${randomUUID()}` })
  const region = await regions.createRegions({
    name: `synthetic binding ${randomUUID()}`,
    currency_code: "zar",
  })
  let subject = "synthetic-cp-maker"
  let legal = true
  let lease = 5000
  const cp: BindingAuthorityClient = {
    authorize: async (_token, operation, scope, digest) => {
      const evaluated = Date.now()
      return {
        scope,
        command_digest: digest,
        decision_id: randomUUID(),
        principal_id: subject,
        issuer: "https://synthetic-iam.example.test",
        token_id: `synthetic-token-${subject}`,
        scope_name: `trade-binding:${operation}`,
        evaluated_at: new Date(evaluated).toISOString(),
        valid_until: new Date(evaluated + lease).toISOString(),
        matched_grant_ids: ["synthetic-exact-grant"],
        provider_permissions_granted: false,
      }
    },
    resolve: async (scope) => ({
      context_id: randomUUID(),
      tenant_id: scope.tenantId,
      organisation_id: scope.organisationId,
      organisation_type: "ORGANISATION",
      country_code: "ZA",
      currency_code: "ZAR",
      market_id: "synthetic_market_za",
      resolved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }),
    assess: async (req) => ({
      context_id: req.context_id,
      operation_reference: req.operation_reference,
      provider_permissions_granted: false,
      legal_actor_resolution: legal
        ? {
            outcome: "AUTHORIZED",
            evaluated_at: new Date().toISOString(),
            valid_until: new Date(Date.now() + 30000).toISOString(),
            policy_reference: "synthetic-storage-only",
            mandate_id: "00000000-0000-4000-8000-000000000002",
            responsible_legal_entity_id: "LE-SYNTHETIC-SELLER",
            evidence_references: ["synthetic-verified-evidence"],
          }
        : {
            outcome: "REVOKED_OR_EXPIRED",
            evaluated_at: new Date().toISOString(),
            policy_reference: "synthetic-storage-only",
          },
    }),
  }
  const native = async (id: string) => {
    const c = await carts.retrieveCart(id)
    if (!c.region_id || !c.sales_channel_id) throw new Error("Native cart missing coordinates")
    return {
      salesChannelId: c.sales_channel_id,
      regionId: c.region_id,
      currencyCode: c.currency_code.toUpperCase(),
      completed: Boolean(c.completed_at),
    }
  }
  const intake = (port = persistence) =>
    new AuthenticatedBindingIntake(cp, port, native, async () => "synthetic-workload-token")
  const create = async () => {
    subject = "synthetic-cp-maker"
    legal = true
    lease = 5000
    const cart = await carts.createCarts({
      region_id: region.id,
      sales_channel_id: channel.id,
      currency_code: "zar",
    })
    await intake().execute(
      "propose",
      cart.id,
      {
        tenantId: "tn_synthetic01",
        organisationId: "00000000-0000-4000-8000-000000000001",
        responsibleLegalEntityId: "LE-SYNTHETIC-SELLER",
        marketCode: "ZA",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      },
      "synthetic-human-token",
    )
    subject = "synthetic-cp-checker"
    await intake().execute("approve", cart.id, { revision: 0 }, "synthetic-human-token")
    return cart
  }
  const row = async (id: string) =>
    (await pool.query("SELECT * FROM native_seller_cart_binding WHERE cart_id=$1", [id])).rows[0]
  // Historical internal/storage-only receipts must never be promoted to
  // authenticated maker/checker approval by a later real operator.
  const legacyCart = await carts.createCarts({
    region_id: region.id,
    sales_channel_id: channel.id,
    currency_code: "zar",
  })
  const legacyScope = {
    cartId: legacyCart.id,
    tenantId: "tn_synthetic01",
    organisationId: "00000000-0000-4000-8000-000000000001",
    responsibleLegalEntityId: "LE-SYNTHETIC-SELLER",
    marketCode: "ZA",
    currencyCode: "ZAR",
    salesChannelId: channel.id,
    regionId: region.id,
  }
  const legacyMaker = {
    subject: "synthetic-cp-maker",
    issuer: "https://synthetic-iam.example.test",
    tokenId: "old-storage-token",
    tenantId: legacyScope.tenantId,
    organisationId: legacyScope.organisationId,
    audience: "baobab-control-plane",
    scopes: ["trade-binding:propose"],
  }
  const legacyProposal = {
    scope: legacyScope,
    maker: legacyMaker,
    proposedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    evidenceReference: "synthetic-old-evidence",
  }
  const oldEvidence = {
    reference: "synthetic-old-evidence",
    decisionId: randomUUID(),
    verifiedAt: new Date().toISOString(),
  }
  await persistence.propose(legacyProposal, oldEvidence)
  await persistence.approve(
    {
      proposal: legacyProposal,
      checker: {
        ...legacyMaker,
        subject: "synthetic-cp-checker",
        scopes: ["trade-binding:approve"],
      },
      approvedAt: new Date().toISOString(),
      approvalReference: oldEvidence.reference,
    },
    oldEvidence,
  )
  subject = "synthetic-cp-operator"
  await assert.rejects(
    intake().execute("activate", legacyCart.id, { revision: 1 }, "synthetic-human-token"),
  )
  assert.equal((await row(legacyCart.id)).status, "PROPOSED")

  const ordinary = await create()
  assert.equal((await row(ordinary.id)).status, "PROPOSED")
  for (const actor of ["synthetic-cp-maker", "synthetic-cp-checker"]) {
    subject = actor
    await assert.rejects(
      intake().execute("activate", ordinary.id, { revision: 1 }, "synthetic-human-token"),
    )
  }
  subject = "synthetic-cp-operator"
  legal = false
  await assert.rejects(
    intake().execute("activate", ordinary.id, { revision: 1 }, "synthetic-human-token"),
  )
  legal = true
  const concurrent = await Promise.allSettled([
    intake().execute("activate", ordinary.id, { revision: 1 }, "synthetic-human-token"),
    intake().execute("activate", ordinary.id, { revision: 1 }, "synthetic-human-token"),
  ])
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1)
  const active = await row(ordinary.id)
  assert.equal(active.status, "ACTIVE")
  assert.equal(active.revision, 2)
  assert.notEqual(active.context_id, "PENDING")
  assert.equal(active.activation_snapshot.actor.subject, "synthetic-cp-operator")
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM la05_binding_activation WHERE binding_id=$1",
        [active.id],
      )
    ).rows[0].n,
    1,
  )
  await assert.rejects(
    intake().execute("activate", ordinary.id, { revision: 2 }, "synthetic-human-token"),
  )
  await assert.rejects(
    pool.query("UPDATE native_seller_cart_binding SET context_id=$2 WHERE cart_id=$1", [
      ordinary.id,
      randomUUID(),
    ]),
  )
  await assert.rejects(
    pool.query("DELETE FROM la05_binding_activation WHERE binding_id=$1", [active.id]),
  )
  legal = false
  await intake().execute(
    "revoke",
    ordinary.id,
    { revision: 2, reason: "synthetic CP mandate withdrawn" },
    "synthetic-human-token",
  )
  const revoked = await row(ordinary.id)
  assert.equal(revoked.status, "REVOKED")
  assert.equal(revoked.revision, 3)
  assert.deepEqual(revoked.activation_snapshot, active.activation_snapshot)
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM la05_binding_decision WHERE binding_id=$1", [
        active.id,
      ])
    ).rows[0].n,
    4,
  )
  const completed = await create()
  await carts.updateCarts(completed.id, { completed_at: new Date() })
  subject = "synthetic-cp-operator"
  await assert.rejects(
    intake().execute("activate", completed.id, { revision: 1 }, "synthetic-human-token"),
  )
  assert.equal((await row(completed.id)).status, "PROPOSED")
  const expiry = await create()
  subject = "synthetic-cp-operator"
  lease = 2000
  const delayed = new PostgresGovernedBindingPersistence({
    connect: async () => {
      const client = await pool.connect()
      return {
        release: () => client.release(),
        query: async (sql, values) => {
          if (sql === "COMMIT") await client.query("SELECT pg_sleep(2.2)")
          return client.query(sql, values ? [...values] : [])
        },
      }
    },
  })
  await assert.rejects(
    intake(delayed).execute("activate", expiry.id, { revision: 1 }, "synthetic-human-token"),
    /Current exact CP command admission required/,
  )
  const afterExpiry = await row(expiry.id)
  assert.equal(afterExpiry.status, "PROPOSED")
  assert.equal(afterExpiry.revision, 1)
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM la05_binding_activation WHERE binding_id=$1",
        [afterExpiry.id],
      )
    ).rows[0].n,
    0,
  )
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM la05_binding_decision WHERE binding_id=$1", [
        afterExpiry.id,
      ])
    ).rows[0].n,
    2,
  )

  const race = await create()
  subject = "synthetic-cp-operator"
  const outcomes = await Promise.allSettled([
    intake().execute("activate", race.id, { revision: 1 }, "synthetic-human-token"),
    intake().execute(
      "revoke",
      race.id,
      { revision: 1, reason: "synthetic concurrent withdrawal" },
      "synthetic-human-token",
    ),
  ])
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1)
  const raced = await row(race.id)
  assert.ok(["ACTIVE", "REVOKED"].includes(raced.status))
  assert.equal(raced.revision, 2)
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM la05_binding_decision WHERE binding_id=$1", [
        raced.id,
      ])
    ).rows[0].n,
    3,
  )
  console.log(
    "P0-04B-02: authenticated synthetic CP intake with real native carts, independent activation, concurrent/replay/direct rewrite denial and revocation history passed; no live authority or checkout certification",
  )
}
