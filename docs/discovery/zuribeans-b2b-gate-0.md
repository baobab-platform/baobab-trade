# ZuriBeans B2B Commerce — Gate 0 Discovery Report

**Status:** Complete  
**Audited:** 2026-09-07  
**Primary repository:** `nabhold/baobab-trade`  
**Related repositories:** `nabhold/baobab-cp`, `nabhold/baobab-erp`, `nabhold/shared`, `nabhold/zuribeans`

## 1. Decision

Gate 0 is complete. The repositories provide a sound platform foundation, but the ZuriBeans B2B implementation must not proceed directly to catalogue seeding. Canonical Market registration, contract alignment, B2B persistence, and production provider configuration remain incomplete.

The implementation order is therefore:

1. close Gate 1 module-health evidence;
2. configure Gate 2 production infrastructure behind environment-driven providers;
3. register and expose canonical Uganda and South Africa Markets in the Control Plane;
4. reconcile Medusa projections to canonical Market identifiers;
5. implement the B2B organisation model before catalogue and checkout work.

## 2. Audited revisions

| Repository             | Revision  | Role                                                         |
| ---------------------- | --------- | ------------------------------------------------------------ |
| `nabhold/baobab-trade` | `bd4074c` | Medusa commerce execution                                    |
| `nabhold/baobab-cp`    | `328e114` | Context, canonical identity, Market and capability authority |
| `nabhold/baobab-erp`   | `e6e4263` | iDempiere integration and enterprise consequence authority   |
| `nabhold/shared`       | `0d61ba0` | Canonical schemas and governance contracts                   |
| `nabhold/zuribeans`    | `8c0b152` | B2B digital estate and intended beneficiary                  |

The Trade contract lock currently pins Shared at `c518b9aa7be1e67c2b9d360c75a97123ee47382f`. Updating that pin is a separate, reviewable contract-consumption change; this report does not silently move it.

## 3. Current Medusa posture

| Area             | Evidence                                                                                                                                                                                                                                                       | Gate status                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Medusa version   | `@medusajs/framework`, `@medusajs/medusa`, and `@medusajs/utils` are pinned to `2.20.1`                                                                                                                                                                        | Ready for Gate 1 verification                         |
| Core modules     | `medusa-config.ts` declares no overrides, so Medusa's default modules provide the initial Product, Pricing, Customer, Cart, Order, Inventory, Stock Location, Region, Sales Channel, Currency, Payment, Fulfillment, Tax, Auth, API Key and Store capabilities | Present, runtime proof still required                 |
| Plugins          | No plugins configured                                                                                                                                                                                                                                          | Deliberate but incomplete for production              |
| Custom modules   | None                                                                                                                                                                                                                                                           | B2B and outbox modules not implemented                |
| Migrations       | No repository-owned Trade migrations                                                                                                                                                                                                                           | B2B and outbox schemas not implemented                |
| Workflows        | No repository-owned custom workflows                                                                                                                                                                                                                           | Approval and order-boundary workflows not implemented |
| Subscribers      | No repository-owned subscribers                                                                                                                                                                                                                                | Canonical event publication not implemented           |
| API routes       | `/health` and `/readiness` only                                                                                                                                                                                                                                | No B2B or protected Commerce routes                   |
| Admin extensions | None                                                                                                                                                                                                                                                           | Not currently required for Gate 1                     |
| Seed             | Intentionally empty                                                                                                                                                                                                                                            | Gate 18 not started                                   |

## 4. Existing Baobab integration

Trade already contains useful, tested foundations:

- typed tenant Context, Market, canonical mapping, provenance, and Problem Details contracts;
- an authenticated Control Plane client with fail-closed production configuration;
- data-driven UG/ZA Medusa projection configuration;
- mapping tags that avoid treating Medusa identifiers as canonical identifiers;
- a typed CloudEvents-compatible envelope and publisher abstraction;
- structured logging, liveness, and readiness endpoints;
- 24 unit tests covering Context, Market mapping, event envelopes, and the Control Plane client.

These components should be refined, not replaced by mechanically named packages.

## 5. Market and sales-channel findings

`nabhold/shared/contracts/legal-entity/registry.yaml` identifies `ZURIBEANS` as B2B and entitled to `baobab-trade`, but its `markets` list is empty. The Control Plane has a `market.market` schema migration, but no repository implementation currently exposes a real ZuriBeans Market aggregate or the documented `GET /v1/markets/{market_id}` behaviour.

Trade has candidate keys `zuribeans_ug` and `zuribeans_za`. Its bootstrap script creates Regions and Stock Locations without minting canonical IDs, which is correct. However, it currently creates a different Sales Channel for each Market. The target plan prefers one principal `zuribeans-b2b` Sales Channel unless a proven operational requirement needs Market-specific channels. Gate 4 must resolve this mismatch without deleting existing data.

No trusted legal-seller binding is currently returned and enforced through the full ZuriBeans-to-Trade request path. Hostname, country, currency, Region, and Sales Channel must remain untrusted selectors.

## 6. Infrastructure findings

