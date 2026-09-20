import { describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/admin/b2b/organisations/[id]/erp-projection/route"
import { B2B_MODULE } from "../src/modules/b2b"
import { EVENT_OUTBOX_MODULE } from "../src/modules/event-outbox"

describe("ZB-04 ERP projection request", () => {
  it("queues an explicitly legal-entity-scoped customer projection", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const outbox = { listEventOutboxes: vi.fn(async () => []), createEventOutboxes: vi.fn(async () => ({})) }
    const b2b = { retrieveB2BOrganisation: vi.fn(async () => ({
      id: "b2borg_1", tenant_id: "tn_zuribeans", status: "PENDING",
      canonical_organisation_id: "org_buyer_1", legal_name: "Acme", trading_name: null,
    })) }
    const req = {
      auth_context: { app_metadata: { baobab_principal_id: "prn_staff" } },
      headers: { "idempotency-key": "erp-projection-0001" },
      params: { id: "b2borg_1" },
      body: { legal_entity_id: "le_zuribeans_za", billing_country: "ZA", default_currency: "ZAR", source_version: 1 },
      scope: { resolve: (key: string) => key === B2B_MODULE ? b2b : key === EVENT_OUTBOX_MODULE ? outbox : null },
    }
    const res: any = { statusCode: 0, status(code: number) { this.statusCode=code; return this }, json(body: unknown) { this.body=body } }
    await POST(req as never, res)
    expect(res.statusCode).toBe(202)
    expect(outbox.createEventOutboxes).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "com.baobab-platform.customer.buyer-erp-projection.requested.v1",
      envelope: expect.objectContaining({ tenantid: "tn_zuribeans", entityid: "le_zuribeans_za" }),
    }))
  })
})
