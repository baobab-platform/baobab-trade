/**
 * Supplemental DEV-07 native read evidence. Uses actual migrated Medusa/PG17
 * rows, with a deterministic resolver clock; no IAM/CP evidence is substituted.
 * Kept separate from the immutable 16 PASS / 9 BLOCKED receipt inventory.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import type { ExecArgs } from "@medusajs/framework/types"
import type B2BModuleService from "../modules/b2b/service"
import { resolveBuyerContext } from "../baobab/b2b/context-resolver"
import { assertActiveBuyerContext } from "../baobab/b2b/policy"

const CASES = [
  "active-membership",
  "start-inclusive",
  "end-exclusive",
  "future-refused",
  "expired-refused",
  "foreign-organisation-refused",
  "foreign-customer-refused",
  "revoked-membership-refused",
  "role-change-revision",
  "membership-change-revision",
  "active-fixture-absence",
] as const

export default async function ({ container }: ExecArgs) {
  const output = "artifacts/dev07-buyer-context"
  for (const name of ["report.json", "report.sha256.json"])
    rmSync(`${output}/${name}`, { force: true })
  const expected = process.env.BAOBAB_DEV07_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected?.endsWith("_test") ||
    !process.env.DATABASE_URL ||
    new URL(process.env.DATABASE_URL).pathname !== `/${expected}`
  ) {
    throw new Error("DEV07_REQUIRES_EXPLICIT_DISPOSABLE_TEST_DATABASE")
  }
  const b2b = container.resolve<B2BModuleService>("b2b")
  const nonce = randomUUID()
  const customer = `dev07_context_${nonce}`
  const tenant = `dev07_context_${nonce}`
  const now = Date.now()
  const passed: string[] = []
  const cleanups: Array<() => Promise<unknown>> = []
  const absence: Array<() => Promise<unknown[]>> = []
  try {
    const org = await b2b.createB2BOrganisations({
      tenant_id: tenant,
      legal_name: "Synthetic DEV07 read buyer",
      status: "ACTIVE",
    })
    cleanups.push(() => b2b.softDeleteB2BOrganisations(org.id))
    absence.push(() => b2b.listB2BOrganisations({ id: org.id }))
    const member = await b2b.createBuyerMemberships({
      organisation_id: org.id,
      customer_id: customer,
      principal_id: randomUUID(),
      status: "ACTIVE",
    })
    cleanups.push(() => b2b.softDeleteBuyerMemberships(member.id))
    absence.push(() => b2b.listBuyerMemberships({ id: member.id }))
    const originalRevision = (await b2b.retrieveBuyerMembership(member.id)).revision
    const role = await b2b.createBuyerRoles({ membership_id: member.id, role: "BUYER" })
    cleanups.push(() => b2b.softDeleteBuyerRoles(role.id))
    absence.push(() => b2b.listBuyerRoles({ id: role.id }))
    const roleRevision = (await b2b.retrieveBuyerMembership(member.id)).revision
    assert(roleRevision > originalRevision, "role insert must change membership revision")
    passed.push("role-change-revision")
    const read = () => resolveBuyerContext(b2b, org.id, customer, () => now)
    const active = await read()
    assert(active)
    assertActiveBuyerContext(active, org.id)
    assert.deepEqual(active.roles, ["BUYER"])
    passed.push("active-membership")
    await b2b.updateBuyerMemberships({
      id: member.id,
      effective_from: new Date(now),
      effective_until: new Date(now + 1000),
    })
    assert((await b2b.retrieveBuyerMembership(member.id)).revision > roleRevision)
    passed.push("membership-change-revision")
    assert(await read())
    passed.push("start-inclusive")
    await b2b.updateBuyerMemberships({
      id: member.id,
      effective_from: new Date(now - 1000),
      effective_until: new Date(now),
    })
    assert.equal(await read(), null)
    passed.push("end-exclusive")
    await b2b.updateBuyerMemberships({
      id: member.id,
      effective_from: new Date(now + 1000),
      effective_until: new Date(now + 2000),
    })
    assert.equal(await read(), null)
    passed.push("future-refused")
    await b2b.updateBuyerMemberships({
      id: member.id,
      effective_from: new Date(now - 2000),
      effective_until: new Date(now - 1000),
    })
    assert.equal(await read(), null)
    passed.push("expired-refused")
    await b2b.updateBuyerMemberships({ id: member.id, effective_from: null, effective_until: null })
    assert.equal(await resolveBuyerContext(b2b, `other_${org.id}`, customer, () => now), null)
    passed.push("foreign-organisation-refused")
    assert.equal(await resolveBuyerContext(b2b, org.id, `other_${customer}`, () => now), null)
    passed.push("foreign-customer-refused")
    await b2b.updateBuyerMemberships({ id: member.id, status: "REVOKED" })
    const revoked = await read()
    assert(revoked)
    assert.throws(() => assertActiveBuyerContext(revoked, org.id), /Active organisation membership/)
    passed.push("revoked-membership-refused")
  } finally {
    // Attempt all cleanup operations even after a failed observation. Never
    // publish completion until independent active-row readback succeeds.
    const failures: unknown[] = []
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const check of absence) {
      try {
        assert.equal((await check()).length, 0)
      } catch (error) {
        failures.push(error)
      }
    }
    assert.equal(failures.length, 0, "DEV07_CONTEXT_CLEANUP_FAILED")
  }
  passed.push("active-fixture-absence")
  assert.equal(new Set(passed).size, CASES.length)
  assert.equal(passed.length, CASES.length)
  assert(CASES.every((name) => passed.includes(name)))
  const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  assert(/^[0-9a-f]{40}$/.test(source))
  const report = {
    schema: "baobab-trade.dev07-native-buyer-context.v1",
    source_sha: source,
    evidence_class: "REAL_COMPONENT_SYNTHETIC_DATA",
    scope: "NATIVE_MEDUSA_POSTGRES_LEGACY_READ_ONLY",
    synthetic_principal_reference_only: true,
    current_iam_cp_buyer_qualified: false,
    int05_qualified: false,
    provider_qualified: false,
    protected_acceptance: false,
    production_authorized: false,
    cases: Object.fromEntries(
      CASES.map((name) => [name, { result: "PASS", reason: "OBSERVED_NATIVE_COMPONENT" }]),
    ),
  }
  const data = JSON.stringify(report, null, 2) + "\n"
  mkdirSync(output, { recursive: true })
  writeFileSync(`${output}/report.json`, data)
  writeFileSync(
    `${output}/report.sha256.json`,
    JSON.stringify({ sha256: createHash("sha256").update(data).digest("hex") }) + "\n",
  )
  console.log("DEV07_NATIVE_BUYER_CONTEXT_OBSERVED_INT05_BLOCKED")
}
