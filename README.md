# Baobab Trade

Baobab Trade is the independently deployable Trade Engine of the Baobab Platform. It is a headless B2B/B2C commerce engine built on MedusaJS. Medusa remains the commerce system; Baobab-specific code adds only organisational context, entitlement and explicit integrations.

## Architectural boundaries

- `baobab-platform/shared` owns canonical organisational contracts and engineering standards.
- `nabhold/baobab-cp` resolves authenticated tenant context, lifecycle and product entitlement.
- `nabhold/infrastructure` owns production infrastructure and deployment orchestration.
- Baobab ERP and Pulse are reached through APIs and signed events, never shared databases.
- Subsidiary frontends remain in their own digital-estate repositories.

Contract provenance is pinned in `contracts.lock.yaml`. Runtime needs are declared in `runtime/requirements.yaml`.

## Local development

Prerequisites: Node.js 24, Git, PostgreSQL and Redis.

```bash
cp .env.example .env
npm install
npm run dev
```

Or use the local development stack:

```bash
docker compose up --build
```

The Compose file is deliberately local-only; it is not the production deployment model.

## Request context

Trade accepts commerce requests only after authoritative context resolution through the Control Plane adapter. A valid context contains distinct `tenantId` and canonical `entityId` values, an active lifecycle status and the `baobab-trade` product entitlement. Unresolved context fails closed.

## Health

- `GET /health` — process liveness.
- `GET /readiness` — configuration readiness, including Control Plane configuration.

## Markets

ZuriBeans launches in Uganda and South Africa as two first-class Baobab
Markets on one codebase. See `docs/architecture/market-model.md` for how
Market differs from Medusa Region, and run `npm run bootstrap:market` to
idempotently provision each Market's Region, Sales Channel and Stock
Location.

## ZuriBeans B2B

Gate 5 adds the typed `b2b` Medusa module for organisations, buyer memberships,
organisation-local roles, purchase approvals, PO references, commercial terms,
delivery sites, and tax registrations. Run `npm run verify:b2b-module` after
migrations. The complete authority and persistence model is documented in
`docs/architecture/zuribeans-b2b-commerce.md`.

Gate 6 provisions the focused ten-product wholesale catalogue and independent
UGX/ZAR standard and volume prices with `npm run bootstrap:catalogue`. Trade
profiles, Market eligibility, MOQ/order multiples, and protected contract-price
records remain typed B2B data; see `docs/architecture/zuribeans-catalogue-pricing.md`.

Gate 7 provisions six canonical inventory locations, Medusa inventory levels,
reservation checks, and replay-safe iDempiere projection/reconciliation records
with `npm run bootstrap:inventory`. See `docs/architecture/zuribeans-inventory.md`.

Gate 8 adds per-Market payment policies, bank/manual and invoice-terms flows,
regional provider boundaries, idempotent payment lifecycle records, and explicit
Commerce-to-iDempiere reconciliation with `npm run bootstrap:payments`. See
`docs/architecture/zuribeans-payments.md`.

Gate 9 adds local, bulk, collection, and cross-border fulfilment policies,
idempotent execution requests, tracking/shipment projections, and logistics
reconciliation with `npm run bootstrap:fulfilment`. See
`docs/architecture/zuribeans-fulfilment.md`.

Gate 10 adds Uganda and South Africa tax contexts, an effective-dated tax
provider boundary, organisation-scoped B2B tax profiles, determination
provenance, and ERP reconciliation with `npm run bootstrap:tax`. See
`docs/architecture/zuribeans-tax.md`.

Gate 11 adds HS and origin data, Incoterms, trade UOMs, customs references,
cross-border transaction metadata, and a replaceable `TradeCompliancePort`
with `npm run bootstrap:trade-readiness`. See
`docs/architecture/zuribeans-trade-readiness.md`.

Gate 12 adds canonical Business Partner, Product, Warehouse, Sales Order,
Shipment, and financial-consequence mappings plus durable Order/Fulfilment
projections and ERP reconciliation with `npm run bootstrap:erp-integration`.
See `docs/architecture/zuribeans-erp-integration.md`.

Gate 13 adds the transactional event outbox, canonical envelope publication,
bounded retry/dead-letter state, duplicate-safe consumer receipts, distributed
correlation and event reconciliation with `npm run verify:event-outbox`. See
`docs/architecture/zuribeans-events-outbox.md`.

Gate 14 confirms typed extraction ports for Order, Inventory, Pricing,
Payments, Fulfilment, Trade Compliance, and future Ledger Evidence while
keeping native Medusa implementations active. See
`docs/architecture/engine-boundaries.md`.

Gate 15 completes B2B isolation and adversarial authorization tests. See
`docs/security/zuribeans-b2b-threat-model.md`.

Gate 16 adds correlated logs, bounded-cardinality metrics, W3C trace handling,
operational diagnostics, and dashboard/alert definitions. See
`docs/operations/observability.md`.

