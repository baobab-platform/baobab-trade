import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import provenance from "../../src/baobab/contracts/shared/provenance.json"
import { CONTRACT_PROVENANCE } from "../../src/baobab/contracts/provenance"
import {
  documentaryRequestSchema,
  documentaryResponseSchema,
  legalActorRequestSchema,
  legalActorResponseSchema,
  merchantReadinessRequestSchema,
  merchantReadinessResponseSchema,
  nativeConfigurationAttestationRequestSchema,
  nativeConfigurationAttestationSchema,
  bindingResolveRequestSchema,
  bindingResolutionSchema,
  orderAuthorityRequestSchema,
  orderAuthorityDecisionSchema,
} from "../../src/baobab/contracts/authority-validation"
import { LEGAL_ACTOR_OUTCOMES } from "../../src/baobab/contracts/authority-schemas.generated"
import {
  HttpLegalActorAssessmentClient,
  isLegalActorDecision,
} from "../../src/baobab/control-plane/legal-actor-assessment"
import { HttpDocumentaryRestrictionClient } from "../../src/baobab/control-plane/documentary-restriction"
import { lock, readJson, readText, readYaml, validatorFor } from "./shared"

const context = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b"
const organisation = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6a"
const request = {
  context_id: context,
  role: "SELLER_OF_RECORD" as const,
  activity: "B2B_COFFEE_SALE",
  market: "ZA",
  capability: "commerce.order.create",
  operation_reference: "cart/synthetic/complete",
}
// ADR-SHARED-039 Trade-0 native-configuration attestation wire shapes.
const attestationRequest = {
  context_id: context,
  engine_instance_id: "ei_tradestaging01",
  native_configuration_reference: "trade/native-seller-configuration/synthetic-za",
  native_configuration_digest: "ab".repeat(32),
  currency_scope: ["ZAR"],
  attested_at: "2026-10-16T03:00:00Z",
}
const attestation = {
  attestation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a70",
  tenant_id: "tn_synthetic",
  operating_organisation_id: organisation,
  market: "ZA",
  engine_instance_id: attestationRequest.engine_instance_id,
  native_configuration_reference: attestationRequest.native_configuration_reference,
  native_configuration_digest: attestationRequest.native_configuration_digest,
  currency_scope: ["ZAR"],
  attested_at: attestationRequest.attested_at,
  recorded_at: "2026-10-16T03:00:00.100Z",
}
const authorized = {
  context_id: context,
  operation_reference: request.operation_reference,
  provider_permissions_granted: false,
  legal_actor_resolution: {
    outcome: "AUTHORIZED",
    evaluated_at: "2026-10-13T03:00:00Z",
    policy_reference: "synthetic/independent-policy",
    mandate_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
    responsible_legal_entity_id: "LE-SYNTHETIC-ZA",
    evidence_references: ["synthetic/independent-evidence"],
    valid_until: "2026-10-13T03:00:20Z",
  },
}
const documentary = {
  context_id: context,
  operation_reference: request.operation_reference,
  organisation_id: organisation,
  market: request.market,
  capability: request.capability,
  blocked: false,
  authority_granted: false,
  policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
  evaluated_at: "2026-10-13T03:00:00Z",
  expires_at: "2026-10-13T03:00:01.500Z",
}
const documentaryRequest = {
  context_id: context,
  operation_reference: request.operation_reference,
  market: request.market,
  capability: request.capability,
}
const merchantRequest = {
  tenant_id: "tn_synthetic",
  organisation_id: organisation,
  responsible_legal_entity_id: "LE-SYNTHETIC-ZA",
  market: "ZA",
  currency_code: "ZAR",
  capability: "commerce.order.create",
  operation_reference: request.operation_reference,
  mandate_id: authorized.legal_actor_resolution.mandate_id,
}
const merchant = {
  ...merchantRequest,
  outcome: "READY",
  provider_certification_reference: "synthetic/certification",
  merchant_activation_reference: "synthetic/merchant-activation",
  policy_reference: "synthetic/payments-policy",
  evaluated_at: authorized.legal_actor_resolution.evaluated_at,
  valid_until: authorized.legal_actor_resolution.valid_until,
}

afterEach(() => vi.unstubAllGlobals())

/** Check source bytes AND runtime behavior: two local copies agreeing is not
 * evidence of convergence to their owning repository. No fixture is live authority. */
