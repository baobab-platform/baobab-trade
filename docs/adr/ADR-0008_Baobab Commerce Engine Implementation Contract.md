# Baobab Commerce Engine Implementation Contract

**Document Type:** Parent Implementation Contract  
**Engine:** MedusaJS Commerce Engine  
**Repository:** `nabhold/baobab-trade`  
**Status:** Normative  
**Architecture Parent:** `ADR-0007 — MedusaJS as the Baobab Commerce Engine`  
**Control Plane:** `nabhold/baobab-cp` — Go  
**ERP Engine:** `nabhold/baobab-erp` — iDempiere  
**Content Engine:** Payload CMS  
**Canonical Contracts:** `nabhold/shared`  
**Primary Persistence:** PostgreSQL  
**Runtime:** Node.js / TypeScript / MedusaJS  
**Applies To:** Development, testing, CI/CD, staging, production and future regional deployments

---

# 1. Purpose

This document defines the physical and software implementation contract for the Baobab Commerce Engine implemented using MedusaJS.

It converts the architectural decisions defined by the MedusaJS Commerce ADR into enforceable implementation boundaries covering:

- repository architecture;
- Medusa modules and extensions;
- runtime topology;
- configuration;
- persistence;
- engine registration;
- Control Plane integration;
- capability binding;
- tenancy and context handling;
- market handling;
- isolation;
- canonical identity mapping;
- REST interfaces;
- event contracts;
- transactional outbox;
- iDempiere integration;
- Payload CMS integration;
- digital-estate consumption;
- observability;
- security;
- testing;
- deployment;
- migration;
- resilience;
- upgrade governance.

This contract SHALL serve as the parent implementation specification for all subsequent technical artefacts in `nabhold/baobab-trade`.

Subordinate artefacts SHALL include, at minimum:

```text
01. Repository and package specification
02. Medusa module specification
03. PostgreSQL extension/migration specification
04. Control Plane integration contract
05. OpenAPI specification
06. AsyncAPI specification
07. Canonical commerce schemas
08. iDempiere integration specification
09. Payload integration specification
10. Digital Estate integration specification
11. Runtime/deployment contract
12. Observability contract
13. Security contract
14. Test and conformance specification
```

No subordinate implementation SHALL contradict this document without an approved architecture decision.

---

# 2. Normative Language

The terms:

```text
MUST
MUST NOT
SHALL
SHALL NOT
SHOULD
SHOULD NOT
MAY
```

are normative.

A requirement identified as `MUST`, `MUST NOT`, `SHALL`, or `SHALL NOT` is mandatory for production conformance.

---

# 3. System Identity

The engine SHALL be registered canonically as:

```text
engine_key: commerce.medusa
engine_type: commerce
implementation: medusajs
repository: nabhold/baobab-trade
```

The precise identifiers SHALL be governed by the Baobab Control Plane schema.

The runtime SHALL NOT assume that its repository name is its canonical engine identifier.

---

# 4. Physical System Boundary

The logical engine boundary SHALL be:

```text
┌─────────────────────────────────────────────────────────┐
│               BAOBAB COMMERCE ENGINE                    │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                 MedusaJS Runtime                  │  │
│  │                                                   │  │
│  │  API Routes                                       │  │
│  │  Workflows                                        │  │
│  │  Modules                                          │  │
│  │  Subscribers                                      │  │
│  │  Jobs                                             │  │
│  │  Baobab Integration Layer                         │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│                  Commerce PostgreSQL                    │
│                                                         │
│        Optional runtime coordination/cache              │
└──────────────────────────┬──────────────────────────────┘
                           │
                    Published Contracts
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    Control Plane      iDempiere        Payload CMS
          │                                 │
          └───────────────┬─────────────────┘
                          ▼
                   Digital Estates
```

Only components owned by the Commerce Engine SHALL access Commerce Engine persistence directly.

---

# 5. Repository Contract

The repository SHALL maintain clear separation between:

- upstream Medusa configuration;
- Baobab-specific modules;
- adapters;
- API contracts;
- event contracts;
- infrastructure;
- tests;
- documentation.

A target repository structure SHALL resemble:

```text
nabhold/baobab-trade/
│
├── .devcontainer/
│
├── .github/
│   ├── workflows/
│   ├── dependabot.yml
│   └── CODEOWNERS
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── contracts/
│   ├── operations/
│   └── runbooks/
│
├── src/
│   ├── api/
│   │   ├── admin/
│   │   ├── store/
│   │   ├── platform/
│   │   └── health/
│   │
│   ├── modules/
│   │   └── baobab/
│   │       ├── context/
│   │       ├── mapping/
│   │       ├── events/
│   │       ├── outbox/
│   │       ├── capabilities/
│   │       └── integration/
│   │
│   ├── workflows/
│   │   └── baobab/
│   │
│   ├── subscribers/
│   │   └── baobab/
│   │
│   ├── jobs/
│   │   └── baobab/
│   │
│   ├── adapters/
│   │   ├── control-plane/
│   │   ├── idempiere/
│   │   ├── payload/
│   │   ├── events/
│   │   └── identity/
│   │
│   ├── middleware/
│   │   └── baobab/
│   │
│   ├── schemas/
│   │
│   └── config/
│
├── contracts/
│   ├── openapi/
│   ├── asyncapi/
│   └── json-schema/
│
├── scripts/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   ├── isolation/
│   ├── resilience/
│   └── e2e/
│
├── Dockerfile
├── compose.yaml
├── package.json
├── tsconfig.json
├── medusa-config.ts
└── README.md
```

Exact paths MAY evolve.

The separation of responsibilities SHALL NOT.

---

# 6. Package Ownership

Baobab-specific code SHALL be grouped into explicitly owned namespaces.

Application code SHALL NOT scatter platform integration logic arbitrarily across Medusa internals.

Preferred ownership:

```text
src/modules/baobab
```

or equivalent documented package boundaries.

The following concerns SHALL have named owners:

