import { describe, expect, it } from "vitest"
import {
  developmentEndpoint,
  DEV07_IDENTITY_CASES,
  identityReport,
  issuerReadbackMatches,
} from "../src/baobab/development/dev07-iam-cp"

const NOW = Date.parse("2026-10-27T06:00:00Z")
const token = {
  subject: "synthetic-subject",
  clientId: "synthetic-bff",
  expiresAt: new Date(NOW + 60_000),
}
const active = {
  active: true,
  iss: "https://iam.example.test",
  sub: token.subject,
  client_id: token.clientId,
  aud: ["baobab-trade"],
  scope: "openid trade:buy",
  exp: (NOW + 60_000) / 1000,
}
const matches = (change: Record<string, unknown> = {}, now = NOW) =>
  issuerReadbackMatches(
    { ...active, ...change },
    token,
    active.iss,
    "baobab-trade",
    "trade:buy",
    now,
  )

describe("DEV07 live issuer/CP qualification evidence boundary (source tests only)", () => {
  it("does not initialize any PASS or connected qualification from source presence", () => {
    const r = identityReport("a".repeat(40))
    expect(Object.keys(r.cases)).toEqual(DEV07_IDENTITY_CASES)
    expect(Object.values(r.cases).every((c) => c.result === "BLOCKED")).toBe(true)
    expect(r.iam_cp_component_qualified).toBe(false)
    expect(r.int05_qualified).toBe(false)
    expect(r.bff_http_qualified).toBe(false)
    expect(r.host_teardown).toBe("NOT_OBSERVED")
    expect(r.production_authorized).toBe(false)
    expect(() => identityReport("main")).toThrow()
  })

  it("binds independent introspection to the verified subject, client, exact issuer, audience and expiry", () => {
    expect(matches()).toBe(true)
    expect(matches({ aud: "baobab-trade" })).toBe(true)
    for (const change of [
      { active: false },
      { active: "true" },
      { sub: "another-human" },
      { client_id: "another-bff" },
      { iss: active.iss + "/" },
      { aud: "baobab-control-plane" },
      { aud: ["baobab-trade", "baobab-control-plane"] },
      { exp: active.exp + 1 },
      { exp: String(active.exp) },
      { scope: "openid trade:buyer" },
      { scope: undefined },
    ])
      expect(matches(change)).toBe(false)
    expect(matches({}, NOW + 60_000)).toBe(false)
    expect(matches({}, NaN)).toBe(false)
    expect(issuerReadbackMatches(null, token, active.iss, "baobab-trade", "trade:buy", NOW)).toBe(
      false,
    )
  })

  it("refuses protected-looking, insecure and credential-bearing qualification endpoints", () => {
    expect(developmentEndpoint("https://cp.baobab-dev.test").hostname).toBe("cp.baobab-dev.test")
    for (const value of [
      undefined,
      "http://cp.baobab-dev.test",
      "https://cp.example.com",
      "https://user:secret@cp.example.test",
      "https://cp.example.test?secret=value",
      "https://cp.example.test#fragment",
      "not a url",
    ]) {
      expect(() => developmentEndpoint(value)).toThrow()
    }
  })
})
