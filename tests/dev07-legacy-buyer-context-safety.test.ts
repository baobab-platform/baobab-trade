import { MedusaError } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"
import { resolveBuyerContext } from "../src/baobab/b2b/context-resolver"
import { GET } from "../src/api/store/b2b/context/route"
import { B2B_MODULE } from "../src/modules/b2b"

type Membership = {
  id: string
  organisation_id: string
  customer_id: string
  principal_id: string
  status: string
  effective_from?: string | null
  effective_until?: string | null
}

const member = (changes: Partial<Membership> = {}): Membership => ({
  id: "mem-1",
  organisation_id: "org-1",
  customer_id: "cus-1",
  principal_id: "principal-1",
  status: "ACTIVE",
  ...changes,
})

const contextFor = async (
  memberships: Membership[],
  roles: { id: string; membership_id: string; role: string }[] = [],
) =>
  resolveBuyerContext(
    {
      listBuyerMemberships: async (filter: { organisation_id: string; customer_id: string }) =>
        memberships.filter(
          (m) => m.organisation_id === filter.organisation_id && m.customer_id === filter.customer_id,
        ),
      listBuyerRoles: async (filter: { membership_id: string }) =>
        roles.filter((r) => r.membership_id === filter.membership_id),
    } as never,
    "org-1",
    "cus-1",
  )

/**
 * Source-level hardening of the legacy Medusa session read path only.
 * Passing these tests is not joined IAM/CP identity or INT-05 qualification.
 */
describe("DEV-07 legacy buyer context fails closed", () => {
  it("accepts the active membership within its inclusive-start, exclusive-end interval", async () => {
    const now = Date.now()
    const context = await contextFor([
      member({
        effective_from: new Date(now - 60_000).toISOString(),
        effective_until: new Date(now + 60_000).toISOString(),
      }),
    ])
    expect(context?.membershipId).toBe("mem-1")
  })

  it.each(["future", "expired", "reversed", "malformed"] as const)(
    "refuses %s membership validity windows",
    async (caseName) => {
      const now = Date.now()
      const intervals = {
        future: {
          effective_from: new Date(now + 60_000).toISOString(),
          effective_until: new Date(now + 120_000).toISOString(),
        },
        expired: {
          effective_from: new Date(now - 120_000).toISOString(),
          effective_until: new Date(now - 60_000).toISOString(),
        },
        reversed: {
          effective_from: new Date(now + 60_000).toISOString(),
          effective_until: new Date(now - 60_000).toISOString(),
        },
        malformed: { effective_from: "not-a-date", effective_until: null },
      }
      await expect(contextFor([member(intervals[caseName])])).resolves.toBeNull()
    },
  )

  it("refuses multiple current membership rows rather than selecting the first", async () => {
    await expect(contextFor([member(), member({ id: "mem-2" })])).resolves.toBeNull()
  })

  it("refuses missing Principal and customer binding", async () => {
    await expect(contextFor([member({ principal_id: "" })])).resolves.toBeNull()
    await expect(contextFor([member({ customer_id: "" })])).resolves.toBeNull()
  })

  it("exposes only known roles bound to the exact membership", async () => {
    const context = await contextFor([member()], [
      { id: "role-1", membership_id: "mem-1", role: "BUYER" },
      { id: "role-2", membership_id: "mem-1", role: "SUPERADMIN" },
      { id: "role-3", membership_id: "other", role: "APPROVER" },
    ])
    expect(context?.roles).toEqual(["BUYER"])
  })

  it("refuses an inactive buyer organisation even with a currently active membership", async () => {
    const store = {
      listB2BOrganisations: async () => [
        {
          id: "org-1",
          canonical_organisation_id: "canon-org-1",
          tenant_id: "tenant-1",
          status: "SUSPENDED",
        },
      ],
      listBuyerMemberships: async () => [member()],
      listBuyerRoles: async () => [{ id: "role-1", membership_id: "mem-1", role: "BUYER" }],
    }
    const req = {
      query: { canonical_organisation_id: "canon-org-1" },
      auth_context: { actor_id: "cus-1", actor_type: "customer" },
      headers: {},
      scope: { resolve: (name: string) => (name === B2B_MODULE ? store : undefined) },
    }
    await expect(GET(req as never, {} as never)).rejects.toMatchObject({
      type: MedusaError.Types.FORBIDDEN,
    })
  })
})