| Concern               | Logical Package          |
| --------------------- | ------------------------ |
| Context               | `baobab/context`         |
| Capability resolution | `baobab/capabilities`    |
| Canonical mapping     | `baobab/mapping`         |
| Outbox                | `baobab/outbox`          |
| Event envelope        | `baobab/events`          |
| Control Plane client  | `adapters/control-plane` |
| ERP integration       | `adapters/idempiere`     |
| CMS integration       | `adapters/payload`       |
| Identity integration  | `adapters/identity`      |

---

# 7. Upstream Medusa Boundary

Baobab SHALL use Medusa extension mechanisms before modifying upstream code.

The extension priority SHALL be:

```text
configuration
     ↓
module
     ↓
workflow
     ↓
subscriber
     ↓
API route
     ↓
provider / adapter
     ↓
upstream patch
```

An upstream patch requires:

```text
ADR or documented architecture exception
+
automated regression test
+
upgrade-impact note
+
named owner
```

---

# 8. Engine Bootstrap

Every running Commerce Engine instance SHALL bootstrap in the following conceptual order:

```text
1. Runtime configuration validation
2. Secret resolution
3. Database connection
4. Medusa module initialisation
5. Baobab module initialisation
6. Control Plane identity verification
7. EngineInstance registration/validation
8. Capability binding readiness
9. Event publisher readiness
10. API readiness
```

Failure of mandatory bootstrap requirements SHALL prevent readiness.

---

# 9. EngineInstance Identity

Each production deployment SHALL have a stable Control Plane `EngineInstance`.

At runtime, the Commerce Engine SHALL know at minimum:

```text
engine_id
engine_instance_id
environment
deployment_region
deployment_revision
```

It MUST NOT create a new EngineInstance on every restart.

Instance identity SHALL represent the logical engine deployment, not a container replica.

---

# 10. Replica Identity

Individual runtime replicas MAY possess operational identifiers such as:

```text
pod_id
container_id
hostname
process_id
```

These SHALL NOT be used as canonical EngineInstance identifiers.

Example:

```text
EngineInstance
  commerce-africa-01
         │
         ├── Replica A
         ├── Replica B
         └── Replica C
```

---

# 11. Control Plane Registration

The Commerce Engine SHALL validate its Control Plane registration at startup or through an equivalent provisioning workflow.

The Control Plane registration SHALL include, conceptually:

```text
engine_instance_id
engine_id
status
environment
region
endpoint
supported_contract_versions
declared_capabilities
isolation_profile_support
metadata
```

The engine SHALL NOT self-authorise capabilities merely because corresponding code exists.

---

# 12. Capability Declaration

Medusa SHALL declare capabilities that it technically implements.

Examples:

```text
commerce.catalog
commerce.pricing
commerce.cart
commerce.checkout
commerce.order
commerce.payment
commerce.fulfilment
commerce.return
commerce.refund
commerce.customer
commerce.b2b
```

The Control Plane determines where those capabilities are bound.

Therefore:

```text
implemented capability
!=
authorised capability binding
```

---

# 13. Capability Binding Resolution

A request requiring platform routing SHALL resolve:

```text
Context
   │
   ▼
Capability
   │
   ▼
CapabilityBinding
   │
   ▼
EngineInstance
```

Commerce operations SHALL reject contexts not bound to the executing engine where binding enforcement applies.

---

# 14. Context Object

The Commerce Engine SHALL maintain a request-scoped Baobab Context projection.

A minimum internal representation SHOULD resemble:

```text
BaobabContext {
    contextId
    tenantId
    organisationId?
    legalEntityId?
    marketId?
    digitalEstateId?
    engineInstanceId
    capabilityBindingId?
    actorId?
    correlationId
    traceId?
}
```

Optionality SHALL be defined by operation semantics.

---

# 15. Trusted Context Boundary

Context supplied directly by an untrusted client SHALL NOT automatically be trusted.

For example:

```text
X-Baobab-Tenant-ID
```

provided by an arbitrary internet client cannot by itself establish tenancy.

Trusted context SHALL originate through:

- validated identity claims;
- Control Plane resolution;
- trusted gateway assertions;
- signed platform credentials;
- other approved mechanisms.

---

# 16. Context Middleware

Baobab middleware SHALL execute before protected platform-integrated routes.

Conceptually:

```text
HTTP Request
    │
    ▼
Authentication
    │
    ▼
Correlation
    │
    ▼
Baobab Context Resolution
    │
    ▼
Capability Validation
    │
    ▼
Isolation Enforcement
    │
    ▼
Medusa Handler / Workflow
```

Middleware ordering SHALL be integration tested.

---

# 17. Context Propagation

Outbound platform requests SHALL propagate appropriate context metadata.

Minimum metadata SHOULD include:

```text
context_id
correlation_id
calling_engine_instance
```

Tenant and market information SHOULD be included where required by the receiving contract.

Receivers SHALL NOT be expected to derive platform context from Medusa-specific identifiers.

---

# 18. Isolation Enforcement

The runtime SHALL enforce the Control Plane's resolved `IsolationProfile`.

The Commerce Engine MUST support at least the isolation profiles approved for its initial deployment architecture.

Isolation MAY occur at:

```text
logical data scope
engine instance
database
infrastructure
region
```

The engine SHALL NOT silently downgrade a requested isolation profile.

---

# 19. Shared Engine Instance Model

Where multiple contexts share one Medusa instance:

```text
                    Medusa Instance
                          │
             ┌────────────┼────────────┐
             │            │            │
          Context A    Context B    Context C
```

all tenant/context-sensitive resources SHALL have an enforceable isolation strategy.

Isolation MUST be tested using adversarial cross-context queries.

---

# 20. Dedicated Engine Instance Model

A dedicated Commerce Engine MAY serve a single tenant or bounded group of contexts.

Example:

```text
Context A
    │
    ▼
CapabilityBinding
    │
    ▼
Dedicated Medusa EngineInstance
```

Dedicated deployment SHALL NOT remove the need for canonical Context metadata.

Isolation topology and logical identity are separate concerns.

---

# 21. Commerce Database

Each Medusa EngineInstance SHALL own its PostgreSQL persistence.

The database SHALL be treated as internal engine state.

External systems MUST NOT depend upon its table layout.

---

# 22. Baobab-Owned Tables

Baobab-specific physical persistence inside the Commerce Engine SHALL be limited to commerce-engine-local requirements.

Such tables MAY include:

