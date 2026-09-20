import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/events/inbound/erp/route"
import { B2B_MODULE } from "../src/modules/b2b"
import { ERP_INTEGRATION_MODULE } from "../src/modules/erp-integration"
import { EVENT_OUTBOX_MODULE } from "../src/modules/event-outbox"

const previousTenant = process.env.BAOBAB_ZURIBEANS_TENANT_ID
const previousSecret = process.env.BAOBAB_WEBHOOK_SIGNING_SECRET

afterEach(() => {
  vi.restoreAllMocks()
  if (previousTenant === undefined) delete process.env.BAOBAB_ZURIBEANS_TENANT_ID
  else process.env.BAOBAB_ZURIBEANS_TENANT_ID = previousTenant
  if (previousSecret === undefined) delete process.env.BAOBAB_WEBHOOK_SIGNING_SECRET
  else process.env.BAOBAB_WEBHOOK_SIGNING_SECRET = previousSecret
})

const event = (status: "APPROVED" | "ON_HOLD" | "REJECTED" = "APPROVED") => ({
  specversion: "1.0",
  id: "72cdfafb-99a2-4eb1-b109-512a3ff6456a",
  type: "com.baobab-platform.customer.buyer-commercial-profile.changed.v1",
  source: "urn:baobab-platform:baobab-erp",
  time: "2026-09-20T18:00:00.000Z",
  tenantid: "tn_zuribeans",
  entityid: "le_zuribeans_za",
  correlationid: "0d954527-116c-4684-8772-49b9a84f884d",
  data: {
    buyer_organisation_id: "b2borg_1",
    tenant_id: "tn_zuribeans",
    legal_entity_id: "le_zuribeans_za",
    source_system: "ERP",
    credit_status: status,
    payment_term_code: status === "APPROVED" ? "NET_30" : null,
    credit_limit_minor: status === "APPROVED" ? 500000 : null,
    currency_code: "ZAR",
    profile_reference: "ERP-PROFILE-1",
    business_partner_id: "BP-10001",
    as_of: "2026-09-20T18:00:00.000Z",
  },
})

const response = () => {
  const res: any = {
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body },
  }
  return res
}

const request = (body: ReturnType<typeof event>, organisationStatus = "PENDING") => {
  process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
  process.env.BAOBAB_WEBHOOK_SIGNING_SECRET = "test-secret"
  const b2b = {
    retrieveB2BOrganisation: vi.fn(async () => ({
      id: "b2borg_1",
      tenant_id: "tn_zuribeans",
      canonical_organisation_id: "canorg_1",
      erp_business_partner_id: null,
      status: organisationStatus,
    })),
    updateB2BOrganisations: vi.fn(async (_id, patch) => ({ id: "b2borg_1", ...patch })),
  }
  const erp = {
    createBuyerCommercialProfileProjections: vi.fn(async (input) => ({ id: "erpbcp_1", ...input })),
    deleteBuyerCommercialProfileProjections: vi.fn(),
  }
  const events = {
    listEventConsumerReceipts: vi.fn(async () => []),
    createEventConsumerReceipts: vi.fn(async () => ({ id: "evtrec_1" })),
    deleteEventConsumerReceipts: vi.fn(),
    createEventOutboxes: vi.fn(async () => ({ id: "evtout_1" })),
  }
  const signature = createHmac("sha256", "test-secret").update(JSON.stringify(body)).digest("hex")
  return {
    req: {
      body,
      headers: { "x-baobab-signature": `sha256=${signature}` },
      scope: { resolve: (key: string) =>
        key === B2B_MODULE ? b2b : key === ERP_INTEGRATION_MODULE ? erp : events },
    },
    b2b,
    erp,
    events,
  }
}

describe("ZB-04 ERP commercial profile consumer", () => {
  it("activates a pending buyer only from an approved ERP projection", async () => {
    const fixture = request(event("APPROVED"))
    const res = response()
    await POST(fixture.req as never, res)
    expect(fixture.erp.createBuyerCommercialProfileProjections).toHaveBeenCalled()
    expect(fixture.b2b.updateB2BOrganisations).toHaveBeenCalledWith("b2borg_1", {
      status: "ACTIVE",
      erp_business_partner_id: "BP-10001",
    })
    expect(fixture.events.createEventConsumerReceipts).toHaveBeenCalled()
    expect(fixture.events.createEventOutboxes).toHaveBeenCalledWith(expect.objectContaining({
      causation_id: event().id,
      idempotency_key: `buyer-activation:${event().id}`,
    }))
    expect(res.statusCode).toBe(202)
  })

  it.each(["ON_HOLD", "REJECTED"] as const)("records %s without activating", async (status) => {
    const fixture = request(event(status))
    await POST(fixture.req as never, response())
    expect(fixture.erp.createBuyerCommercialProfileProjections).toHaveBeenCalled()
    expect(fixture.b2b.updateB2BOrganisations).toHaveBeenCalledWith("b2borg_1", {
      erp_business_partner_id: "BP-10001",
    })
    expect(fixture.events.createEventOutboxes).not.toHaveBeenCalled()
  })

  it("rejects an invalid signature before applying effects", async () => {
    const fixture = request(event())
    fixture.req.headers["x-baobab-signature"] = "sha256=" + "0".repeat(64)
    await expect(POST(fixture.req as never, response())).rejects.toThrow("invalid ERP event signature")
    expect(fixture.erp.createBuyerCommercialProfileProjections).not.toHaveBeenCalled()
  })

  it("deduplicates a redelivered event", async () => {
    const fixture = request(event())
    fixture.events.listEventConsumerReceipts.mockResolvedValueOnce([{ id: "evtrec_existing" }])
    const res = response()
    await POST(fixture.req as never, res)
    expect(res.body).toEqual({ status: "ALREADY_PROCESSED", event_id: event().id })
    expect(fixture.erp.createBuyerCommercialProfileProjections).not.toHaveBeenCalled()
  })
})
