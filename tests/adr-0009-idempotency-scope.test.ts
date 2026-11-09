import { afterEach, describe, expect, it, vi } from "vitest"
import { MedusaError } from "@medusajs/framework/utils"
import { POST as apply } from "../src/api/store/b2b/organisations/apply/route"
import { POST as uploadEvidence } from "../src/api/store/b2b/applications/[id]/evidence/route"
import { B2B_MODULE } from "../src/modules/b2b"

const oldTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
afterEach(() => {
  if (oldTenant === undefined) delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
  else process.env.BAOBAB_ZURIBEANS_TENANT_ID = oldTenant
})

const applicationRequest = (service: unknown, actor = "cus-a") => ({
  auth_context: { actor_id: actor, actor_type: "customer" },
  headers: { "idempotency-key": "application-shared-key-0001" },
  body: { legal_name: "Acme Procurement" },
  scope: { resolve: (key: string) => key === B2B_MODULE ? service : null },
})

const evidenceRequest = (service: unknown, actor = "cus-a") => ({
  auth_context: { actor_id: actor, actor_type: "customer" },
  params: { id: "app-a" },
  headers: { "idempotency-key": "kyb-shared-key-0001" },
  body: {
    evidence_type: "COMPANY_REGISTRATION",
    canonical_document_id: "doc_0001",
    document_version: "1",
    content_sha256: "a".repeat(64),
    media_type: "application/pdf",
    size_bytes: 2048,
  },
  scope: { resolve: (key: string) => key === B2B_MODULE ? service : null },
})

const response = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
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

describe("ADR-0009 §42 additional per-buyer isolation for idempotency replays", () => {
  it("does not disclose another customer's application using its idempotency key", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tenant-a"
    const service = {
      listBuyerApplications: vi.fn(async () => [{
        tenant_id: "tenant-a",
        applicant_customer_id: "cus-b",
        id: "app-b",
        request_hash: "irrelevant",
      }]),
      createBuyerApplications: vi.fn(),
    }
    await expect(apply(applicationRequest(service) as never, response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(service.createBuyerApplications).not.toHaveBeenCalled()
  })

  it("checks application ownership before the evidence replay lookup", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tenant-a"
    const service = {
      retrieveBuyerApplication: vi.fn(async () => ({
        id: "app-a", tenant_id: "tenant-a", applicant_customer_id: "cus-b",
      })),
      listBuyerApplicationEvidences: vi.fn(),
      createBuyerApplicationEvidences: vi.fn(),
    }
    await expect(uploadEvidence(evidenceRequest(service) as never, response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(service.listBuyerApplicationEvidences).not.toHaveBeenCalled()
    expect(service.createBuyerApplicationEvidences).not.toHaveBeenCalled()
  })

  it("refuses replay evidence issued for a different application or customer", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tenant-a"
    for (const row of [
      { application_id: "app-b", submitted_by_customer_id: "cus-a" },
      { application_id: "app-a", submitted_by_customer_id: "cus-b" },
      { application_id: "app-a", submitted_by_customer_id: "cus-a", tenant_id: "tenant-b" },
    ]) {
      const service = {
        retrieveBuyerApplication: vi.fn(async () => ({
          id: "app-a", tenant_id: "tenant-a", applicant_customer_id: "cus-a", status: "SUBMITTED",
        })),
        listBuyerApplicationEvidences: vi.fn(async () => [{
          id: "evidence-other", tenant_id: "tenant-a", request_hash: "irrelevant", ...row,
        }]),
        createBuyerApplicationEvidences: vi.fn(),
      }
      await expect(uploadEvidence(evidenceRequest(service) as never, response() as never)).rejects.toMatchObject({
        type: MedusaError.Types.NOT_FOUND,
      })
      expect(service.createBuyerApplicationEvidences).not.toHaveBeenCalled()
    }
  })
})
