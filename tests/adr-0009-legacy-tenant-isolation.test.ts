import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../src/modules/b2b"
import { GET as getMe } from "../src/api/store/b2b/organisations/me/route"
import {
  GET as getMembers,
  POST as inviteMember,
} from "../src/api/store/b2b/organisations/[id]/members/route"
import {
  GET as getSites,
  POST as createSite,
} from "../src/api/store/b2b/organisations/[id]/delivery-sites/route"
import {
  GET as getTax,
  POST as createTax,
} from "../src/api/store/b2b/organisations/[id]/tax-registrations/route"
import { POST as resend } from "../src/api/store/b2b/organisations/[id]/members/[membershipId]/resend/route"
import { POST as revoke } from "../src/api/store/b2b/organisations/[id]/members/[membershipId]/revoke/route"
import { POST as acceptInvitation } from "../src/api/store/b2b/invitations/accept/route"
import { GET as legacyContext } from "../src/api/store/b2b/context/route"
import {
  assertLegacyTenantOwnership,
  requireLegacyTenantOrganisation,
} from "../src/baobab/b2b/legacy-tenant-scope"

const local = { id: "org-a", tenant_id: "tenant-a", status: "ACTIVE", legal_name: "Local buyer" }
const foreign = {
  id: "org-b",
  tenant_id: "tenant-b",
  status: "ACTIVE",
  legal_name: "Foreign buyer",
}
const principal = { actor_id: "cus-1", app_metadata: { baobab_principal_id: "principal-1" } }
const originalTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
const originalUrl = process.env.ZURIBEANS_PUBLIC_URL
const originalTemplate = process.env.BAOBAB_BUYER_INVITATION_TEMPLATE

beforeEach(() => {
  process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tenant-a"
  process.env.ZURIBEANS_PUBLIC_URL = "https://buyer.example.test"
  process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = "buyer-invite"
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const [name, original] of [
    ["BAOBAB_ZURIBEANS_TENANT_ID", originalTenant],
    ["ZURIBEANS_PUBLIC_URL", originalUrl],
    ["BAOBAB_BUYER_INVITATION_TEMPLATE", originalTemplate],
  ] as const) {
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
})

const response = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value
      return res
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      return res
    },
  }
  return res
}

const baseRequest = (service: Record<string, unknown>) => ({
  auth_context: principal,
  params: { id: foreign.id, membershipId: "member-b" },
  query: { canonical_organisation_id: "canon-foreign" },
  headers: { "idempotency-key": "cross-tenant-attack-0001" },
  body: { email: "victim@example.test", invitation_token: "foreign-token" },
  scope: { resolve: () => service },
})

