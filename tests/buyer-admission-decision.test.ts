import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/admin/b2b/applications/[id]/decision/route"
import { CANONICAL_ORGANISATION_VERIFIER } from "../src/baobab/b2b/canonical-organisation-verifier"
import { B2B_MODULE } from "../src/modules/b2b"
import { EVENT_OUTBOX_MODULE } from "../src/modules/event-outbox"

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

const application = {
  id: "b2bapp_1",
  tenant_id: "tn_zuribeans",
  applicant_customer_id: "cus_1",
  applicant_principal_id: "prn_buyer_1",
  legal_name: "Acme Procurement",
  trading_name: null,
  registration_number: "REG-1",
  status: "UNDER_REVIEW",
  revision: 2,
}

const request = (decision: "APPROVED" | "REJECTED", scope: { resolve: (key: string) => unknown }) => ({
  auth_context: {
    actor_id: "user_1",
    app_metadata: { baobab_principal_id: "prn_staff_1" },
  },
  params: { id: application.id },
  headers: { "idempotency-key": `admission-decision-${decision.toLowerCase()}` },
  body: {
    decision,
    decision_reference: `DECISION-${decision}`,
    reason_code: decision === "APPROVED" ? "KYB_ACCEPTED" : "KYB_REJECTED",
    canonical_organisation_id: decision === "APPROVED" ? "canorg_1" : undefined,
    expected_revision: 2,
  },
  scope,
})