```text
baobab_outbox
baobab_inbox
baobab_processed_event
baobab_external_mapping_cache
baobab_context_projection
baobab_integration_checkpoint
baobab_reconciliation_record
```

Names are illustrative.

Actual migration specifications SHALL define physical names and columns.

---

# 23. Database Namespace

Baobab extensions SHOULD use explicit naming to distinguish extension-owned persistence from Medusa upstream tables.

Potential strategies include:

```text
baobab_<name>
```

or a dedicated PostgreSQL schema if supported cleanly by the chosen Medusa migration model.

The strategy MUST remain upgrade-safe.

---

# 24. Database Identifier Strategy

Baobab-owned persistent entities SHOULD use UUIDv7 where technically practical and consistent with Control Plane contracts.

Medusa-native identifiers SHALL remain native.

The Commerce Engine SHALL NOT attempt to rewrite Medusa primary keys merely to conform to Control Plane UUID strategy.

---

# 25. Canonical Identity

Canonical identity SHALL remain external to Medusa-native IDs.

Example:

```text
canonical_entity_id
    019...
       │
       ▼
ExternalReference
       │
       ├── engine_instance = commerce-africa-01
       └── external_id = prod_01...
```

The mapping authority remains the Baobab Control Plane.

---

# 26. Local Mapping Cache

The Commerce Engine MAY cache canonical mappings required for efficient operation.

Such a cache:

- SHALL NOT become authoritative;
- MUST be rebuildable;
- MUST contain provenance/version information where necessary;
- MUST tolerate invalidation.

---

# 27. Mapping Resolution

Cross-engine processing SHOULD resolve canonical identity through:

```text
local cache
     │
     ├── hit → use validated mapping
     │
     └── miss
          │
          ▼
     Control Plane resolver
```

Caching strategy SHALL respect mapping lifecycle and temporal validity.

---

# 28. Mapping Creation

The Commerce Engine SHALL NOT create arbitrary cross-engine mappings outside the authorised mapping workflow.

When a new Medusa resource requires canonical identity:

```text
Medusa entity created
      │
      ▼
Canonical registration request/event
      │
      ▼
Control Plane
      │
      ▼
CanonicalEntity + ExternalReference
```

The exact synchronous/asynchronous mechanism SHALL be contract-specific.

---

# 29. Market Projection

The Commerce Engine SHALL maintain enough Medusa-native configuration to execute a Baobab Market.

A Baobab Market MAY map to several Medusa concepts.

Example:

```text
Baobab Market
    │
    ├── region
    ├── currency
    ├── sales channel
    ├── price list
    ├── fulfilment configuration
    └── payment configuration
```

A mapping specification SHALL define this projection explicitly.

---

# 30. Market Provisioning

Market configuration SHALL be provisioned through an idempotent workflow.

Conceptually:

```text
Control Plane Market
       │
       ▼
Commerce Provisioning Command
       │
       ▼
Medusa projection creation/update
       │
       ▼
Mapping registration
       │
       ▼
Capability activation
```

Manual production configuration SHOULD be exceptional.

---

# 31. Currency Rules

Every persisted or transmitted monetary value SHALL have explicit currency context unless it is structurally guaranteed by the enclosing type.

Canonical money representation SHALL use integer minor units or approved decimal representation.

Binary floating-point SHALL NOT be used for monetary values in canonical contracts.

---

# 32. Commercial Seller

Every order requiring legal accounting consequences SHALL resolve a legal seller.

The seller SHALL NOT be inferred merely from the Medusa instance.

A shared instance could serve multiple legal sellers.

Therefore:

```text
EngineInstance
!=
LegalSeller
```

---

# 33. Product Representation

Medusa SHALL maintain the commerce projection of products and variants.

A product record SHOULD be able to resolve:

```text
canonical_product_id
Medusa product id
ERP product/item reference
Payload content reference
market eligibility
sales-channel eligibility
```

Not every reference needs to be stored directly on the product record.

The mapping layer SHALL remain authoritative.

---

# 34. Product Synchronisation

Product interactions across engines SHALL be contract-specific and attribute-aware.

A naïve full-object synchronisation model is prohibited.

Instead:

```text
attribute
   │
   ▼
authoritative system
   │
   ▼
canonical event
   │
   ▼
projection
```

Example:

```text
ERP accounting category
       │
       ▼
iDempiere authoritative
       │
       ▼
projection if Medusa requires it
```

while:

```text
commerce sellability
       │
       ▼
Medusa authoritative
```

---

# 35. Payload Integration

Payload integration SHALL use canonical product identity.

The Commerce Engine SHOULD NOT call Payload synchronously for transactional checkout operations unless an explicit requirement demands it.

Customer-facing composition SHOULD normally occur in the digital estate:

```text
Digital Estate
     │
     ├── Payload content
     └── Medusa commerce data
```

This prevents CMS availability from becoming a commerce transaction dependency.

---

# 36. Digital Estate API Boundary

Digital estates SHALL consume Medusa using published store/B2B APIs.

They SHALL NOT require:

- direct PostgreSQL access;
- internal Medusa service imports;
- repository-level coupling;
- internal module knowledge.

Digital Estate integration MUST remain network-contract based.

---

# 37. B2B Organisation Mapping

A B2B commerce organisation SHALL possess commerce-native identity and, where necessary, canonical identity.

Example:

```text
CanonicalEntity
 type = customer_organisation
          │
          ▼
ExternalReference
 engine = Medusa
 external_id = ...
```

This MUST NOT automatically imply that the organisation is a Baobab tenant.

---

# 38. B2B Buyer Identity

A buyer MAY have relationships to:

```text
platform principal
commerce customer
B2B organisation
role
buying authority
```

These identifiers SHALL remain distinct.

Authorization logic MUST evaluate the relationships rather than equating the records.

---

# 39. B2B Buying Authority

The engine architecture SHOULD support policies such as:

```text
can_view_prices
can_create_cart
can_submit_order
can_approve_order
can_view_invoices
can_manage_buyers
```

Where policy authority resides outside Medusa, Medusa SHALL consume an authorised projection rather than becoming the platform-wide identity authority.

---

# 40. Cart Context