Gate 17 adds machine-readable production controls and automated release
conformance gates. See `docs/operations/ci-cd.md`.

Gate 18 adds the deterministic ZuriBeans Uganda–South Africa simulation pack
covering ten products, B2B parties, six warehouses, tax/tariff assumptions,
cross-border scenarios and ERP expectations. Run `npm run verify:simulation`;
see `docs/simulation/zuribeans-ug-za.md`.

## Thamani B2C

Thamani is a second, coexisting Baobab Digital Estate on this same Trade
engine instance — a strict B2C retailer with many independent suppliers, not
a marketplace and not a second ZuriBeans storefront. ERP integration, events,
Store Credit, and a deterministic Uganda-South Africa simulation pack (50
consumers, real orders with captured payments, a real return/refund, a
cross-border import order, and their ERP consequences — run
`npm run verify:thamani-simulation` and `npm run regression:thamani-simulation-pack`;
see `docs/simulation/thamani-ug-za.md`) are all implemented on top of Gates
0-13 (Discovery through Cross-border Trade Readiness). See
`docs/architecture/thamani-b2c-foundation.md`
for Gates 0-6, including the two Medusa store-wide constraints (one Region
per country, globally unique Fulfillment Service Zone names) that shape how
the two estates share this engine.

Run `npm run bootstrap:thamani-market` to provision the `thamani_ug`/
`thamani_za` Markets (their own `thamani_b2c` Sales Channel and Stock
Locations, sharing each country's Region and Tax Region with ZuriBeans where
one already exists) and `npm run verify:thamani-market` to check isolation.
Run `npm run bootstrap:thamani-catalogue` to provision the ~38-product
multi-supplier retail catalogue and `npm run verify:thamani-catalogue` to
check it, including the deliberately single-Market SKUs.

Gate 7 indexes that catalogue for keyword search, category facets, and
Market-scoped filtering using Medusa's native Search Module with its
built-in Postgres provider — no external search service required yet. Run
`npm run migrate:search` once after `npm run migrate`, then
`npm run bootstrap:thamani-search` to (re)build the `thamani_product` index
and `npm run verify:thamani-search` to check its health and Market
isolation. `npm run regression:thamani-eligibility-sync` is a separate,
disposable-database-only fixture proving an eligibility change reaches
search after a bootstrap resync — it mutates data and is deliberately not
part of the read-only health check. See `docs/architecture/thamani-search.md`.

Gate 8 adds scheduled sale pricing on top of Gate 6's standard UGX/ZAR
prices, plus the `ThamaniPricingDecisionPort` a future checkout calls
instead of reading Medusa Pricing directly. Run
`npm run bootstrap:thamani-pricing` to provision the three demonstration
sale Price Lists (one active, one upcoming, one expired, windows computed
relative to _now_) and `npm run verify:thamani-pricing` to check effective
dating resolves correctly. See `docs/architecture/thamani-pricing.md`.

Gate 9 adds percentage/code-based Promotions using Medusa's native
Promotion module, plus Baobab's own Digital-Estate-scope, Market/currency-
scope, and exclusive-stacking policy checks — none enforced by Medusa
itself — via a `validate` hook (`src/workflows/thamani-promotion-guard.ts`)
registered directly on `updateCartPromotionsWorkflow`, so it applies to
every caller including Medusa's own Store API route, not just a wrapper
function. Run `npm run bootstrap:thamani-promotions` to provision the two
demonstration codes and `npm run verify:thamani-promotions` to check their
configuration. `npm run regression:thamani-promotion-application` is a
separate, disposable-database-only fixture proving a discount actually
computes correctly against a Cart, that a second code is rejected, and that
a ZuriBeans cart cannot redeem a Thamani code — it mutates data (including a
Gate-10-independent stock level for its two demo variants) and is
deliberately not part of the read-only health check. See
`docs/architecture/thamani-promotions.md`.

Gate 10 adds five Thamani-owned Stock Locations, eligible-Market inventory
levels for all 38 retail products, native Medusa reservation checks, and
replay-safe ERP projection/reconciliation records. Run
`npm run bootstrap:thamani-inventory` and
`npm run verify:thamani-inventory`; see
`docs/architecture/thamani-inventory.md`.

Gate 11 adds prepaid UGX/ZAR consumer payment policies, provider-neutral
orchestration, signed replay-resistant webhook receipts, idempotent refunds,
and ERP reconciliation. Regional live adapters remain disabled pending
commercial and credential approval. Run `npm run bootstrap:thamani-payments`
and `npm run verify:thamani-payments`; see
`docs/architecture/thamani-payments.md`.

Gate 12 adds local delivery, parcel and pickup policies, multi-location line
allocation, tracking evidence, bounded returns, and execution reconciliation.
Run `npm run bootstrap:thamani-fulfilment` and
`npm run verify:thamani-fulfilment`; see
`docs/architecture/thamani-fulfilment.md`.

