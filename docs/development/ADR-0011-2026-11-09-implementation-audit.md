# ADR-0011 — Commerce Product, Variant, Catalogue and Canonical Product Authority: implementation audit

**Date:** 2026-11-09  
**Governing architecture:** Accepted `docs/adr/ADR-0011_ Commerce Product, Variant, Catalogue and Canonical Product Authority Model.md` (108 sections; PRD-COM-001–025; §106's 25 conformance cases).  
**Assessed baseline:** `baobab-trade/main` plus open #189 (native checkout), #190 (security), #200 (readiness), #201 (startup), #202 (tenant isolation), #203 (Market authority).  
**Disposition:** **PARTIALLY IMPLEMENTED. Production catalogue confidentiality, canonical identity, and native search/checkout conformance remain HELD.**

## Audit findings

| ADR-0011 responsibility | Source assessed | Assessment |
| --- | --- | --- |
| §§4–20; PRD-COM-001–007/013–017: PRODUCT vs PRODUCT_VARIANT canonical identity, attribute authority, CP mapping | `src/baobab/contracts/canonical-mapping.ts`, `src/baobab/context/resolver.ts`, `src/baobab/catalogue/catalogue-config.ts`, `src/api/admin/b2b/product-trade-profiles/[id]/canonical-link/route.ts` | **Partial.** Medusa product/variant IDs and business keys are separate, but a locally supplied `canonical_product_key` is not evidence of a CP-verified PRODUCT ExternalReference; independently scoped variant mappings and multi-instance idempotent reconciliation are not connected |
| §§11–16; PRD-COM-003–007/015–016: commerce vs editorial vs ERP attribute authority | Native Medusa and B2B metadata, ERP/CMS integration boundaries | **Architectural split present; connected attribute-level sync proof outstanding.** No universal product master should be introduced |
| §§27–34, 72–75; PRD-COM-010–012/022–023: Market, sales-channel and customer-organisation catalogue visibility | `src/api/store/b2b/assortment/route.ts`, `src/baobab/b2b/product-assortment-policy.ts`, `src/modules/b2b/models/market-product-eligibility.ts` | **Critical disclosure gap addressed in this tranche.** The previous unauthenticated Store route accepted any `market_key` and returned `blocked` records, including product IDs, status and regulatory eligibility. It did not enforce real IAM/CP buyer/estate Market authority or B2B organisation product entitlements |
| §§33–34, 72–74: effective eligibility policy | Admin upsert and native eligibility model | **Defect addressed.** Previously JavaScript parsed arbitrary date strings, could persist invalid/reversed effective windows, and adopted `take:1` first-match rows without verifying the returned product/Market owner |
| §§49–50, 84, 90–96; PRD-COM-022–024: confidential search/direct ID/cache and data minimisation | Store assortment route; generic native `/store/products` | **Only this Store assortment route hardened.** Search, native Medusa `/store/products`, product-by-ID and any side channel still need an independently verified policy enforcement point. No claim of end-to-end confidentiality |
| §§61–65, 107; PRD-COM-020–021: idempotent product/variant projection, duplicate/orphan reconciliation | Native launch catalogue scripts and CP mappings | **Not qualified.** `canonicalKey` bootstraps are not CP-minted PRODUCT identities. Real registration, versioned scoped mapping, variant reconciliation and failure replay are needed |
| §§68–71; PRD-COM-018–019: durable order-line snapshots during product rename/retirement | Native Medusa order/ERP integration, open #189 | **Connected order-line history proof outstanding** |
| §§54–60, 87–89; PRD-COM-015–016/025: attribute ownership, events and cross-engine sync | Trade event/outbox adapters, separate ERP/CMS | **No full native/connected product event proof**; preserve publisher/consumer retries and never overwrite ERP costs or CMS editorial attributes |

## Implementation committed in this tranche

1. `src/baobab/catalogue/visibility-authority.ts` defines an explicitly server-registered **`ProductCatalogueAccessPort`** with methods to authenticate and attest a buyer-specific Market scope, and resolve organisation-authorised product IDs from an already market/regulatory-cleared candidate set. Exact Market, canonical CP-minted-style Market ID, tenant, buyer principal, buyer organisation, estate and expiry are checked; entitlement results must be an exact subset, without duplicate/unknown/blocked product IDs.
2. `GET /store/b2b/assortment` refuses requests **before any database read** when that trusted provider is absent, expired, mismatched or unavailable. The route independently checks every row's `market_key` even if the source ignores query filters, evaluates commercial/regulatory/effective eligibility, then intersects with the buyer-specific entitlement provider. Store clients receive **only** an authorised `sellable_product_ids` array; no `blocked`, regulatory reasons, internal cost, counts or withheld IDs. All answers are non-cacheable. A supplied Market key remains *selection intent only*.
3. `validateMarketEligibilityBody` accepts only timezone-qualified, parseable ISO 8601 effective dates and a forward effective window; invalid or ambiguous policy references fail before B2B access. The administrative upsert rechecks **all** returned row owners, refuses duplicates and wrong-Product/wrong-Market rows, and uses the validated timestamps rather than re-parsing raw request data.
4. Development regression tests exercise foreign-Market filtered data, restricted products excluded for another buyer organisation, blocked status non-disclosure, attacker-selected Market, expired/missing buyer scope, provider over-return, malformed effective windows, ambiguous first-match upserts and positive same-Market records.

**Runtime qualification boundary:** `ProductCatalogueAccessPort` has no fake local success implementation or configured CP replacement. A deployment without a **real IAM/CP-authoritative verifier and an actual B2B product-entitlement provider** now refuses the restricted assortment route. This may block older digital estate calls to that route; it is intentional until the estate BFF's subject/Market/organisation and per-product entitlement source are qualified. An ordinary Medusa customer token, hostname, unverified JWT claims or client `market_key` must never silently grant access.

## ADR-0011 §106 conformance matrix

| §106 cases | Required proof | Status |
| --- | --- | --- |
| 1–5 | Same canonical PRODUCT links distinct Medusa/ERP/Payload representations; variant distinct; identity survives migrations | **Not qualified** in connected engines |
| 6–7 | Duplicate product and variant projection idempotence | **Not qualified** by real persistence/replay |
| 8–10 | Market and sales-channel product eligibility survives cross-context purchase attempts | **Partial source-level Market eligibility only**; native checkout veto outstanding |
| 11–13 | B2B exclusive catalogue hidden across list, direct ID and search | **Partial route denial/regression coverage**, native direct ID and search HELD |
| 14–16 | Payload/Medusa/ERP attribute authority and cost confidentiality | **Not qualified** connected |
| 17–19 | Historical order lines and stable identity after product/SKU changes | **Not qualified** connected |
| 20–23 | Missing/orphan/duplicate mapping detection and cross-region canonical continuity | **Not qualified** connected |
| 24–25 | Cross-engine writes refuse foreign authority; canonical product event correlation | **Not qualified** connected |

## Next implementation/qualification gates

**G1 — Real authenticated BFF-to-Trade catalogue read.** Reuse the actual IAM human/BFF verification and Control Plane estate/buyer context sequence, under an approved catalogue-read operation (not `trade.buyer-context.resolve` impersonation). Extend CP estate-Market capability evidence and Trade's native B2B organisation/contract-product entitlement relationship, then register the server-only `ProductCatalogueAccessPort` via Medusa's dependency injection. Include positive **two organisations, two Markets and one same-market exclusive product** with independent negative cases. No unqualified fallback.

**G2 — Enforce identical scope on native search, listing, direct ID and cart/checkout.** `/store/products` and Medusa search adapters need the same PEP; a filtered list is not an IDOR or purchase fence. Ensure blocked IDs are not revealed by count, cache key, price list, or error details.

**G3 — CP PRODUCT/PRODUCT_VARIANT canonical registration.** Verify CP ExternalReference (target namespace, engine and instance), exact canonical type, parent-child variant relationship, Market/tenant MappingScope, lifecycle, idempotent provisioning, orphan/duplicate detection and migration continuity. Current local `canonical_product_key` must not be upgraded to CP authority by nomenclature.

**G4 — Cross-engine and historical proof.** Qualify Medusa commerce vs Payload editorial vs iDempiere costing, privacy-safe events, replay/reconciliation, immutable order-line product snapshots and all 25 §106 scenarios under connected PostgreSQL, IAM/CP and the actual engine providers.

**Release decision:** the new development tests and CI are necessary regression barriers. They are **not** live CP/IAM or cross-engine acceptance evidence. Do not merge based only on source-level tests; do not promote or enable the restricted route in production until G1–G4 are qualified.