A cart SHALL be bound to sufficient commercial context to prevent ambiguous checkout.

At minimum this SHOULD include:

```text
market
currency
sales channel
```

and where applicable:

```text
tenant/context
legal seller
B2B organisation
price context
customer
```

Changing an incompatible context MAY require cart recreation or explicit re-pricing.

---

# 41. Checkout Invariants

Before order creation, the engine MUST validate:

```text
Context valid
CapabilityBinding active
Market active
Currency valid
Legal seller resolvable
Pricing valid
Customer/buyer authorised
Inventory policy satisfied
Payment method permitted
Fulfilment method permitted
```

Validation rules MAY differ by market.

---

# 42. Order Creation

Order creation SHALL be locally atomic within the Commerce Engine.

Cross-engine side effects SHALL NOT participate in the same database transaction.

The transaction SHOULD conceptually write:

```text
Medusa order state
+
Baobab outbox event
```

before commit.

---

# 43. Transactional Outbox

The Commerce Engine SHALL implement a durable outbox for canonical events.

Minimum conceptual fields:

```text
id
event_id
event_type
event_version
aggregate_type
aggregate_id
canonical_entity_id
context_id
payload
metadata
occurred_at
created_at
published_at
attempt_count
next_attempt_at
last_error
status
```

The physical migration specification SHALL finalise types and constraints.

---

# 44. Outbox Atomicity

An event describing a successful commerce state transition MUST be recorded within the same local transaction as that transition wherever feasible.

The following is unacceptable:

```text
COMMIT order

then

try to insert event
```

The event could be lost between the two operations.

---

# 45. Outbox Publisher

The publisher SHALL:

- select unpublished records;
- claim work safely across replicas;
- publish;
- record outcome;
- retry transient failures;
- stop retrying permanently failing messages according to policy;
- expose failure metrics.

Parallel publishers MUST NOT create uncontrolled duplicate processing.

---

# 46. Delivery Semantics

Baobab SHALL assume:

```text
at-least-once delivery
```

for canonical events unless explicitly upgraded later.

Consumers SHALL therefore be idempotent.

---

# 47. Event Envelope

Every canonical commerce event SHALL use the organisation-standard envelope.

The logical form SHALL be:

```json
{
  "event_id": "...",
  "event_type": "commerce.order.placed",
  "event_version": "1.0",
  "occurred_at": "...",
  "producer": {
    "engine": "commerce.medusa",
    "engine_instance_id": "..."
  },
  "context": {
    "context_id": "...",
    "tenant_id": "...",
    "market_id": "..."
  },
  "subject": {
    "canonical_entity_id": "...",
    "external_id": "..."
  },
  "correlation_id": "...",
  "causation_id": "...",
  "data": {},
  "metadata": {}
}
```

This is illustrative.

The AsyncAPI/JSON Schema artefacts are authoritative.

---

# 48. Event Naming

Canonical events SHALL use:

```text
<domain>.<aggregate>.<past-tense-fact>
```

Examples:

```text
commerce.order.placed
commerce.payment.captured
commerce.fulfilment.shipped
```

Implementation callbacks such as:

```text
medusa.workflow.step.completed
```

SHALL NOT become canonical business events unless specifically standardised as operational events.

---

# 49. Event Versioning

Event evolution SHALL follow compatibility rules.

Backward-compatible addition SHOULD retain the same major version.

Breaking semantic change MUST introduce a new major contract version.

Consumers MUST explicitly declare supported versions.

---

# 50. Inbox / Consumer Deduplication

For inbound canonical events, the Commerce Engine SHOULD maintain a durable inbox/deduplication mechanism.

Conceptual fields:

```text
event_id
event_type
event_version
received_at
processed_at
result
status
error
```

A previously successfully processed `event_id` MUST NOT trigger the same business side effect again.

---

# 51. iDempiere Adapter

The iDempiere adapter SHALL be isolated behind an explicit interface.

Conceptually:

```text
Commerce Domain
      │
      ▼
ERP Port
      │
      ▼
iDempiere Adapter
      │
      ▼
iDempiere API
```

Business workflows SHALL NOT scatter raw iDempiere endpoint calls throughout the codebase.

---

# 52. ERP Port

An internal ERP interface SHOULD expose business intent rather than iDempiere implementation details.

For example:

```text
submitCommerceOrder()
cancelCommerceOrder()
registerReturn()
registerRefund()
resolveInventoryProjection()
```

Exact interfaces SHALL be defined in the package specification.

---

# 53. Order-to-ERP Integration

The preferred path SHALL be asynchronous:

```text
commerce.order.placed
       │
       ▼
Integration consumer
       │
       ▼
canonical mapping
       │
       ▼
iDempiere request
       │
       ▼
ERP acknowledgement/event
```

Where an intermediary integration service is introduced, Medusa SHALL use the same canonical contract.

---

# 54. ERP Failure Handling

If ERP order creation fails after a Commerce order has committed:

- the Commerce order MUST remain durable;
- the event MUST remain recoverable;
- retry MUST occur according to policy;
- final failure MUST become visible operationally;
- reconciliation MUST be possible.

An ERP outage MUST NOT make the Commerce database internally inconsistent.

---

# 55. ERP Reconciliation

The Commerce Engine SHALL support detection of:

```text
order not exported
ERP order missing
ERP order mapping missing
ERP rejection
payment/accounting mismatch
return mismatch
refund mismatch
inventory projection mismatch
```

Each discrepancy class SHOULD have a documented repair procedure.

---

# 56. Inventory Projection Adapter

Commerce availability SHOULD be isolated behind an internal inventory port.

This allows inventory authority to evolve without rewriting commerce workflows.

Possible sources include:

```text
Medusa local inventory
iDempiere
warehouse system
future inventory service
```

---

# 57. Inventory Projection

If iDempiere is authoritative for enterprise stock, Medusa SHOULD hold a commerce projection.

Projection metadata SHOULD include:

```text
source
source_reference
effective_at
synchronised_at
version or sequence
```

where needed for correctness.

---

# 58. Inventory Event Handling

Inbound stock events SHALL be idempotent.

Out-of-order events MUST NOT regress a newer inventory projection when the source contract supplies an ordering/version mechanism.

