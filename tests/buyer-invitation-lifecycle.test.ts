import { afterEach, describe, expect, it, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { POST as resend } from "../src/api/store/b2b/organisations/[id]/members/[membershipId]/resend/route"
import { POST as revoke } from "../src/api/store/b2b/organisations/[id]/members/[membershipId]/revoke/route"
import { B2B_MODULE } from "../src/modules/b2b"

const oldUrl = process.env.ZURIBEANS_PUBLIC_URL
const oldTemplate = process.env.BAOBAB_BUYER_INVITATION_TEMPLATE
afterEach(() => {
  if (oldUrl === undefined) delete process.env.ZURIBEANS_PUBLIC_URL
  else process.env.ZURIBEANS_PUBLIC_URL = oldUrl
  if (oldTemplate === undefined) delete process.env.BAOBAB_BUYER_INVITATION_TEMPLATE
  else process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = oldTemplate
})

const response = () => {
  const res: any = { status(code: number) { this.statusCode = code; return this }, json(body: unknown) { this.body = body } }
  return res
}

const auth = { actor_id: "cus_admin", app_metadata: { baobab_principal_id: "prn_admin" } }

describe("buyer invitation lifecycle", () => {
  it("rotates a token and records a durable resend attempt", async () => {
    process.env.ZURIBEANS_PUBLIC_URL = "https://zuribeans.example"
    process.env.BAOBAB_BUYER_INVITATION_TEMPLATE = "buyer-invite"
    const b2b = {
      listBuyerMemberships: vi.fn(async () => [{ id: "b2bmem_admin" }]),
      listBuyerRoles: vi.fn(async () => [{ role: "ACCOUNT_ADMIN" }]),
      retrieveBuyerMembership: vi.fn(async () => ({
        id: "b2bmem_invite", organisation_id: "b2borg_1", status: "INVITED",
        invited_email: "buyer@example.com", invitation_token_hash: "old-hash",
        invitation_expires_at: new Date(Date.now() + 1000),
      })),
      listBuyerInvitationDeliveries: vi.fn(async () => [{ attempt_number: 1 }]),
      updateBuyerMemberships: vi.fn(async () => ({})),
      createBuyerInvitationDeliveries: vi.fn(async (input) => ({ id: "delivery_2", ...input })),
      updateBuyerInvitationDeliveries: vi.fn(async () => ({})),
      retrieveB2BOrganisation: vi.fn(async () => ({ legal_name: "Acme" })),
    }
    const notification = { createNotifications: vi.fn(async () => ({ id: "msg_2" })) }
    const req = {
      auth_context: auth,
      params: { id: "b2borg_1", membershipId: "b2bmem_invite" },
      headers: { "idempotency-key": "buyer-invite-resend-0001" },
      scope: { resolve: (key: string) => key === B2B_MODULE ? b2b : key === Modules.NOTIFICATION ? notification : null },
    }
    const res = response()
    await resend(req as never, res)
    expect(b2b.createBuyerInvitationDeliveries).toHaveBeenCalledWith(expect.objectContaining({
      membership_id: "b2bmem_invite", attempt_number: 2, status: "PENDING",
    }))
    expect(b2b.updateBuyerInvitationDeliveries).toHaveBeenCalledWith("delivery_2", {
      status: "QUEUED", provider_message_id: "msg_2",
    })
    expect(JSON.stringify(res.body)).not.toContain("token")
    expect(res.statusCode).toBe(202)
  })

  it("revokes an invitation and clears bearer-token authority", async () => {
    const b2b = {
      listBuyerMemberships: vi.fn(async () => [{ id: "b2bmem_admin" }]),
      listBuyerRoles: vi.fn(async () => [{ role: "ACCOUNT_ADMIN" }]),
      retrieveBuyerMembership: vi.fn(async () => ({
        id: "b2bmem_invite", organisation_id: "b2borg_1", status: "INVITED",
      })),
      updateBuyerMemberships: vi.fn(async (_id, patch) => ({ id: "b2bmem_invite", ...patch })),
    }
    const req = {
      auth_context: auth,
      params: { id: "b2borg_1", membershipId: "b2bmem_invite" },
      scope: { resolve: () => b2b },
    }
    const res = response()
    await revoke(req as never, res)
    expect(b2b.updateBuyerMemberships).toHaveBeenCalledWith("b2bmem_invite", expect.objectContaining({
      status: "REVOKED", invitation_token_hash: null, invitation_expires_at: null,
    }))
    expect(res.body).toEqual({ membership_id: "b2bmem_invite", status: "REVOKED" })
  })
})
