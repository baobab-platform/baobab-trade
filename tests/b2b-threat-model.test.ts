import { describe, expect, it } from "vitest"
import {
  assertNoPersonalData,
  assertNoSensitiveEventData,
  assertPrincipalBinding,
  authorizeB2BResource,
  type AuthoritativeBuyerContext,
} from "../src/baobab/security"
const buyer: AuthoritativeBuyerContext = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  customerId: "customer-a",
  organisationId: "org-a",
  membershipId: "member-a",
  membershipStatus: "ACTIVE",
  roles: ["BUYER"],
}
describe("Gate 15 B2B threat model", () => {
  it("blocks cross-tenant IDOR even when organisation ids collide", () =>
    expect(() =>
      authorizeB2BResource(buyer, { tenantId: "tenant-b", organisationId: "org-a" }, ["BUYER"]),
    ).toThrow(/TENANT_SCOPE_MISMATCH/))
  it("blocks cross-organisation IDOR", () =>
    expect(() =>
      authorizeB2BResource(buyer, { tenantId: "tenant-a", organisationId: "org-b" }, ["BUYER"]),
    ).toThrow(/organisation/))
  it("blocks role escalation", () =>
    expect(() =>
      authorizeB2BResource(buyer, { tenantId: "tenant-a", organisationId: "org-a" }, [
        "ACCOUNT_ADMIN",
      ]),
    ).toThrow(/role/))
  it("blocks suspended memberships", () =>
    expect(() =>
      authorizeB2BResource(
        { ...buyer, membershipStatus: "SUSPENDED" },
        { tenantId: "tenant-a", organisationId: "org-a" },
        ["BUYER"],
      ),
    ).toThrow(/membership/))
  it("blocks spoofed principal context", () =>
    expect(() => assertPrincipalBinding("attacker", buyer)).toThrow(/PRINCIPAL_BINDING_MISMATCH/))
  it("rejects sensitive credentials anywhere in event data", () =>
    expect(() =>
      assertNoSensitiveEventData({ payment: { card_number: "4111111111111111" } }),
    ).toThrow(/SENSITIVE_EVENT_FIELD/))
  it("rejects a buyer contact's personal data anywhere in event data (Gate 19)", () =>
    expect(() =>
      assertNoPersonalData({ organisation: { contact: { email: "buyer@example.com" } } }),
    ).toThrow(/PERSONAL_DATA_FIELD/))
})
