# ADR-0012 — Pricing implementation audit (2026-11-09)

**Decision:** Accepted ADR-0012, §§4, 16–27, 67–70 and PRC-COM-004/006/007/011/015/016/027/028. **Overall: PARTIAL / connected acceptance HELD.**

## Audited gap
The B2B `selectPrice` port accepted prices without product-variant or Market scope; it accepted a supposedly private CONTRACT/CUSTOMER_SPECIFIC price without an organisation; and it selected the first highest-rank candidate by database row order. Malformed minor-unit amounts, invalid tiers and expired private terms could participate in price selection.

## Implemented
Explicit variant and Market identity on every B2B price candidate; exact organisation binding for private prices; valid currency and positive quantity; safe-integer minor-unit amounts; effective start-inclusive/end-exclusive windows; explicit ACTIVE rule; deterministic precedence with ambiguous equal-rank rejection. The B2B selection port now fails closed on invalid or ambiguous pricing. Added adversarial scoped-price/quantity/time/money tests and kept existing positive wholesale cases.

This source-level consumer guard does **not** authenticate the caller or certify an authoritative Medusa Pricing provider. True checkout must revalidate latest native price, settlement currency, buyer/estate/Market authority, promotions and private contracts in the same commitment chain. The `PriceCandidateProvider` interface does not replace Medusa as pricing authority.

## Open conformance (ADR §116)
Two-Market and two-currency *native Medusa* prices, B2B negotiated price read isolation against live IAM/CP, effective-dated price list and tier provisioning, promotion stacking and coupon subject eligibility, cart Market change/login repricing, search/cache leakage, immutable committed order price readback and ERP committed-amount comparison remain **unqualified**. Preserving Trade #189 buyer/checkout vertical, #203 Market authority, #204 catalogue visibility; no synthetic financial success counted as acceptance.

**Disposition:** This PR is a narrow development hardening tranche, not complete ADR-0012 qualification.