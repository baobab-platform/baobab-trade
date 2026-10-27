/**
 * Real IAM-issued buyer + workload evidence against real CP and native Trade.
 * This command never signs a token, writes CP SQL, edits a registry or invents
 * an attestation. Missing scope/binding/current authority remains BLOCKED.
 * Input is a private one-use OAuth code packet supplied by the disposable
 * topology owner, never a tracked fixture or command-line credential.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type { ExecArgs } from "@medusajs/framework/types"
import type B2BModuleService from "../modules/b2b/service"
import { POST } from "../api/store/b2b/buyer-context/route"
import { BuyerTokenVerifier } from "../baobab/auth/buyer-access-token"
import { getBaobabTradeEnvironment } from "../baobab/config/environment"
import {
  PrincipalResolutionError,
  getBuyerPrincipalResolver,
} from "../baobab/control-plane/principal-resolution"
import {
  EstateBindingError,
  getEstateBindingResolver,
} from "../baobab/control-plane/estate-binding"
import { getWorkloadTenantVerifier } from "../baobab/control-plane/workload-tenant-verifier"
import {
  developmentEndpoint,
  DEV07_IDENTITY_CASES,
  identityReport,
  issuerReadbackMatches,
  IdentityQualificationError,
  type IdentityCase,
} from "../baobab/development/dev07-iam-cp"

type Packet = {
  schema: "baobab-trade.dev07-code-packet.v1"
  deadline: string
  bff_client_id: string
  bff_client_secret: string
  verifier_client_id: string
  verifier_client_secret: string
  organisation_id: string
  other_organisation_id: string
  country_code: "UG" | "ZA"
  codes: { buyer: Code; wrong_audience: Code & { client_id: string; client_secret: string } }
}
type Code = { code: string; verifier: string; redirect_uri: string }
const OUTPUT = "artifacts/dev07-iam-cp"
const requireObserved = (ok: unknown) => {
  if (!ok) throw new IdentityQualificationError("ASSERTION_FAILED")
}

export default async function ({ container }: ExecArgs) {
  for (const file of ["report.json", "report.sha256.json"])
    rmSync(`${OUTPUT}/${file}`, { force: true })
  const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const report = identityReport(source)
  let current: IdentityCase = DEV07_IDENTITY_CASES[0]
  const pass = (name: IdentityCase) => {
    report.cases[name] = { result: "PASS", reason: "OBSERVED" }
  }
  const b2b = container.resolve<B2BModuleService>("b2b")
  const cleanup: Array<() => Promise<unknown>> = []
  const absent: Array<() => Promise<unknown[]>> = []
  const tokens: string[] = []
  const refreshTokens: string[] = []
  let packet: Packet | undefined
  let revoke:
    ((token: string, hint?: "access_token" | "refresh_token") => Promise<void>) | undefined
  let introspect: ((token: string) => Promise<unknown>) | undefined
  let completed = false
  try {
    const env = getBaobabTradeEnvironment()
    const db = process.env.DATABASE_URL
    const expected = process.env.BAOBAB_DEV07_TEST_DB
    const file = process.env.BAOBAB_DEV07_CODE_PACKET
    if (
      env.deploymentEnvironment !== "development" ||
      process.env.NODE_ENV !== "test" ||
      !expected?.endsWith("_test") ||
      !db ||
      new URL(db).pathname !== `/${expected}` ||
      !file ||
      !env.buyerIdentityEnabled ||
      !env.buyerIamIssuer ||
      !env.controlPlaneBaseUrl
    ) {
      throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
    }
    const stat = lstatSync(file)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 32768 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.()
    )
      throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    assert(value && typeof value === "object" && !Array.isArray(value))
    packet = value as Packet
    assert.deepEqual(
      Object.keys(packet).sort(),
      [
        "schema",
        "deadline",
        "bff_client_id",
        "bff_client_secret",
        "verifier_client_id",
        "verifier_client_secret",
        "organisation_id",
        "other_organisation_id",
        "country_code",
        "codes",
      ].sort(),
    )
    requireObserved(
      packet.schema === "baobab-trade.dev07-code-packet.v1" &&
        Number.isFinite(Date.parse(packet.deadline)) &&
        Date.now() < Date.parse(packet.deadline) &&
        Date.parse(packet.deadline) <= Date.now() + 3600000 &&
        packet.bff_client_id !== packet.verifier_client_id &&
        env.buyerAuthorisedParties.includes(packet.bff_client_id) &&
        packet.organisation_id !== packet.other_organisation_id &&
        ["UG", "ZA"].includes(packet.country_code),
    )
    for (const code of Object.values(packet.codes)) {
      requireObserved(
        typeof code.code === "string" &&
          code.code.length > 0 &&
          code.code.length < 8192 &&
          typeof code.verifier === "string" &&
          /^[A-Za-z0-9._~-]{43,128}$/.test(code.verifier),
      )
      developmentEndpoint(code.redirect_uri)
    }
    developmentEndpoint(env.buyerIamIssuer)
    const issuer = env.buyerIamIssuer
    developmentEndpoint(env.controlPlaneBaseUrl)
    const deadline = Date.parse(packet.deadline)
    const request = async (
      url: URL,
      body?: URLSearchParams,
      basic?: [string, string],
      teardown = false,
    ) => {
      if (!teardown && Date.now() >= deadline)
        throw new IdentityQualificationError("DEPENDENCY_UNAVAILABLE")
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(basic
            ? { authorization: `Basic ${Buffer.from(basic.join(":"), "utf8").toString("base64")}` }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(5000),
      })
      const raw = await response.text()
      if (raw.length > 65536) throw new IdentityQualificationError("DEPENDENCY_UNAVAILABLE")
      return {
        status: response.status,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      }
    }
    const metadata = await request(
      new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : issuer + "/"),
    )
    requireObserved(metadata.status === 200 && metadata.body.issuer === issuer)
    const endpoint = (key: string) => {
      const result = developmentEndpoint(metadata.body[key])
      requireObserved(result.origin === new URL(issuer).origin)
      return result
    }
    const tokenUrl = endpoint("token_endpoint")
    const statusUrl = endpoint("introspection_endpoint")
    const revokeUrl = endpoint("revocation_endpoint")
    const bff = packet
    introspect = async (token) => {
      const actual = await request(statusUrl, new URLSearchParams({ token }), [
        bff.verifier_client_id,
        bff.verifier_client_secret,
      ])
      requireObserved(actual.status === 200)
      return actual.body
    }
    revoke = async (token, hint = "access_token") => {
      const result = await request(
        revokeUrl,
        new URLSearchParams({ token, token_type_hint: hint }),
        issuedOwners.get(token) ?? [bff.bff_client_id, bff.bff_client_secret],
        true,
      )
      requireObserved(result.status === 200)
    }
    const issuedOwners = new Map<string, [string, string]>()
    const issue = async (
      fields: Record<string, string>,
      owner: [string, string] = [bff.bff_client_id, bff.bff_client_secret],
    ) => {
      const actual = await request(tokenUrl, new URLSearchParams(fields), owner)
      requireObserved(actual.status === 200 && typeof actual.body.access_token === "string")
      const token = actual.body.access_token as string
      tokens.push(token) // Track immediately, even if subsequent verification fails.
      issuedOwners.set(token, owner)
      if (typeof actual.body.refresh_token === "string") {
        refreshTokens.push(actual.body.refresh_token)
        issuedOwners.set(actual.body.refresh_token, owner)
      }
      return token
    }
    const exchange = (code: Code) =>
      issue({
        grant_type: "authorization_code",
        code: code.code,
        code_verifier: code.verifier,
        redirect_uri: code.redirect_uri,
      })
    const buyer = await exchange(packet.codes.buyer)
    const caller = await issue({
      grant_type: "client_credentials",
      scope: "trade:buyer-handoff",
      audience: "baobab-trade",
    })
    const verifier = new BuyerTokenVerifier({ issuer, authorisedParties: [packet.bff_client_id] })
    const signed = await verifier.verify(buyer)
    const signedCaller = await verifier.verifyBffCaller(caller)
    requireObserved(
      issuerReadbackMatches(
        await introspect(buyer),
        { subject: signed.subject, clientId: signed.authorisedParty, expiresAt: signed.expiresAt },
        issuer,
        "baobab-trade",
        "trade:buy",
        Date.now(),
      ),
    )
    requireObserved(
      issuerReadbackMatches(
        await introspect(caller),
        {
          subject: packet.bff_client_id,
          clientId: signedCaller.clientId,
          expiresAt: signedCaller.expiresAt,
        },
        issuer,
        "baobab-trade",
        "trade:buyer-handoff",
        Date.now(),
      ),
    )
    pass(current)
    report.evidence_class = "REAL_COMPONENT_SYNTHETIC_DATA"

    current = "cp-principal-estate-organisation-market"
    const principals = getBuyerPrincipalResolver(),
      estates = getEstateBindingResolver(),
      tenants = getWorkloadTenantVerifier()
    if (!principals || !estates || !tenants)
      throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
    const correlation = randomUUID()
    const principal = await principals.resolve(buyer, correlation)
    const estate = await estates.resolve({
      clientEvidence: caller,
      subjectAuthorisedParty: signed.authorisedParty,
      correlationId: correlation,
    })
    const cp = await tenants.verifyOrganisationTenant(
      estate.tenantId,
      packet.organisation_id,
      correlation,
      packet.country_code,
    )
    requireObserved(
      cp.expiresAt &&
        cp.expiresAt.getTime() > Date.now() &&
        cp.marketId &&
        cp.countryCode === packet.country_code,
    )
    pass(current)

    // Native records use only independently returned CP facts, in this
    // explicitly disposable development database. They confer no CP authority.
    const org = await b2b.createB2BOrganisations({
      tenant_id: estate.tenantId,
      canonical_organisation_id: packet.organisation_id,
      legal_name: "Synthetic DEV07 IAM/CP buyer",
      engine_instance_id: estate.engineInstanceId,
      link_provenance: `dev07-iam-cp:${correlation}`,
      status: "ACTIVE",
    })
    cleanup.push(() => b2b.softDeleteB2BOrganisations(org.id))
    absent.push(() => b2b.listB2BOrganisations({ id: org.id }))
    const member = await b2b.createBuyerMemberships({
      organisation_id: org.id,
      principal_id: principal.principalId,
      status: "ACTIVE",
    })
    cleanup.push(() => b2b.softDeleteBuyerMemberships(member.id))
    absent.push(() => b2b.listBuyerMemberships({ id: member.id }))
    const role = await b2b.createBuyerRoles({ membership_id: member.id, role: "BUYER" })
    cleanup.push(() => b2b.softDeleteBuyerRoles(role.id))
    absent.push(() => b2b.listBuyerRoles({ id: role.id }))
    const invoke = async (subject = buyer, organisation = bff.organisation_id) => {
      let status = 0,
        body: Record<string, unknown> = {}
      const headers: Record<string, string> = {}
      const response = {
        setHeader: (name: string, value: string) => {
          headers[name] = value
        },
        status: (value: number) => {
          status = value
          return response
        },
        json: (value: Record<string, unknown>) => {
          body = value
          return response
        },
      }
      await POST(
        {
          headers: { authorization: `Bearer ${caller}`, "x-correlation-id": correlation },
          body: {
            subject_token: subject,
            subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
            requested_organisation_id: organisation,
            requested_country_code: bff.country_code,
            correlation_id: correlation,
          },
          scope: { resolve: () => b2b },
        } as never,
        response as never,
      )
      requireObserved(headers["Cache-Control"] === "private, no-store")
      return { status, body }
    }
    const reason = (answer: Awaited<ReturnType<typeof invoke>>, expected: string) => {
      const decision = answer.body.decision as { outcome?: string; reasons?: string[] } | undefined
      return (
        answer.status === 403 &&
        decision?.outcome === "DENY" &&
        decision.reasons?.includes(expected)
      )
    }
    current = "native-buyer-context"
    const positive = await invoke()
    requireObserved(
      positive.status === 200 &&
        positive.body.actor_principal_id === principal.principalId &&
        positive.body.canonical_organisation_id === packet.organisation_id &&
        positive.body.market_id === cp.marketId &&
        positive.body.buyer_membership_id === member.id &&
        Date.parse(String(positive.body.expires_at)) > Date.now(),
    )
    pass(current)
    current = "wrong-company-denial"
    requireObserved(
      reason(await invoke(buyer, packet.other_organisation_id), "BUYER_NOT_AUTHORISED"),
    )
    pass(current)
    current = "wrong-audience-denial"
    const negative = packet.codes.wrong_audience
    requireObserved(
      negative.client_id === "baobab-dev-human" &&
        typeof negative.client_secret === "string" &&
        negative.client_secret.length >= 32,
    )
    const wrong = await issue(
      {
        grant_type: "authorization_code",
        code: negative.code,
        code_verifier: negative.verifier,
        redirect_uri: negative.redirect_uri,
      },
      [negative.client_id, negative.client_secret],
    )
    const wrongStatus = (await introspect(wrong)) as Record<string, unknown>
    requireObserved(
      wrongStatus.active === true &&
        wrongStatus.sub === signed.subject &&
        wrongStatus.client_id === negative.client_id &&
        (wrongStatus.aud === "baobab-control-plane" ||
          JSON.stringify(wrongStatus.aud) === '["baobab-control-plane"]'),
    )
    const cpWrong = await principals.resolve(wrong, randomUUID()).catch((error: unknown) => error)
    requireObserved(
      cpWrong instanceof PrincipalResolutionError &&
        ["SUBJECT_TOKEN_INVALID", "SUBJECT_TOKEN_NOT_FOR_CALLER"].includes(cpWrong.code),
    )
    const denied = await invoke(wrong)
    requireObserved(denied.status === 401 && Number(wrongStatus.exp) * 1000 > Date.now())
    pass(current)
    current = "membership-suspension-denial"
    await b2b.updateBuyerMemberships({ id: member.id, status: "SUSPENDED" })
    requireObserved(reason(await invoke(), "BUYER_NOT_AUTHORISED"))
    await b2b.updateBuyerMemberships({ id: member.id, status: "ACTIVE" })
    requireObserved((await invoke()).status === 200)
    pass(current)
    current = "issuer-revocation-before-expiry"
    await revoke(buyer)
    requireObserved(((await introspect(buyer)) as Record<string, unknown>).active === false)
    const cpRevoked = await principals.resolve(buyer, randomUUID()).catch((error: unknown) => error)
    requireObserved(
      cpRevoked instanceof PrincipalResolutionError &&
        cpRevoked.code === "SUBJECT_TOKEN_NOT_CURRENT",
    )
    const revoked = await invoke()
    requireObserved(
      (revoked.status === 401 || reason(revoked, "BUYER_TOKEN_INVALID")) &&
        signed.expiresAt.getTime() > Date.now(),
    )
    pass(current)
    completed = true
  } catch (error) {
    const reason =
      error instanceof IdentityQualificationError
        ? error.reason
        : (error instanceof PrincipalResolutionError && error.code === "CALLER_NOT_PERMITTED") ||
            (error instanceof EstateBindingError &&
              [
                "CALLER_NOT_PERMITTED",
                "BINDING_NOT_FOUND",
                "ENGINE_INSTANCE_NOT_PERMITTED",
              ].includes(error.code))
          ? "AUTHORITY_NOT_CONFIGURED"
          : "DEPENDENCY_UNAVAILABLE"
    report.cases[current] = { result: reason === "ASSERTION_FAILED" ? "FAIL" : "BLOCKED", reason }
  } finally {
    let failed = false
    for (const operation of cleanup.reverse()) {
      try {
        await operation()
      } catch {
        failed = true
      }
    }
    for (const check of absent) {
      try {
        if ((await check()).length !== 0) failed = true
      } catch {
        failed = true
      }
    }
    for (const token of tokens) {
      try {
        if (!revoke || !introspect) throw new Error()
        await revoke(token)
        if (((await introspect(token)) as Record<string, unknown>).active !== false) failed = true
      } catch {
        failed = true
      }
    }
    for (const token of refreshTokens) {
      try {
        if (!revoke || !introspect) throw new Error()
        await revoke(token, "refresh_token")
        if (((await introspect(token)) as Record<string, unknown>).active !== false) failed = true
      } catch {
        failed = true
      }
    }
    const name = "owned-buyer-bff-native-cleanup"
    if (failed) report.cases[name] = { result: "FAIL", reason: "CLEANUP_FAILED" }
    else if (tokens.length > 0) pass(name)
    report.iam_cp_component_qualified =
      completed &&
      !failed &&
      DEV07_IDENTITY_CASES.every((key) => report.cases[key].result === "PASS")
    mkdirSync(OUTPUT, { recursive: true })
    const data = JSON.stringify(report, null, 2) + "\n"
    writeFileSync(`${OUTPUT}/report.json`, data)
    writeFileSync(
      `${OUTPUT}/report.sha256.json`,
      JSON.stringify({ sha256: createHash("sha256").update(data).digest("hex") }) + "\n",
    )
  }
  if (!report.iam_cp_component_qualified) throw new Error("DEV07_IAM_CP_NOT_QUALIFIED")
  console.log("DEV07_IAM_CP_COMPONENTS_OBSERVED_HOST_TEARDOWN_PENDING")
}
