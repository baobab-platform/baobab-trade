import { describe, expect, it } from "vitest"
import { resolveBuyerContext } from "../src/baobab/b2b"

// A minimal fake of B2BModuleService covering only the two methods
// resolveBuyerContext calls -- consistent with this test suite's existing
// convention of testing src/baobab business logic against hand-built
// fakes/fixtures rather than a running Medusa app (see tests/b2b-policy.test.ts,
// tests/b2b-threat-model.test.ts).
function fakeB2BModuleService(options: {
  memberships: Array<{
    id: string
    organisation_id: string
    customer_id: string
    principal_id: string
    status: string
  }>
  roles: Array<{ id: string; membership_id: string; role: string }>
}) {
  return {
    listBuyerMemberships: async (filter: { organisation_id: string; customer_id: string }) =>
      options.memberships.filter(
        (m) => m.organisation_id === filter.organisation_id && m.customer_id === filter.customer_id,
      ),
    listBuyerRoles: async (filter: { membership_id: string }) =>
      options.roles.filter((r) => r.membership_id === filter.membership_id),
  } as any
}

describe("resolveBuyerContext", () => {
  it("returns null when the customer has no membership in the organisation", async () => {
    const b2b = fakeB2BModuleService({ memberships: [], roles: [] })
    const context = await resolveBuyerContext(b2b, "org-1", "cus-1")
    expect(context).toBeNull()
  })

  it("assembles a BuyerContext from real membership and role rows", async () => {
    const b2b = fakeB2BModuleService({
      memberships: [
        {
          id: "mem-1",
          organisation_id: "org-1",
          customer_id: "cus-1",
          principal_id: "principal-1",
          status: "ACTIVE",
        },
      ],
      roles: [
        { id: "role-1", membership_id: "mem-1", role: "BUYER" },
        { id: "role-2", membership_id: "mem-1", role: "APPROVER" },
      ],
    })
    const context = await resolveBuyerContext(b2b, "org-1", "cus-1")
    expect(context).toEqual({
      principalId: "principal-1",
      customerId: "cus-1",
      organisationId: "org-1",
      membershipId: "mem-1",
      membershipStatus: "ACTIVE",
      roles: ["BUYER", "APPROVER"],
    })
  })

  it("never returns another organisation's membership for the same customer", async () => {
    const b2b = fakeB2BModuleService({
      memberships: [
        {
          id: "mem-other",
          organisation_id: "org-2",
          customer_id: "cus-1",
          principal_id: "principal-1",
          status: "ACTIVE",
        },
      ],
      roles: [],
    })
    const context = await resolveBuyerContext(b2b, "org-1", "cus-1")
    expect(context).toBeNull()
  })

  it("surfaces a non-ACTIVE membership rather than hiding it as no membership", async () => {
    const b2b = fakeB2BModuleService({
      memberships: [
        {
          id: "mem-1",
          organisation_id: "org-1",
          customer_id: "cus-1",
          principal_id: "principal-1",
          status: "SUSPENDED",
        },
      ],
      roles: [],
    })
    const context = await resolveBuyerContext(b2b, "org-1", "cus-1")
    expect(context?.membershipStatus).toBe("SUSPENDED")
  })
})
