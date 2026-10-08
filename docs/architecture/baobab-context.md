# Baobab Commerce Context

Gate 3 establishes the governed context boundary that every later commerce
workflow must cross.

## Resolution

1. Trade resolves the authenticated tenant and product entitlement through
   `POST /v1/context/resolve`.
2. Trade reads the selected Market through `GET /v1/markets/{market_id}`.
3. Trade verifies that the Market is active and owned by the resolved tenant.
4. The Market supplies the Legal Seller canonical ID. Trade does not infer it
   from country, currency, Medusa Region, or the tenant ID.
5. A trusted route or deployment policy supplies the Digital Estate canonical
   ID. Raw caller-supplied tenancy and Market headers are not authoritative.
6. Trade asks the Control Plane to resolve and store a platform context through
   `POST /v1/platform-context/resolve` (the Market's own country selects among
   the tenant's market participations) and keeps its `context_id`. Trade checks
   that the stored context belongs to the resolved tenant and, when it names a
   Market, that it is the selected one.
7. Trade resolves the Market, Legal Seller, and Digital Estate canonical IDs to
   Medusa ExternalReference IDs through `POST /v1/resolution/mappings`,
   redeeming that `context_id` (ADR-SHARED-014). The request names only the
   `context_id`, the canonical entity, and the target
   (`target_system_namespace: medusa`, `target_engine_id: baobab-trade`); Trade
   never supplies tenant, legal entity or Market scope to it (Canonical Mapping
   Model section 17.3).

The result is immutable request context:

```text
Authenticated tenant
  + active owned Market
  + explicit Legal Seller
  + explicit Digital Estate
  + active Control Plane mappings
  = BaobabCommerceContext
```

## Isolation invariants

- A Market owned by another tenant is rejected before mapping resolution.
- An inactive Market cannot enter a transactional workflow.
- Missing Legal Seller or Digital Estate canonical identity fails closed.
- Mapping responses must be `ACTIVE`, contain a Control Plane-issued
  `external_reference_id`, and repeat the requested canonical entity ID and
  the redeemed `context_id`. A response that resolves to another canonical
  entity (`target_canonical_entity_id`), or in another tenant, is rejected.
- Trade stores or propagates canonical and ExternalReference IDs; it does not
  mint replacement canonical mappings.
- Tenant, Legal Seller, Market, Digital Estate, Medusa Region, and Sales
  Channel remain distinct concepts even when their initial data correlates.

## Current Control Plane boundary

The pinned Shared contracts (`contracts.lock.yaml`) publish tenant-context,
platform-context, Market-read, and mapping-resolution operations. They do not
publish standalone Digital Estate or ExternalReference read operations. Gate 3
therefore consumes their canonical IDs and mapping-resolution references
without creating local shadow registries. Rich resource hydration belongs in a
compatible Control Plane and shared-contract change.

Trade's compatibility with those contracts is proved, not asserted: the
suite in `tests/shared-conformance` (`npm run test:shared-conformance`, run in CI
against the pinned commit) checks Trade's validators, client requests, event
envelopes and workload authority against the real Shared files.

## Open items for the owners

`resolveCommerceContext` is not yet called by any route, so none of these fails
in production today. Each needs a decision outside Trade:

- **Workload scopes.** The Control Plane requires `market:read` for
  `GET /markets/{market_id}` and `mapping:resolve` for
  `POST /resolution/mappings`. The `baobab-trade-workload` registration in
  Shared `contracts/identity/v1/workload-registry.yaml` allows only
  `context:resolve` and `provider-migration:task`. Granting a scope is an
  authority decision (Shared registry, the IAM client, the Control Plane).
  The conformance suite pins this gap.
- **Which entities can be mapped.** The Control Plane maps only registered
  canonical entities, whose identifiers are UUIDs (`registry.canonical_entity`),
  and answers `POST /resolution/mappings` with 400 for any other identifier,
  although the contract's `canonical_entity_id` grammar is broader. A Market's
  `market_id` (`mkt_...`) is not a canonical entity, so the Market step of
  `resolveCommerceContext` cannot succeed against the Control Plane as served.
  Whether a Market is a mapping subject, and which identifier to resolve, is a
  Mapping Model decision. Trade follows the contract and passes the identifier
  it has.
- **One reference per canonical entity.** Mapping resolution has no capability
  or native-type argument (ADR-SHARED-014 section 3). A Market that maps to a
  Medusa Region, Sales Channel and Stock Location resolves ambiguously
  (`MAPPING_AMBIGUOUS`, 409). Until the Mapping Model says how one canonical
  entity maps to several native objects, Trade expects exactly one mapping
  into Medusa per canonical entity.
