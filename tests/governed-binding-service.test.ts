import { describe, expect, it, vi } from "vitest"
import {
  approveBinding,
  proposeBinding,
  revokeBinding,
  type BindingAuthorityPorts,
} from "../src/baobab/orders/governed-binding-service"

const now = Date.parse("2026-10-10T06:00:00Z")
const scope = {
  cartId: "cart-test",
  tenantId: "tenant-test",
  organisationId: "org-test",
  responsibleLegalEntityId: "legal-test",
  marketCode: "ZA",
  currencyCode: "ZAR",
  salesChannelId: "channel-test",
  regionId: "region-test",
}
const maker = {
  subject: "maker",
  tenantId: scope.tenantId,
  organisationId: scope.organisationId,
  audience: "baobab-control-plane",
  scopes: ["trade-binding:propose"],
  issuer: "iam-test",
  tokenId: "jwt-test",
}
const checker = { ...maker, subject: "checker", scopes: ["trade-binding:approve"] }
const proposal = {
  scope,
  maker,
  proposedAt: new Date(now - 10000).toISOString(),
  expiresAt: new Date(now + 10000).toISOString(),
  evidenceReference: "evidence/propose",
}
const approval = {
  proposal,
  checker,
  approvedAt: new Date(now - 5000).toISOString(),
  approvalReference: "evidence/approve",
}
function ports(actor = maker): BindingAuthorityPorts {
  return {
    iam: { verify: vi.fn().mockResolvedValue(actor) },
    evidence: {
      verify: vi.fn().mockImplementation(async (reference: string) => ({
        reference,
        decisionId: "decision-test",
        verifiedAt: new Date(now).toISOString(),
      })),
    },
    legalAuthority: { assertCurrent: vi.fn().mockResolvedValue(undefined) },
    persistence: {
      propose: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue(undefined),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
  }
}
describe("LA-05C5 verified boundary", () => {
  it("requires independent IAM verification, current authority and verified evidence", async () => {
    const p = ports()
    await proposeBinding(p, "token", proposal, () => now)
    expect(p.legalAuthority.assertCurrent).toHaveBeenCalledWith(scope)
    expect(p.persistence.propose).toHaveBeenCalledTimes(1)
  })
  it("rejects spoofed maker before writing", async () => {
    const p = ports({ ...maker, subject: "attacker" })
    await expect(proposeBinding(p, "token", proposal, () => now)).rejects.toThrow("maker mismatch")
    expect(p.persistence.propose).not.toHaveBeenCalled()
  })
  it("rejects self-approval and evidence disagreement", async () => {
    const p = ports({ ...checker, subject: "maker" })
    await expect(
      approveBinding(
        p,
        "token",
        { ...approval, checker: { ...checker, subject: "maker" } },
        () => now,
      ),
    ).rejects.toThrow()
    expect(p.persistence.approve).not.toHaveBeenCalled()
    const q = ports(checker)
    vi.mocked(q.evidence.verify).mockResolvedValue({
      reference: "different",
      decisionId: "id",
      verifiedAt: new Date(now).toISOString(),
    })
    await expect(approveBinding(q, "token", approval, () => now)).rejects.toThrow("evidence")
    expect(q.persistence.approve).not.toHaveBeenCalled()
  })
  it("denies revocation without IAM revocation scope", async () => {
    const p = ports(maker)
    await expect(revokeBinding(p, "token", scope, "revoked", "evidence/revoke")).rejects.toThrow()
    expect(p.persistence.revoke).not.toHaveBeenCalled()
  })
  it("denies expiry or revoked IAM authority after remote evidence I/O", async () => {
    let at = now
    const p = ports()
    vi.mocked(p.evidence.verify).mockImplementation(async (reference) => {
      at = now + 20_000
      return { reference, decisionId: "decision-test", verifiedAt: new Date(at).toISOString() }
    })
    await expect(proposeBinding(p, "token", proposal, () => at)).rejects.toThrow()
    expect(p.persistence.propose).not.toHaveBeenCalled()
    const q = ports()
    vi.mocked(q.iam.verify)
      .mockResolvedValueOnce(maker)
      .mockResolvedValueOnce({ ...maker, scopes: [] })
    await expect(proposeBinding(q, "token", proposal, () => now)).rejects.toThrow(
      "authority changed",
    )
    expect(q.persistence.propose).not.toHaveBeenCalled()
  })
  it("denies stale, future and invalid-calendar evidence without writing", async () => {
    for (const verifiedAt of [
      new Date(now - 30_001).toISOString(),
      new Date(now + 1).toISOString(),
      "2026-02-30T06:00:00Z",
    ]) {
      const p = ports()
      vi.mocked(p.evidence.verify).mockResolvedValue({
        reference: proposal.evidenceReference,
        decisionId: "test",
        verifiedAt,
      })
      await expect(proposeBinding(p, "token", proposal, () => now)).rejects.toThrow("evidence")
      expect(p.persistence.propose).not.toHaveBeenCalled()
    }
  })
})
