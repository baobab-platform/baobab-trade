import { afterEach, describe, expect, it, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { POST as acceptInvitation } from "../src/api/store/b2b/invitations/accept/route"
import { GET as listMembers, POST as inviteMember } from "../src/api/store/b2b/organisations/[id]/members/route"
import { B2B_MODULE } from "../src/modules/b2b"

const originalPublicUrl = process.env.ZURIBEANS_PUBLIC_URL
const originalTemplate = process.env.BAOBAB_BUYER_INVITATION_TEMPLATE
afterEach(() => {
  vi.restoreAllMocks()
  if (originalPublicUrl === undefined) delete process.env.ZURIBEANS_PUBLIC_URL
  else process.env.ZURIBEANS_PUBLIC_URL = originalPublicUrl
  if (originalTemplate === undefined) delete process.env.BAOBAB_BUYER_INVITATION_TEMPLATE
  else process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = originalTemplate
})

const response = () => {
  const res: { statusCode?: number; body?: unknown; status: (code: number) => typeof res } = {
    status(code) {
      res.statusCode = code
      return res
    },
  }
  ;(res as typeof res & { json: (body: unknown) => void }).json = (body) => {
    res.body = body
  }
  return res as typeof res & { json: (body: unknown) => void }
}

describe("buyer organisation invitations", () => {
  it("lists members without evaluating invitation-only request fields", async () => {
    const b2b = {
      listBuyerMemberships: vi
        .fn()
        .mockResolvedValueOnce([{ id: "b2bmem_admin", status: "ACTIVE" }])
        .mockResolvedValueOnce([
          {
            id: "b2bmem_invited",
            customer_id: null,
            principal_id: null,
            status: "INVITED",
            invited_email: "buyer@example.com",
            invitation_accepted_at: null,
          },
        ]),
      listBuyerRoles: vi.fn(async () => [
        { membership_id: "b2bmem_invited", role: "BUYER" },
      ]),
    }
    const req = {
      auth_context: { actor_id: "cus_admin" },
      params: { id: "b2borg_1" },
      scope: { resolve: () => b2b },
    }
    const res = response()

    await listMembers(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      organisation_id: "b2borg_1",
      members: [
        expect.objectContaining({
          customer_id: null,
          principal_id: null,
          status: "INVITED",
          roles: ["BUYER"],
        }),
      ],
    })
  })

  it("requires an independently mapped canonical Principal before acceptance", async () => {
    const service = { listBuyerMemberships: vi.fn() }
    const req = {
      auth_context: { actor_id: "cus_1", app_metadata: {} },
      body: { invitation_token: "secret" },
      scope: { resolve: () => service },
    }

    await expect(acceptInvitation(req as never, response() as never)).rejects.toThrow(
      "canonical Principal mapping is required",
    )
    expect(service.listBuyerMemberships).not.toHaveBeenCalled()
  })

  it("queues secure delivery without returning the bearer token", async () => {
    process.env.ZURIBEANS_PUBLIC_URL = "https://zuribeans.example"
    process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = "buyer-invite"
    const b2b = {
      retrieveB2BOrganisation: vi.fn(async () => ({
        id: "b2borg_1",
        status: "ACTIVE",
        legal_name: "Acme",
      })),
      listBuyerMemberships: vi
        .fn()
        .mockResolvedValueOnce([{ id: "b2bmem_admin", status: "ACTIVE" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      listBuyerRoles: vi.fn(async () => [
        { membership_id: "b2bmem_admin", role: "ACCOUNT_ADMIN" },
      ]),
      createBuyerMemberships: vi.fn(async (input) => ({
        id: "b2bmem_invite",
        ...input,
      })),
      createBuyerRoles: vi.fn(async (input) => ({ id: "b2brole_1", ...input })),
      deleteBuyerRoles: vi.fn(),
      deleteBuyerMemberships: vi.fn(),
      createBuyerInvitationDeliveries: vi.fn(async (input) => ({ id: "b2binvdel_1", ...input })),
      updateBuyerInvitationDeliveries: vi.fn(async () => ({})),
    }
    const notification = { createNotifications: vi.fn(async () => ({})) }
    const req = {
      auth_context: {
        actor_id: "cus_admin",
        app_metadata: { baobab_principal_id: "prn_admin" },
      },
      params: { id: "b2borg_1" },
      headers: { "idempotency-key": "buyer-invite-key-0001" },
      body: { email: "buyer@example.com", role: "BUYER" },
      scope: {
        resolve: (key: string) => (key === B2B_MODULE ? b2b : key === Modules.NOTIFICATION ? notification : null),
      },
    }
    const res = response()

    await inviteMember(req as never, res as never)

    expect(notification.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        channel: "email",
        template: "buyer-invite",
        data: expect.objectContaining({
          invitation_url: expect.stringContaining(
            "https://zuribeans.example/account/invitations/accept?token=",
          ),
        }),
      }),
    )
    expect(JSON.stringify(res.body)).not.toContain("token")
    expect(res.statusCode).toBe(202)
  })

  it("removes invitation authority when delivery fails", async () => {
    process.env.ZURIBEANS_PUBLIC_URL = "https://zuribeans.example"
    process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = "buyer-invite"
    const deleteBuyerRoles = vi.fn(async () => undefined)
    const deleteBuyerMemberships = vi.fn(async () => undefined)
    const b2b = {
      retrieveB2BOrganisation: vi.fn(async () => ({
        id: "b2borg_1",
        status: "ACTIVE",
        legal_name: "Acme",
      })),
      listBuyerMemberships: vi
        .fn()
        .mockResolvedValueOnce([{ id: "b2bmem_admin", status: "ACTIVE" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      listBuyerRoles: vi.fn(async () => [{ role: "ACCOUNT_ADMIN" }]),
      createBuyerMemberships: vi.fn(async (input) => ({
        id: "b2bmem_invite",
        ...input,
      })),
      createBuyerRoles: vi.fn(async () => ({ id: "b2brole_1" })),
      deleteBuyerRoles,
      deleteBuyerMemberships,
      createBuyerInvitationDeliveries: vi.fn(async (input) => ({ id: "b2binvdel_1", ...input })),
      updateBuyerInvitationDeliveries: vi.fn(async () => ({})),
    }
    const req = {
      auth_context: {
        actor_id: "cus_admin",
        app_metadata: { baobab_principal_id: "prn_admin" },
      },
      params: { id: "b2borg_1" },
      headers: { "idempotency-key": "buyer-invite-key-0002" },
      body: { email: "buyer@example.com", role: "BUYER" },
      scope: {
        resolve: (key: string) =>
          key === B2B_MODULE
            ? b2b
            : { createNotifications: vi.fn(async () => { throw new Error("delivery failed") }) },
      },
    }

    await expect(inviteMember(req as never, response() as never)).rejects.toThrow(
      "delivery failed",
    )
    expect(b2b.updateBuyerInvitationDeliveries).toHaveBeenCalledWith("b2binvdel_1", {
      status: "FAILED",
      error_code: "NOTIFICATION_PROVIDER_ERROR",
    })
    expect(deleteBuyerRoles).not.toHaveBeenCalled()
    expect(deleteBuyerMemberships).not.toHaveBeenCalled()
  })
  it("binds acceptance to the authenticated customer email", async () => {
    const b2b = {
      listBuyerMemberships: vi.fn(async () => [{
        id: "b2bmem_invite",
        organisation_id: "b2borg_1",
        invited_email: "invited@example.com",
        invitation_expires_at: new Date(Date.now() + 60_000),
        status: "INVITED",
      }]),
    }
    const customer = { retrieveCustomer: vi.fn(async () => ({ email: "attacker@example.com" })) }
    const req = {
      auth_context: {
        actor_id: "cus_attacker",
        app_metadata: { baobab_principal_id: "prn_attacker" },
      },
      body: { invitation_token: "secret" },
      scope: {
        resolve: (key: string) => key === B2B_MODULE ? b2b : key === Modules.CUSTOMER ? customer : null,
      },
    }
    await expect(acceptInvitation(req as never, response() as never)).rejects.toThrow(
      "invitation is invalid or already used",
    )
  })

})
