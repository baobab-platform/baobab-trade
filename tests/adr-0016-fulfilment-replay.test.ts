import { describe, expect, it, vi } from "vitest"
import {
  assertSameFulfilmentAttempt, MedusaFulfilmentAdapter,
  type RequestFulfilmentCommand, type FulfilmentSnapshot,
} from "../src/baobab/fulfilment/fulfilment-port"
import { FulfilmentBridgeRecordAdapter } from "../src/baobab/fulfilment/record-adapter"

const command: RequestFulfilmentCommand = {
  fulfilmentReference:"ful-1",orderReference:"order-1",organisationId:"buyer-za",
  marketKey:"zuribeans_za",legalSellerKey:"seller-za",sourceLocationKey:"warehouse-za",
  mode:"CROSS_BORDER",providerKey:"carrier-a",
  shipment:{
    originCountry:"ZA",destinationCountry:"UG",exporterOrganisationId:"seller-za",
    importerOrganisationId:"buyer-ug",hsReferences:["0901.11"],
    complianceDecisionId:"decision-1",incoterm:"CIF",
    grossWeightKg:100,packageCount:2,
  },
  idempotencyKey:"shipment-attempt-1",correlationId:"corr-1",
}
const snapshot: FulfilmentSnapshot={
  ...command,digitalEstate:"estate:zuribeans-b2b",id:"ful_1",status:"REQUESTED",
}
const repo = (stored: FulfilmentSnapshot | undefined) => ({
  findByIdempotencyKey:vi.fn(async()=>stored),
  create:vi.fn(async()=>snapshot),
  transition:vi.fn(async()=>snapshot),
})
describe("ADR-0016 logistics intent and native transition replay",()=>{
  it("adopts an unchanged fulfillment response after loss, allowing new correlation",async()=>{
    const db=repo(snapshot)
    const result=await new MedusaFulfilmentAdapter(db).request({...command,correlationId:"retry"})
    expect(result).toBe(snapshot)
    expect(db.create).not.toHaveBeenCalled()
  })
  it.each([
    ["buyer",{organisationId:"buyer-ug"}],
    ["seller",{legalSellerKey:"seller-ug"}],
    ["warehouse",{sourceLocationKey:"warehouse-ug"}],
    ["carrier",{providerKey:"carrier-b"}],
    ["Market",{marketKey:"zuribeans_ug"}],
    ["order",{orderReference:"order-2"}],
    ["weight",{shipment:{...command.shipment,grossWeightKg:101}}],
    ["Incoterms",{shipment:{...command.shipment,incoterm:"DAP" as const}}],
    ["HS",{shipment:{...command.shipment,hsReferences:["0901.12"]}}],
  ])("refuses idempotent shipment substitution of %s",async(_label,change)=>{
    const db=repo(snapshot)
    await expect(new MedusaFulfilmentAdapter(db).request({...command,...change}))
      .rejects.toThrow("different shipment")
    expect(db.create).not.toHaveBeenCalled()
  })
  it("rejects mismatched provider-lock result after a concurrent native creation",async()=>{
    const db=repo(undefined)
    db.create.mockResolvedValueOnce({...snapshot,sourceLocationKey:"warehouse-other"})
    await expect(new MedusaFulfilmentAdapter(db).request(command)).rejects.toThrow(
      "different shipment",
    )
  })
  it("rejects invalid weight, package count and blank idempotency before persistence",async()=>{
    for(const change of [
      {shipment:{...command.shipment,grossWeightKg:Number.POSITIVE_INFINITY}},
      {shipment:{...command.shipment,packageCount:Number.MAX_SAFE_INTEGER+1}},
      {idempotencyKey:""},
    ]){
      const db=repo(undefined)
      await expect(new MedusaFulfilmentAdapter(db).request({...command,...change})).rejects.toThrow()
      expect(db.create).not.toHaveBeenCalled()
    }
  })
  it("replays a previously applied transition when the native record is already at the target status",async()=>{
    const stored={
      id:"ful_1",digital_estate:"estate:zuribeans-b2b",
      fulfilment_reference:"ful-1",order_reference:"order-1",
      organisation_id:"buyer-za",market_key:"zuribeans_za",
      legal_seller_key:"seller-za",source_location_key:"warehouse-za",
      mode:"CROSS_BORDER",provider_key:"carrier-a",
      shipment_metadata:command.shipment,source_idempotency_key:command.idempotencyKey,
      correlation_id:"corr-1",status:"ACCEPTED",
    }
    const bridge={
      listFulfilmentStatusTransitions:vi.fn(async()=>[{
        fulfilment_id:"ful_1",from_status:"REQUESTED",
        to_status:"ACCEPTED",idempotency_key:"accepted-1",
      }]),
      listCommerceFulfilments:vi.fn(async()=>[stored]),
      createFulfilmentStatusTransitions:vi.fn(),
      updateCommerceFulfilments:vi.fn(),
    }
    const locking={execute:vi.fn(async(_key:string,fn:()=>Promise<unknown>)=>fn())}
    const adapter=new FulfilmentBridgeRecordAdapter(bridge as never,locking as never)
    const accepted=await adapter.transition(snapshot,"ACCEPTED","accepted-1")
    expect(accepted.status).toBe("ACCEPTED")
    expect(bridge.createFulfilmentStatusTransitions).not.toHaveBeenCalled()
  })
  it("refuses transition replay from another fulfilment even when a source ignores filters",async()=>{
    const bridge={
      listFulfilmentStatusTransitions:vi.fn(async()=>[{
        fulfilment_id:"ful_other",from_status:"REQUESTED",
        to_status:"ACCEPTED",idempotency_key:"accepted-1",
      }]),
      listCommerceFulfilments:vi.fn(async()=>[{id:"ful_1",status:"ACCEPTED"}]),
    }
    const locking={execute:vi.fn(async(_key:string,fn:()=>Promise<unknown>)=>fn())}
    const adapter=new FulfilmentBridgeRecordAdapter(bridge as never,locking as never)
    await expect(adapter.transition(snapshot,"ACCEPTED","accepted-1")).rejects.toThrow(
      "different transition",
    )
  })
})
