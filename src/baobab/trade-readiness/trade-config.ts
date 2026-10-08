import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../context/digital-estates"
import type { TradeLanePolicy } from "./compliance-port"
export const ZURIBEANS_TRADE_LANES: readonly TradeLanePolicy[] = [
  {
    digitalEstate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    policyReference: "control-plane:trade-lane:ug-za",
    policyVersion: "gate11-v1",
    originCountry: "UG",
    destinationCountry: "ZA",
    permittedIncoterms: ["FCA", "FOB", "CFR", "CIF", "DAP", "DDP"],
    permittedTradeUoms: ["BAG", "CARTON"],
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    source: "GATE11_CONFIGURATION_NOT_CUSTOMS_AUTHORITY",
  },
  {
    digitalEstate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    policyReference: "control-plane:trade-lane:za-ug",
    policyVersion: "gate11-v1",
    originCountry: "ZA",
    destinationCountry: "UG",
    permittedIncoterms: ["FCA", "FOB", "CFR", "CIF", "DAP", "DDP"],
    permittedTradeUoms: ["BAG", "CARTON"],
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    source: "GATE11_CONFIGURATION_NOT_CUSTOMS_AUTHORITY",
  },
] as const