---

# 59. Payments

Payment providers SHALL be encapsulated through Medusa-supported provider architecture or explicit Baobab adapters.

Provider credentials MUST originate from approved secret management.

Payment state changes SHALL generate appropriate canonical events.

---

# 60. Payment Metadata

Canonical payment events SHALL contain only information needed by downstream consumers.

Cardholder data SHALL NOT be propagated.

Permissible examples include:

```text
payment_reference
provider_reference
amount
currency
status
payment_method_type
occurred_at
```

subject to security classification.

---

# 61. Payment Idempotency

Provider commands with monetary consequences MUST use provider-supported idempotency where available.

Baobab command IDs SHOULD be stable across retry attempts.

---

# 62. Refund Integration

Refund processing SHALL establish explicit responsibility for:

```text
commerce validation
provider refund
commerce status
ERP accounting consequence
customer notification
```

No single component SHALL silently assume successful completion of the entire distributed workflow.

---

# 63. Fulfilment Adapter

Fulfilment integrations SHALL use explicit ports/adapters.

Potential implementations MAY include:

```text
iDempiere
3PL provider
carrier
warehouse management system
local fulfilment provider
```

Provider-specific semantics SHOULD remain behind the adapter.

---

# 64. External References

All significant external provider relationships SHALL be representable as `ExternalReference`s or equivalent engine-local mappings.

Examples:

```text
payment provider transaction
carrier shipment
ERP order
warehouse reference
CMS document
```

Provider identifiers MUST NOT become global canonical IDs.

---

# 65. Control Plane Client

The Control Plane adapter SHALL expose typed operations for at least:

```text
resolveContext
resolveCapabilityBinding
resolveCanonicalEntity
resolveExternalReference
resolveMapping
registerExternalReference
getMarket
getDigitalEstate
getEngineInstance
```

The final interface SHALL follow the Control Plane REST contract.

---

# 66. Control Plane Failure Policy

Commerce operations SHALL classify Control Plane dependency into:

```text
hard dependency
cached dependency
asynchronous dependency
```

for each use case.

For example, cached static market metadata MAY tolerate temporary Control Plane unavailability.

A security-sensitive authorisation lookup MAY not.

This MUST be documented explicitly.

---

# 67. Local Control Plane Cache

Where caching is allowed, cached data MUST contain:

```text
source
version
fetched_at
expires_at or invalidation semantics
```

Stale data handling MUST be explicit.

---

# 68. REST Resource Namespace

Baobab-specific Commerce Engine endpoints SHOULD use a distinct namespace.

For example:

```text
/platform/v1/...
```

or an equivalent organisation-standard route.

Upstream Medusa routes SHALL retain their native route contract unless intentionally wrapped.

---

# 69. Platform API Resources

Initial platform integration resources MAY include:

```text
GET    /platform/v1/health
GET    /platform/v1/readiness
GET    /platform/v1/engine
GET    /platform/v1/capabilities

POST   /platform/v1/context/validate

POST   /platform/v1/mappings/resolve
POST   /platform/v1/reconciliation/orders
POST   /platform/v1/reconciliation/inventory
```

These examples are non-final.

The OpenAPI document SHALL determine exact resources.

---

# 70. API Error Model

Platform-facing APIs SHALL use the Baobab canonical error representation.

Errors SHOULD include:

```text
code
message
correlation_id
details
```

and SHALL NOT expose:

- stack traces;
- SQL;
- secrets;
- internal topology.

---

# 71. Idempotent APIs

Commands susceptible to retry SHOULD support:

```text
Idempotency-Key
```

or an equivalent canonical field.

The key scope and retention period SHALL be documented per endpoint.

---

# 72. Authentication Modes

The engine SHALL support separate trust models for:

```text
storefront client
authenticated customer
administrative user
service-to-service client
Control Plane
ERP integration
CMS integration
```

Credentials SHALL NOT be interchangeable by default.

---

# 73. Service Authentication

Machine-to-machine calls SHALL use approved platform service identity.

Possible implementation mechanisms MAY include:

- signed JWT;
- OAuth2 client credentials;
- workload identity;
- mTLS.

The specific mechanism MAY evolve.

The identity semantics SHALL not.

---

# 74. Authorization

Authorization MUST evaluate:

```text
principal
action
resource
context
```

and, where applicable:

```text
organisation
market
digital estate
B2B role
```

Context isolation MUST be enforced server-side.

---

# 75. Administrative Boundary

Medusa administrative APIs SHALL NOT automatically provide platform-wide administration.

Control Plane operators and Medusa commerce administrators are separate roles unless explicitly granted both.

---

# 76. Correlation

All inbound external requests SHOULD receive or generate a correlation ID.

The same identifier SHOULD propagate through:

```text
Digital Estate
   ↓
Medusa
   ↓
Outbox
   ↓
Event
   ↓
iDempiere
```

This enables end-to-end operational tracing.

---

# 77. Trace Propagation

Where distributed tracing is enabled, standard trace-context propagation SHOULD be used.

Correlation identifiers remain required even where distributed tracing infrastructure is unavailable.

---

# 78. Structured Logging

Production application logs SHALL be structured.

Minimum common fields SHOULD include:

```text
timestamp
level
service
engine_instance_id
environment
correlation_id
trace_id
context_id
event
message
```

Sensitive values MUST be redacted.

---

# 79. Metrics

The engine SHOULD expose metrics covering:

```text
request rate
error rate
latency
database pool
queue/outbox depth
event publication failures
integration failures
ERP latency
Control Plane latency
payment failures
checkout failures
order creation
reconciliation discrepancies
```

Metrics SHALL support alerting against service objectives.

---

# 80. Health Endpoints

At minimum:

```text
/livez
/readyz
```

or organisation-standard equivalents SHALL exist.

`livez` SHALL answer whether the process should be restarted.

`readyz` SHALL answer whether the replica should receive production traffic.

---

# 81. Dependency Readiness

Readiness SHOULD reflect mandatory dependencies.

For example:

```text
PostgreSQL unavailable
→ NOT READY
```

but:

```text
optional asynchronous downstream reporting system unavailable
→ potentially READY
```

Dependency classification SHALL be explicit.

---