describe("ZB-04 admission decision", () => {
  it("fails closed when canonical verification is unavailable", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const b2b = {
      listBuyerApplicationDecisions: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => application),
    }
    const scope = {
      resolve: (key: string) => {
        if (key === B2B_MODULE) return b2b
        if (key === EVENT_OUTBOX_MODULE) return {}
        if (key === CANONICAL_ORGANISATION_VERIFIER) throw new Error("not registered")
        return null
      },
    }

    await expect(POST(request("APPROVED", scope) as never, response() as never)).rejects.toThrow(
      "canonical organisation verification is not configured",
    )
  })

  it("provisions the initial organisation, membership and role only after verification", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const b2b = {
      listBuyerApplicationDecisions: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => application),
      createB2BOrganisations: vi.fn(async (input) => ({ id: "b2borg_1", ...input })),
      createBuyerMemberships: vi.fn(async (input) => ({ id: "b2bmem_1", ...input })),
      createBuyerRoles: vi.fn(async (input) => ({ id: "b2brole_1", ...input })),
      createBuyerApplicationDecisions: vi.fn(async (input) => ({ id: "b2bdec_1", ...input })),
      updateBuyerApplications: vi.fn(async (_id, patch) => ({ ...application, ...patch })),
      deleteB2BOrganisations: vi.fn(),
      deleteBuyerMemberships: vi.fn(),
      deleteBuyerRoles: vi.fn(),
      deleteBuyerApplicationDecisions: vi.fn(),
    }
    const outbox = {
      createEventOutboxes: vi.fn(async (input) => ({ id: "evtout_1", ...input })),
      deleteEventOutboxes: vi.fn(),
    }
    const verifier = {
      verify: vi.fn(async () => ({
        verified: true,
        canonicalOrganisationId: "canorg_1",
        kind: "BUYER_ORGANISATION" as const,
        verifiedAt: new Date().toISOString(),
      })),
    }
    const scope = {
      resolve: (key: string) => {
        if (key === B2B_MODULE) return b2b
        if (key === EVENT_OUTBOX_MODULE) return outbox
        if (key === CANONICAL_ORGANISATION_VERIFIER) return verifier
        return null
      },
    }
    const res = response()

    await POST(request("APPROVED", scope) as never, res as never)

    expect(verifier.verify).toHaveBeenCalledWith({
      tenantId: "tn_zuribeans",
      canonicalOrganisationId: "canorg_1",
      expectedKind: "BUYER_ORGANISATION",
    })
    expect(b2b.createB2BOrganisations).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tn_zuribeans",
        status: "PENDING",
        canonical_organisation_id: "canorg_1",
      }),
    )
    expect(b2b.createBuyerMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus_1",
        principal_id: "prn_buyer_1",
        status: "ACTIVE",
      }),
    )
    expect(b2b.createBuyerRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "ACCOUNT_ADMIN",
        assigned_by_principal_id: "prn_staff_1",
      }),
    )
    expect(outbox.createEventOutboxes).toHaveBeenCalledTimes(3)
    expect(outbox.createEventOutboxes).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "com.baobab-platform.customer.buyer-application.decision-recorded.v1",
        tenant_id: "tn_zuribeans",
        status: "PENDING",
      }),
    )
    expect(outbox.createEventOutboxes).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "com.baobab-platform.customer.buyer-organisation.registered.v1",
        envelope: expect.objectContaining({
          data: expect.objectContaining({
            buyer_organisation_id: "b2borg_1",
            canonical_organisation_id: "canorg_1",
            source_application_id: "b2bapp_1",
            status: "PENDING",
          }),
        }),
      }),
    )
    expect(outbox.createEventOutboxes).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "com.baobab-platform.customer.buyer-membership.changed.v1",
        envelope: expect.objectContaining({
          data: expect.objectContaining({
            buyer_membership_id: "b2bmem_1",
            principal_id: "prn_buyer_1",
            customer_id: "cus_1",
            roles: ["ACCOUNT_ADMIN"],
          }),
        }),
      }),
    )
    expect(b2b.updateBuyerApplications).toHaveBeenCalledWith(application.id, {
      status: "APPROVED",
      revision: 3,
    })
    expect(res.statusCode).toBe(200)
  })

  it("records rejection without creating buyer authority", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const b2b = {
      listBuyerApplicationDecisions: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => application),
      createB2BOrganisations: vi.fn(),
      createBuyerMemberships: vi.fn(),
      createBuyerRoles: vi.fn(),
      createBuyerApplicationDecisions: vi.fn(async (input) => ({ id: "b2bdec_1", ...input })),
      updateBuyerApplications: vi.fn(async (_id, patch) => ({ ...application, ...patch })),
      deleteBuyerApplicationDecisions: vi.fn(),
    }
    const outbox = {
      createEventOutboxes: vi.fn(async (input) => ({ id: "evtout_1", ...input })),
      deleteEventOutboxes: vi.fn(),
    }
    const scope = {
      resolve: (key: string) => {
        if (key === B2B_MODULE) return b2b
        if (key === EVENT_OUTBOX_MODULE) return outbox
        return null
      },
    }

    await POST(request("REJECTED", scope) as never, response() as never)

    expect(b2b.createB2BOrganisations).not.toHaveBeenCalled()
    expect(b2b.createBuyerMemberships).not.toHaveBeenCalled()
    expect(b2b.createBuyerRoles).not.toHaveBeenCalled()
    expect(b2b.updateBuyerApplications).toHaveBeenCalledWith(application.id, {
      status: "REJECTED",
      revision: 3,
    })
  })

  it("compensates provisioned authority if the final application projection fails", async () => {
    process.env.BAOBAB_ZURIBEANS_TENANT_ID = "tn_zuribeans"
    const deletionOrder: string[] = []
    const b2b = {
      listBuyerApplicationDecisions: vi.fn(async () => []),
      retrieveBuyerApplication: vi.fn(async () => application),
      createB2BOrganisations: vi.fn(async () => ({ id: "b2borg_1" })),
      createBuyerMemberships: vi.fn(async () => ({ id: "b2bmem_1" })),
      createBuyerRoles: vi.fn(async () => ({ id: "b2brole_1" })),
      createBuyerApplicationDecisions: vi.fn(async () => ({ id: "b2bdec_1" })),
      updateBuyerApplications: vi.fn(async () => {
        throw new Error("application update failed")
      }),
      deleteB2BOrganisations: vi.fn(async () => deletionOrder.push("organisation")),
      deleteBuyerMemberships: vi.fn(async () => deletionOrder.push("membership")),
      deleteBuyerRoles: vi.fn(async () => deletionOrder.push("role")),
      deleteBuyerApplicationDecisions: vi.fn(async () => deletionOrder.push("decision")),
    }
    const outbox = {
      createEventOutboxes: vi.fn(async () => ({ id: "evtout_1" })),
      deleteEventOutboxes: vi.fn(async () => deletionOrder.push("outbox")),
    }
    const verifier = {
      verify: vi.fn(async () => ({
        verified: true,
        canonicalOrganisationId: "canorg_1",
        kind: "BUYER_ORGANISATION" as const,
        verifiedAt: new Date().toISOString(),
      })),
    }
    const scope = {
      resolve: (key: string) => {
        if (key === B2B_MODULE) return b2b
        if (key === EVENT_OUTBOX_MODULE) return outbox
        if (key === CANONICAL_ORGANISATION_VERIFIER) return verifier
        return null
      },
    }

    await expect(POST(request("APPROVED", scope) as never, response() as never)).rejects.toThrow(
      "application update failed",
    )
    expect(deletionOrder).toEqual([
      "outbox",
      "outbox",
      "outbox",
      "decision",
      "role",
      "membership",
      "organisation",
    ])
  })
})
