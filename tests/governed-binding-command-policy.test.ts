import { describe, expect, it } from "vitest"
import {
  assertBindingApproval,
  assertBindingProposal,
  assertBindingRevocation,
} from "../src/baobab/orders/governed-binding-command-policy"

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
  subject: "human-maker",
  tenantId: scope.tenantId,
  organisationId: scope.organisationId,
  audience: "baobab-trade",
  scopes: ["trade:legal-seller-binding:propose"],
}
const checker = {
  ...maker,
  subject: "human-checker",
  scopes: ["trade:legal-seller-binding:approve"],
}
const proposal = {
  scope,
  maker,
  proposedAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  evidenceReference: "evidence/synthetic/not-certified",
}
const approval = {
  proposal,
  checker,
  approvedAt: new Date(now - 30_000).toISOString(),
  approvalReference: "review/synthetic/not-certified",
}
describe("LA-05C5 command policy (no provider certification)", () => {
  it("accepts structurally valid synthetic maker/checker inputs only", () => {
    expect(() => assertBindingProposal(proposal, now)).not.toThrow()
    expect(() => assertBindingApproval(approval, now)).not.toThrow()
  })
  it("denies self approval, wrong audience, wrong scope, wrong tenant and expired evidence", () => {
    for (const candidate of [
      { ...approval, checker: { ...checker, subject: maker.subject } },
      { ...approval, checker: { ...checker, audience: "storefront" } },
      { ...approval, checker: { ...checker, scopes: [] } },
      { ...approval, checker: { ...checker, tenantId: "other-tenant" } },
      { ...approval, approvedAt: new Date(now + 1000).toISOString() },
      { ...approval, proposal: { ...proposal, expiresAt: new Date(now).toISOString() } },
    ])
      expect(() => assertBindingApproval(candidate, now)).toThrow("LA-05C5 denied")
  })
  it("denies missing market, currency, evidence, and unauthorised maker", () => {
    for (const candidate of [
      { ...proposal, scope: { ...scope, marketCode: "" } },
      { ...proposal, scope: { ...scope, currencyCode: "Z" } },
      { ...proposal, evidenceReference: "" },
      { ...proposal, maker: { ...maker, scopes: [] } },
    ])
      expect(() => assertBindingProposal(candidate, now)).toThrow("LA-05C5 denied")
  })
  it("requires revocation authority, reason and evidence", () => {
    const revoker = { ...maker, scopes: ["trade:legal-seller-binding:revoke"] }
    expect(() =>
      assertBindingRevocation(scope, revoker, "mandate revoked", "evidence/test"),
    ).not.toThrow()
    expect(() =>
      assertBindingRevocation(scope, maker, "mandate revoked", "evidence/test"),
    ).toThrow()
    expect(() => assertBindingRevocation(scope, revoker, "", "evidence/test")).toThrow()
    expect(() => assertBindingRevocation(scope, revoker, "mandate revoked", "")).toThrow()
  })
})