describe("P0-04A pinned consequential authority contracts", () => {
  it("every generated schema is byte-identical to Shared and declared in the lock", () => {
    expect(provenance.commit).toBe(lock.source.commit)
    expect(CONTRACT_PROVENANCE.sharedCommit).toBe(lock.source.commit)
    expect(CONTRACT_PROVENANCE.sharedRepository).toBe(lock.source.repository)
    // Inspect the entire directory, not just manifest entries: obsolete files
    // from a previous reference closure must fail conformance too.
    const embeddedRoot = resolve(__dirname, "../../src/baobab/contracts/shared")
    const inventory = (path: string): string[] =>
      readdirSync(resolve(embeddedRoot, path), { withFileTypes: true }).flatMap((entry) => {
        const child = `${path}/${entry.name}`
        return entry.isDirectory() ? inventory(child) : [child]
      })
    expect(inventory("contracts").sort()).toEqual(Object.keys(provenance.files).sort())
    for (const [path, hash] of Object.entries(provenance.files)) {
      expect(lock.contracts).toContain(path)
      const embedded = readFileSync(
        resolve(__dirname, "../../src/baobab/contracts/shared", path),
        "utf8",
      )
      expect(embedded).toBe(readText(path))
      expect(createHash("sha256").update(embedded).digest("hex")).toBe(hash)
    }
  })

  const cases = [
    [
      "organisation/v2/legal-actor-enforcement.schema.json",
      "AssessLegalActorRequest",
      request,
      legalActorRequestSchema,
    ],
    [
      "organisation/v2/legal-actor-enforcement.schema.json",
      "AssessLegalActorResponse",
      authorized,
      legalActorResponseSchema,
    ],
    [
      "admission/v2/documentary-restriction.schema.json",
      "DocumentaryRestrictionAssessmentRequest",
      documentaryRequest,
      documentaryRequestSchema,
    ],
    [
      "admission/v2/documentary-restriction.schema.json",
      "DocumentaryRestrictionAssessmentResponse",
      documentary,
      documentaryResponseSchema,
    ],
    [
      "payments/v1/merchant-readiness.schema.json",
      "ReadinessRequest",
      merchantRequest,
      merchantReadinessRequestSchema,
    ],
    [
      "payments/v1/merchant-readiness.schema.json",
      "ReadyDecision",
      merchant,
      merchantReadinessResponseSchema,
    ],
    [
      "trade/v2/seller-operating-binding.schema.json",
      "NativeConfigurationAttestationRequest",
      attestationRequest,
      nativeConfigurationAttestationRequestSchema,
    ],
    [
      "trade/v2/seller-operating-binding.schema.json",
      "NativeConfigurationAttestation",
      attestation,
      nativeConfigurationAttestationSchema,
    ],
    // Trade-A TA-03: the Shared examples themselves are the fixtures.
    [
      "trade/v2/seller-operating-binding.schema.json",
      "BindingResolveRequest",
      readJson("contracts/trade/v2/examples/binding-resolve-request.json"),
      bindingResolveRequestSchema,
    ],
    [
      "trade/v2/seller-operating-binding.schema.json",
      "BindingResolution",
      readJson("contracts/trade/v2/examples/binding-resolution-resolved.json"),
      bindingResolutionSchema,
    ],
    [
      "trade/v2/order-authority.schema.json",
      "OrderAuthorityRequest",
      readJson("contracts/trade/v2/examples/order-authority-request.json"),
      orderAuthorityRequestSchema,
    ],
    [
      "trade/v2/order-authority.schema.json",
      "OrderAuthorityDecision",
      readJson("contracts/trade/v2/examples/order-authority-decision-authorized.json"),
      orderAuthorityDecisionSchema,
    ],
  ] as const

  it.each(cases)(
    "%s#%s agrees on valid, missing, extra and wrongly typed fields",
    (path, definition, payload, runtime) => {
      const sourcePath = `contracts/${path}`
      const owned = validatorFor(sourcePath, definition)
      expect(owned(payload), JSON.stringify(owned.errors)).toBe(true)
      expect(runtime(payload)).toBe(true)
      const required = readJson(sourcePath).$defs[definition].required as string[]
      for (const key of required) {
        const missing = { ...payload, [key]: undefined }
        const wronglyTyped = { ...payload, [key]: [] }
        expect(owned(missing)).toBe(false)
        expect(runtime(missing)).toBe(false)
        expect(owned(wronglyTyped)).toBe(false)
        expect(runtime(wronglyTyped)).toBe(false)
      }
      const invented = { ...payload, provider_permission_override: true }
      expect(owned(invented)).toBe(false)
      expect(runtime(invented)).toBe(false)
    },
  )

  it("uses the exact finite denial vocabulary and never permits a denied actor/mandate", () => {
    const outcomes = readJson("contracts/organisation/v2/legal-actor-mandate.schema.json").$defs
      .LegalActorResolution.properties.outcome.enum
    expect([...LEGAL_ACTOR_OUTCOMES]).toEqual(outcomes)
    for (const outcome of outcomes.filter((x: string) => x !== "AUTHORIZED")) {
      const denial = {
        ...authorized,
        legal_actor_resolution: {
          outcome,
          evaluated_at: authorized.legal_actor_resolution.evaluated_at,
          policy_reference: "synthetic/denial",
        },
      }
      expect(isLegalActorDecision(denial, request)).toBe(true)
      expect(
        isLegalActorDecision(
          {
            ...denial,
            legal_actor_resolution: {
              ...denial.legal_actor_resolution,
              mandate_id: authorized.legal_actor_resolution.mandate_id,
            },
          },
          request,
        ),
      ).toBe(false)
    }
    expect(
      isLegalActorDecision(
        {
          ...authorized,
          legal_actor_resolution: { ...authorized.legal_actor_resolution, outcome: "TRUST_ME" },
        },
        request,
      ),
    ).toBe(false)
  })

  it("rejects invalid dates/UUIDs/actor IDs and binds the request echo beyond schema validity", () => {
    for (const patch of [
      { evaluated_at: "2026-02-30T03:00:00Z" },
      { valid_until: "October 13, 2026" },
      { mandate_id: "------------------------------------" },
      { responsible_legal_entity_id: "lowercase-local-seller" },
      { evidence_references: ["x".repeat(501)] },
      { policy_reference: "x".repeat(501) },
      { grant_provider_access: true },
    ]) {
      expect(
        isLegalActorDecision(
          {
            ...authorized,
            legal_actor_resolution: { ...authorized.legal_actor_resolution, ...patch },
          },
          request,
        ),
      ).toBe(false)
    }
    const unrelated = { ...authorized, operation_reference: "cart/foreign/complete" }
    expect(legalActorResponseSchema(unrelated)).toBe(true)
    expect(isLegalActorDecision(unrelated, request)).toBe(false)
  })

  it("captured authenticated client requests satisfy Shared and refuse redirects", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(authorized)))
      .mockResolvedValueOnce(new Response(JSON.stringify(documentary)))
    vi.stubGlobal("fetch", fetch)
    await new HttpLegalActorAssessmentClient("https://synthetic-cp.invalid").assess(
      request,
      "synthetic-token",
      "synthetic-correlation",
    )
    await new HttpDocumentaryRestrictionClient("https://synthetic-cp.invalid").assess(
      documentaryRequest,
      "synthetic-token",
      "synthetic-correlation",
    )
    for (const [i, validate] of [legalActorRequestSchema, documentaryRequestSchema].entries()) {
      const init = fetch.mock.calls[i][1] as RequestInit
      expect(validate(JSON.parse(init.body as string))).toBe(true)
      expect(init.redirect).toBe("error")
      expect(init.headers).toMatchObject({
        authorization: "Bearer synthetic-token",
        "cache-control": "no-store",
      })
    }
  })

  it("attests only through the PROVISIONED assessor, never the general Trade workload", () => {
    const profiles = readYaml("contracts/identity/v1/workload-registry.yaml").workloads
    const scopeRegistry = readYaml("contracts/authorization/v1/scope-registry.yaml").scopes
    const assessor = profiles["baobab-trade-legal-actor-assessor-staging"]
    expect(assessor.status).toBe("PROVISIONED")
    expect(assessor.allowed_scopes).toEqual(
      expect.arrayContaining(["context:resolve", "trade-seller-binding:attest"]),
    )
    // Trade-A TA-03 adds discovery; the same PROVISIONED assessor, never the general workload.
    for (const name of [
      "trade-seller-binding:attest",
      "trade-seller-binding:resolve",
      "trade-order-authority:resolve",
    ]) {
      expect(assessor.allowed_scopes).toContain(name)
      expect(profiles["baobab-trade-workload"].allowed_scopes).not.toContain(name)
      const scope = scopeRegistry.find((x: { name: string }) => x.name === name)
      expect(scope?.audience).toEqual(["baobab-control-plane"])
      expect(scope?.grants_authority).toBe(false)
    }
  })

  it("preserves ungranted scope gaps and PROVISIONED staging standing", () => {
    const profiles = readYaml("contracts/identity/v1/workload-registry.yaml").workloads
    const scopeRegistry = readYaml("contracts/authorization/v1/scope-registry.yaml").scopes
    const trade = profiles["baobab-trade-legal-actor-assessor-staging"]
    expect(trade.status).toBe("PROVISIONED")
    expect(trade.context_purposes).toEqual(["RUNTIME"])
    expect(trade.allowed_scopes).toContain("legal-actor:assess")
    // This is a recorded activation prerequisite, not a grant or an exception.
    expect(trade.allowed_scopes).not.toContain("documentary:restriction-assess")
    for (const name of ["legal-actor:assess", "documentary:restriction-assess"]) {
      expect(scopeRegistry.find((x: { name: string }) => x.name === name)?.grants_authority).toBe(
        false,
      )
      expect(profiles["baobab-trade-workload"].allowed_scopes).not.toContain(name)
    }
  })
})
