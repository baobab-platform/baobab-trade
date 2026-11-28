import { describe, expect, it } from "vitest"
import { assertFinancialClearance, type FinanceScope, type FinanceReceipt } from "../src/baobab/payments/financial-clearance-guard"

const scope: FinanceScope = {
  tenantId:"zb-tenant",sellerLegalEntityId:"zb-ug",buyerOrganisationId:"buyer-a",
  transactionReference:"order-11",currencyCode:"USD",amountMinor:"123456",
}
const at="2026-11-09T12:00:00Z"
const receipt=(kind:FinanceReceipt["kind"],authority:FinanceReceipt["authority"]):FinanceReceipt=>({
  ...scope,kind,authority,status:"CLEARED",reference:"receipt-"+kind,version:"v1",
  observedAt:"2026-11-09T10:00:00Z",expiresAt:"2026-11-10T10:00:00Z",
})
const exposures=()=>[receipt("EXPOSURE","ERP"),receipt("CREDIT_RESERVATION","CREDIT_POLICY")]
describe("ADR-0027 financial readiness does not equate payment with accounting settlement",()=>{
  it("requires distinct current ERP exposure and governed credit hold",()=>{
    expect(assertFinancialClearance(scope,["EXPOSURE","CREDIT_RESERVATION"],exposures(),at)).toEqual({
      evidenceReferences:["receipt-EXPOSURE","receipt-CREDIT_RESERVATION"],status:"CLEARED",
    })
  })
  it("never substitutes a PSP authorization for ERP settlement",()=>{
    expect(()=>assertFinancialClearance(scope,["ERP_SETTLEMENT"],[
      receipt("PROVIDER_PAYMENT","PAYMENT_PROVIDER"),
    ],at)).toThrow("missing or ambiguous")
    expect(()=>assertFinancialClearance(scope,["ERP_SETTLEMENT"],[
      receipt("ERP_SETTLEMENT","PAYMENT_PROVIDER"),
    ],at)).toThrow("authority")
  })
  it("denies unknown, partial, revoked, expired and unapproved financial exposure",()=>{
    for(const status of ["UNKNOWN","PARTIAL","REVOKED","DECLINED","PENDING"] as const)
      expect(()=>assertFinancialClearance(scope,["EXPOSURE"],[
        {...receipt("EXPOSURE","ERP"),status},
      ],at)).toThrow("not cleared")
    expect(()=>assertFinancialClearance(scope,["EXPOSURE"],[
      {...receipt("EXPOSURE","ERP"),expiresAt:at},
    ],at)).toThrow("stale")
  })
  it("refuses foreign legal seller, buyer, tenant, order, currency and amount",()=>{
    for(const field of ["tenantId","sellerLegalEntityId","buyerOrganisationId","transactionReference","currencyCode","amountMinor"] as const)
      expect(()=>assertFinancialClearance(scope,["EXPOSURE"],[
        {...receipt("EXPOSURE","ERP"),[field]:"foreign"},
      ],at)).toThrow("foreign finance scope")
  })
  it("refuses absent policy, duplicate receipt, ambiguous amount and unknown financial requirement",()=>{
    expect(()=>assertFinancialClearance(scope,[],exposures(),at)).toThrow("requirements")
    expect(()=>assertFinancialClearance(scope,["EXPOSURE"],[
      receipt("EXPOSURE","ERP"),receipt("EXPOSURE","ERP"),
    ],at)).toThrow("ambiguous")
    expect(()=>assertFinancialClearance({...scope,amountMinor:"1.1"},["EXPOSURE"],exposures(),at))
      .toThrow("invalid financial scope")
    expect(()=>assertFinancialClearance(scope,["NOT_KNOWN" as "EXPOSURE"],exposures(),at))
      .toThrow("unknown finance")
  })
})
