import { describe, expect, it, vi } from "vitest"
import { AuthenticatedBindingIntake } from "../src/baobab/orders/authenticated-binding-intake"
import type {
  BindingAuthorityClient,
  BindingAdmission,
} from "../src/baobab/orders/binding-authority-client"
import type { PostgresGovernedBindingPersistence } from "../src/baobab/orders/postgres-governed-binding-persistence"
import type { BindingProposal } from "../src/baobab/orders/governed-binding-command-policy"

const now = Date.parse("2026-10-13T12:00:00Z")
const scope = {
  cartId: "cart-native",
  tenantId: "tn_test01",
  organisationId: "00000000-0000-4000-8000-000000000001",
  responsibleLegalEntityId: "LE-SELLER",
  marketCode: "ZA",
  currencyCode: "ZAR",
  salesChannelId: "channel",
  regionId: "region",
}
const proposal: BindingProposal = {
  scope,
  maker: {
    subject: "prn_maker",
    tenantId: scope.tenantId,
    organisationId: scope.organisationId,
    audience: "baobab-control-plane",
    scopes: ["trade-binding:propose"],
  },
  proposedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 60000).toISOString(),
  evidenceReference: "cp/trade-binding/fixture",
}
function fixture(subject = "prn_operator") {
  let clock = now
  const cp: BindingAuthorityClient = {
    authorize: vi.fn(async (_token, operation, s, digest) => ({
      scope: s,
      command_digest: digest,
      decision_id: crypto.randomUUID(),
      principal_id: subject,
      issuer: "https://iam.example.test",
      token_id: "verified-human-token",
      scope_name: `trade-binding:${operation}`,
      evaluated_at: new Date(clock).toISOString(),
      valid_until: new Date(clock + 5000).toISOString(),
      matched_grant_ids: ["grant-exact"],
      provider_permissions_granted: false as const,
    })),
    resolve: vi.fn(async () => ({
      context_id: "00000000-0000-4000-8000-000000000007",
      tenant_id: scope.tenantId,
      organisation_id: scope.organisationId,
      organisation_type: "ORGANISATION",
      country_code: "ZA",
      currency_code: "ZAR",
      market_id: "market_za",
      resolved_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 60000).toISOString(),
    })),
    assess: vi.fn(async (r) => ({
      context_id: r.context_id,
      operation_reference: r.operation_reference,
      provider_permissions_granted: false as const,
      legal_actor_resolution: {
        outcome: "AUTHORIZED",
        evaluated_at: new Date(clock).toISOString(),
        valid_until: new Date(clock + 30000).toISOString(),
        policy_reference: "ADR-BCP-027",
        mandate_id: "00000000-0000-4000-8000-000000000002",
        responsible_legal_entity_id: scope.responsibleLegalEntityId,
        evidence_references: ["verified-mandate-evidence"],
      },
    })),
  }
  const persistence = {
    load: vi.fn(async () => ({
      proposal,
      revision: 1,
      status: "PROPOSED",
      approvedBy: "prn_checker",
    })),
    propose: vi.fn(),
    approve: vi.fn(),
    revoke: vi.fn(),
    activate: vi.fn(),
  }
  const native = vi.fn(async () => ({
    salesChannelId: "channel",
    regionId: "region",
    currencyCode: "ZAR",
    completed: false,
  }))
  const service = new AuthenticatedBindingIntake(
    cp,
    persistence as unknown as PostgresGovernedBindingPersistence,
    native,
    async () => "verified-workload-token",
    () => clock,
  )
  return {
    cp,
    persistence,
    native,
    service,
    advance: (ms: number) => {
      clock += ms
    },
  }
}
describe("actual authenticated binding command intake", () => {
  it("derives native coordinates and maker from CP and persists its final admission", async () => {
    const f = fixture("prn_maker")
    await f.service.execute(
      "propose",
      scope.cartId,
      {
        tenantId: scope.tenantId,
        organisationId: scope.organisationId,
        responsibleLegalEntityId: scope.responsibleLegalEntityId,
        marketCode: "ZA",
        expiresAt: new Date(now + 60000).toISOString(),
      },
      "human-token",
    )
    expect(f.persistence.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        maker: expect.objectContaining({
          subject: "prn_maker",
          issuer: "https://iam.example.test",
        }),
      }),
      expect.objectContaining({
        admission: expect.objectContaining({ scope_name: "trade-binding:propose" }),
      }),
    )
    expect(f.cp.authorize).toHaveBeenCalledTimes(2)
  })
  it.each(["actor", "maker", "context_id", "salesChannelId", "legalActivity", "evidenceReference"])(
    "refuses caller selected %s",
    async (key) => {
      const f = fixture()
      await expect(
        f.service.execute(
          "activate",
          scope.cartId,
          { revision: 1, [key]: "forged" },
          "human-token",
        ),
      ).rejects.toThrow()
      expect(f.cp.authorize).not.toHaveBeenCalled()
    },
  )
  it.each(["prn_maker", "prn_checker"])(
    "denies activation by maker/checker %s",
    async (subject) => {
      const f = fixture(subject)
      await expect(
        f.service.execute("activate", scope.cartId, { revision: 1 }, "human-token"),
      ).rejects.toThrow()
      expect(f.persistence.activate).not.toHaveBeenCalled()
    },
  )
  it("activates only the stored tuple with an independent current CP-owned proof", async () => {
    const f = fixture()
    await f.service.execute("activate", scope.cartId, { revision: 1 }, "human-token")
    expect(f.persistence.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        revision: 1,
        actor: expect.objectContaining({ subject: "prn_operator" }),
        context: expect.objectContaining({ context_id: "00000000-0000-4000-8000-000000000007" }),
      }),
    )
  })
  it("denies wrong seller or expired context", async () => {
    const f = fixture()
    vi.mocked(f.cp.assess).mockImplementation(async (r) => ({
      context_id: r.context_id,
      operation_reference: r.operation_reference,
      provider_permissions_granted: false as const,
      legal_actor_resolution: {
        outcome: "NO_APPLICABLE_MANDATE",
        evaluated_at: new Date(now).toISOString(),
        policy_reference: "denied",
      },
    }))
    await expect(
      f.service.execute("activate", scope.cartId, { revision: 1 }, "human-token"),
    ).rejects.toThrow()
    expect(f.persistence.activate).not.toHaveBeenCalled()
  })
  it("denies changed human authority after legal I/O", async () => {
    const f = fixture()
    vi.mocked(f.cp.authorize)
      .mockReset()
      .mockImplementation(
        async (_t, op, s, d) =>
          ({
            scope: s,
            command_digest: d,
            decision_id: crypto.randomUUID(),
            principal_id:
              vi.mocked(f.cp.authorize).mock.calls.length === 1 ? "prn_operator" : "prn_other",
            issuer: "https://iam.example.test",
            token_id: "t",
            scope_name: `trade-binding:${op}`,
            evaluated_at: new Date(now).toISOString(),
            valid_until: new Date(now + 5000).toISOString(),
            matched_grant_ids: ["g"],
            provider_permissions_granted: false as const,
          }) satisfies BindingAdmission,
      )
    await expect(
      f.service.execute("activate", scope.cartId, { revision: 1 }, "human-token"),
    ).rejects.toThrow()
    expect(f.persistence.activate).not.toHaveBeenCalled()
  })
  it("withdraws after old mandate/context/native lifecycle denial", async () => {
    const f = fixture()
    f.native.mockRejectedValue(new Error("closed cart"))
    vi.mocked(f.cp.resolve).mockRejectedValue(new Error("revoked tenant"))
    await f.service.execute(
      "revoke",
      scope.cartId,
      { revision: 1, reason: "withdraw after CP mandate revocation" },
      "human-token",
    )
    expect(f.persistence.revoke).toHaveBeenCalled()
    expect(f.cp.resolve).not.toHaveBeenCalled()
    expect(f.native).not.toHaveBeenCalled()
  })
  it("denies replay revision and changed cart coordinates after authority I/O", async () => {
    const f = fixture()
    await expect(
      f.service.execute("activate", scope.cartId, { revision: 0 }, "human-token"),
    ).rejects.toThrow()
    f.native
      .mockResolvedValueOnce({
        salesChannelId: "channel",
        regionId: "region",
        currencyCode: "ZAR",
        completed: false,
      })
      .mockResolvedValueOnce({
        salesChannelId: "other",
        regionId: "region",
        currencyCode: "ZAR",
        completed: false,
      })
    await expect(
      f.service.execute("activate", scope.cartId, { revision: 1 }, "human-token"),
    ).rejects.toThrow()
    expect(f.persistence.activate).not.toHaveBeenCalled()
  })
})
