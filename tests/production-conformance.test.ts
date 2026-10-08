import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import controls from "../conformance/production-controls.json"
const read = (path: string) => readFileSync(path, "utf8")
describe("Gate 17 production conformance", () => {
  it("pins the approved runtime and delivery semantics", () => {
    expect(controls.runtime.nodeMajor).toBe(24)
    expect(controls.architecture.deliverySemantics).toBe("at-least-once")
    expect(controls.architecture.crossEngineDatabaseAccess).toBe(false)
  })
  it("keeps every required operations document in version control", () =>
    controls.requiredDocumentation.forEach((path) => expect(existsSync(path), path).toBe(true)))
  it("runs all staged integration checks on a fresh database", () => {
    const ci = read(".github/workflows/ci.yml")
    ;[
      "verify:core-modules",
      "verify:erp-integration",
      "verify:event-outbox",
      "verify:thamani-market",
    ].forEach((command) => expect(ci).toContain(command))
  })
  it("tests production-provider migrations", () =>
    expect(read(".github/workflows/ci.yml")).toContain(
      "Apply Medusa migrations with production providers",
    ))
  it("keeps security and foundation scanning enabled", () => {
    expect(read(".github/workflows/security.yml")).toContain("security-codeql.yml")
    expect(read(".github/workflows/foundation.yml")).toContain("foundation-repository-gates.yml")
  })
  it("does not configure cross-engine database credentials", () => {
    const runtime = read("runtime/requirements.yaml")
    expect(runtime).not.toMatch(/IDEMPIERE_(?:DATABASE|DB)_URL|ERP_(?:DATABASE|DB)_URL/)
    expect(runtime).toContain("Do not share databases")
  })
  it("produces reproducible release evidence: an immutable image tag and a release manifest", () => {
    expect(controls.requiredChecks).toContain("release-manifest")
    const releaseReadiness = read(".github/workflows/release-readiness.yml")
    expect(releaseReadiness).toContain("npm run release:manifest")
    expect(releaseReadiness).toContain('docker build --tag "baobab-trade:${{ github.sha }}"')
    expect(releaseReadiness).toContain("actions/upload-artifact@")
  })
})