describe("ADR-0009 TEN-COM-007/008/009/017 legacy B2B tenant boundaries", () => {
  it("rejects a cross-tenant organisation by ID regardless of any membership record", async () => {
    const service = {
      retrieveB2BOrganisation: vi.fn(async () => foreign),
      listBuyerMemberships: vi.fn(async () => [
        { organisation_id: foreign.id, customer_id: "cus-1", status: "ACTIVE" },
      ]),
    }
    await expect(
      requireLegacyTenantOrganisation(service as never, foreign.id),
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(service.listBuyerMemberships).not.toHaveBeenCalled()
  })

  it("refuses a lookup whose data source returns an unrelated or unowned organisation", () => {
    expect(() => assertLegacyTenantOwnership(foreign, foreign.id)).toThrow(
      "buyer organisation was not found",
    )
    expect(() => assertLegacyTenantOwnership(local, foreign.id)).toThrow(
      "buyer organisation was not found",
    )
    expect(() => assertLegacyTenantOwnership({ ...local, tenant_id: "" }, local.id)).toThrow(
      "buyer organisation was not found",
    )
    expect(() => assertLegacyTenantOwnership(local, local.id)).not.toThrow()
  })

  it("fails closed without a configured trusted tenant before touching storage", async () => {
    delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
    const service = { retrieveB2BOrganisation: vi.fn(async () => local) }
    await expect(requireLegacyTenantOrganisation(service as never, local.id)).rejects.toThrow(
      "BAOBAB_ZURIBEANS_TENANT_ID",
    )
    expect(service.retrieveB2BOrganisation).not.toHaveBeenCalled()
  })

  it.each([
    ["members GET", getMembers, false],
    ["members invitation POST", inviteMember, true],
    ["sites GET", getSites, false],
    ["sites POST", createSite, true],
    ["tax GET", getTax, false],
    ["tax POST", createTax, true],
    ["invitation resend", resend, true],
    ["invitation revoke", revoke, true],
  ] as const)(
    "refuses foreign-tenant %s before membership reads or business mutations",
    async (_name, handler, _mutating) => {
      const service = {
        retrieveB2BOrganisation: vi.fn(async () => foreign),
        listBuyerMemberships: vi.fn(async () => []),
        listBuyerRoles: vi.fn(async () => []),
        listDeliverySites: vi.fn(),
        listTaxRegistrations: vi.fn(),
        createDeliverySites: vi.fn(),
        createTaxRegistrations: vi.fn(),
        createBuyerMemberships: vi.fn(),
        updateBuyerMemberships: vi.fn(),
        createNotifications: vi.fn(),
      }
      const request = baseRequest(service)
      await expect(handler(request as never, response() as never)).rejects.toMatchObject({
        type: MedusaError.Types.NOT_FOUND,
      })
      expect(service.retrieveB2BOrganisation).toHaveBeenCalledTimes(1)
      expect(service.listBuyerMemberships).not.toHaveBeenCalled()
      expect(service.listBuyerRoles).not.toHaveBeenCalled()
      expect(service.listDeliverySites).not.toHaveBeenCalled()
      expect(service.listTaxRegistrations).not.toHaveBeenCalled()
      expect(service.createDeliverySites).not.toHaveBeenCalled()
      expect(service.createTaxRegistrations).not.toHaveBeenCalled()
      expect(service.createBuyerMemberships).not.toHaveBeenCalled()
      expect(service.updateBuyerMemberships).not.toHaveBeenCalled()
    },
  )

  it("refuses foreign-tenant invitation acceptance before binding the customer or changing membership", async () => {
    const service = {
      listBuyerMemberships: vi.fn(async (filter: Record<string, unknown>) =>
        "invitation_token_hash" in filter
          ? [
              {
                id: "member-b",
                organisation_id: foreign.id,
                invited_email: "victim@example.test",
                status: "INVITED",
              },
            ]
          : [],
      ),
      retrieveB2BOrganisation: vi.fn(async () => foreign),
      updateBuyerMemberships: vi.fn(),
    }
    const customer = { retrieveCustomer: vi.fn(async () => ({ email: "victim@example.test" })) }
    const req = {
      ...baseRequest(service),
      scope: {
        resolve: (key: string) =>
          key === B2B_MODULE ? service : key === Modules.CUSTOMER ? customer : null,
      },
    }
    // The handler verifies customer email before the organisation guard, but
    // MUST refuse cross-tenant state before any membership mutation.
    await expect(acceptInvitation(req as never, response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(service.updateBuyerMemberships).not.toHaveBeenCalled()
  })

  it("filters both foreign organisations and foreign applications from /me even if the source ignores its filters", async () => {
    const service = {
      listBuyerMemberships: vi.fn(async () => [
        { id: "mem-a", organisation_id: local.id, customer_id: "cus-1", status: "ACTIVE" },
        { id: "mem-b", organisation_id: foreign.id, customer_id: "cus-1", status: "ACTIVE" },
      ]),
      listBuyerApplications: vi.fn(async () => [
        { id: "app-a", tenant_id: "tenant-a", applicant_customer_id: "cus-1", status: "SUBMITTED" },
        { id: "app-b", tenant_id: "tenant-b", applicant_customer_id: "cus-1", status: "SUBMITTED" },
      ]),
      listB2BOrganisations: vi.fn(async () => [local, foreign]),
    }
    const res = response()
    await getMe(baseRequest(service) as never, res as never)
    expect(service.listB2BOrganisations).toHaveBeenCalledWith({
      id: [local.id, foreign.id],
      tenant_id: "tenant-a",
    })
    const body = res.body as {
      organisations: Array<{ organisation: { id: string } }>
      applications: Array<{ id: string }>
    }
    expect(body.organisations.map(({ organisation }) => organisation.id)).toEqual([local.id])
    expect(body.applications.map(({ id }) => id)).toEqual(["app-a"])
    expect(JSON.stringify(body)).not.toContain("tenant-b")
    expect(JSON.stringify(body)).not.toContain("org-b")
  })

  it("does not resolve a foreign tenant through legacy canonical buyer-context even with a valid local membership", async () => {
    const service = {
      listB2BOrganisations: vi.fn(async () => [
        { ...foreign, canonical_organisation_id: "canon-foreign" },
      ]),
      listBuyerMemberships: vi.fn(),
      listBuyerRoles: vi.fn(),
    }
    await expect(
      legacyContext(baseRequest(service) as never, response() as never),
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(service.listBuyerMemberships).not.toHaveBeenCalled()
  })
})
