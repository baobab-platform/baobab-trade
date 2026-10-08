# Engine boundaries

Baobab is a platform of specialised engines. This table distinguishes who
holds authority **today** from where that capability could be extracted to a
dedicated engine **later**. Extraction happens only when independent
authority, scale, complexity or multiple consumers justify a new engine — not
merely because the target architecture diagram has a box for it.

| Capability                                        | Current authority           | Status                                                                      | Future extractable engine          |
| ------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Commerce Order                                    | Medusa (`baobab-trade`)     | NATIVE-IN-MEDUSA                                                            | Baobab Order Engine / DOM          |
| Commerce Product & catalogue                      | Medusa                      | NATIVE-IN-MEDUSA                                                            | — (stays with Commerce Engine)     |
| Commerce Pricing                                  | Medusa                      | NATIVE-IN-MEDUSA                                                            | Pricing Engine                     |
| Promotions                                        | Medusa                      | NATIVE-IN-MEDUSA                                                            | Pricing Engine                     |
| Commerce availability / reservation               | Medusa                      | NATIVE-IN-MEDUSA                                                            | Inventory Engine                   |
| Payment orchestration                             | Medusa                      | NATIVE-IN-MEDUSA (placeholder providers only, none approved)                | Payments Engine                    |
| Commerce fulfilment                               | Medusa                      | NATIVE-IN-MEDUSA (placeholder providers only, none approved)                | Fulfilment Engine                  |
| Tax calculation                                   | Medusa / provider           | NATIVE-IN-MEDUSA (no provider selected)                                     | Tax capability / external provider |
| Physical inventory                                | iDempiere (`baobab-erp`)    | EXTERNAL, not yet integrated                                                | Inventory Engine / WMS             |
| Accounting                                        | iDempiere                   | EXTERNAL, not yet integrated                                                | Remains ERP                        |
| ERP Business Partner                              | iDempiere                   | EXTERNAL, not yet integrated                                                | Remains ERP                        |
| Editorial content                                 | Payload CMS                 | EXTERNAL, not yet integrated                                                | Remains Payload                    |
| Platform Context (Tenant, lifecycle, entitlement) | Control Plane (`baobab-cp`) | ACTIVE — `HttpControlPlaneClient.resolveContext`                            | Remains Control Plane              |
| Baobab Market registry                            | Control Plane               | PLANNED — schema published, no Market instance registered yet for ZuriBeans | Remains Control Plane              |
| Canonical mapping / ExternalReference             | Control Plane               | PLANNED — Trade only writes a local engine-native breadcrumb today          | Remains Control Plane              |
| Trade compliance                                  | Projected adapter           | ACTIVE PORT — projected policy remains local                                | Trade Compliance Engine            |
| Ledger evidence                                   | Disabled adapter            | BOUNDARY ONLY — no ledger authority or service                              | Ledger Engine                      |
| Intelligence / signals                            | `baobab-pulse`              | PLANNED, no event consumer built yet                                        | Remains Pulse                      |

## Reading the "Status" column

- **ACTIVE** — implemented and exercised by this repository today.
- **NATIVE-IN-MEDUSA** — Medusa's own module is the current implementation;
  Trade has not built a capability port around it because there is no second
  consumer or competing implementation yet to justify one (task brief §17,
  §66).
- **PLANNED** — a boundary this repository intends to integrate with, but has
  not yet, because either the dependency isn't ready (no Market registered,
  no ERP contract exercised) or nothing in this codebase needs it yet (no
  commerce order flow exists to publish `commerce.order.placed` from).
- **EXTERNAL** — owned by another repository/engine; Trade must reach it only
  through APIs, signed events and `ExternalReference`, never a shared
  database (task brief §28, `docs/architecture.md` "No engine shares database
  tables with another engine").

## What this repository does not do

Per the engineering principle in the task brief: this repository does not
scaffold empty deployable services for Order, Inventory, Pricing, Payments,
Fulfilment or Compliance. Where a future engine is anticipated, the boundary
is a typed contract or client (`src/baobab/contracts/`,
`src/baobab/control-plane/client.ts`) and, where a real cross-engine
consequence exists, an event (`src/baobab/events/`) — not a running service.

## Gate 14 port inventory

`OrderOrchestrationPort`, `InventoryAvailabilityPort`, `PricingDecisionPort`,
`PaymentOrchestrationPort`, `FulfilmentPort`, `TradeCompliancePort`, and
`LedgerEvidencePort` are typed extraction seams. Their binding registry keeps
Orders, Inventory, Pricing, Payments and Fulfilment native in Medusa. The
ledger adapter is deliberately disabled: defining a port is not permission to
invent a ledger, and routing changes remain governed by Control Plane
CapabilityBindings.

## Gate 18 port contract tests

Every one of the seven ports above now has a dedicated contract test
(`tests/order-orchestration.test.ts`, `tests/inventory-availability.test.ts`,
`tests/pricing-decision.test.ts`, `tests/payment-orchestration.test.ts`,
`tests/fulfilment-port.test.ts`, `tests/trade-compliance-port.test.ts`,
`tests/ledger-evidence.test.ts`), run together as the `test:ports` CI step.
Each test exercises the port's current binding — its Medusa-native,
projected, or disabled adapter — against an in-memory fake of whatever it
depends on (a repository, a policy provider, or Medusa's own module service),
proving today's adapter honours the full port contract (idempotency,
validation, fail-closed rejection, and — where relevant — Digital Estate
isolation) without requiring a live Medusa container. This is what makes the
seam real: a future extraction only has to satisfy the same contract test,
not rediscover it. `PricingDecisionPort` previously had no implementation at
all (unlike the other six); Gate 18 added `MedusaPricingDecisionAdapter`,
matching the same injected-collaborator shape as `MedusaOrderOrchestrationAdapter`,
so the port has a reference adapter to hold to its contract.