Gate 13 adds effective-dated Uganda and South Africa standard VAT reference
snapshots, governed product-tax categories, tax-inclusive retail display,
B2C determination ownership, provenance and ERP reconciliation. Run
`npm run bootstrap:thamani-tax` and `npm run verify:thamani-tax`; see
`docs/architecture/thamani-tax.md`. Protected zero-rated and exempt categories
remain review-required until their precise statutory classification is verified.

Gate 14 projects origin, HS, customs-tariff and landed-cost references for
every eligible product/Market pair and extends the `TradeCompliancePort` for
retail units. Catalogue classifications remain explicitly unverified and route
imports to review until customs authority evidence is recorded. Run
`npm run bootstrap:thamani-trade-readiness` and
`npm run verify:thamani-trade-readiness`; see
`docs/architecture/thamani-trade-readiness.md`.

Gate 15 adds canonical ERP mappings for Thamani products, procurement
suppliers and warehouses, plus replay-safe product, supplier, warehouse,
order, shipment, payment and return/refund projections. Run
`npm run bootstrap:thamani-erp-integration` and
`npm run verify:thamani-erp-integration`; see
`docs/architecture/thamani-erp-integration.md`.

Gate 16 makes those seven projection families durable canonical facts. A
PostgreSQL trigger persists each Thamani ERP projection and its outbox envelope
in one transaction, with explicit Tenant, owning legal entity, Digital Estate,
Market and legal-seller scope. At-least-once dispatch, bounded retry,
dead-letter handling, consumer receipts, replay collision rejection and
reconciliation are verified by `npm run verify:thamani-events`; see
`docs/architecture/thamani-events-outbox.md`.

## Repository layout

- `src/api` — Medusa API extensions.
- `src/baobab/contracts` — temporary compatibility adapters with explicit Shared provenance.
- `src/baobab/control-plane` — Control Plane client boundary.
- `src/baobab/events` — versioned cross-engine envelopes and publishers.
- `src/baobab/market` — Market configuration and engine-native mapping helpers.
- `src/baobab/b2b` — server-side B2B purchase and approval policy.
- `src/baobab/catalogue` — governed ZuriBeans product and bootstrap price definitions.
- `src/baobab/pricing` — replaceable pricing decision boundary.
- `src/baobab/inventory` — inventory configuration, availability port, and reconciliation policy.
- `src/baobab/payments` — payment policy, orchestration port, lifecycle, and ERP reconciliation.
- `src/baobab/fulfilment` — fulfilment policy, provider port, shipment metadata, and reconciliation.
- `src/baobab/thamani` — Thamani B2C consumer policy, catalogue, supplier, search-projection, pricing, promotion, inventory, ERP, and legally scoped event definitions.
- `src/baobab/tax` — contextual tax policy, effective-dated provider, and reconciliation.
- `src/baobab/trade-readiness` — cross-border metadata and compliance-provider boundary.
- `src/baobab/erp-integration` — durable ERP projection and reconciliation policy.
- `src/modules/b2b` — durable B2B Medusa module, models, service, and migrations.
- `src/modules/thamani` — durable Thamani B2C Medusa module (suppliers, retail profiles, Market eligibility).
- `src/modules/inventory-bridge` — ERP projections and canonical location mappings.
- `src/modules/payment-bridge` — payment policy, status, and reconciliation persistence.
- `src/modules/fulfilment-bridge` — fulfilment, tracking, and logistics reconciliation persistence.
- `src/modules/tax-bridge` — tax rules, B2B profiles, determinations, and reconciliation persistence.
- `src/modules/trade-readiness` — trade lane, decision, and cross-border transaction persistence.
- `src/modules/erp-integration` — external mappings and ERP integration projections.
- `src/modules/event-outbox` — durable publication, consumer receipts, and event reconciliation.
- `src/scripts/bootstrap-market.ts` — idempotent per-Market Medusa provisioning (shared provisioning logic in `src/baobab/market/provisioning.ts`).
- `src/scripts/bootstrap-thamani-market.ts` / `bootstrap-thamani-catalogue.ts` / `bootstrap-thamani-search.ts` / `bootstrap-thamani-pricing.ts` — Thamani B2C provisioning.
- `src/search/thamani-product-index.ts` — the `thamani_product` Search Module index definition.
- `src/workflows/thamani-promotion-guard.ts` — a `validate` hook on Medusa's `updateCartPromotionsWorkflow` enforcing Thamani's Digital-Estate, Market/currency, and stacking policies for every caller.
- `runtime` — infrastructure-facing runtime requirements.
- `docs` — architecture and decisions.

## Secrets

Never commit credentials. Production injects database, Redis, Medusa signing and webhook secrets through facilities owned by `nabhold/infrastructure`. Access tokens are forwarded only to the configured Control Plane context endpoint and must never be logged.

## Foundation 4

Codespaces uses `ghcr.io/nabhold/baobab-dev:1.2.6`. The reusable, SHA-pinned
Foundation gate validates the environment contract and reproducible inputs and
scans source, dependencies, secrets, configuration, and the Trade image.
