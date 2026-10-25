/**
 * DEV-07's currently runnable native components on Medusa + disposable PG17.
 * No IAM token/CP response is faked. Local Principal references and market
 * projections are explicitly NOT canonical buyer/market authority. The joined
 * INT-05 obligations stay BLOCKED until their real owners can supply them.
 */
import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import type { ExecArgs, IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type B2BModuleService from "../modules/b2b/service"
import { resolveBuyerContext } from "../baobab/b2b/context-resolver"
import { assertActiveBuyerContext } from "../baobab/b2b/policy"
import {
  loadBuyerOperationPolicy,
  type B2BPolicyStore,
} from "../baobab/b2b/buyer-operation-policy-source"
import {
  evaluateBuyerOperation,
  type BuyerOperationFacts,
} from "../baobab/b2b/buyer-operation-policy"
import { ZURIBEANS_CATALOGUE } from "../baobab/catalogue"
import { GET as assortment } from "../api/store/b2b/assortment/route"
import { dev07Report } from "../baobab/development/dev07-report"

export default async function ({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_DEV07_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected?.endsWith("_test") ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error("DEV07_REQUIRES_EXPLICIT_DISPOSABLE_TEST_DATABASE")
  }
  const b2b = container.resolve<B2BModuleService>("b2b")
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const passed: string[] = []
  const cleanups: Array<() => Promise<unknown>> = []
  const absenceChecks: Array<() => Promise<unknown[]>> = []
  const pass = (name: string) => passed.push(name)
  const run = randomUUID()
  const tenant = `dev07_${run}`
  const principal = randomUUID() // Only a synthetic local reference, never a CP-issued identity.
  const customer = `dev07_customer_${run}`
  const now = new Date()
  const before = new Date(now.getTime() - 60_000)
  const after = new Date(now.getTime() + 3_600_000)
  const cleanupFailures: unknown[] = []
  try {
    const own = await b2b.createB2BOrganisations({
      tenant_id: tenant,
      legal_name: "Synthetic DEV07 buyer",
      status: "ACTIVE",
    })
    cleanups.push(() => b2b.softDeleteB2BOrganisations(own.id))
    const other = await b2b.createB2BOrganisations({
      tenant_id: `other_${tenant}`,
      legal_name: "Unrelated synthetic buyer",
      status: "ACTIVE",
    })
    cleanups.push(() => b2b.softDeleteB2BOrganisations(other.id))
    assert.notEqual(own.id, other.id)
    assert.notEqual(own.tenant_id, other.tenant_id)
    assert.equal((await b2b.retrieveB2BOrganisation(own.id)).canonical_organisation_id, null)
    pass("independent-buyer-relationships")
    const member = await b2b.createBuyerMemberships({
      organisation_id: own.id,
      customer_id: customer,
      principal_id: principal,
      status: "ACTIVE",
    })
    cleanups.push(() => b2b.softDeleteBuyerMemberships(member.id))
    absenceChecks.push(() => b2b.listBuyerMemberships({ id: member.id }))
    const role = await b2b.createBuyerRoles({ membership_id: member.id, role: "BUYER" })
    cleanups.push(() => b2b.softDeleteBuyerRoles(role.id))
    absenceChecks.push(() => b2b.listBuyerRoles({ id: role.id }))
    const grant = await b2b.createBuyerRoleMarketScopes({
      buyer_role_id: role.id,
      market_key: "zuribeans_ug",
      granted_by_principal_id: principal,
      evidence_reference: "synthetic/dev07/component-only",
    })
    // Grants are append-only authority history: revoke, never delete. Keep
    // their referenced role soft-deleted until the disposable DB is destroyed.
    cleanups.push(() =>
      b2b.updateBuyerRoleMarketScopes({
        id: grant.id,
        status: "REVOKED",
        revoked_at: new Date(),
        revoked_by_principal_id: principal,
        revocation_reason: "synthetic fixture teardown",
      }),
    )
    absenceChecks.push(async () => {
      assert.equal((await b2b.retrieveBuyerRoleMarketScope(grant.id)).status, "REVOKED")
      return []
    })
    const context = await resolveBuyerContext(b2b, own.id, customer)
    assert(context)
    assert.equal(context.principalId, principal)
    pass("persisted-principal-reference")
    assert.equal(await resolveBuyerContext(b2b, other.id, customer), null)
    pass("other-buyer-relationship-refused")
    assert.equal(await resolveBuyerContext(b2b, own.id, `unknown_${customer}`), null)
    pass("unknown-customer-refused")
    const loaded = await loadBuyerOperationPolicy(b2b as unknown as B2BPolicyStore, {
      organisationId: own.id,
      membershipId: member.id,
      marketKey: "zuribeans_ug",
      siteIds: [],
      now,
    })
    assert.notEqual(loaded.roles, "UNAVAILABLE")
    assert.deepEqual(
      loaded.roles !== "UNAVAILABLE" && loaded.roles.flatMap((r) => r.markets.map((m) => m.key)),
      ["zuribeans_ug"],
    )
    pass("role-bound-market-grants")
    const facts: BuyerOperationFacts = {
      ...loaded,
      operation: "trade.private-catalogue.view",
      now,
      principalId: principal,
      organisationId: own.id,
      membershipId: member.id,
      membership: { status: "ACTIVE", effectiveFrom: null, effectiveUntil: null },
      marketKey: "zuribeans_ug",
      marketAuthority: "UNAVAILABLE",
      sites: [],
      purchaseOrder:
        loaded.purchaseOrderRule === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : { rule: loaded.purchaseOrderRule },
    }
    assert.deepEqual(evaluateBuyerOperation({ ...facts, roles: [] }), {
      outcome: "DENY",
      reasons: ["ROLE_NOT_PERMITTED"],
    })
    pass("absent-role-refused")
    // Never manufacture ATTESTED from the local market projection/grant.
    assert.deepEqual(evaluateBuyerOperation(facts), {
      outcome: "UNAVAILABLE",
      reasons: ["SOURCE_UNAVAILABLE"],
    })
    pass("missing-canonical-market-fails-closed")
    await b2b.updateBuyerMemberships({ id: member.id, status: "REVOKED" })
    const revoked = await resolveBuyerContext(b2b, own.id, customer)
    assert(revoked)
    assert.throws(() => assertActiveBuyerContext(revoked, own.id), /Active organisation membership/)
    pass("revoked-membership-refused")

    const catalogue = await products.listProducts({
      handle: ZURIBEANS_CATALOGUE.map((p) => p.handle),
    })
    assert.equal(catalogue.length, 10)
    assert(catalogue.some((p) => p.handle.includes("vanilla")))
    for (const [key, name] of [
      ["zuribeans_ug", "ug-native-catalogue"],
      ["zuribeans_za", "za-native-catalogue"],
    ]) {
      const rows = await b2b.listMarketProductEligibilities({
        market_key: key,
        product_id: catalogue.map((p) => p.id),
      })
      assert.equal(rows.length, 10)
      assert(rows.every((r) => r.market_key === key))
      pass(name)
    }
    const product = await products.createProducts({
      title: `Synthetic DEV07 ${run}`,
      handle: `dev07-${run}`,
    })
    cleanups.push(() => products.deleteProducts([product.id]))
    const eligibility = await b2b.createMarketProductEligibilities({
      product_id: product.id,
      market_key: "zuribeans_ug",
      status: "ACTIVE",
      regulatory_eligibility: "ELIGIBLE",
      effective_from: before,
      effective_until: after,
    })
    cleanups.push(() => b2b.deleteMarketProductEligibilities(eligibility.id))
    absenceChecks.push(() => b2b.listMarketProductEligibilities({ id: eligibility.id }))
    const invoke = async (query: Record<string, string>) => {
      let body: { sellable_product_ids: string[] } | undefined
      const req = { query, scope: { resolve: () => b2b } }
      const res = {
        setHeader: () => {},
        status: () => res,
        json: (value: typeof body) => {
          body = value
        },
      }
      await assortment(req as never, res as never)
      assert(body)
      return body
    }
    for (const value of ["false", "0", "invalid"]) {
      await assert.rejects(
        () => invoke({ market_key: "zuribeans_ug", require_regulatory_clearance: value }),
        /clearance is mandatory/,
      )
    }
    pass("public-clearance-cannot-be-relaxed")
    assert((await invoke({ market_key: "zuribeans_ug" })).sellable_product_ids.includes(product.id))
    assert(
      !(await invoke({ market_key: "zuribeans_za" })).sellable_product_ids.includes(product.id),
    )
    pass("current-market-assortment")
    await b2b.updateMarketProductEligibilities({ id: eligibility.id, effective_until: before })
    assert(
      !(await invoke({ market_key: "zuribeans_ug" })).sellable_product_ids.includes(product.id),
    )
    pass("expired-market-assortment-refused")
    await b2b.updateMarketProductEligibilities({
      id: eligibility.id,
      effective_from: after,
      effective_until: new Date(after.getTime() + 60_000),
    })
    assert(
      !(await invoke({ market_key: "zuribeans_ug" })).sellable_product_ids.includes(product.id),
    )
    pass("future-market-assortment-refused")
    await b2b.updateMarketProductEligibilities({
      id: eligibility.id,
      status: "WITHDRAWN",
      effective_from: before,
      effective_until: after,
    })
    assert(
      !(await invoke({ market_key: "zuribeans_ug" })).sellable_product_ids.includes(product.id),
    )
    pass("withdrawn-market-assortment-refused")
  } finally {
    // Attempt every cleanup, including when an assertion fails. Do not publish
    // completed evidence unless active fixture absence is independently read back.
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    assert.equal(cleanupFailures.length, 0, "DEV07_FIXTURE_CLEANUP_FAILED")
    for (const check of absenceChecks) assert.equal((await check()).length, 0)
    assert.equal(
      (await b2b.listB2BOrganisations({ tenant_id: [tenant, `other_${tenant}`] })).length,
      0,
    )
    assert.equal((await b2b.listBuyerMemberships({ customer_id: customer })).length, 0)
    assert.equal((await products.listProducts({ handle: `dev07-${run}` })).length, 0)
  }
  pass("owned-active-fixtures-removed")
  const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const report = dev07Report(passed, source)
  mkdirSync("artifacts/dev07", { recursive: true })
  const data = JSON.stringify(report, null, 2) + "\n"
  writeFileSync("artifacts/dev07/report.json", data)
  writeFileSync(
    "artifacts/dev07/report.sha256.json",
    JSON.stringify({ sha256: createHash("sha256").update(data).digest("hex") }) + "\n",
  )
  console.log("DEV07_NATIVE_COMPONENTS_OBSERVED_INT05_BLOCKED")
}
