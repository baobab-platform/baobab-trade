import { describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/admin/b2b/organisations/[id]/status/route"

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

describe("POST /admin/b2b/organisations/:id/status", () => {
  it("rejects PENDING to ACTIVE outside the governed decision flow", async () => {
    const service = {
      retrieveB2BOrganisation: vi.fn(async () => ({ id: "b2borg_1", status: "PENDING" })),
      updateB2BOrganisations: vi.fn(),
    }
    const req = {
      params: { id: "b2borg_1" },
      body: { status: "ACTIVE", reason: "approved" },
      scope: { resolve: () => service },
    }

    await expect(POST(req as never, response() as never)).rejects.toThrow(
      "initial activation requires the governed buyer-application decision flow",
    )
    expect(service.updateB2BOrganisations).not.toHaveBeenCalled()
  })

  it("requires a reason for operational status changes", async () => {
    const service = {
      retrieveB2BOrganisation: vi.fn(),
      updateB2BOrganisations: vi.fn(),
    }
    const req = {
      params: { id: "b2borg_1" },
      body: { status: "SUSPENDED" },
      scope: { resolve: () => service },
    }

    await expect(POST(req as never, response() as never)).rejects.toThrow(
      "reason is required",
    )
    expect(service.retrieveB2BOrganisation).not.toHaveBeenCalled()
  })
})