# 82. Runtime Configuration

Configuration SHOULD follow precedence such as:

```text
compiled defaults
        ↓
environment configuration
        ↓
external configuration source
        ↓
secret source
```

Secrets SHALL remain logically separate.

---

# 83. Environment Contract

The repository SHALL consume organisation-standard environment naming.

Typical variables MAY include:

```text
BAOBAB_ENVIRONMENT
BAOBAB_ENGINE_ID
BAOBAB_ENGINE_INSTANCE_ID
BAOBAB_REGION

DATABASE_URL

BAOBAB_CP_URL
BAOBAB_CP_CREDENTIAL...

EVENT_PUBLISHER_...
```

Exact variables SHALL be defined in the environment contract.

---

# 84. Configuration Validation

The process SHALL fail fast on invalid mandatory configuration.

Configuration SHOULD be validated through a typed schema at startup.

Unknown critical configuration SHOULD NOT silently fall back to insecure defaults.

---

# 85. Secrets

Secrets MUST NOT appear in:

```text
git history
Dockerfile
container image layers
public CI logs
canonical events
test fixtures committed to source
```

Production secrets SHALL use an approved secrets manager or equivalent secure runtime injection mechanism.

---

# 86. Docker Runtime Contract

The production image SHALL:

- use a minimal appropriate runtime base;
- run as non-root where practical;
- contain only runtime dependencies;
- not embed development credentials;
- support immutable deployment;
- expose defined health endpoints;
- produce deterministic/reproducible builds where practical.

The image SHALL NOT be based on `baobab-dev`.

---

# 87. `baobab-dev` Contract

`ghcr.io/nabhold/baobab-dev` SHALL remain the engineering environment.

The repository SHALL consume an approved `baobab-dev` profile for Codespaces/DevContainers.

The development image MAY contain:

```text
Node.js
pnpm/npm
Git
GitHub CLI
Docker CLI
PostgreSQL tooling
debugging/build tools
```

Production and development image responsibilities MUST remain separated.

---

# 88. Docker Compose Development

Local development SHOULD allow dependent systems to run as distinct services:

```text
commerce
postgres
redis where required
mock/control-plane
mock/erp
mock/payload
```

or real engines where integration testing requires them.

No requirement exists to run every Baobab engine for ordinary unit development.

---

# 89. CI Pipeline

The repository SHALL execute, at minimum:

```text
format/lint
type checking
unit tests
migration validation
contract validation
integration tests
security scan
dependency scan
container build
container scan
SBOM generation where adopted
```

Protected branches SHALL require mandated checks.

---

# 90. SHA Pinning

GitHub Actions SHALL be pinned to full immutable commit SHAs in accordance with Nabhold organisation policy.

Mutable tags such as:

```text
@v4
```

SHALL NOT be permitted where the organisation requires immutable action references.

---

# 91. Dependency Governance

Medusa, Node.js and critical dependencies SHALL be version governed.

Upgrades SHOULD be performed intentionally through pull requests with:

```text
tests
release-note review
migration review
security review
contract compatibility review
```

---

# 92. Database Migrations

All Baobab-owned database changes SHALL be migration-driven.

Manual schema mutation in production is prohibited except during documented incident recovery.

Migration order and rollback/forward strategy SHALL be documented.

---

# 93. Medusa Upstream Migrations

Upstream Medusa migrations and Baobab extension migrations SHALL be tested together.

CI SHOULD validate upgrades from the currently deployed production schema.

---

# 94. Migration Safety

Production migrations SHOULD follow expand/contract patterns where necessary.

A deployment SHALL NOT require instantaneous coordinated replacement of all replicas unless explicitly accepted.

---

# 95. Backup

PostgreSQL backup policy SHALL include:

```text
scheduled backups
retention
encryption
restore testing
off-host/off-instance storage
```

Production restore tests SHALL be documented.

---

# 96. Recovery

Recovery procedures MUST consider both:

```text
database state
event/outbox state
```

A restored database may contain events that were already delivered before the failure.

Consumers and publishers MUST tolerate replay.

---

# 97. Disaster Recovery

The engine SHALL eventually have explicit:

```text
RPO
RTO
regional recovery strategy
```

appropriate to its service tier.

These SHALL be deployment-profile specific rather than hard-coded into application logic.

---

# 98. Test Taxonomy

Tests SHALL be organised into:

```text
unit
module
integration
contract
isolation
resilience
end-to-end
migration
security
performance
```

Not every pull request must run the complete expensive suite, but release gates SHALL execute required production conformance tests.

---

# 99. Unit Tests

Unit tests SHALL validate domain logic without unnecessary remote dependencies.

They SHOULD cover:

```text
context validation
event creation
mapping logic
adapter transformations
money handling
B2B permission rules
retry classification
```

---

# 100. Integration Tests

Integration tests SHALL validate real PostgreSQL behaviour and Medusa runtime integration.

Mocks SHALL NOT be used as proof of database or transaction correctness.

---

# 101. Contract Tests

Contract tests SHALL consume canonical schemas from `nabhold/shared`.

They SHALL prove:

```text
published event schema compatibility
consumed event compatibility
Control Plane API compatibility
ERP integration payload compatibility
canonical error compatibility
```

---

# 102. Isolation Tests

Isolation tests MUST attempt cross-context data access.

The test philosophy SHALL assume the possibility of an implementation defect rather than merely testing intended happy paths.

Examples:

```text
Context A attempts Order B
Tenant A attempts customer B
B2B Organisation A attempts negotiated price B
```

All MUST fail safely.

---

# 103. Event Reliability Tests

Tests SHALL prove:

```text
DB commit + publisher crash
publisher retry
duplicate delivery
consumer crash after side effect
out-of-order message
temporary broker failure
poison event
event replay
```

No event-driven architecture is production-grade until these cases are exercised.

---

# 104. ERP Resilience Tests

The suite SHALL include:

```text
iDempiere unavailable
iDempiere timeout
iDempiere duplicate request
iDempiere rejects order
iDempiere succeeds but response is lost
mapping missing
ERP response delayed
```

Expected recovery behaviour MUST be asserted.

---

# 105. Performance Tests

Performance tests SHOULD establish baselines for:

