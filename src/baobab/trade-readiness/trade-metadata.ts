export type TradeUom = "BAG" | "CARTON" | "EACH"
export type TradeIncoterm = "EXW" | "FCA" | "FOB" | "CFR" | "CIF" | "DAP" | "DPU" | "DDP"
export type CrossBorderLine = {
  canonicalProductKey: string
  hsClassificationReference: string
  hsClassificationStatus: "VERIFIED" | "UNVERIFIED"
  customsTariffReference: string
  landedCostReference: string
  originCountry: string
  originRegion?: string
  tradeUom: TradeUom
  quantity: number
  netWeightKg: number
  grossWeightKg: number
  lotReference?: string
}
export type CrossBorderTransactionMetadata = {
  digitalEstate: string
  transactionReference: string
  orderReference: string
  marketKey: string
  legalSellerKey: string
  exporterOrganisationId: string
  importerOrganisationId: string
  originCountry: string
  destinationCountry: string
  incoterm: TradeIncoterm
  customsProcedureReference: string
  exportEligibilityReference: string
  exporterRegistrationReference: string
  importerRegistrationReference: string
  customsDeclarationReference?: string
  exportPermitReference?: string
  lines: CrossBorderLine[]
  idempotencyKey: string
  correlationId: string
}

export const validateCrossBorderMetadata = (value: CrossBorderTransactionMetadata) => {
  if (value.originCountry === value.destinationCountry)
    throw new Error("Cross-border origin and destination must differ")
  for (const field of [
    value.digitalEstate,
    value.legalSellerKey,
    value.exporterOrganisationId,
    value.importerOrganisationId,
    value.incoterm,
    value.customsProcedureReference,
    value.exportEligibilityReference,
    value.exporterRegistrationReference,
    value.importerRegistrationReference,
  ])
    if (!field) throw new Error("Cross-border transaction metadata is incomplete")
  if (!value.lines.length) throw new Error("Cross-border transaction requires trade lines")
  for (const line of value.lines) {
    if (!/^HS-[0-9]{4}(?:\.[0-9]{2,6})?$/.test(line.hsClassificationReference))
      throw new Error("Invalid HS classification reference")
    if (!line.customsTariffReference || !line.landedCostReference)
      throw new Error("Customs and landed-cost references are required")
    if (line.originCountry !== value.originCountry)
      throw new Error("Line origin conflicts with transaction origin")
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.netWeightKg <= 0 ||
      line.grossWeightKg < line.netWeightKg
    )
      throw new Error("Invalid trade quantity or weight")
  }
}
