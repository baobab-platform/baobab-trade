import { describe, expect, it, vi } from "vitest"
import {
  attributeCommitment,
  CommitmentAttributionDenied,
  type CommitmentAttribution,
  type CommitmentAttributionDependencies,
} from "../src/baobab/orders/commitment-attribution"
import { canonicalNativeSellerConfiguration } from "../src/baobab/orders/native-seller-configuration"

const org = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c"
const contextId = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a01"
const B1 = "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21"
const scope = {
  reference: "trade:seller-config/synthetic-01/v2",
  tenantId: "tn_synthetic01",
  organisationId: org,
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX"],
  salesChannelIds: ["sc_a"],
  regionIds: ["reg_ugx"],
}
const facts = {
  salesChannels: [{ id: "sc_a", is_disabled: false }],
  regions: [{ id: "reg_ugx", currency_code: "ugx", countries: ["ug"] }],
}
const canonical = canonicalNativeSellerConfiguration(scope, facts.salesChannels, facts.regions)
const native = { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "ugx" }

const deps = (
  over: Partial<CommitmentAttributionDependencies> = {},
  prior: CommitmentAttribution | null = null,
) => {
  const recorded: Omit<CommitmentAttribution, "attribution_id">[] = []
  const sent: Record<string, unknown>[] = []
  const d: CommitmentAttributionDependencies = {
    engineInstanceId: "ei_tradestaging01",
    attested: {
      latestForEngine: async () => [
        {
          attestation_id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
          native_configuration_reference: scope.reference,
          canonical_configuration: canonical.canonical,
        },
      ],
    },
    facts: { read: async () => facts },
    tokens: { getAccessToken: async () => "workload-token" },
    controlPlane: {
      resolvePlatformContext: vi.fn(async (tenantId: string, organisationId: string) => ({
        context_id: contextId,
        tenant_id: tenantId,
        organisation_id: organisationId,
        organisation_type: "ORGANISATION",
        country_code: "UG",
        resolved_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })),
    },
    authority: {
      resolveBinding: vi.fn(async (req) => {
        sent.push(req)
        return {
          resolution_id: "4a6b8c0d-2e4f-4a6b-8c0d-2e4f6a8b0c2d",
          ...req,
          outcome: "RESOLVED" as const,
          binding_reference: { binding_id: B1, binding_version: 2 },
          status: "ACTIVE" as const,
          effective_from: "2026-10-16T00:00:00Z",
          resolved_at: new Date().toISOString(),
          provider_permissions_granted: false as const,
        }
      }),
    },
    store: {
      current: async () => prior,
      record: async (a) => {
        recorded.push(a)
        return { attribution_id: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", ...a }
      },
    },
    ...over,
  }
  return { d, recorded, sent }
}

describe("TA-04 commitment attribution", () => {
  it("attributes a native record to the single CP binding under the attested scope", async () => {
    const { d, recorded, sent } = deps()
    const r = await attributeCommitment({ type: "cart", id: "cart_01" }, native, d)
    expect(sent[0]).toEqual({
      context_id: contextId,
      engine_instance_id: "ei_tradestaging01",
      native_configuration_reference: scope.reference,
      native_configuration_digest: canonical.digest,
      currency: "UGX",
    })
    expect(d.controlPlane.resolvePlatformContext).toHaveBeenCalledWith(
      "tn_synthetic01",
      org,
      "workload-token",
      expect.stringMatching(/^trade-attribution\//),
      undefined,
      "UG",
    )
    expect(recorded[0]).toMatchObject({
      subject_type: "cart",
      subject_id: "cart_01",
      binding_id: B1,
      binding_version: 2,
      native_configuration_digest: canonical.digest,
      tenant_id: "tn_synthetic01",
      context_id: contextId,
    })
    expect(r.context.contextId).toBe(contextId)
  })

  it("works the same for drafts and orders without a cart", async () => {
    for (const type of ["draft_order", "order"] as const) {
      const { d, recorded } = deps()
      await attributeCommitment({ type, id: `${type}_01` }, native, d)
      expect(recorded[0].subject_type).toBe(type)
    }
  })

  it.each([
    "NO_APPLICABLE_BINDING",
    "AMBIGUOUS_BINDING",
    "BINDING_NOT_ACTIVE",
    "NATIVE_CONFIGURATION_MISMATCH",
    "ENGINE_INSTANCE_NOT_BOUND",
    "CONTEXT_NOT_USABLE",
  ])("denies and records nothing on %s", async (outcome) => {
    const { d, recorded } = deps({
      authority: {
        resolveBinding: async (req) => ({
          resolution_id: "4a6b8c0d-2e4f-4a6b-8c0d-2e4f6a8b0c2d",
          ...req,
          outcome: outcome as "NO_APPLICABLE_BINDING",
          resolved_at: new Date().toISOString(),
          provider_permissions_granted: false,
        }),
      },
    })
    await expect(
      attributeCommitment({ type: "cart", id: "cart_01" }, native, d),
    ).rejects.toMatchObject({ outcome })
    expect(recorded).toHaveLength(0)
  })

  it("never substitutes a different seller binding, but accepts a new version of the same", async () => {
    const prior = {
      binding_id: "9b1c3d5e-7f9a-4b2c-8d4e-6f8a0b2c4d6e",
      binding_version: 1,
    } as CommitmentAttribution
    const changed = deps({}, prior)
    await expect(
      attributeCommitment({ type: "cart", id: "cart_01" }, native, changed.d),
    ).rejects.toMatchObject({
      outcome: "SELLER_CHANGED",
    })
    expect(changed.recorded).toHaveLength(0)
    const same = deps({}, { binding_id: B1, binding_version: 1 } as CommitmentAttribution)
    await attributeCommitment({ type: "cart", id: "cart_01" }, native, same.d)
    expect(same.recorded[0].binding_version).toBe(2)
  })

  it("denies an unresolvable native record, a mismatched context and invalid subjects", async () => {
    const { d, sent } = deps()
    await expect(
      attributeCommitment(
        { type: "cart", id: "cart_01" },
        { ...native, salesChannelId: "sc_z" },
        d,
      ),
    ).rejects.toMatchObject({ outcome: "NATIVE_CONFIGURATION_UNRESOLVED" })
    for (const over of [
      { organisation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6d" },
      { country_code: "KE" },
      { expires_at: undefined },
    ]) {
      const ctx = deps()
      ctx.d.controlPlane.resolvePlatformContext = async () => ({
        context_id: contextId,
        tenant_id: "tn_synthetic01",
        organisation_id: org,
        organisation_type: "ORGANISATION",
        country_code: "UG",
        resolved_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...over,
      })
      await expect(
        attributeCommitment({ type: "cart", id: "cart_01" }, native, ctx.d),
      ).rejects.toMatchObject({
        outcome: "CONTEXT_NOT_USABLE",
      })
      expect(ctx.sent).toHaveLength(0)
    }
    for (const subject of [
      { type: "quote", id: "q1" },
      { type: "cart", id: "" },
      { type: "cart", id: "has space" },
    ]) {
      await expect(attributeCommitment(subject as never, native, d)).rejects.toBeInstanceOf(
        CommitmentAttributionDenied,
      )
    }
    expect(sent).toHaveLength(0)
  })
})
