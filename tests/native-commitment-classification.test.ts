import { describe, expect, it } from "vitest"
import type { TradeBuyerExecutionContext } from "../src/baobab/b2b/buyer-authority"
import {
  CommerceProfileError,
  type CommerceProfileAttestation,
  type CommerceProfileFailure,
} from "../src/baobab/control-plane/estate-commerce-profile"
import type { CommitmentAttribution } from "../src/baobab/orders/commitment-attribution"
import {
  CLASSIFICATION_DECISION_REASON,
  classifyNativeCommitment,
  type ClassificationStore,
  type ClassifyRequest,
  type EstateProof,
  type NativeCommitmentClassification,
  type NewClassification,
  type ProfileObservation,
  wireFields,
} from "../src/baobab/orders/native-commitment-classification"
import classificationSchema from "../src/baobab/contracts/shared/contracts/trade/v2/native-commitment-classification.schema.json"

/**
 * ADR-SHARED-042 section 14 Decision 8: Trade's classification of a native
 * commitment from the CP commerce profile and its own buyer relationship.
 * Synthetic identifiers and fakes only: this proves Trade's rules, not CP,
 * IAM, the database guard or connected acceptance.
 */
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const BINDING = "5d2c7f0e-3b1a-4c6d-9e8f-0a1b2c3d4e5f"
const CONTEXT = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b"

const attribution: CommitmentAttribution = {
  attribution_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  subject_type: "cart",
  subject_id: "cart_synthetic01",
  attestation_id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  native_configuration_reference: "native:synthetic",
  native_configuration_digest: "a".repeat(64),
  currency: "UGX",
  tenant_id: "tn_synthetic01",
  operating_organisation_id: "4c5d6e7f-8a9b-4c0d-8e1f-2a3b4c5d6e7f",
  market: "UG",
  engine_instance_id: "ei_trade01",
  binding_id: "6e7f8a9b-0c1d-4e2f-8a3b-4c5d6e7f8a9b",
  binding_version: 3,
  resolution_id: "7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c",
  context_id: CONTEXT,
  resolved_at: new Date(NOW - 1000).toISOString(),
  correlation_id: CORRELATION,
}

const buyerContext = (change: Partial<TradeBuyerExecutionContext> = {}) =>
  ({
    context_id: "8a9b0c1d-2e3f-4a4b-8c5d-6e7f8a9b0c1d",
    digital_estate_id: "estate_synthetic",
    tenant_id: "tn_synthetic01",
    engine_instance_id: "ei_trade01",
    buyer_organisation_id: "b2borg_synthetic01",
    buyer_membership_id: "b2bmem_synthetic01",
    expires_at: new Date(NOW + 30_000).toISOString(),
    evidence_references: [`cp-estate-binding:${BINDING}@r1`],
    ...change,
  }) as TradeBuyerExecutionContext

const binding = () => request().estate as Extract<EstateProof, { kind: "ESTATE_CLIENT_BINDING" }>

const request = (change: Partial<ClassifyRequest> = {}): ClassifyRequest => ({
  resource: { type: "cart", id: "cart_synthetic01" },
  attribution,
  sellerContext: { contextId: CONTEXT, marketId: "market_synthetic" },
  estate: {
    kind: "ESTATE_CLIENT_BINDING",
    bindingId: BINDING,
    revision: 1,
    digitalEstateId: "estate_synthetic",
    tenantId: "tn_synthetic01",
    engineInstanceId: "ei_trade01",
    expiresAt: new Date(NOW + 60_000),
  },
  buyer: { model: "BUYER_ORGANISATION", context: buyerContext() },
  correlationId: CORRELATION,
  ...change,
})

const profile = (change: Partial<CommerceProfileAttestation> = {}): CommerceProfileAttestation => ({
  attestationId: "9b0c1d2e-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
  commerceProfileId: "0c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e3f",
  profileRevision: 2,
  digitalEstateId: "estate_synthetic",
  tenantId: "tn_synthetic01",
  engineInstanceId: "ei_trade01",
  marketId: "market_synthetic",
  commerceModel: "B2B",
  issuedAt: new Date(NOW),
  expiresAt: new Date(NOW + 60_000),
  profileEffectiveUntil: null,
  evidenceReference: "changeset:synthetic-0002",
  ...change,
})

