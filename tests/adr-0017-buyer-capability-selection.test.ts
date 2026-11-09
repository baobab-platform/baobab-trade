import { describe, expect, it, vi } from "vitest"
import { resolveSelectedOrganisationCapability } from "../src/baobab/b2b/capability-selection"
import { GET } from "../src/api/store/b2b/capabilities/route"

const now = Date.parse("2026-11-09T11:00:00Z")
const member = {
  id:"mem_1",organisation_id:"org_a",customer_id:"cus_1",
  principal_id:"prn_1",status:"ACTIVE",
  effective_from:"2026-10-01T00:00:00Z",effective_until:null,
}
const org = {
  id:"org_a",tenant_id:"tn_za",status:"ACTIVE",
  canonical_organisation_id:"11111111-2222-4333-8444-555555555555",
}
const service = (m: unknown[]=[member],o: unknown[]=[org])=>({
  listBuyerMemberships:vi.fn(async()=>m),
  listB2BOrganisations:vi.fn(async()=>o),
})
const verifier=()=>({
  verifyOrganisationTenant:vi.fn(async()=>({
    contextId:"ctx_1",expiresAt:new Date(now+30_000),
  })),
})
const args = {
  tenantId:"tn_za",customerId:"cus_1",principalId:"prn_1",
  selectedOrganisationId:"org_a",correlationId:"corr-1",
}
describe("ADR-0017 explicit B2B organisation selection",()=>{
  it("requires a CP-attested in-effect membership bound to the exact human principal",async()=>{
    const db=service(),cp=verifier()
    const actual=await resolveSelectedOrganisationCapability(db as never,cp,args,now)
    expect(actual).toEqual({organisationId:"org_a",status:"ACTIVE"})
    expect(cp.verifyOrganisationTenant).toHaveBeenCalledWith(
      "tn_za",org.canonical_organisation_id,"corr-1",
    )
  })
  it.each([
    ["foreign customer",{customer_id:"cus_2"}],
    ["different principal",{principal_id:"prn_2"}],
    ["other org",{organisation_id:"org_b"}],
    ["revoked",{status:"REVOKED"}],
    ["future",{effective_from:"2026-11-10T00:00:00Z"}],
    ["expired",{effective_until:"2026-11-08T00:00:00Z"}],
  ])("refuses %s before CP is called",async(_reason,change)=>{
    const db=service([{...member,...change}]),cp=verifier()
    expect(await resolveSelectedOrganisationCapability(db as never,cp,args,now)).toBeNull()
    expect(cp.verifyOrganisationTenant).not.toHaveBeenCalled()
  })
  it("refuses ambiguous membership and foreign tenant",async()=>{
    const cp=verifier()
    expect(await resolveSelectedOrganisationCapability(
      service([member,member]) as never,cp,args,now,
    )).toBeNull()
    expect(await resolveSelectedOrganisationCapability(
      service([member],[{...org,tenant_id:"tn_ug"}]) as never,cp,args,now,
    )).toBeNull()
    expect(cp.verifyOrganisationTenant).not.toHaveBeenCalled()
  })
  it("requires current CP context, not a bare 200 response",async()=>{
    const db=service()
    const cp={verifyOrganisationTenant:vi.fn(async()=>({
      contextId:"ctx_1",expiresAt:new Date(now-1000),
    }))}
    expect(await resolveSelectedOrganisationCapability(db as never,cp,args,now)).toBeNull()
  })
  it("never automatically chooses the first organisation for an unselected customer",async()=>{
    const req={
      auth_context:{actor_id:"cus_1",app_metadata:{baobab_principal_id:"prn_1"}},
      query:{},
      scope:{resolve:vi.fn()},
    }
    const res={
      setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn(),
    }
    await GET(req as never,res as never)
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control","private, no-store")
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      organisation_id:null,selection_required:true,
      capabilities:{organisation:false,team:false,catalogue:false,orders:false,documents:false},
    }))
  })
})
