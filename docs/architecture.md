# Baobab Trade Architecture

## Responsibility

Baobab Trade is the independently deployable commerce engine. Medusa owns products, catalogues, customers, carts, orders, pricing, fulfilment, payment and commerce inventory abstractions. Baobab-specific code is limited to platform context, entitlement, mappings and cross-engine integration.

**Trade does not own**: the Control Plane's Tenant, Market or canonical-mapping
registries; ERP accounting or physical inventory; editorial content; a future
Order/Inventory/Pricing/Payments/Fulfilment engine's enterprise authority; or
distributed-ledger evidence. Trade is the _initial, native_ implementation of
Commerce Order, Pricing, Inventory projection, Payment orchestration and
Fulfilment for the current launch — see `docs/architecture/engine-boundaries.md`
for which capabilities that covers and what each one's future extraction point
would be.

## Decision records

`docs/adr/0001`–`0006` are the six short, already-implemented decisions this
repository was bootstrapped from. `docs/adr/ADR-0007`–`ADR-0018` are a later,
much more detailed elaboration of the same target architecture (Commerce
Engine boundary, tenancy, Market/Region/Currency/Sales-Channel/Legal-Seller,
product/pricing/inventory/checkout/payment/fulfilment/customer/tax). They were
renumbered from their original `ADR-0001`–`ADR-0012` to remove a numbering
collision with the short set; treat the long set as the authoritative detail
and the short set as the original lightweight record for the same area.

## Repository relationships

| Repository               | Authority                                                                | Trade obligation                                                               |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `nabhold/shared`         | Organisational contracts, identifiers and engineering standards          | Pin, validate and adapt published contracts; do not redefine them as canonical |
| `nabhold/baobab-cp`      | Authentication-derived tenant context, lifecycle and product entitlement | Resolve context through an explicit client and fail closed                     |
| `nabhold/infrastructure` | Production cloud resources, networking, secrets and deployment           | Publish runtime requirements; do not own production IaC here                   |
| `nabhold/baobab-erp`     | ERP operational records                                                  | Integrate through APIs and signed events only                                  |
| `nabhold/baobab-pulse`   | Intelligence and signals                                                 | Consume APIs/events without database access                                    |

## Request boundary

1. A client authenticates through the platform identity path.
2. Trade calls `POST /v1/context/resolve` on the Control Plane with `{"product_id": "baobab-trade"}` and the caller's bearer token (`src/baobab/control-plane/client.ts`).
3. The Control Plane returns authoritative `tenant_id`, `entity_id`, `lifecycle_status`, `entitled` and a `cache_ttl_seconds` (capped at 60s, 15s in practice). Trade caches a successful resolution for at most that TTL and fails closed — an expired cache is never served, it triggers re-resolution.
4. Trade rejects unresolved, inactive or unentitled contexts (`assertTradeEntitlement`).
5. Medusa workflows execute inside that context.
6. Outbound events carry `tenantid` (tenant-scoped events only), `correlationid` and `causationid` per the CloudEvents envelope below.

Caller-supplied tenant headers, `market_id`, `currency`, `region_id`, `sales_channel_id`, `seller_id` and provider ids are never authoritative (ADR-0010 §92-§93). Legal entity remains the default tenant boundary, but `tenant_id` and canonical `entity_id` are separate immutable identifiers.

## Contracts

`contracts.lock.yaml` pins the exact `nabhold/shared` commit and contract paths this repository was reviewed against, including the Control Plane OpenAPI, `context-resolution`, `market`, `canonical-mapping`, `problem-details` and `event-envelope` JSON Schemas — all of which are published, not pending. Local TypeScript definitions under `src/baobab/contracts/` are compatibility adapters (`fromContextResolutionResponse` etc.) that mirror those schemas field-for-field; they must be replaced by generated imports once Shared publishes a TypeScript contracts package, not extended into a competing standard.

## Events

Cross-engine events use the CloudEvents 1.0 structured JSON profile from `contracts/events/v1/envelope.schema.json` (`src/baobab/events/event-contracts.ts`): `specversion`, `id` (uuid), `type` (`com.nabhold.<name>.v<N>`), `source`, `subject`, `time`, `datacontenttype`, `dataschema`, `baobabscope` (`platform`|`tenant`), `correlationid`, optional `causationid`/`idempotencykey`/`traceparent`/`tracestate`, and `data`. `baobabscope: "tenant"` requires `tenantid`; `"platform"` forbids it — enforced as a discriminated TypeScript union, not just a runtime check. `NoopEventPublisher` is a placeholder (`order.mode = EVENT_ONLY`, no durable outbox yet); see Outstanding Decisions.

## Markets

See `docs/architecture/market-model.md` for the Baobab Market vs. Medusa
Region split and the ZuriBeans Uganda/South Africa bootstrap.

## Deployment

`docker-compose.yml` is local development tooling. `runtime/requirements.yaml` is the hand-off contract for `nabhold/infrastructure`. This repository builds the application image; Infrastructure owns production topology, managed databases, networks, domains, certificates, secret injection, scaling and rollback.

No engine shares database tables with another engine.

## Outstanding decisions

These require owner/business input; this repository has deliberately not
guessed at them:

- **No Control Plane Market exists yet for ZuriBeans.** `nabhold/shared` `contracts/legal-entity/registry.yaml` lists `ZURIBEANS` with `markets: []`, pending Control Plane approval. `src/baobab/market/market-config.ts` uses candidate market keys (`zuribeans_ug`, `zuribeans_za`) to drive local provisioning; once Control Plane registers and activates the real Markets, their `market_id` must be reconciled against the `baobab_market_key` metadata tag left on each Medusa Region/Sales Channel/Stock Location.
- **No payment, fulfilment or tax provider has been approved for either Market.** `market-config.ts` records `NATIVE` mode with Medusa's own built-in placeholders (`pp_system_default`, `manual_manual`) rather than a real provider. Wiring a real provider module into `medusa-config.ts` is a follow-up increment once one is chosen.
- **No request path resolves Control Plane context yet.** `HttpControlPlaneClient` and `bootstrap-market.ts` exist as clean boundaries, but there are no custom API routes, workflows or subscribers in this repository yet for the client to protect — wiring context resolution into checkout/order commitment is a Phase 5+ increment once those exist.
- **The canonical mapping registered with the Control Plane** (vs. the local `baobab_market_key` metadata breadcrumb this repository writes) requires a mapping-write API that is not yet exercised by Trade — confirm with the Control Plane team whether Trade should call it directly during bootstrap or whether reconciliation happens out-of-band.
