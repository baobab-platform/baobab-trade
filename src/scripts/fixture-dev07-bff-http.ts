/** Native Trade records for the leased, independently provisioned CP buyer.
 * This CLI is never a route or a source of canonical identity/permission.
 * The actual HTTP handler must still verify current IAM and CP on every call.
 */
import assert from "node:assert/strict"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import type { ExecArgs, IApiKeyModuleService } from "@medusajs/framework/types"
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
  assert.ok(["prepare", "suspend", "resume", "cleanup"].includes(phase ?? ""))
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