```text
catalog read
cart mutation
checkout
order placement
B2B price resolution
event publication
mapping resolution
```

Initial performance targets SHALL be based on realistic workload rather than arbitrary hyperscale assumptions.

---

# 106. Security Tests

Security testing SHALL include:

```text
authentication bypass
context spoofing
cross-tenant access
B2B privilege escalation
secret leakage
injection
dependency vulnerabilities
container vulnerabilities
unsafe webhook handling
event signature validation where applicable
```

---

# 107. Observability Tests

Release testing SHOULD confirm:

```text
correlation IDs propagate
logs are structured
health endpoints behave correctly
failed integrations emit metrics
sensitive values are redacted
```

---

# 108. API Compatibility

Published APIs consumed outside `nabhold/baobab-trade` SHALL be treated as contracts.

Breaking changes require:

```text
new version
migration strategy
consumer impact assessment
```

---

# 109. Event Compatibility

Published canonical events SHALL be treated more strictly than internal application events.

Internal Medusa subscribers MUST NOT accidentally become platform contracts merely because another repository begins consuming them.

---

# 110. Internal vs Canonical Events

The engine SHALL explicitly distinguish:

```text
Medusa internal event
```

from:

```text
Baobab canonical event
```

Transformation SHALL occur at a deliberate boundary.

---

# 111. Reconciliation Persistence

Persistent reconciliation records SHOULD capture:

```text
reconciliation_id
entity_type
canonical_entity_id
local_reference
remote_reference
status
detected_at
resolved_at
resolution
attempt_count
last_error
```

Physical design SHALL be specified separately.

---

# 112. Dead-Letter Handling

Permanently failing events SHALL enter a controlled failure state.

The platform SHALL NOT silently discard them.

Operations MUST be able to:

```text
inspect
diagnose
repair
replay
```

dead-lettered or exhausted messages.

---

# 113. Operational Runbooks

The repository SHALL contain runbooks for at least:

```text
database unavailable
Control Plane unavailable
ERP unavailable
event publication backlog
payment-provider outage
failed migration
inventory drift
mapping failure
restore from backup
event replay
secret rotation
```

---

# 114. Deployment Promotion

Deployments SHOULD promote immutable artefacts:

```text
build once
   ↓
test
   ↓
staging
   ↓
production
```

Production SHOULD NOT rebuild source independently from the artefact tested in staging.

---

# 115. Container Tagging

Images SHOULD be addressable through immutable identifiers.

Example:

```text
ghcr.io/nabhold/baobab-trade:<git-sha>
```

Human-readable release tags MAY additionally be applied.

---

# 116. Supply Chain Security

Production builds SHOULD support:

```text
SBOM
provenance
dependency scanning
container scanning
immutable action pinning
least-privilege CI credentials
```

according to organisation standards.

---

# 117. Release Versioning

The Commerce Engine SHALL maintain an application release version independent of Medusa upstream version.

Conceptually:

```text
Baobab Commerce Engine 1.4.0
Medusa X.Y.Z
Node.js X
Contract version Y
```

This makes compatibility explicit.

---

# 118. Upstream Upgrade Procedure

Every major Medusa upgrade SHALL include:

```text
1. Release-note analysis
2. Breaking-change assessment
3. Migration assessment
4. Extension compatibility test
5. Contract test
6. Integration test
7. Performance regression check
8. Staging deployment
9. Rollback/roll-forward plan
10. Production approval
```

---

# 119. Architectural Drift Control

CI SHOULD eventually enforce architectural rules automatically.

Examples:

```text
no imports from forbidden upstream internals
no database client usage in adapters where not allowed
canonical schema validation
dependency boundary tests
no direct iDempiere SQL drivers
no direct Payload database drivers
```

---

# 120. Forbidden Dependencies

`nabhold/baobab-trade` MUST NOT depend on:

- iDempiere database schema;
- Payload database schema;
- Control Plane PostgreSQL schema;
- another digital estate's source code;
- tenant-specific repositories for core engine behaviour.

Integration SHALL be through contracts.

---

# 121. Tenant-Specific Customisation

Tenant-specific commerce requirements SHOULD be expressed using:

```text
configuration
market configuration
capability binding
plugin/module configuration
feature policy
```

before introducing tenant-specific code.

Hard-coded conditions such as:

```text
if tenant == "thamani"
```

inside shared commerce-domain code SHOULD be prohibited.

---

# 122. Digital-Estate-Specific Customisation

Likewise:

```text
if digitalEstate == "zuribeans"
```

SHOULD NOT govern core commerce behaviour.

Digital-estate-specific experience belongs primarily in that estate.

Where commercial behaviour genuinely differs, it SHALL be modelled explicitly as business configuration or capability policy.

---

# 123. Regional Customisation

Country or market behaviour SHALL be data/configuration-driven wherever practical.

Examples:

```text
currency
tax
payment provider
fulfilment
price list
legal seller
consumer terms
```

Regional expansion SHOULD NOT require forking the Commerce Engine.

---

# 124. Feature Flags

Feature flags MAY be used for controlled rollout.

They SHALL NOT become a permanent substitute for:

- capability binding;
- configuration;
- market modelling;
- architecture.

Flag ownership and removal criteria SHOULD be recorded.

---

# 125. Data Classification

Commerce data SHALL be classified at minimum into:

```text
public
internal
confidential
restricted
```

or the canonical Baobab classification taxonomy.

Controls SHALL reflect classification.

---

# 126. Customer Data

Customer data SHALL be minimised.

Cross-engine events SHOULD prefer:

```text
customer canonical ID
```

over copying full customer profiles unless the consumer requires the attributes.

---

# 127. Data Retention

Retention SHALL be defined by data class and jurisdiction.

Deletion/anonymisation workflows MUST consider distributed representations.

Deleting a Medusa customer MUST NOT imply that financial records in iDempiere may legally be deleted.

---

# 128. Privacy Requests

Where data-subject requests apply, canonical identity SHALL assist discovery of distributed representations.

The architecture SHOULD support:

```text
canonical customer
      │
      ├── Medusa representation
      ├── Payload representation if any
      └── ERP representation
```

without using shared databases.

---

# 129. Audit Trail

