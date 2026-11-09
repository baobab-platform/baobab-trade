# ADR-0009 — MedusaJS Commerce Tenancy and Isolation Model: implementation audit

**Audit date:** 2026-11-09  
**Governing source:** `docs/adr/ADR-0009_ MedusaJS Commerce Tenancy and Isolation Model.md` (Accepted, 2026-09-02).  
**Baseline inspected:** `main`; open Trade PRs #189 (buyer/order/outbox vertical), #190 (dependency maintenance), #200 (readiness), #201 (ADR-0008 startup).  
**Status:** **PARTIALLY IMPLEMENTED — production isolation conformance NOT ACCEPTED.** This is a source-level audit plus a narrow route-hardening implementation, not a connected multi-tenant qualification.

## Boundary audit

| ADR-0009 obligation | Evidence found in source | Finding / disposition |
| --- | --- | --- |
| §§4–14, TEN-COM-001–006: Tenant distinct from LegalEntity, Market, Estate, Medusa Region, buyer organisation and EngineInstance | `src/baobab/contracts/tenant-context.ts`, `src/baobab/context/resolver.ts`, `src/baobab/b2b/`, tenant/market/organisation model keys | **Partial**. Distinct IDs exist; no proof of governed cross-entity tenancy/cardinality under real CP topology |
| §§15–20, TEN-COM-007–009: trusted Context precedes protected reads/writes; cross-tenant identifiers fail | `context/resolver.ts`, `control-plane/estate-binding.ts`, `buyer-authority.ts`, `security/b2b-isolation.ts` | **Partial**. New IAM/CP path is separate; legacy buyer onboarding had cross-tenant membership-as-authorization gaps and insufficient result ownership checks. This PR adds a server-side bound check, adversarial tests and query-result defence in depth; legacy is still not itself CP-authoritative |
| §§41–43, TEN-COM-017: administrative, buyer organisation and negotiated-price isolation | Buyer memberships/roles and buyer operation policy; `src/api/store/b2b/organisations/` | **Partial**. Legacy organisation routes required only Medusa customer membership; this PR requires a server-selected tenant plus an exact active membership and role binding. Platform-wide administrative authorisation, native prices and all other Medusa endpoints remain unqualified |
| §42: buyer private evidence and idempotency isolation | `src/api/store/b2b/organisations/apply/route.ts` and `src/api/store/b2b/applications/[id]/evidence/route.ts` | **Defect addressed**. Replay previously resolved a record by a same-tenant idempotency key without requiring the requesting customer to own the returned applicant/evidence row. This PR enforces applicant, application and tenant matching before returning replay data |
| §§26–30, TEN-COM-010–012: isolation escalation, instance migration, residency | Canonical mapping and CP-oriented context contract | **Not qualified**. No demonstrated live migration, dedicated instance/database separation or mapping continuity |
| §§34–38, TEN-COM-013–015: tenant-scoped caches, jobs, events, outbox | `src/modules/event-outbox`, `src/baobab/observability`, PR #189 event/broker work | **Partial / unqualified**. Source modules exist; independent multi-tenant replay and publisher/consumer isolation proof not established here. Do not duplicate or prematurely accept #189 |
| §§44–48, TEN-COM-016/018: protected search and context-bound provider configurations | `src/baobab/thamani`, `src/modules/{payment,fulfilment,tax}-bridge` | **Not qualified**. No connected cross-tenant search-index, payment-merchant, fulfilment-provider or tax negative proof in this audit |
| §§49–60: quotas, provisioning, suspension, deprovisioning, backup/restore and secrets | Trade infrastructure/config and CP ownership boundaries | **Not qualified** as tenant-isolation production evidence; protected environment governance remains separate |
| §§61–64, TEN-COM-020: adversarial cross-tenant testing as release gate | Existing `tests/b2b-threat-model.test.ts`, `tests/commerce-context.test.ts` plus new route/replay tests | **Improved, still HELD**. Source-level IDOR tests are necessary, not sufficient for full runtime protection. No claim of all eight mandatory §61 cases or production promotion approval |

## Verified defect and implementation scope

The legacy customer-facing Medusa onboarding routes at `/store/b2b/organisations/:id/*` often authenticated a customer and then trusted a membership/role row matching the URL's native organisation ID. They did **not** first establish that the native organisation belonged to the tenant selected by this digital estate. Because a Medusa EngineInstance can serve multiple tenants (ADR §7), a customer with a valid membership to another tenant's organisation could use that organisation's native ID to read or mutate protected customer-organisation data. This is a distinct defence-in-depth defect even when request authentication is valid.

`src/baobab/b2b/legacy-tenant-scope.ts` is the bounded remediation for this legacy path. It obtains the **server-only** configured ZuriBeans tenant from `resolveBuyerTenantId()`, loads the requested organisation, compares its exact stored `id` and `tenant_id` and returns a generic 404 for foreign/mismatched IDs. Absence of deployment tenant configuration fails closed before database read. It does not assert that `BAOBAB_ZURIBEANS_TENANT_ID` is a CP attestation or authorise purchases.

The check now precedes membership or confidential data access for legacy member roster/invitation creation, site and tax registration reads/writes, invitation resend/revoke, and applies before invitation acceptance changes persisted membership. The legacy canonical buyer-context route validates the locally linked organisation's tenant before returning buyer membership/roles. `/store/b2b/organisations/me` filters both returned organisations and applications by tenant and caller, including when the underlying service ignores an input filter. Member/site/tax list responses also recheck returned owners. Duplicate/mismatched membership and role rows do not grant authority.

Application and KYB evidence POST replay additionally require the *same applicant*, tenant and application ID as the replayed row. An idempotency key is an operation discriminator, **not** a bearer credential.

## Test evidence and next gates

Added tests target negative cross-tenant reads and writes across legacy endpoints, cross-context canonical buyer lookups, foreign-tenant invitation acceptance, mixed-source query-result leakage, incorrect or missing tenant configuration, and replay of another buyer's application/KYB evidence. Existing positive invitation and context tests are updated with explicit tenant and membership bindings.

Development test command:

```sh
npx vitest run \
  tests/adr-0009-legacy-tenant-isolation.test.ts \
  tests/adr-0009-idempotency-scope.test.ts \
  tests/buyer-invitation-route.test.ts \
  tests/buyer-invitation-lifecycle.test.ts \
  tests/b2b-context-route.test.ts \
  tests/dev07-legacy-buyer-context-safety.test.ts \
  tests/buyer-application-route.test.ts \
  tests/buyer-kyb-evidence.test.ts
```

Further required work, in order of risk: **(1)** require live IAM/CP-authoritative context and capability binding for every protected native/legacy commerce entry point, or retire the legacy path; **(2)** scope native customer/cart/order/price and search reads, payment/fulfilment providers and all administrative actions; **(3)** enforce context in background jobs, caches and events under tenant-adversarial retries and failures; **(4)** qualify distinct tenants and buyer organisations in real PostgreSQL/Medusa plus CP/IAM and exported evidence; **(5)** prove provisioning, suspension, migration, dedicated-instance/database isolation, backup and restore, and privacy/residency controls. Record all eight ADR §61 attack cases as individually reproducible, connected negative evidence before production promotion.

**Merge/acceptance rule:** a green source-level CI run does not qualify ADR-0009 production isolation. Keep independent protected staging/production gates and the existing held Trade #189 acceptance conditions intact.