class FakeStore implements ClassificationStore {
  observations: ProfileObservation[] = []
  rows: NewClassification[] = []
  refuseObservation = false
  answer: "CREATED" | "EXISTING" | "CHANGED" = "CREATED"
  async observe(observation: ProfileObservation) {
    if (this.refuseObservation) throw new Error("stale revision")
    this.observations.push(observation)
  }
  async classify(row: NewClassification) {
    this.rows.push(row)
    if (this.answer === "CHANGED") return { outcome: "CHANGED" as const }
    const classification: NativeCommitmentClassification = {
      ...wireFields(row),
      status: "ACTIVE",
      revision: 1,
      classified_at: new Date(NOW).toISOString(),
    }
    return { outcome: this.answer, classification }
  }
}

const run = async (
  options: {
    request?: Partial<ClassifyRequest>
    attestation?: Partial<CommerceProfileAttestation>
    denial?: CommerceProfileFailure | "THROWS"
    store?: FakeStore
    noResolver?: boolean
  } = {},
) => {
  const store = options.store ?? new FakeStore()
  const asked: unknown[] = []
  const result = await classifyNativeCommitment(
    {
      engineInstanceId: "ei_trade01",
      store,
      now: () => NOW,
      newId: () => "1d2e3f4a-5b6c-4d7e-8f8a-9b0c1d2e3f4a",
      profiles: options.noResolver
        ? null
        : {
            resolve: async (r) => {
              asked.push(r)
              if (options.denial === "THROWS") throw new Error("boom")
              if (options.denial) throw new CommerceProfileError(options.denial)
              return profile(options.attestation)
            },
          },
    },
    request(options.request),
  )
  return { result, store, asked }
}