Business-critical operations SHOULD create audit evidence sufficient to determine:

```text
who
did what
to which entity
under which Context
at what time
with what result
```

Audit evidence SHALL not expose secrets.

---

# 130. Commerce Domain Events vs Audit Events

These are distinct.

For example:

```text
commerce.order.cancelled
```

is a business event.

```text
audit.resource.modified
```

may record administrative action.

One SHALL NOT automatically replace the other.

---

# 131. Initial Capability Set

The initial production engine SHOULD target:

```text
commerce.catalog
commerce.pricing
commerce.customer
commerce.cart
commerce.checkout
commerce.order
commerce.payment
commerce.fulfilment
commerce.return
commerce.refund
```

B2B capability MAY be enabled incrementally but SHALL conform to this contract when introduced.

---

# 132. Initial Canonical Entity Set

The first mapping implementation SHOULD support:

```text
Product
ProductVariant
Customer
CustomerOrganisation
Order
Payment
Fulfilment
```

Additional entities MAY follow as integration requirements mature.

---

# 133. Initial Control Plane Dependencies

The first vertical slice SHOULD consume:

```text
Engine
EngineInstance
Capability
CapabilityBinding
Context
Market
CanonicalEntity
ExternalReference
Mapping
```

This will prove the central architecture before deeper commerce customisation.

---

# 134. Initial ERP Vertical Slice

The minimum production-quality ERP proof SHALL demonstrate:

```text
Medusa order
      │
      ▼
commerce.order.placed
      │
      ▼
mapping resolution
      │
      ▼
iDempiere order creation
      │
      ▼
canonical reference
      │
      ▼
acknowledgement/reconciliation
```

Duplicate event delivery MUST not create duplicate iDempiere orders.

---

# 135. Initial Payload Vertical Slice

The minimum Content Engine proof SHALL demonstrate:

```text
Canonical Product
   ├── Medusa commerce representation
   └── Payload editorial representation
            │
            ▼
       Digital Estate
```

No database-level integration SHALL be used.

---

# 136. Initial Digital Estate Proof

One independent digital estate SHALL demonstrate:

```text
browse
product detail
price
cart
checkout
order confirmation
```

through published Medusa interfaces.

The estate SHALL remain independently deployable.

---

# 137. Initial Failure Proof

Before production, the platform SHALL intentionally test:

```text
Control Plane down
iDempiere down
event publisher down
PostgreSQL restart
duplicate order event
payment timeout
```

and document expected behaviour.

---

# 138. Production Definition of Done

The Commerce Engine is production-ready only when:

```text
architecture conforms
contracts exist
CI enforces contracts
migrations are reproducible
container is reproducible
context isolation is proven
canonical mapping works
outbox is durable
events are idempotent
ERP integration reconciles
Payload boundary is proven
Digital Estate integration works
secrets are governed
observability exists
backup restore is tested
runbooks exist
```

---

# 139. Derived Artefacts

This implementation contract SHALL be decomposed into the following implementation specifications.

## 139.1 Medusa Repository and Package Specification

Defines:

- directory structure;
- package/module ownership;
- TypeScript interfaces;
- dependency rules;
- adapters;
- workflows;
- middleware;
- extension strategy.

## 139.2 PostgreSQL Migration Specification

Defines:

- Baobab-owned tables;
- columns;
- UUID strategy;
- constraints;
- indexes;
- outbox;
- inbox;
- checkpoints;
- reconciliation state.

## 139.3 OpenAPI Contract

Defines:

- Control Plane-facing resources;
- operational APIs;
- reconciliation endpoints;
- authenticated service APIs.

## 139.4 AsyncAPI Contract

Defines:

- canonical commerce events;
- event envelopes;
- channels/topics;
- schema versions;
- producer/consumer obligations.

## 139.5 Control Plane Integration Specification

Defines concrete mapping of:

```text
Engine
EngineInstance
Capability
CapabilityBinding
Context
Market
DigitalEstate
CanonicalEntity
ExternalReference
Mapping
IsolationProfile
```

into the Commerce Engine runtime.

## 139.6 iDempiere Integration Specification

Defines:

- order projection;
- customer mapping;
- product mapping;
- inventory;
- payments;
- refunds;
- fulfilment;
- reconciliation.

## 139.7 Payload Integration Specification

Defines the commerce/content identity boundary.

## 139.8 Conformance Test Specification

Defines executable architecture tests.

---

# 140. Implementation Order

The implementation SHOULD proceed in this sequence:

```text
Foundation
   │
   ▼
Repository/package boundaries
   │
   ▼
Control Plane client
   │
   ▼
Context middleware
   │
   ▼
EngineInstance + CapabilityBinding
   │
   ▼
Canonical mapping
   │
   ▼
Outbox / canonical events
   │
   ▼
Digital Estate vertical slice
   │
   ▼
iDempiere vertical slice
   │
   ▼
Payload composition
   │
   ▼
B2B extensions
   │
   ▼
Production hardening
```

Infrastructure complexity SHALL be introduced only when justified by workload, isolation or regulatory requirements.

---

# 141. Final Implementation Rule

The implementation MUST preserve the following architecture:

```text
                 BAOBAB CONTROL PLANE
                         │
                  Platform Context
                         │
                         ▼
               Capability Binding
                         │
                         ▼
                 MEDUSA COMMERCE
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
     Payload CMS     iDempiere ERP    Digital Estate
       Content         Enterprise       Experience
                         │
                         ▼
                  Canonical Events
```

The Commerce Engine SHALL remain a specialised engine.

The Control Plane SHALL remain the authority for platform context and capability binding.

iDempiere SHALL remain the ERP authority.

Payload SHALL remain the editorial-content authority.

Digital estates SHALL remain presentation and experience owners.

Canonical mapping SHALL relate representations without collapsing their ownership boundaries.

Events and APIs SHALL connect engines without shared databases.

The implementation shall therefore be judged by one overriding principle:

> **A production-quality Baobab Commerce Engine is not merely a working Medusa installation. It is a Medusa installation that can participate safely, independently, observably and contractually within the Baobab multi-engine architecture without acquiring responsibilities that belong to another bounded context.**

This contract is authoritative for that implementation boundary.
