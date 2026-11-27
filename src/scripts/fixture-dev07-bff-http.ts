/** Native Trade records for the leased, independently provisioned CP buyer.
 * This CLI is never a route or a source of canonical identity/permission.
 * The actual HTTP handler must still verify current IAM and CP on every call.
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import type { ExecArgs, IApiKeyModuleService, IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { buildFinalBuyerCommitmentValuation } from "../baobab/b2b/buyer-commitment-valuation"
import { issueGovernedCartCharges } from "../baobab/b2b/governed-cart-charge-issuer"
import {
  nativeMedusaCartPriceReadback,
  type NativeCartModule,
} from "../baobab/b2b/medusa-final-cart-pricing"
import { withNativeMedusaOrderTransaction } from "../baobab/b2b/medusa-native-transaction-owner"
import { nativeBuyerCommitRuntime } from "../baobab/b2b/native-buyer-commit-runtime"
import { readNativeCurrencyExponent } from "../baobab/b2b/native-currency-exponent"
import type B2BModuleService from "../modules/b2b/service"

type OwnerFixture = {
  run_id: string
  tenant_id: string
  organisation_id: string
  principal_id: string
  engine_instance_id: string
  expires_at: string
  synthetic_only: true
  protected_acceptance: false
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PATH = "/run/dev07-bff-owner.json"
const FIELDS = [
  "run_id",
  "tenant_id",
  "organisation_id",
  "principal_id",
  "engine_instance_id",
  "expires_at",
  "synthetic_only",
  "protected_acceptance",
]

export function validateOwnerFixture(
  value: unknown,
  env: NodeJS.ProcessEnv,
  now: number = Date.now(),
): OwnerFixture {
  const f = value as OwnerFixture
  const database = env.BAOBAB_DEV07_TEST_DB ?? ""
  assert.ok(f && typeof f === "object" && !Array.isArray(f))
  assert.deepEqual(Object.keys(f).sort(), [...FIELDS].sort())
  assert.ok(env.NODE_ENV === "test" && env.BAOBAB_ENVIRONMENT === "development")
  assert.ok(/^[0-9a-f]{32}$/.test(f.run_id) && f.run_id === env.BAOBAB_DEV07_RUN_ID)
  assert.equal(database, `dev07_bff_${f.run_id.slice(0, 12)}_test`)
  assert.equal(new URL(env.DATABASE_URL ?? "").pathname, `/${database}`)
  assert.ok(f.synthetic_only === true && f.protected_acceptance === false)
  assert.ok(UUID.test(f.organisation_id) && UUID.test(f.principal_id))
  assert.ok(/^tn_[a-z0-9]+$/.test(f.tenant_id))
  assert.ok(/^ei_[a-z0-9]+$/.test(f.engine_instance_id))
  assert.equal(f.engine_instance_id, env.BAOBAB_TRADE_ENGINE_INSTANCE_ID)
  const expires = Date.parse(f.expires_at)
  assert.ok(Number.isFinite(now) && expires > now && expires <= now + 3_600_000)
  return f
}

/** Revoke the exact run-owned key before native Medusa permits deletion. */
export async function cleanupFixturePublishableKey(
  apiKeys: IApiKeyModuleService,
  keyId: string,
  runId: string,
): Promise<void> {
  assert.ok(/^[0-9a-f]{32}$/.test(runId))
  const actor = `dev07:${runId}`
  const key = await apiKeys.retrieveApiKey(keyId)
  assert.equal(key.id, keyId)
  assert.equal(key.title, `DEV07 BFF HTTP ${runId}`)
  assert.equal(key.type, "publishable")
  assert.equal(key.created_by, actor)
  await apiKeys.revoke(keyId, { revoked_by: actor, revoke_in: 0 })
  const revoked = await apiKeys.retrieveApiKey(keyId)
  assert.equal(revoked.id, keyId)
  assert.equal(revoked.revoked_by, actor)
  const revokedAt = revoked.revoked_at
  const epoch = revokedAt instanceof Date ? revokedAt.getTime() : Date.parse(String(revokedAt))
  assert.ok(Number.isFinite(epoch) && epoch <= Date.now())
  await apiKeys.deleteApiKeys(keyId)
}

