# Thamani cross-border trade readiness

Gate 14 projects origin, HS references, customs-tariff references and landed-cost references for every eligible Thamani product/Market pair. These are procurement and import controls for Thamani as retailer; they do not turn the consumer storefront into a marketplace or make Baobab Trade a customs authority.

The catalogue's original HS values are illustrative. Every projected profile therefore starts `UNVERIFIED`, carries the source marker `THAMANI_CATALOGUE_REFERENCE_NOT_CUSTOMS_AUTHORITY`, and cannot be treated as import-ready. Promotion to `VERIFIED` requires a recorded customs review timestamp. This is deliberate: a plausible six-digit code is still not a legal classification.

The existing `TradeCompliancePort` remains the replaceable enforcement boundary. It now supports retail unit `EACH` and returns `REVIEW_REQUIRED` with `HS_CLASSIFICATION_UNVERIFIED` whenever any line lacks verified classification. Missing or ambiguous effective lane policy still throws and fails closed. Customs declarations, registrations, permits and real landed-cost calculations remain external authority outputs referenced by durable identifiers, not fabricated by Medusa.

Run `npm run bootstrap:thamani-trade-readiness` after the catalogue and shared trade-lane bootstrap, then `npm run verify:thamani-trade-readiness`.
