import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/store/b2b/applications/[id]/evidence/route"
import { assertVerifiedBuyerKybPackage } from "../src/baobab/b2b/kyb-evidence"

const oldTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
afterEach(() => {
  if (oldTenant === undefined) delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
  else process.env.BAOBAB_ZURIBEANS_TENANT_ID = oldTenant
})

const response = () => {
  const res: any = {
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body },
  }
  return res
}

describe("ZB-04 buyer KYB evidence", () => {
  it("records only canonical document metadata for the owning applicant", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const createBuyerApplicationEvidences = vi.fn(async (input) => ({ id: "b2bevd_1", ...input }))
    const b2b = {
      listBuyerApplicationEvidences: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => ({
        id: "b2bapp_1",
        tenant_id: "tn_zuribeans",
        applicant_customer_id: "cus_1",
        status: "INFORMATION_REQUIRED",
      })),
      createBuyerApplicationEvidences,
    }
    const req = {
      auth_context: {
        actor_id: "cus_1",
        app_metadata: { baobab_principal_id: "prn_buyer_1" },
      },
      params: { id: "b2bapp_1" },
      headers: { "idempotency-key": "kyb-evidence-submit-0001" },
      body: {
        evidence_type: "COMPANY_REGISTRATION",
        canonical_document_id: "doc_01K5REGISTRATION",
        document_version: "1",
        content_sha256: "a".repeat(64),
        media_type: "application/pdf",
        size_bytes: 4096,
      },
      scope: { resolve: () => b2b },
    }
    const res = response()
    await POST(req as never, res)
    expect(createBuyerApplicationEvidences).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "tn_zuribeans",
      application_id: "b2bapp_1",
      canonical_document_id: "doc_01K5REGISTRATION",
      content_sha256: "a".repeat(64),
      status: "PENDING",
      submitted_by_customer_id: "cus_1",
    }))
    expect(res.statusCode).toBe(201)
  })

  it("does not disclose another applicant's application", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const b2b = {
      listBuyerApplicationEvidences: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => ({
        id: "b2bapp_1",
        tenant_id: "tn_zuribeans",
        applicant_customer_id: "cus_other",
        status: "SUBMITTED",
      })),
      createBuyerApplicationEvidences: vi.fn(),
    }
    const req = {
      auth_context: { actor_id: "cus_attacker" },
      params: { id: "b2bapp_1" },
      headers: { "idempotency-key": "kyb-evidence-submit-0002" },
      body: {
        evidence_type: "COMPANY_REGISTRATION",
        canonical_document_id: "doc_1",
        document_version: "1",
        content_sha256: "b".repeat(64),
        media_type: "application/pdf",
        size_bytes: 100,
      },
      scope: { resolve: () => b2b },
    }
    await expect(POST(req as never, response())).rejects.toThrow("buyer application was not found")
    expect(b2b.createBuyerApplicationEvidences).not.toHaveBeenCalled()
  })

  it("blocks review when the verified baseline package is incomplete", async () => {
    const b2b = {
      listBuyerApplicationEvidences: vi.fn(async () => [
        { evidence_type: "COMPANY_REGISTRATION" },
      ]),
    }
    await expect(
      assertVerifiedBuyerKybPackage(b2b as never, "b2bapp_1", "tn_zuribeans"),
    ).rejects.toThrow("TAX_REGISTRATION, AUTHORIZED_REPRESENTATIVE")
  })
})
