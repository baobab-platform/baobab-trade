# ADR-0012 — Pricing implementation audit (2026-11-09)

**Decision:** Accepted ADR-0012, §§4, 16–27, 67–70 and PRC-COM-004/006/007/011/015/016/027/028. **Overall: PARTIAL / connected acceptance HELD.**

## Audited gap

The B2B `selectPrice` port accepted prices without product-variant or Market scope; it accepted a supposedly private CONTRACT/CUSTOMER_SPECIFIC price without an organisation; and it selected the first highest-rank candidate by database row order. Malformed minor-unit amounts, invalid tiers and expired private terms could participate in price selection.

## Implemented

Explicit variant and Market identity on every B2B price candidate; exact organisation binding for private prices; valid currency and positive quantity; safe-integer minor-unit amounts; effective start-inclusive/end-exclusive windows; explicit ACTIVE rule; deterministic precedence with ambiguous equal-rank rejection. The B2B selection port now fails closed on invalid or ambiguous pricing. Added adversarial scoped-price/quantity/time/money tests and kept existing positive wholesale cases.

This source-level consumer guard does **not** authenticate the caller or certify an authoritative Medusa Pricing provider. True checkout must revalidate latest native price, settlement currency, buyer/estate/Market authority, promotions and private contracts in the same commitment chain. The `PriceCandidateProvider` interface does not replace Medusa as pricing authority.

## Open conformance (ADR §116)

Two-Market and two-currency _native Medusa_ prices, B2B negotiated price read isolation against live IAM/CP, effective-dated price list and tier provisioning, promotion stacking and coupon subject eligibility, cart Market change/login repricing, search/cache leakage, immutable committed order price readback and ERP committed-amount comparison remain **unqualified**. Preserving Trade #189 buyer/checkout vertical, #203 Market authority, #204 catalogue visibility; no synthetic financial success counted as acceptance.

**Disposition:** This PR is a narrow development hardening tranche, not complete ADR-0012 qualification.


## 27 November 2026 follow-up

- Candidate validation now requires explicit `ACTIVE` status, an organisation binding for private candidates, an agreement reference for `CONTRACT`, an explicit `minQuantity` for `VOLUME`, valid currency-code syntax, and safe integer minor-unit amounts. These checks prevent missing state/provenance/tier fields from silently participating.
- Current Medusa v2 documentation identifies the native Pricing Module `calculatePrices` path for PriceSets, PriceLists, rules and quantity tiers; Medusa recommends workflows for most customizations. Medusa v2 stores price amounts in major units, while this helper's internal contract is integer minor units. No exact, currency-aware conversion adapter is implemented here; a floating-point cast is not acceptable.
- The `PricingDecisionPort` / `PriceCandidateProvider` remains unregistered and has no runtime caller. This PR does not invoke native Medusa `calculatePrices`, does not provision native PriceLists, and does not reprice a Medusa cart or checkout.
- The helper is therefore source-level policy code only. Do not treat it as a native Medusa pricing implementation or merge it as a substitute for ADR-0012 §5 and §116. Native Medusa integration, exact amount conversion, and connected organisation/Market/contract tests remain required.
