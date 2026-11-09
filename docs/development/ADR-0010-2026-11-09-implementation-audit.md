# ADR-0010 — Market execution authority audit and implementation tranche

**Audit:** 9 November 2026  
**Governing specification:** `docs/adr/ADR-0010_ MedusaJS Commerce Market, Region, Currency, Sales Channel and Legal Seller Model.md` (Accepted).  
**Authority contracts consulted:** `shared/contracts/control-plane/v1/market.schema.json`, `market-lifecycle.yaml`, and `platform-context.schema.json`.  
**Baseline:** Trade `main`; open Trade #189, #200–#202 intentionally remain separate.  
**Overall verdict:** **PARTIAL — NOT qualified for staging/production**.

## Why this implementation tranche

Native Medusa order restrictions and Medusa-specific projections already exist in Trade, but an all-native cart/order/customer/price/search/PSP/carrier protection claim requires *joined* IAM identity, Control Plane Context and capability/estate binding, Medusa persistence boundaries, real provider credentials and independently exported multi-tenant evidence. The reviewed repository does not establish all of those. This tranche therefore follows the requested **ADR-0010 fallback**, without weakening the native Trade-A guard or duplicating in-flight #189.

### Concrete failure mode found

`src/baobab/context/resolver.ts` previously allowed a stored Control Plane context with **no `market_id`**, as long as any present `market_id` did not disagree. It also accepted an active Market's status without proving that its effective window was current, or that the currency and country selected by the Control Plane agreed with the Market. The resolver checked mapping tenant IDs but did not itself recheck the returned mapping's `context_id` and `canonical_entity_id`; `HttpControlPlaneClient.getMarket()` accepted a syntactically valid 200 payload for a different Market ID.

These are **authority-consistency** gaps. Two Markets can share a country, currency and Medusa Region yet have different legal, commercial and tenant permissions. CP `/v1/platform-context/resolve` chooses a **primary registry Market for the country**, not any arbitrary Market in that country. Its result cannot be borrowed to authorise another Market merely because geography, currency or Medusa configuration match.

## Implemented in this PR

- `src/baobab/market/execution-authority.ts`: pure, fail-closed CP Market/Context consumer guard for ADR-0010 §§6–7, 27, 43, 62–64, 91–94 and MKT-COM-010–018/022. It requires active entitled tenant, exact requested/returned Market and stored CP `market_id`, same tenant, canonical seller, current Market effective interval, positive Market revision, valid uppercase ISO 4217 currency and allowed-currency policy, exact CP context currency, a CP participation country included in the Market, and unexpired/nonfuture CP context when bounded.
- `src/baobab/context/resolver.ts`: invokes this guard **before** any external mapping requests; carries the verified `marketAuthority` (Market, seller, transaction currency, country, revision and `context_id`) in the resolved commerce context. Mapping responses must echo tenant, stored Context, canonical entity and `ACTIVE` status before Trade uses their native references.
- `src/baobab/control-plane/client.ts`: refuses a successful HTTP Market read if its `market_id` is not the requested ID. This prevents a valid-looking but wrong Market object from crossing the CP adapter.
- `tests/adr-0010-market-execution.test.ts`: negative tests for same-country/same-currency Market substitution, foreign tenant and stored contexts, market lifecycle/effective-time failures, wrong/missing seller, currency and participation mismatch, expired contexts, invalid revisions and positive multi-country scope.
- `tests/commerce-context.test.ts` and `tests/control-plane-client.test.ts`: exercise the actual composed resolver and HTTP adapter with consistent fixtures and adversarial responses.

**Important scope distinction:** The guard validates **consistency of CP responses already obtained by a trusted Trade workload**. It is *not* itself IAM authentication, a buyer entitlement, a seller operating-binding activation, an independently attested estate-Market capability binding, or a live transaction commit fence. A resolved `marketAuthority` must not be serialized as a customer bearer credential.

## Requirement assessment (ADR-0010 §105)

| Requirement groups | Evidence assessed | Status |
| --- | --- | --- |
| Market distinct from tenant/country/region/currency/channel/estate/instance (§§2–26, MKT-COM-001–009) | CP domain contracts; `market-config.ts`, `mapping.ts`, `context/resolver.ts` | **Structural implementation; cardinality not fully qualified** |
| Active Market, country participation, exact seller and currency (§§6–7, 27, 62–64; #5–7, #13–16) | New guard, existing CP client, composition tests | **Development-consumer guards implemented**; no actual funded order acceptance claim |
| Two same-country Markets and a multijurisdiction Market (#1–4, #18, #24) | Adversarial Market/Context tests; CP contract permits cardinality | **Source-level negatives**, not a real multitenant CP provisioning proof |
| Cart Market switch rebuilds prices/taxes/payment/fulfilment (#9–12) | Not connected to a certified native Medusa cart-rebuild gate in this tranche | **OUTSTANDING** |
| Seller/transaction currency persisted immutably on real native order (#13–14, §48) | Separate in-progress Trade #189 native order/outbox transaction | **OUTSTANDING connected qualification** |
| Provider/customer/search/cache isolation (#17–20) | Provider adapters and search exist, but no complete connected cross-market negatives here | **OUTSTANDING** |
| Idempotent Market projection, native Region mapping and migration (#21–24) | Existing bootstrap/mapping source; no real duplicated/protected migration witness here | **PARTIAL** |
| ERP seller/currency context (#25) | Existing boundary contracts and Trade #189/ERP integration work | **OUTSTANDING final connected proof** |

## What still must happen

1. **CP authority:** prove estate-Market eligibility and capability binding under genuine workload + subject identities. The CP country-participation *primary* Market is insufficient authority for another B2B/B2C Market within the same country; extend the CP contract if secondary Market admission is required rather than guessing from Region or Sales Channel.
2. **Native operation PEPs:** bind this CP Market/currency/seller decision to actual native Medusa cart creation/update, repricing, payment, fulfilment and checkout, including all negative/unknown outcomes. Do not trust HTTP request body, currency symbol, buyer-selected `region_id` or sales channel.
3. **Historical evidence:** persist immutable Market, seller, currency, legal/price/tax snapshot and provider authority within the actual order/commit transaction, then independently read back durable results and outbox evidence.
4. **Provider and projections:** test tenant/Market-scoped merchant accounts, carrier adapters, tax, pricing, search and cache keys. Demonstrate one Market cannot borrow another's provider even when a Medusa Region is shared.
5. **Connected conformance:** execute ADR-0010 §105's complete 25-case matrix against real Medusa/PostgreSQL 17 + IAM/CP + provider sandboxes with independent traces and negative cases. Do not call source-only Vitest green staging/production qualification.

### Development verification

```sh
npx vitest run \
  tests/adr-0010-market-execution.test.ts \
  tests/commerce-context.test.ts \
  tests/control-plane-client.test.ts \
  tests/market-config.test.ts \
  tests/market-mapping.test.ts
npm run format:check
npm run typecheck
```

**Promotion disposition:** ADR-0010 remains HELD for connected acceptance. The governed runtime and production approval boundaries are unchanged; this document is an audit ledger, not a declaration of full ADR closure.
