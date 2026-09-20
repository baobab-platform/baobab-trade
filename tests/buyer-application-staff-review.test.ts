import { afterEach, describe, expect, it, vi } from "vitest"
import { GET as listApplications } from "../src/api/admin/b2b/applications/route"
import { POST as reviewApplication } from "../src/api/admin/b2b/applications/[id]/review/route"

const originalTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
afterEach(() => {
  vi.restoreAllMocks()
  if (originalTenant === undefined) delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
  else process.env.BAOBAB_ZURIBEANS_TENANT_ID = originalTenant
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

describe("ZB-04 staff application review", () => {
  it("always scopes the staff queue to the configured ZuriBeans tenant", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const listBuyerApplications = vi.fn(async () => [])
    const req = {
      query: { status: "SUBMITTED", limit: "25", offset: "0" },
      scope: { resolve: () => ({ listBuyerApplications }) },
    }

    await listApplications(req as never, response() as never)

    expect(listBuyerApplications).toHaveBeenCalledWith(
      { tenant_id: "tn_zuribeans", status: "SUBMITTED" },
      {
        take: 25,
        skip: 0,
        order: { created_at: "DESC" },
      },
    )
  })

  it("records an idempotent, attributable transition into review", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const application = {
      id: "b2bapp_1",
      tenant_id: "tn_zuribeans",
      status: "SUBMITTED",
      revision: 1,
    }
    const createBuyerApplicationReviewActions = vi.fn(async (input) => ({
      id: "b2brev_1",
      ...input,
    }))
    const updateBuyerApplications = vi.fn(async (_id, patch) => ({
      ...application,
      ...patch,
    }))
    const service = {
      listBuyerApplicationReviewActions: vi.fn(async () => []),
      listBuyerApplicationEvidences: vi.fn(async () => [
        { evidence_type: "COMPANY_REGISTRATION" },
        { evidence_type: "TAX_REGISTRATION" },
        { evidence_type: "AUTHORIZED_REPRESENTATIVE" },
      ]),
      retrieveBuyerApplication: vi.fn(async () => application),
      createBuyerApplicationReviewActions,
      updateBuyerApplications,
      deleteBuyerApplicationReviewActions: vi.fn(),
    }
    const req = {
      auth_context: {
        actor_id: "user_1",
        app_metadata: { baobab_principal_id: "prn_staff_1" },
      },
      params: { id: application.id },
      headers: { "idempotency-key": "staff-review-key-0001" },
      body: {
        status: "UNDER_REVIEW",
        reason_code: "REVIEW_STARTED",
        expected_revision: 1,
      },
      scope: { resolve: () => service },
    }
    const res = response()

    await reviewApplication(req as never, res as never)

    expect(createBuyerApplicationReviewActions).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tn_zuribeans",
        application_id: application.id,
        from_status: "SUBMITTED",
        to_status: "UNDER_REVIEW",
        reviewer_principal_id: "prn_staff_1",
        application_revision: 2,
      }),
    )
    expect(updateBuyerApplications).toHaveBeenCalledWith(application.id, {
      status: "UNDER_REVIEW",
      revision: 2,
      assigned_reviewer_principal_id: "prn_staff_1",
    })
    expect(res.statusCode).toBe(200)
  })

  it("does not permit an admission decision through the review endpoint", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const req = {
      auth_context: {
        actor_id: "user_1",
        app_metadata: { baobab_principal_id: "prn_staff_1" },
      },
      params: { id: "b2bapp_1" },
      headers: { "idempotency-key": "staff-review-key-0002" },
      body: {
        status: "APPROVED",
        reason_code: "APPROVED",
        expected_revision: 1,
      },
    }

    await expect(reviewApplication(req as never, response() as never)).rejects.toThrow(
      "status must be INFORMATION_REQUIRED or UNDER_REVIEW",
    )
  })

  it("hides applications belonging to another tenant", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const service = {
      listBuyerApplicationReviewActions: vi.fn(async () => []),
      listBuyerApplicationEvidences: vi.fn(async () => [
        { evidence_type: "COMPANY_REGISTRATION" },
        { evidence_type: "TAX_REGISTRATION" },
        { evidence_type: "AUTHORIZED_REPRESENTATIVE" },
      ]),
      retrieveBuyerApplication: vi.fn(async () => ({
        id: "b2bapp_other",
        tenant_id: "tn_other",
        status: "SUBMITTED",
        revision: 1,
      })),
    }
    const req = {
      auth_context: {
        actor_id: "user_1",
        app_metadata: { baobab_principal_id: "prn_staff_1" },
      },
      params: { id: "b2bapp_other" },
      headers: { "idempotency-key": "staff-review-key-0003" },
      body: {
        status: "UNDER_REVIEW",
        reason_code: "REVIEW_STARTED",
        expected_revision: 1,
      },
      scope: { resolve: () => service },
    }

    await expect(reviewApplication(req as never, response() as never)).rejects.toThrow(
      "buyer application was not found",
    )
  })

  it("compensates the audit intent if the status projection cannot be updated", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const deleteBuyerApplicationReviewActions = vi.fn(async () => undefined)
    const service = {
      listBuyerApplicationReviewActions: vi.fn(async () => []),
      listBuyerApplicationEvidences: vi.fn(async () => [
        { evidence_type: "COMPANY_REGISTRATION" },
        { evidence_type: "TAX_REGISTRATION" },
        { evidence_type: "AUTHORIZED_REPRESENTATIVE" },
      ]),
      retrieveBuyerApplication: vi.fn(async () => ({
        id: "b2bapp_1",
        tenant_id: "tn_zuribeans",
        status: "SUBMITTED",
        revision: 1,
      })),
      createBuyerApplicationReviewActions: vi.fn(async (input) => ({
        id: "b2brev_1",
        ...input,
      })),
      updateBuyerApplications: vi.fn(async () => {
        throw new Error("projection update failed")
      }),
      deleteBuyerApplicationReviewActions,
    }
    const req = {
      auth_context: {
        actor_id: "user_1",
        app_metadata: { baobab_principal_id: "prn_staff_1" },
      },
      params: { id: "b2bapp_1" },
      headers: { "idempotency-key": "staff-review-key-0004" },
      body: {
        status: "UNDER_REVIEW",
        reason_code: "REVIEW_STARTED",
        expected_revision: 1,
      },
      scope: { resolve: () => service },
    }

    await expect(reviewApplication(req as never, response() as never)).rejects.toThrow(
      "projection update failed",
    )
    expect(deleteBuyerApplicationReviewActions).toHaveBeenCalledWith("b2brev_1")
  })
})
