# ADR-0030 — Gate ZB-06 Product Trade Profile and Market Assortment Boundary

**Status:** Accepted  
**Date:** 2026-09-20  
**Primary Repository:** `baobab-platform/baobab-trade`  
**Gate:** ZB-06 — Product and Assortment Master  
**Related:** ADR-0011 (Accepted), ADR-0024 (Proposed), ADR-0010, Go-Live plan §10.7–10.9  
**Not related:** Shared `contracts/product/v1` (platform SaaS Product/Subscription — different concept)

## Context

Gate ZB-06 requires canonical-oriented product commerce attributes, trade UOM,
origin, HS references, packaging, market eligibility, and market assortments for
commodities (coffee, wine, vanilla, etc.).

Existing tables `b2b_product_trade_profile` and `b2b_market_product_eligibility`
were schema-only with no HTTP surface, a hard-coded trade UOM of BAG|CARTON only,
and a single commercial status that conflated “in assortment” with regulatory
eligibility — contradicting ADR-0024’s explicit chain:

```text
Product Exists ≠ Listed ≠ Offered ≠ Qualified ≠ Importable ≠ Exportable ≠ Sellable
```

## Decision

1. **Trade owns** commerce-side trade profile and **market assortment** rows that
   attach to Medusa `product_id` (ADR-0011 §11). Canonical correlation uses
   `canonical_product_key` as an external key pending CP mapping — Trade does not
   mint Control Plane `CanonicalEntity` ids.
2. **Separate commercial status from regulatory eligibility** on market rows:
   - `status`: `ACTIVE | SUSPENDED | WITHDRAWN` — assortment activation
   - `regulatory_eligibility`: ADR-0024 vocabulary (`NOT_EVALUATED` … `EXPIRED`)
3. **HS and commodity fields remain references**, not authoritative customs
   decisions (ADR-0024 §9). Classification confidence may be stored; AI or staff
   suggestions start as `PROPOSED` and must not auto-authorise trade.
4. **Trade UOM** is an open set of string codes validated at the API (BAG, CARTON,
   KG, TONNE, LITRE, BOTTLE, PALLET, OTHER, …). Core code SHALL NOT branch on
   product name (“if coffee”). Purchase constraints use the **same** UOM vocabulary.
5. **No universal product master** in Trade (ADR-0011 §16). ERP valuation, CMS
   copy, and CP identity stay outside this module.
6. Admin HTTP under Medusa staff auth manages profiles and market eligibility;
   store catalogue sellability must compose Medusa publication + assortment
   ACTIVE + non-blocking regulatory state.
7. **Store assortment filter** (`GET /store/b2b/assortment?market_key=`) returns
   sellable product ids for a market. Estates filter stock Medusa catalogue with
   this list — Trade does not fork `/store/products`.
8. **CP external-reference wiring (Trade side):**
   `POST /admin/b2b/product-trade-profiles/{id}/canonical-link` updates
   `canonical_product_key` after an operator has registered the matching
   CanonicalEntity external reference in baobab-cp. Symmetric to organisation
   canonical-link (ZB-03.3). CP remains authority for the entity itself.

## Explicit non-goals (this slice)

- Creating Medusa products/variants (stock Medusa admin remains source)
- Control Plane CanonicalEntity registration automation (CP APIs remain source)
- ERP item projection
- Provider-backed regulatory resolve (ADR-0021)
- Lot-level origin / batch eligibility
- Customer-specific catalogues

## Consequences

- Operators can attach trade metadata and market assortment without inventing
  a second product catalogue.
- Regulatory `INELIGIBLE` can coexist with commercial `ACTIVE` (fail closed in
  sellability helper).
- Estates and storefronts can query market-sellable product ids without treating
  Medusa publication alone as market eligibility.
- Future ZB-07+ consumption must call the sellability composition, not assume
  profile existence equals tradeable.
