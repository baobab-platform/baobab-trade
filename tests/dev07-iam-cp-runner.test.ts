/** Source-only fault injection. These fakes can never qualify a runtime. */
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import qualify from "../src/scripts/qualify-dev07-iam-cp"
import { PrincipalResolutionError } from "../src/baobab/control-plane/principal-resolution"

const blocked = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("../src/baobab/control-plane/principal-resolution", async (original) => {
  const exports =
    await original<typeof import("../src/baobab/control-plane/principal-resolution")>()
  return { ...exports, getBuyerPrincipalResolver: () => blocked }
})
vi.mock("../src/baobab/control-plane/estate-binding", async (original) => ({
  ...(await original<typeof import("../src/baobab/control-plane/estate-binding")>()),
  getEstateBindingResolver: () => ({ resolve: vi.fn() }),
}))
vi.mock("../src/baobab/control-plane/workload-tenant-verifier", async (original) => ({
  ...(await original<typeof import("../src/baobab/control-plane/workload-tenant-verifier")>()),
  getWorkloadTenantVerifier: () => ({ verifyOrganisationTenant: vi.fn() }),
}))

const ISSUER = "https://iam.example.test"
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 })
const paths: string[] = []
const cwd = process.cwd()
afterEach(() => {
  process.chdir(cwd)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("DEV07 driver fail-closed orchestration (not runtime evidence)", () => {
  it("retains a missing CP scope as BLOCKED and revokes every issued bearer with independent readback", async () => {
    const root = mkdtempSync(join(tmpdir(), "dev07-identity-source-"))
    paths.push(root)
    // The source identity remains real; only report output is redirected.
    const { execFileSync } = await import("node:child_process")
    execFileSync("git", ["init", "-q", root])
    execFileSync("git", ["-C", root, "config", "user.email", "synthetic@example.invalid"])
    execFileSync("git", ["-C", root, "config", "user.name", "Synthetic source test"])
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "source test only"])
    const packet = join(root, "code-packet.json")
    const auth = {
      code: "synthetic-code",
      verifier: "v".repeat(43),
      redirect_uri: "https://bff.example.test/callback",
    }
    writeFileSync(
      packet,
      JSON.stringify({
        schema: "baobab-trade.dev07-code-packet.v1",
        deadline: new Date(Date.now() + 600_000).toISOString(),
        bff_client_id: "synthetic-bff",
        bff_client_secret: "private-source-secret",
        verifier_client_id: "synthetic-verifier",
        verifier_client_secret: "private-reader-secret",
        organisation_id: "019a0915-a8c0-7000-8000-00000000a001",
        other_organisation_id: "019a0915-a8c0-7000-8000-00000000a002",
        country_code: "UG",
        codes: { buyer: auth, wrong_audience: { ...auth, code: "wrong-code" } },
      }),
      { mode: 0o600 },
    )
    for (const [key, value] of Object.entries({
      NODE_ENV: "test",
      BAOBAB_ENVIRONMENT: "development",
      BAOBAB_DEV07_TEST_DB: "dev07_source_test",
      DATABASE_URL: "postgres://unused@localhost/dev07_source_test",
      BAOBAB_DEV07_CODE_PACKET: packet,
      BAOBAB_BUYER_IDENTITY_ENABLED: "true",
      BAOBAB_IAM_BUYER_ISSUER: ISSUER,
      BAOBAB_IAM_BUYER_AUTHORISED_PARTIES: "synthetic-bff",
      BAOBAB_CONTROL_PLANE_BASE_URL: "https://cp.example.test",
    }))
      vi.stubEnv(key, value)
    const issued = new Map<string, Record<string, unknown>>()
    const revoked = new Set<string>()
    let count = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        const path = new URL(url).pathname
        if (path === "/.well-known/openid-configuration")
          return Response.json({
            issuer: ISSUER,
            jwks_uri: ISSUER + "/jwks",
            token_endpoint: ISSUER + "/token",
            revocation_endpoint: ISSUER + "/revoke",
          })
        if (path === "/jwks")
          return Response.json({
            keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic", use: "sig" }],
          })
        const fields = new URLSearchParams(init?.body as URLSearchParams)
        if (path === "/token") {
          const human = fields.get("grant_type") === "authorization_code"
          const now = Math.floor(Date.now() / 1000)
          const body = {
            iss: ISSUER,
            sub: human ? "synthetic-human" : "synthetic-bff",
            client_id: "synthetic-bff",
            azp: "synthetic-bff",
            actor_type: human ? "human" : "workload",
            scope: human ? "trade:buy" : "trade:buyer-handoff",
            aud: ["baobab-trade"],
            iat: now,
            exp: now + 300,
            jti: `synthetic-${++count}`,
          }
          const input = [{ alg: "RS256", kid: "synthetic" }, body]
            .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
            .join(".")
          const bearer =
            input +
            "." +
            sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString("base64url")
          issued.set(bearer, body)
          issued.set(`refresh-${count}`, body)
          return Response.json({
            access_token: bearer,
            refresh_token: `refresh-${count}`,
            expires_in: 300,
          })
        }
        const bearer = fields.get("token") ?? ""
        if (path === "/revoke") {
          revoked.add(bearer)
          return new Response(null, { status: 200 })
        }
        // Hydra exposes introspection through its protected native route, not OIDC discovery.
        if (path === "/oauth2/introspect") {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Basic " + Buffer.from("synthetic-verifier:private-reader-secret").toString("base64"),
          )
          return Response.json({ ...issued.get(bearer), active: !revoked.has(bearer) })
        }
        throw new Error("unexpected source-test transport")
      }),
    )
    blocked.resolve.mockRejectedValue(new PrincipalResolutionError("CALLER_NOT_PERMITTED"))
    const create = vi.fn()
    process.chdir(root)
    mkdirSync("artifacts", { recursive: true })
    await expect(
      qualify({ container: { resolve: () => ({ createB2BOrganisations: create }) } } as never),
    ).rejects.toThrow("DEV07_IAM_CP_NOT_QUALIFIED")
    expect(create).not.toHaveBeenCalled()
    expect(issued.size).toBe(4)
    expect(revoked.size).toBe(issued.size)
    const report = JSON.parse(readFileSync("artifacts/dev07-iam-cp/report.json", "utf8"))
    expect(report.cases["cp-principal-estate-organisation-market"]).toEqual({
      result: "BLOCKED",
      reason: "AUTHORITY_NOT_CONFIGURED",
    })
    expect(report.cases["owned-buyer-bff-native-cleanup"].result).toBe("PASS")
    expect(report.iam_cp_component_qualified).toBe(false)
    expect(report.int05_qualified).toBe(false)
    expect(JSON.stringify(report)).not.toContain("private-source-secret")
    expect(JSON.stringify(report)).not.toContain("synthetic-human")
  })
})
