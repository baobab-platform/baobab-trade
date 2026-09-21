# Ops runbook — Gate ZB-06 market assortment (Trade)

**ADRs:** ADR-0011, ADR-0024, ADR-0030

## Operator sequence

1. **Medusa admin** — create product + variants (Trade does not create products).
2. **Trade profile** — `POST /admin/b2b/product-trade-profiles`
   - Required: `product_id`, `canonical_product_key`, `country_of_origin`,
     `hs_classification_reference`, `commodity_category`, `trade_uom`
   - UOM codes: BAG, CARTON, KG, TONNE, LITRE, BOTTLE, PALLET, CASE, DRUM, OTHER
3. **Market eligibility** — `POST /admin/b2b/market-product-eligibility`
   - `market_key` must match estate keys (e.g. `zuribeans_ug`, `zuribeans_za`)
   - For sellable under strict clearance: `status=ACTIVE` and
     `regulatory_eligibility` in `ELIGIBLE` | `ELIGIBLE_WITH_CONDITIONS`
4. **Purchase constraints** (optional) — `POST /admin/b2b/purchase-constraints`
   - Same UOM vocabulary as profiles
5. **Canonical link** (optional) — after CP registers the product:
   `POST /admin/b2b/product-trade-profiles/{id}/canonical-link`
6. **Verify store filter** —
   `GET /store/b2b/assortment?market_key=zuribeans_ug`
   - Inspect `sellable_product_ids` and `blocked` diagnostics

## Estate composition

ZuriBeans intersects Medusa `/store/products` with assortment ids when
`ZB06_ASSORTMENT_FILTER=strict`. See estate `docs/ops/zb-06-market-assortment-runbook.md`.

## Fail closed (ADR-0024)

| Assortment | Regulatory | Sellable (strict) |
|------------|------------|-------------------|
| ACTIVE | ELIGIBLE | Yes |
| ACTIVE | NOT_EVALUATED | No |
| SUSPENDED | ELIGIBLE | No |

## Non-goals

Regulatory provider resolve, ERP item, lot origin, customer catalogues, Medusa product create in Trade.