export default async function ({ container }: ExecArgs) {
  const stat = lstatSync(PATH)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0)
  assert.ok(stat.size > 0 && stat.size <= 4096)
  const f = validateOwnerFixture(JSON.parse(readFileSync(PATH, "utf8")), process.env)
  const phase = process.env.BAOBAB_DEV07_NATIVE_PHASE
  assert.ok(
    ["prepare", "suspend", "resume", "cleanup", "enforce-checkout", "price-and-reserve"].includes(
      phase ?? "",
    ),
  )
  const b2b = container.resolve<B2BModuleService>("b2b")
  const apiKeys = container.resolve<IApiKeyModuleService>("api_key")
  const keyTitle = `DEV07 BFF HTTP ${f.run_id}`
  const keys = await apiKeys.listApiKeys({ title: keyTitle, type: "publishable" })
  for (const key of keys) {
    assert.equal(key.title, keyTitle)
    assert.equal(key.type, "publishable")
    assert.equal(key.created_by, `dev07:${f.run_id}`)
  }
  const orgId = `buyerorg_${f.run_id}`
  const memberId = `buyermem_${f.run_id}`
  const roleId = `b2brole_${f.run_id}`
  const orgs = await b2b.listB2BOrganisations({ id: orgId })
  const members = await b2b.listBuyerMemberships({ id: memberId })
  const roles = await b2b.listBuyerRoles({ id: roleId })
  for (const org of orgs) {
    assert.equal(org.tenant_id, f.tenant_id)
    assert.equal(org.canonical_organisation_id, f.organisation_id)
    assert.equal(org.engine_instance_id, f.engine_instance_id)
    assert.equal(org.link_provenance, `dev07-bff-http:${f.run_id}`)
  }
  for (const member of members) {
    assert.equal(member.organisation_id, orgId)
    assert.equal(member.principal_id, f.principal_id)
  }
  for (const role of roles) {
    assert.equal(role.membership_id, memberId)
    assert.equal(role.role, "BUYER")
  }
  if (phase === "enforce-checkout" || phase === "price-and-reserve") {
    assert.ok(keys.length === 1 && orgs.length === 1 && members.length === 1 && roles.length === 1)
    assert.equal(orgs[0].status, "ACTIVE")
    assert.equal(members[0].status, "ACTIVE")
    assert.equal(process.env.BAOBAB_DEV07_DISPOSABLE_CHECKOUT_APPROVED_RUN, f.run_id)
    assert.ok(
      process.env.BAOBAB_DEPLOYMENT_ENV === undefined ||
        process.env.BAOBAB_DEPLOYMENT_ENV === "development",
    )
    const reference = process.env.BAOBAB_DEV07_CHECKOUT_CHANGE_REFERENCE ?? ""
    assert.ok(/^[A-Za-z0-9._:/-]{8,200}$/.test(reference))
    if (phase === "price-and-reserve") {
      const cartId = process.env.BAOBAB_NATIVE_PRICE_CART_ID ?? ""
      assert.ok(/^cart_[A-Za-z0-9_-]{6,128}$/.test(cartId) && members[0].customer_id)
      const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
      const carts = container.resolve<NativeCartModule>(Modules.CART)
      const runtime = nativeBuyerCommitRuntime()
      const correlation = randomUUID()
      const binding = await withNativeMedusaOrderTransaction(orders, async ({ db }) => {
        const result = await db.query(
          `SELECT b.market_key,b.responsible_legal_entity_id,b.currency_code
             FROM native_seller_cart_binding b JOIN cart c ON c.id=b.cart_id
            WHERE c.id=$1 AND b.tenant_id=$2 AND c.customer_id=$3
              AND c.completed_at IS NULL AND c.deleted_at IS NULL
              AND b.status='ACTIVE' AND b.deleted_at IS NULL AND b.expires_at>clock_timestamp()
              AND b.sales_channel_id=c.sales_channel_id AND b.region_id=c.region_id
              AND b.currency_code=upper(c.currency_code)
              AND EXISTS (SELECT 1 FROM trade_commit_fence_enforcement
                 WHERE singleton AND mode='ENFORCED' AND revision=2 AND change_reference=$4)`,
          [cartId, f.tenant_id, members[0].customer_id, `dev07:${f.run_id}:${reference}`],
        )
        assert.equal(result.rowCount, 1)
        const { market_key, responsible_legal_entity_id, currency_code } = result.rows[0]
        assert.ok(typeof market_key === "string" && market_key !== "PENDING")
        assert.ok(typeof currency_code === "string" && /^[A-Z]{3}$/.test(currency_code))
        if (typeof responsible_legal_entity_id !== "string" || !responsible_legal_entity_id)
          throw new Error("DEV07_CART_SELLER_UNAVAILABLE")
        return { market_key, responsible_legal_entity_id, currency_code }
      })
      await issueGovernedCartCharges(runtime.chargeSource(correlation), cartId)
      const price = await withNativeMedusaOrderTransaction(orders, async ({ db, manager }) => {
        const source = await db.query(
          `SELECT DISTINCT a.market_id
             FROM trade_native_cart_charge_authority a JOIN cart c ON c.id=a.cart_id
            WHERE a.cart_id=$1 AND a.tenant_id=$2 AND a.seller_legal_entity_id=$3
              AND a.cart_updated_at_exact=to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          [cartId, f.tenant_id, binding.responsible_legal_entity_id],
        )
        assert.equal(source.rowCount, 1)
        const marketId = source.rows[0].market_id
        assert.ok(typeof marketId === "string" && marketId)
        return nativeMedusaCartPriceReadback(carts, readNativeCurrencyExponent, (check) =>
          runtime.verifyCurrentIssuer(check, correlation),
        )(
          db,
          "READ_ONLY",
          {
            receipt: {
              resource_id: cartId,
              tenant_id: f.tenant_id,
              market_id: marketId,
              seller_legal_entity_id: binding.responsible_legal_entity_id,
              currency: binding.currency_code,
            },
          },
          manager,
        )
      })
      const valuation = buildFinalBuyerCommitmentValuation(price.valuation)
      const holdKey = createHash("sha256")
        .update(JSON.stringify([f.run_id, cartId, valuation.transaction_digest]))
        .digest("hex")
      const result = await runtime.spend.submit({
        idempotencyKey: `dev07.reserve.${holdKey}`,
        purchaseReference: cartId,
        tenantId: f.tenant_id,
        organisationId: orgId,
        membershipId: memberId,
        actorPrincipalId: f.principal_id,
        marketKey: binding.market_key,
        currencyCode: valuation.currency,
        agreementReference: null,
        transactionDigest: valuation.transaction_digest,
        resourceVersion: valuation.resource_version,
        amountMinor: BigInt(valuation.buyer_commitment_amount_minor),
        expiresAt: new Date(Math.min(Date.parse(f.expires_at), Date.now() + 300_000)),
      })
      assert.ok(result.outcome === "APPLIED" && result.status === "ACTIVE")
      return
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 3000 })
    try {
      const scope = [process.env.BAOBAB_DEV07_TEST_DB, `dev07:${f.run_id}:${reference}`]
      // This operation is restricted to the existing isolated buyer-BFF
      // fixture database and its single initial migration posture.
      const result = await pool.query(
        `UPDATE trade_commit_fence_enforcement
            SET mode='ENFORCED', revision=revision+1, change_reference=$2
          WHERE singleton AND mode='SHADOW' AND revision=1 AND current_database()=$1
          RETURNING mode,revision`,
        scope,
      )
      const observed =
        result.rowCount === 1
          ? result
          : await pool.query(
              `SELECT mode,revision FROM trade_commit_fence_enforcement
          WHERE singleton AND mode='ENFORCED' AND revision=2
            AND current_database()=$1 AND change_reference=$2`,
              scope,
            )
      assert.deepEqual(observed.rows, [{ mode: "ENFORCED", revision: 2 }])
    } finally {
      await pool.end()
    }
    return
  }
  if (phase === "prepare") {
    assert.equal(keys.length, 0)
    assert.ok(orgs.length === 0 && members.length === 0 && roles.length === 0)
    await b2b.createB2BOrganisations({
      id: orgId,
      tenant_id: f.tenant_id,
      canonical_organisation_id: f.organisation_id,
      engine_instance_id: f.engine_instance_id,
      legal_name: "Synthetic DEV07 HTTP buyer",
      link_provenance: `dev07-bff-http:${f.run_id}`,
      status: "ACTIVE",
    })
    await b2b.createBuyerMemberships({
      id: memberId,
      organisation_id: orgId,
      principal_id: f.principal_id,
      status: "ACTIVE",
    })
    await b2b.createBuyerRoles({ id: roleId, membership_id: memberId, role: "BUYER" })
    // The Store router requires a real native publishable key even for this
    // custom IAM route. It carries no buyer or canonical estate authority.
    const key = await apiKeys.createApiKeys({
      title: keyTitle,
      type: "publishable",
      created_by: `dev07:${f.run_id}`,
    })
    assert.ok(/^pk_[A-Za-z0-9_-]{16,512}$/.test(key.token))
    writeFileSync(
      "/run/dev07-bff-native/store-key.json",
      JSON.stringify({ key_id: key.id, publishable_key: key.token }),
      { flag: "wx", mode: 0o600 },
    )
  } else if (phase === "cleanup") {
    for (const key of keys) await cleanupFixturePublishableKey(apiKeys, key.id, f.run_id)
    assert.equal((await apiKeys.listApiKeys({ title: keyTitle, type: "publishable" })).length, 0)
    if (roles.length) await b2b.softDeleteBuyerRoles(roleId)
    if (members.length) await b2b.softDeleteBuyerMemberships(memberId)
    if (orgs.length) await b2b.softDeleteB2BOrganisations(orgId)
    assert.equal((await b2b.listBuyerRoles({ id: roleId })).length, 0)
    assert.equal((await b2b.listBuyerMemberships({ id: memberId })).length, 0)
    assert.equal((await b2b.listB2BOrganisations({ id: orgId })).length, 0)
  } else {
    assert.ok(orgs.length === 1 && members.length === 1 && roles.length === 1)
    await b2b.updateBuyerMemberships({
      id: memberId,
      status: phase === "suspend" ? "SUSPENDED" : "ACTIVE",
    })
  }
  console.log(`DEV07_BFF_NATIVE_${phase?.toUpperCase()}_OBSERVED`)
}
