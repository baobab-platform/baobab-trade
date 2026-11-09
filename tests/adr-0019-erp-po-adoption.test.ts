import { describe, expect, it } from "vitest"
import {
  reconcileSupplierAwardToErp,
  type ApprovedSupplierAward,
  type ErpPurchaseOrderEvidence,
} from "../src/baobab/procurement/erp-po-adoption"

const award: ApprovedSupplierAward = {
  tenantId:"tn_za", procurementCommitmentId:"pc-1", approvedAwardId:"award-1",
  approvedSupplierCanonicalId:"supplier-a",buyerLegalEntityId:"seller-za",
  currency:"ZAR",totalMinor:125000,idempotencyKey:"pc-1:erp-po",status:"APPROVED",
}
const evidence: ErpPurchaseOrderEvidence = {
  source:"ERP",sourceEventId:"erp-event-1",procurementCommitmentId:"pc-1",
  approvedAwardId:"award-1",tenantId:"tn_za",supplierCanonicalId:"supplier-a",
  buyerLegalEntityId:"seller-za",currency:"ZAR",committedTotalMinor:125000,
  idempotencyKey:"pc-1:erp-po",erpPurchaseOrderId:"C_Order-100",
  status:"CREATED",
}
describe("ADR-0019 Trade award is not the ERP purchase order",()=>{
  it("does not claim a PO before receiving actual ERP evidence",()=>{
    expect(reconcileSupplierAwardToErp(award,null)).toEqual({
      procurementCommitmentId:"pc-1",erpPurchaseOrderId:null,
      status:"ERP_PENDING",evidenceEventId:null,
    })
  })
  it("adopts matching ERP-native PO evidence without changing supplier award",()=>{
    const v=reconcileSupplierAwardToErp(award,evidence)
    expect(v).toMatchObject({erpPurchaseOrderId:"C_Order-100",status:"ERP_CONFIRMED"})
    expect(reconcileSupplierAwardToErp(award,evidence,v)).toEqual(v)
  })
  it.each([
    {tenantId:"tn_ug"},{supplierCanonicalId:"supplier-b"},
    {buyerLegalEntityId:"seller-ug"},{currency:"UGX"},
    {committedTotalMinor:500},{procurementCommitmentId:"pc-2"},
    {approvedAwardId:"award-2"},{idempotencyKey:"other"},
    {source:"TRADE" as const},
  ])("refuses mismatched ERP authority %j",(delta)=>{
    expect(()=>reconcileSupplierAwardToErp(award,{...evidence,...delta})).toThrow(
      "does not match",
    )
  })
  it("requires a genuine native PO ID rather than a synthetic approval",()=>{
    expect(()=>reconcileSupplierAwardToErp(award,{...evidence,erpPurchaseOrderId:""}))
      .toThrow("native purchase order")
  })
  it("an ERP rejection or unknown outcome becomes reconciliation, not an invented PO",()=>{
    for(const status of ["UNKNOWN","REJECTED"] as const){
      expect(reconcileSupplierAwardToErp(award,{...evidence,status})).toMatchObject({
        erpPurchaseOrderId:null,status:"ERP_RECONCILIATION_REQUIRED",
      })
    }
  })
  it("does not regress a committed PO on replay of a later unknown event",()=>{
    const prior=reconcileSupplierAwardToErp(award,evidence)
    expect(reconcileSupplierAwardToErp(award,{...evidence,status:"UNKNOWN"},prior)).toBe(prior)
    expect(()=>reconcileSupplierAwardToErp(award,{
      ...evidence,erpPurchaseOrderId:"C_Order-other",
    },prior)).toThrow("conflicts")
  })
  it("refuses unsafe financial award and wrong previous commitment",()=>{
    expect(()=>reconcileSupplierAwardToErp({...award,totalMinor:1.5},evidence))
      .toThrow("valid, authorised")
    expect(()=>reconcileSupplierAwardToErp(award,null,{
      procurementCommitmentId:"pc-other",erpPurchaseOrderId:null,
      status:"ERP_PENDING",evidenceEventId:null,
    })).toThrow("different commitment")
  })
})
