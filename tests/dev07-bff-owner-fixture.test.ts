import { describe, expect, it, vi } from "vitest"
import type { IApiKeyModuleService } from "@medusajs/framework/types"
import {
  cleanupFixturePublishableKey,
  validateOwnerFixture,
} from "../src/scripts/fixture-dev07-bff-http"

const now = Date.parse("2026-10-29T00:00:00Z")
const fixture = {
  run_id: "a".repeat(32),
  tenant_id: "tn_synthetic",
  organisation_id: "019a0915-a8c0-7000-8000-000000000001",
  principal_id: "019a0915-a8c0-7000-8000-000000000002",
  engine_instance_id: "ei_synthetic",
  expires_at: new Date(now + 600000).toISOString(),
  synthetic_only: true,
  protected_acceptance: false,
}
const env = {
  NODE_ENV: "test",
  BAOBAB_ENVIRONMENT: "development",
  BAOBAB_DEV07_RUN_ID: fixture.run_id,
  BAOBAB_DEV07_TEST_DB: "dev07_bff_aaaaaaaaaaaa_test",
  DATABASE_URL: "postgres://synthetic:private@db/dev07_bff_aaaaaaaaaaaa_test",
  BAOBAB_TRADE_ENGINE_INSTANCE_ID: fixture.engine_instance_id,
}
describe("native BFF fixture boundary (synthetic source tests only)", () => {
  it("accepts the exact owner run and disposable database", () => {
    expect(validateOwnerFixture(fixture, env, now)).toEqual(fixture)
  })
  it("refuses protected, foreign, unbounded and expired input", () => {
    for (const patch of [
      { run_id: "b".repeat(32) },
      { synthetic_only: false },
      { protected_acceptance: true },
      { principal_id: "email@example.invalid" },
      { engine_instance_id: "ei_foreign" },
      { expires_at: new Date(now).toISOString() },
      { expires_at: new Date(now + 3600001).toISOString() },
      { extra: true },
    ])
      expect(() => validateOwnerFixture({ ...fixture, ...patch }, env, now)).toThrow()
    for (const patch of [
      { NODE_ENV: "production" },
      { BAOBAB_ENVIRONMENT: "staging" },
      { DATABASE_URL: "postgres://db/production" },
      { BAOBAB_DEV07_RUN_ID: "other" },
    ])
      expect(() => validateOwnerFixture(fixture, { ...env, ...patch }, now)).toThrow()
    expect(() => validateOwnerFixture(fixture, env, NaN)).toThrow()
  })
})

describe("native publishable fixture key cleanup", () => {
  function service(change: Record<string, unknown> = {}, future = false) {
    const events: string[] = []
    let revoked = false
    const key = {
      id: "apk_fixture",
      title: `DEV07 BFF HTTP ${fixture.run_id}`,
      type: "publishable",
      created_by: `dev07:${fixture.run_id}`,
      ...change,
    }
    const api = {
      retrieveApiKey: vi.fn(async () => {
        events.push("read")
        return {
          ...key,
          revoked_by: revoked ? `dev07:${fixture.run_id}` : null,
          revoked_at: revoked ? new Date(Date.now() + (future ? 60000 : -100)) : null,
        }
      }),
      revoke: vi.fn(async () => {
        events.push("revoke")
        revoked = true
      }),
      deleteApiKeys: vi.fn(async () => {
        if (!revoked) throw new Error("native API refuses unrevoked key deletion")
        events.push("delete")
      }),
    }
    return { api, events, module: api as unknown as IApiKeyModuleService }
  }

  it("revokes and independently reads back before native deletion", async () => {
    const s = service()
    await cleanupFixturePublishableKey(s.module, "apk_fixture", fixture.run_id)
    expect(s.api.revoke).toHaveBeenCalledWith("apk_fixture", {
      revoked_by: `dev07:${fixture.run_id}`,
      revoke_in: 0,
    })
    expect(s.events).toEqual(["read", "revoke", "read", "delete"])
  })

  it("cannot delete foreign, secret or future-revoked keys", async () => {
    for (const patch of [
      { created_by: "another-run" },
      { title: "another fixture" },
      { type: "secret" },
      { id: "apk_foreign" },
    ]) {
      const s = service(patch)
      await expect(
        cleanupFixturePublishableKey(s.module, "apk_fixture", fixture.run_id),
      ).rejects.toThrow()
      expect(s.api.revoke).not.toHaveBeenCalled()
      expect(s.api.deleteApiKeys).not.toHaveBeenCalled()
    }
    const s = service({}, true)
    await expect(
      cleanupFixturePublishableKey(s.module, "apk_fixture", fixture.run_id),
    ).rejects.toThrow()
    expect(s.api.deleteApiKeys).not.toHaveBeenCalled()
  })

  it("retains failure when revocation cannot be observed", async () => {
    const s = service()
    s.api.revoke.mockRejectedValueOnce(new Error("native revocation unavailable"))
    await expect(
      cleanupFixturePublishableKey(s.module, "apk_fixture", fixture.run_id),
    ).rejects.toThrow()
    expect(s.api.deleteApiKeys).not.toHaveBeenCalled()
  })
})