describe("classifyNativeCommitment", () => {
  it("classifies a B2B cart from the CP profile and Trade's own buyer relationship", async () => {
    const { result, store, asked } = await run()
    expect(result.outcome).toBe("CLASSIFIED")
    if (result.outcome !== "CLASSIFIED") return
    expect(result.classification).toMatchObject({
      resource_type: "cart",
      origin: "DIRECT",
      commerce_model: "B2B",
      buyer_account_model: "BUYER_ORGANISATION",
      buyer_organisation_id: "b2borg_synthetic01",
      buyer_membership_id: "b2bmem_synthetic01",
      market_id: "market_synthetic",
      seller_binding_reference: { binding_id: attribution.binding_id, binding_version: 3 },
    })
    expect(asked).toEqual([
      {
        digitalEstateId: "estate_synthetic",
        marketId: "market_synthetic",
        provenance: { kind: "ESTATE_CLIENT_BINDING", reference: BINDING },
        correlationId: CORRELATION,
      },
    ])
    expect(store.observations.map((o) => o.outcome)).toEqual(["ATTESTED"])
    expect(store.rows[0]).toMatchObject({
      attribution_id: attribution.attribution_id,
      seller_context_id: CONTEXT,
      buyer_context_id: buyerContext().context_id,
    })
  })

  it("classifies B2C only for a positively established consumer", async () => {
    const consumer = { model: "CONSUMER" as const, consumerReference: "consumer:synthetic01" }
    const { result } = await run({
      request: { buyer: consumer },
      attestation: { commerceModel: "B2C" },
    })
    expect(result).toMatchObject({
      outcome: "CLASSIFIED",
      classification: { commerce_model: "B2C", consumer_reference: "consumer:synthetic01" },
    })
    expect(
      (await run({ request: { buyer: { model: "CONSUMER", consumerReference: " " } } })).result,
    ).toEqual({ outcome: "REFUSED", reason: "CLASSIFICATION_ABSENT" })
  })

  it("never reinterprets a commitment across models", async () => {
    const consumer = { model: "CONSUMER" as const, consumerReference: "consumer:synthetic01" }
    expect((await run({ request: { buyer: consumer } })).result).toEqual({
      outcome: "REFUSED",
      reason: "BUYER_AUTHORITY_ABSENT",
    })
    expect((await run({ attestation: { commerceModel: "B2C" } })).result).toEqual({
      outcome: "REFUSED",
      reason: "CLASSIFICATION_CONFLICT",
    })
  })

  it("maps every CP answer to a fail-closed refusal, never a default model", async () => {
    const cases: [CommerceProfileFailure | "THROWS", string][] = [
      ["PROFILE_NOT_REGISTERED", "CLASSIFICATION_ABSENT"],
      ["ESTATE_PROVENANCE_INVALID", "CLASSIFICATION_ABSENT"],
      ["PROFILE_NOT_ACTIVE", "PROFILE_NOT_ACTIVE"],
      ["PROFILE_AMBIGUOUS", "CLASSIFICATION_CONFLICT"],
      ["ENGINE_INSTANCE_NOT_PERMITTED", "CLASSIFICATION_CONFLICT"],
      ["CALLER_NOT_PERMITTED", "PROFILE_UNAVAILABLE"],
      ["RESOLUTION_UNAVAILABLE", "PROFILE_UNAVAILABLE"],
      ["THROWS", "PROFILE_UNAVAILABLE"],
    ]
    for (const [denial, reason] of cases) {
      const { result, store } = await run({ denial })
      expect(result).toEqual({ outcome: "REFUSED", reason })
      expect(store.rows).toHaveLength(0)
      // A CP decision is recorded; unavailability is not an answer.
      expect(store.observations.length).toBe(reason === "PROFILE_UNAVAILABLE" ? 0 : 1)
    }
    expect((await run({ noResolver: true })).result).toEqual({
      outcome: "REFUSED",
      reason: "PROFILE_UNAVAILABLE",
    })
  })

  it("refuses when the resource, seller attribution, estate and buyer do not belong together", async () => {
    const cases: [Partial<ClassifyRequest>, string][] = [
      [{ resource: { type: "cart", id: "cart_other01" } }, "CLASSIFICATION_ABSENT"],
      [
        { resource: { type: "quotation" as "cart", id: "cart_synthetic01" } },
        "CLASSIFICATION_ABSENT",
      ],
      [
        { sellerContext: { contextId: "other", marketId: "market_synthetic" } },
        "CLASSIFICATION_ABSENT",
      ],
      [{ sellerContext: { contextId: CONTEXT } }, "CLASSIFICATION_ABSENT"],
      [{ sellerContext: { contextId: CONTEXT, marketId: "UG" } }, "CLASSIFICATION_ABSENT"],
      [
        { attribution: { ...attribution, engine_instance_id: "ei_other01" } },
        "CLASSIFICATION_ABSENT",
      ],
      [{ estate: { ...binding(), tenantId: "tn_other01" } }, "CLASSIFICATION_CONFLICT"],
      [{ estate: { ...binding(), expiresAt: new Date(NOW) } }, "CLASSIFICATION_CONFLICT"],
      [{ estate: undefined as never }, "CLASSIFICATION_ABSENT"],
      [{ estate: { kind: "SALES_CHANNEL" } as never }, "CLASSIFICATION_ABSENT"],
      [
        {
          buyer: {
            model: "BUYER_ORGANISATION",
            context: buyerContext({ digital_estate_id: "estate_other" }),
          },
        },
        "CLASSIFICATION_CONFLICT",
      ],
      [
        {
          buyer: {
            model: "BUYER_ORGANISATION",
            context: buyerContext({ evidence_references: ["cp-estate-binding:other@r1"] }),
          },
        },
        "CLASSIFICATION_CONFLICT",
      ],
      [
        {
          buyer: {
            model: "BUYER_ORGANISATION",
            context: buyerContext({ expires_at: new Date(NOW).toISOString() }),
          },
        },
        "CLASSIFICATION_CONFLICT",
      ],
    ]
    for (const [change, reason] of cases) {
      const { result, asked } = await run({ request: change })
      expect(result).toEqual({ outcome: "REFUSED", reason })
      expect(asked).toHaveLength(0)
    }
  })

  it("refuses CP's answer for another Tenant, or one older than Trade has seen", async () => {
    expect((await run({ attestation: { tenantId: "tn_other01" } })).result).toEqual({
      outcome: "REFUSED",
      reason: "CLASSIFICATION_CONFLICT",
    })
    const store = new FakeStore()
    store.refuseObservation = true
    expect((await run({ store })).result).toEqual({
      outcome: "REFUSED",
      reason: "CLASSIFICATION_CONFLICT",
    })
    expect(store.rows).toHaveLength(0)
  })

  it("reports a changed classification instead of overwriting it", async () => {
    const store = new FakeStore()
    store.answer = "CHANGED"
    expect((await run({ store })).result).toEqual({
      outcome: "REFUSED",
      reason: "CLASSIFICATION_CHANGED",
    })
  })

  // Decision 9: a commitment that does not come through a BFF proves its
  // estate with CP's governed resource assignment attestation.
  const assignment = (change: Record<string, unknown> = {}): EstateProof => ({
    kind: "GOVERNED_RESOURCE_ASSIGNMENT",
    assignment: {
      attestationId: "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
      assignmentId: "3f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c",
      assignmentRevision: 2,
      scope: "WORKLOAD",
      workloadClientId: "synthetic-server-checkout",
      digitalEstateId: "estate_synthetic",
      tenantId: "tn_synthetic01",
      engineInstanceId: "ei_trade01",
      marketId: "market_synthetic",
      operation: "trade.order.commit",
      issuedAt: new Date(NOW),
      expiresAt: new Date(NOW + 60_000),
      assignmentEffectiveUntil: null,
      evidenceReference: "changeset:synthetic-assign",
      ...change,
    },
  })

  it("classifies a non-BFF commitment on its governed resource assignment", async () => {
    const { result, asked, store } = await run({
      request: {
        estate: assignment(),
        buyer: { model: "CONSUMER", consumerReference: "consumer:1" },
      },
      attestation: { commerceModel: "B2C" },
    })
    expect(result.outcome).toBe("CLASSIFIED")
    if (result.outcome !== "CLASSIFIED") throw new Error("unreachable")
    expect(result.classification.evidence_references).toEqual(
      expect.arrayContaining([
        "cp-resource-assignment:3f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c@r2",
        "cp-resource-assignment-attestation:2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
      ]),
    )
    expect(
      result.classification.evidence_references.some((e) => e.startsWith("cp-estate-binding:")),
    ).toBe(false)
    expect(asked).toEqual([
      {
        digitalEstateId: "estate_synthetic",
        marketId: "market_synthetic",
        provenance: {
          kind: "GOVERNED_RESOURCE_ASSIGNMENT",
          reference: "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
        },
        correlationId: CORRELATION,
      },
    ])
    expect(store.observations[0].provenance.kind).toBe("GOVERNED_RESOURCE_ASSIGNMENT")
  })

  it("still requires an independently established buyer for a B2B assigned commitment", async () => {
    const b2b = await run({ request: { estate: assignment() } })
    expect(b2b.result.outcome).toBe("CLASSIFIED")
    const consumer = await run({
      request: {
        estate: assignment(),
        buyer: { model: "CONSUMER", consumerReference: "consumer:1" },
      },
    })
    expect(consumer.result).toEqual({ outcome: "REFUSED", reason: "BUYER_AUTHORITY_ABSENT" })
    const foreign = await run({
      request: {
        estate: assignment(),
        buyer: { model: "BUYER_ORGANISATION", context: buyerContext({ tenant_id: "tn_other01" }) },
      },
    })
    expect(foreign.result).toEqual({ outcome: "REFUSED", reason: "CLASSIFICATION_CONFLICT" })
  })

  it("refuses an assignment for another Market, Tenant, engine or after it expires", async () => {
    for (const change of [
      { marketId: "market_other" },
      { tenantId: "tn_other01" },
      { engineInstanceId: "ei_other01" },
      { expiresAt: new Date(NOW) },
    ]) {
      const { result, asked } = await run({ request: { estate: assignment(change) } })
      expect(result).toEqual({ outcome: "REFUSED", reason: "CLASSIFICATION_CONFLICT" })
      expect(asked).toHaveLength(0)
    }
    const { result } = await run({
      request: { estate: { kind: "GOVERNED_RESOURCE_ASSIGNMENT" } as EstateProof },
    })
    expect(result).toEqual({ outcome: "REFUSED", reason: "CLASSIFICATION_ABSENT" })
  })

  it("maps every refusal to the contract's decision reason", () => {
    const refusals = (
      classificationSchema as { $defs: { classificationRefusal: { enum: string[] } } }
    ).$defs.classificationRefusal.enum
    expect(Object.keys(CLASSIFICATION_DECISION_REASON).sort()).toEqual([...refusals].sort())
  })
})