| Concern        | Development state                                  | Production gap                                                                                            |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | Dedicated Trade database in Compose                | Compose uses PostgreSQL 16; deployment ownership remains external                                         |
| Redis URL      | Present in configuration and Compose               | Explicit Redis Event, Workflow, Locking, and Cache module wiring is absent                                |
| Event delivery | In-memory publisher abstraction                    | No transactional outbox, retry worker, or dead-letter/reconciliation path                                 |
| Files          | No provider configured                             | S3-compatible provider required                                                                           |
| Notifications  | No provider configured                             | Provider-neutral production email integration required                                                    |
| Search         | No provider configured                             | Decide whether PostgreSQL search suffices for the initial ten-product catalogue before adding Meilisearch |
| Observability  | Structured application logger and health endpoints | Metrics, traces, and dependency diagnostics remain incomplete                                             |

Production must fail closed when required provider configuration is absent. Development fallbacks must be explicit and must never masquerade as production readiness.

## 7. B2B capability findings

No Trade-owned structured persistence exists yet for:

- `B2BOrganisation` and lifecycle state;
- buyer membership, role, and organisation-scoped authorization;
- approval policies and spend limits;
- customer purchase-order requirements and durable PO references;
- commercial and invoice terms;
- organisation tax registrations;
- delivery sites;
- contract pricing ownership and organisation isolation.

The ZuriBeans estate already contains buyer registration/login pages and a separate supplier-application workflow backed by its own schema. That supplier workflow is sourcing intake, not a Medusa customer model. It must remain distinct from buyer organisations and must integrate through an explicit API/event boundary rather than shared database access.

## 8. ERP and event findings

Shared already publishes ERP contracts for business partners, customers, warehouses, inventory availability, order consequences, payment outcomes, invoices, mappings, OpenAPI, and AsyncAPI. ERP has inbox/outbox tables and projection-oriented integration code. Trade should consume these contracts instead of creating parallel ERP payloads.

Trade's event envelope aligns conceptually with Shared's CloudEvents profile, but Trade has neither transactional outbox persistence nor domain-event subscribers. At-least-once delivery and idempotent ERP consumption are therefore architectural intent, not yet an end-to-end implemented guarantee.

## 9. Verification baseline

| Repository    | Command/result                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Trade         | Format, lint, typecheck, 24 tests, and Medusa build passed                                              |
| ZuriBeans     | Lint, typecheck, 50 tests passed; 3 database-backed tests skipped; Next.js production build passed      |
| ERP           | 42 Python/JSON validation checks passed; Maven was unavailable, so the OSGi extension build was skipped |
| Control Plane | Not executed in this runner because Go is unavailable                                                   |
| Shared        | Contract validators not executed in this runner because Ruby is unavailable                             |

The local runner used Node 24, while Trade declares `>=20.19.0 <23` and ZuriBeans declares `>=22.14.0 <23`. Node results are useful but do not replace CI on the repositories' supported Node versions.

PR CI subsequently confirmed that the repository-contract foundation check passes, while the foundation vulnerability scan fails on the pre-existing transitive `lodash 4.17.23` dependency (`CVE-2026-4800`, HIGH; scanner-reported fixed version `4.18.0`). Gate 1 must resolve or formally assess this dependency finding; it must not be waived merely to obtain a green pipeline.

## 10. Gate backlog and acceptance order

| Next gate     | Deliverable                                                                                        | Exit condition                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1        | Executable core-module health probe and CI evidence                                                | Required default modules resolve and basic create/read flows pass against PostgreSQL/Redis                                      |
| Gate 2        | Environment-driven Redis module wiring and production provider policy                              | Production cannot boot with volatile critical providers; S3/email/search decisions are documented and tested                    |
| Gate 3        | Canonical ZuriBeans Context and Market integration across Shared, CP, and Trade                    | Active UG/ZA Market IDs, legal seller, estate, engine instance and capabilities are resolved from trusted Context               |
| Gate 4        | Idempotent UG/ZA Commerce projections                                                              | Regions, one justified B2B Sales Channel, currencies, locations and provider bindings reconcile without hardcoded Medusa IDs    |
| Gate 5        | Trade-owned B2B module and migrations                                                              | Cross-organisation reads/writes fail server-side; roles, terms, sites, tax registrations, approvals and PO rules are structured |
| Gate 6 onward | Catalogue, pricing, inventory, payments, fulfilment, tax, trade metadata, ERP, outbox and security | Each gate's contract and isolation tests pass before the next gate begins                                                       |

## 11. Risks requiring explicit decisions

1. Legal seller records and tax registrations are not canonical yet. They must not be fabricated from country codes.
2. The plan names three warehouses per country, while the existing bootstrap has one placeholder per Market. Gate 4 needs approved canonical locations before expansion.
3. No production payment, fulfilment, notification, file, or tax provider is approved. Interfaces may be implemented first; credentials and provider choice belong outside domain logic.
4. The initial catalogue is small. Meilisearch should be added only if its operational cost is justified; search remains a projection either way.
5. ZuriBeans' supplier database must not evolve into a second commerce or ERP authority.
6. The current dependency graph fails the shared HIGH/CRITICAL vulnerability gate on `lodash`; remediation must preserve Medusa compatibility and lockfile reproducibility.

## 12. Gate 0 conclusion

Proceed with Gate 1 in `baobab-trade`, while preparing the coordinated Gate 3 contract changes in `shared` and `baobab-cp`. Do not seed the ten products, hardcode tax percentages, or implement cross-border checkout until trusted canonical Context and Market records exist.
