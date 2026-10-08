import type { TradeLanePolicy } from "../../trade-readiness/compliance-port"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../../context/digital-estates"

/**
 * Thamani's own UG-ZA/ZA-UG lane policies. Gate 14 originally implemented this by mutating
 * ZuriBeans' own `ZURIBEANS_TRADE_LANES` rows in place (bumping their version and adding the
 * `EACH` retail UOM) — a review caught that this coupled ZuriBeans' wholesale compliance
 * outcomes to a Thamani-only change. Thamani gets its own policy references and its own
 * `digitalEstate` tag instead; `EACH` is only ever permitted here, never on ZuriBeans' lanes.
 */
export const THAMANI_TRADE_LANES: readonly TradeLanePolicy[] = [
  {
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    policyReference: "thamani:trade-lane:ug-za",
    policyVersion: "gate14-v1",
    originCountry: "UG",
    destinationCountry: "ZA",
    permittedIncoterms: ["FCA", "FOB", "CFR", "CIF", "DAP", "DDP"],
    permittedTradeUoms: ["BAG", "CARTON", "EACH"],
    effectiveFrom: new Date("2026-09-09T00:00:00Z"),
    source: "GATE14_CONFIGURATION_NOT_CUSTOMS_AUTHORITY",
  },
  {
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    policyReference: "thamani:trade-lane:za-ug",
    policyVersion: "gate14-v1",
    originCountry: "ZA",
    destinationCountry: "UG",
    permittedIncoterms: ["FCA", "FOB", "CFR", "CIF", "DAP", "DDP"],
    permittedTradeUoms: ["BAG", "CARTON", "EACH"],
    effectiveFrom: new Date("2026-09-09T00:00:00Z"),
    source: "GATE14_CONFIGURATION_NOT_CUSTOMS_AUTHORITY",
  },
] as const
