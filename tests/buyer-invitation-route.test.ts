import { describe, expect, it, vi } from "vitest"
import { POST as acceptInvitation } from "../src/api/store/b2b/invitations/accept/route"
import { POST as inviteMember } from "../src/api/store/b2b/organisations/[id]/members/route"

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

  it("does not return bearer invitation tokens before secure delivery is configured", async () => {
    const req = {
      auth_context: {
        actor_id: "cus_admin",
        app_metadata: { baobab_principal_id: "prn_admin" },
      },
      params: { id: "b2borg_1" },
      body: { email: "buyer@example.com", role: "BUYER" },
    }

    await expect(inviteMember(req as never, response() as never)).rejects.toThrow(
      "secure invitation delivery adapter",
    )
  })
})
