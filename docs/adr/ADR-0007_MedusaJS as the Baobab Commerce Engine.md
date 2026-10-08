# ADR-0007 — MedusaJS as the Baobab Commerce Engine

**Status:** Accepted  
**Decision Type:** Platform Architecture / Commerce  
**Scope:** Baobab Platform — Commerce Engine  
**Engine:** MedusaJS  
**Repository:** `nabhold/baobab-trade`  
**Owners:** Baobab Platform Architecture / Commerce Engineering  
**Related Systems:** Baobab Control Plane, iDempiere ERP Engine, Payload CMS Content Engine, Digital Estates, Baobab Shared Contracts  
**Supersedes:** Any architecture that embeds commerce business logic directly within a digital estate, ERP engine, CMS, or Baobab Control Plane  
**Review Trigger:** Major MedusaJS version change; material change to Baobab tenancy model; replacement of the commerce engine; material change to canonical mapping or capability-binding contracts

---

## 1. Decision Summary

Baobab SHALL adopt **MedusaJS as its headless Commerce Engine** for B2B and B2C transactional commerce.

MedusaJS SHALL operate as an independently deployable, independently persistent, contract-governed Baobab engine.

It SHALL own commerce-domain state and behaviour allocated to it through Baobab capability bindings, including, where applicable:

- products and variants as commerce representations;
- sales channels;
- markets and regions;
- commerce pricing;
- price lists;
- promotions;
- carts;
- checkout;
- orders;
- commerce customer accounts;
- B2B commerce organisations and buying relationships;
- payment orchestration;
- fulfilment orchestration;
- returns;
- exchanges;
- refunds;
- commerce-facing inventory availability;
- commerce tax configuration;
- commerce transaction lifecycle state.

MedusaJS SHALL NOT become:

- the Baobab Control Plane;
- the authoritative organisational registry;
- the canonical tenant registry;
- the canonical legal-entity registry;
- the enterprise accounting system;
- the general ERP;
- the enterprise content-management system;
- the digital-estate presentation layer;
- the enterprise identity provider;
- the cross-engine integration database;
- the platform event broker;
- the canonical mapping authority.

The fundamental architectural rule is:

> **Medusa owns commerce execution; Baobab owns the platform context within which that commerce execution occurs.**

Baobab SHALL standardise the contracts around MedusaJS rather than attempting to make MedusaJS internally conform to the implementation architecture of other engines.

---

# 2. Context

Baobab is a polyrepo, polyglot, multi-engine enterprise platform intended to support independently evolving organisations, markets, regions, currencies, products, digital estates and business models.

Commerce is one capability of that platform.

It is not the platform itself.

The Baobab architecture deliberately separates specialised engines behind common platform contracts. This follows the previously established architectural principle that specialised systems should retain their native strengths while integration, identity, tenancy and governance are standardised at platform boundaries.

The current relevant architecture consists conceptually of:

```text
                           BAOBAB PLATFORM

                     ┌────────────────────┐
                     │   Control Plane    │
                     │       Go           │
                     └─────────┬──────────┘
                               │
              Context / Capability / Mapping
                               │
       ┌───────────────────────┼──────────────────────┐
       │                       │                      │
       ▼                       ▼                      ▼
┌─────────────┐         ┌─────────────┐       ┌─────────────┐
│ Commerce    │         │ ERP Engine  │       │Content      │
│ Engine      │         │             │       │Engine       │
│ MedusaJS    │         │ iDempiere   │       │Payload CMS  │
└──────┬──────┘         └──────┬──────┘       └──────┬──────┘
       │                       │                      │
       └───────────────┬───────┴──────────────┬───────┘
                       │                      │
                Canonical Events       Canonical Mapping
                       │                      │
                       └──────────┬───────────┘
                                  │
                           Digital Estates
```

Examples of digital estates include independently deployed websites, applications, portals and customer experiences belonging to Nabhold Group or its operating entities.

A digital estate MAY consume MedusaJS commerce capabilities.

A digital estate MUST NOT thereby become the owner of commerce-domain transactional truth.

---

# 3. Architectural Forces

The decision is driven by several forces.

## 3.1 Independent organisational evolution

Nabhold entities are independent organisations capable of expanding into additional jurisdictions, brands, markets and business models.

The architecture therefore cannot assume:

```text
one tenant
=
one legal entity
=
one market
=
one country
=
one currency
=
one digital estate
=
one Medusa instance
```

These concepts MUST remain independently modelled.

---

## 3.2 B2B and B2C coexistence

Baobab requires commerce capable of supporting both:

```text
B2C
Consumer
 → Cart
 → Checkout
 → Payment
 → Fulfilment
```

and:

```text
B2B
Organisation
 → Buyer
 → Contract/Price Context
 → Purchase
 → Approval where applicable
 → Order
 → ERP
 → Fulfilment
 → Invoice/Settlement
```

These models share commerce infrastructure but have materially different commercial semantics.

The platform MUST support both without making one an awkward special case of the other.

---

## 3.3 Multi-market operation

A consuming organisation may operate in:

- South Africa;
- Uganda;
- Kenya;
- the wider African market;
- Europe;
- Asia;
- other jurisdictions.

Commerce therefore requires explicit modelling of:

- currency;
- country;
- region;
- market;
- tax context;
- sales channel;
- pricing context;
- fulfilment context;
- payment context;
- legal seller;
- digital estate.

---

## 3.4 Engine independence

MedusaJS, iDempiere and Payload CMS have distinct bounded contexts.

Their databases SHALL NOT become an informal integration mechanism.

Replacing one engine MUST NOT require wholesale redesign of the others.

---

# 4. Architectural Principles

The MedusaJS implementation SHALL conform to the following principles.

### P1 — Headless by design

MedusaJS SHALL expose commerce capability through versioned machine interfaces.

Digital presentation SHALL remain outside the engine.

### P2 — Engine autonomy

MedusaJS SHALL retain ownership of its internal architecture, persistence and domain behaviour.

### P3 — Contract standardisation

Baobab SHALL standardise interfaces, identities, mappings, events, security metadata and operational requirements rather than internal engine implementation.

### P4 — No shared databases

No Baobab component SHALL directly read or write Medusa's private database tables except Medusa itself and explicitly authorised Medusa-owned migration/administration tooling.

### P5 — Canonical identity without canonical persistence

Baobab canonical identity SHALL NOT require all engines to persist the same data structure.

### P6 — Explicit context

Commerce operations SHALL execute within an explicitly resolved Baobab Context.

### P7 — Asynchronous integration by default

Cross-engine propagation SHOULD use durable asynchronous events where synchronous completion is unnecessary.

### P8 — Synchronous calls only where necessary

Synchronous APIs SHALL be reserved for interactions requiring an immediate response.

### P9 — Idempotency

All externally retryable commands and event consumers SHALL be idempotent.

### P10 — Replaceability

MedusaJS-specific concepts SHALL NOT unnecessarily leak into Baobab-wide canonical contracts.

---

# 5. Commerce Bounded Context

The Commerce Engine owns the lifecycle of a commercial transaction from commerce intent through commerce completion.

Conceptually:

```text
Discovery
   │
   ▼
Commerce Product
   │
   ▼
Price / Offer
   │
   ▼
Cart
   │
   ▼
Checkout
   │
   ▼
Payment orchestration
   │
   ▼
Order
   │
   ▼
Fulfilment orchestration
   │
   ▼
Return / Exchange / Refund
```

Medusa SHALL be authoritative for the operational state of this lifecycle until responsibility explicitly crosses an engine boundary.

---

# 6. Capability Ownership

The following allocation SHALL apply unless superseded by a more specific capability ADR.

| Capability                      | Primary Authority                    |
| ------------------------------- | ------------------------------------ |
| Platform tenant/context         | Baobab Control Plane                 |
| Legal entity identity           | Baobab canonical/control-plane model |
| Engine registration             | Baobab Control Plane                 |
| Capability binding              | Baobab Control Plane                 |
| Commerce product representation | Medusa                               |
| Editorial product content       | Payload CMS                          |
| Commerce price                  | Medusa                               |
| Cart                            | Medusa                               |
| Checkout                        | Medusa                               |
| Commerce order                  | Medusa                               |
| Payment orchestration           | Medusa                               |
| Commerce promotion              | Medusa                               |
| Commerce sales channel          | Medusa                               |
| Accounting transaction          | iDempiere                            |
| General ledger                  | iDempiere                            |
| Accounts receivable             | iDempiere                            |
| Accounts payable                | iDempiere                            |
| ERP inventory/accounting truth  | iDempiere                            |
| Editorial content               | Payload CMS                          |
| Website presentation            | Digital Estate                       |
| Canonical cross-engine mappings | Baobab Control Plane                 |
| Engine-instance registration    | Baobab Control Plane                 |

Ownership does not prohibit replication.

It determines which system wins when replicated state disagrees.

---

# 7. Control Plane Boundary

The Go-based Baobab Control Plane SHALL govern the relationship between Medusa and the wider platform.

The Control Plane SHALL own or resolve:

```text
Engine
EngineInstance
Capability
CapabilityBinding
Context
IsolationProfile
Market
DigitalEstate
CanonicalEntity
ExternalReference
Mapping
MappingScope
```

Medusa SHALL NOT independently redefine these Baobab concepts.

Where Medusa requires a native representation, that representation SHALL be connected through an explicit mapping.

---

# 8. Context Resolution

A commerce request MUST execute against an unambiguous context.

Conceptually:

```text
Request
   │
   ▼
Identity
   │
   ▼
Digital Estate
   │
   ▼
Baobab Context
   │
   ├── tenant boundary
   ├── organisation
   ├── legal seller
   ├── market
   ├── region
   ├── currency
   ├── sales channel
   ├── engine instance
   └── capability binding
   │
   ▼
Medusa Commerce Operation
```

Medusa MUST NOT infer a platform tenant solely from:

- hostname;
- currency;
- country;
- sales channel;
- Medusa region;
- user-supplied identifiers.

Context SHALL originate from trusted platform resolution or an equivalent cryptographically trustworthy mechanism.

---

# 9. Tenant Is Not Market

Baobab explicitly rejects:

```text
Tenant = Market
```

A tenant MAY participate in many markets.

A market MAY have multiple participating organisations where permitted by the platform model.

Similarly:

```text
LegalEntity != Tenant
Market      != Tenant
Region      != Tenant
Currency    != Tenant
Brand       != Tenant
DigitalEstate != Tenant
```

A legal entity remains the **default tenant boundary**, but tenancy and organisational structure are separate architectural concerns.

---

# 10. Market Model

A Baobab `Market` represents a platform-level commercial operating context.

A Medusa native market/region/sales-channel representation MAY participate in implementing that context but SHALL NOT automatically become the canonical Baobab Market.

Example:

```text
Baobab Market
ZA-B2C-RETAIL
      │
      ├── Currency: ZAR
      ├── Countries: ZA
      ├── Legal Seller: Entity A
      ├── Digital Estate: Thamani ZA
      ├── Medusa Region: ...
      ├── Sales Channel: ...
      ├── Payment Configuration: ...
      └── Fulfilment Configuration: ...
```

Mappings SHALL make these relationships explicit.

---

# 11. Currency Architecture

Currency SHALL be an explicit commercial dimension.

The architecture MUST support:

- different currencies by market;
- different price lists by commercial context;
- B2B negotiated pricing;
- B2C retail pricing;
- currency-specific rounding;
- currency-specific payment providers;
- FX-derived prices where permitted;
- manually governed prices;
- ERP reconciliation.

An amount crossing an engine boundary MUST contain at minimum:

```text
amount
currency
```

Where relevant it SHOULD additionally include:

```text
price_basis
tax_basis
exchange_rate
exchange_rate_source
exchange_rate_timestamp
```

Money MUST NOT be represented by binary floating-point values in canonical contracts.

---

# 12. Product Architecture

A product is not a single cross-platform database record.

It is a business concept with engine-specific representations.

Example:

```text
              CanonicalEntity
                  PRODUCT
                     │
          ┌──────────┼───────────┐
          │          │           │
          ▼          ▼           ▼
       Medusa     iDempiere    Payload
       Product      Product/     Content
                    Item
```

Each representation SHALL possess its own native identifier.

The canonical mapping layer SHALL relate them.

No engine SHALL be required to use another engine's primary key as its own.

---

# 13. Canonical Entity Mapping

Every cross-engine business object requiring stable identity SHALL be eligible for canonical mapping.

Example:

```text
CanonicalEntity
id = 019...
type = product
        │
        ├── ExternalReference
        │     engine = medusa
        │     external_id = prod_...
        │
        ├── ExternalReference
        │     engine = idempiere
        │     external_id = ...
        │
        └── ExternalReference
              engine = payload
              external_id = ...
```

Mappings SHALL be context-aware where identity relationships vary by market, tenant or engine instance.

---

# 14. Product Authority

Medusa SHALL own commerce-specific product behaviour.

Payload CMS SHALL own editorial product content.

iDempiere SHALL own ERP representations necessary for enterprise operations.

This deliberately avoids declaring an overloaded universal "product master" without distinguishing authority by attribute.

For example:

| Attribute                       | Authority |
| ------------------------------- | --------- |
| Commerce variant                | Medusa    |
| Commerce price                  | Medusa    |
| Cart eligibility                | Medusa    |
| Marketing story                 | Payload   |
| SEO editorial content           | Payload   |
| Long-form merchandising content | Payload   |
| Accounting classification       | iDempiere |
| Financial posting configuration | iDempiere |
| ERP inventory valuation         | iDempiere |

Attribute-level ownership SHALL be documented when representations overlap.

---

# 15. Payload CMS Integration

Payload SHALL NOT directly manipulate Medusa persistence.

Likewise Medusa SHALL NOT become an editorial CMS merely because products require descriptions.

The integration model SHALL resemble:

```text
Payload
   │
   │ canonical product reference
   ▼
CanonicalEntity
   ▲
   │
Medusa
```

A digital estate MAY compose:

```text
Payload editorial content
        +
Medusa transactional commerce data
        =
Customer Experience
```

This is intentional.

The digital estate is the composition layer.

---

# 16. Digital Estate Boundary

A digital estate owns:

- presentation;
- navigation;
- branding;
- content composition;
- accessibility;
- frontend state;
- customer journey;
- frontend analytics;
- experience-specific behaviour.

It SHALL NOT duplicate Medusa commerce logic.

For example:

```text
Digital Estate
      │
      ├──── Payload ─── content
      │
      ├──── Medusa ──── commerce
      │
      └──── Control Plane / Identity
```

The digital estate MUST use published APIs/contracts.

Direct database connectivity is prohibited.

---

# 17. iDempiere Integration

Medusa and iDempiere SHALL remain independently deployable.

Neither SHALL directly access the other's database.

The conceptual lifecycle is:

```text
Customer
   │
   ▼
Medusa
   │
   │ commerce order
   ▼
Canonical Event
   │
   ▼
Integration
   │
   ▼
iDempiere
   │
   ├── enterprise order representation
   ├── accounting
   ├── receivable
   ├── inventory/accounting consequences
   └── enterprise fulfilment processes
```

The exact ERP document created from a commerce transaction SHALL be governed by integration contracts rather than hard-coded assumptions in the canonical event schema.

---

# 18. Order Authority

The Medusa order and iDempiere ERP order/document SHALL be distinct records.

They SHALL be mapped, not conflated.

```text
CanonicalEntity: ORDER
        │
        ├── Medusa Order
        │
        └── iDempiere Document
```

Medusa remains authoritative for customer-facing commerce state.

iDempiere remains authoritative for ERP/accounting state.

The platform SHALL tolerate temporary divergence caused by asynchronous processing.

---

# 19. Order-to-ERP Flow

The preferred pattern SHALL be:

```text
Medusa transaction
       │
       ▼
Transactional Outbox
       │
       ▼
commerce.order.placed
       │
       ▼
Integration Consumer
       │
       ▼
Canonical Mapping Resolution
       │
       ▼
iDempiere Command/API
       │
       ▼
ERP Transaction
       │
       ▼
erp.order.accepted
       │
       ▼
Mapping / Status Projection
```

A successful commerce checkout MUST NOT depend on an uncontrolled distributed database transaction spanning Medusa and iDempiere.

---

# 20. Event Architecture

Medusa SHALL publish canonical integration events for material commerce lifecycle transitions.

Events SHALL follow the organisation-wide event envelope.

The envelope SHOULD contain:

```text
event_id
event_type
event_version
occurred_at

producer
engine
engine_instance

tenant_id
context_id
market_id

subject
canonical_entity_id
external_reference

correlation_id
causation_id
trace_id

data
metadata
```

Fields SHALL be omitted only where semantically inapplicable under the canonical event specification.

---

# 21. Canonical Commerce Events

The initial event vocabulary SHOULD include, subject to formal AsyncAPI definition:

```text
commerce.product.created
commerce.product.updated
commerce.product.published
commerce.product.unpublished

commerce.customer.created
commerce.customer.updated

commerce.cart.created
commerce.cart.updated
commerce.cart.abandoned
commerce.cart.completed

commerce.order.placed
commerce.order.confirmed
commerce.order.cancelled
commerce.order.completed

commerce.payment.authorized
commerce.payment.captured
commerce.payment.failed
commerce.payment.refunded

commerce.fulfilment.requested
commerce.fulfilment.created
commerce.fulfilment.shipped
commerce.fulfilment.delivered
commerce.fulfilment.failed

commerce.return.requested
commerce.return.authorized
commerce.return.received
commerce.return.completed

commerce.refund.requested
commerce.refund.completed
commerce.refund.failed
```

The event taxonomy SHALL describe business facts rather than implementation callbacks.

---

# 22. Transactional Outbox

Material events resulting from Medusa transactions MUST use a durable transactional-outbox or equivalently reliable pattern.

The prohibited pattern is:

```text
write database
     │
     ▼
commit
     │
     ▼
hope webhook succeeds
```

The required semantic is:

```text
transaction
   │
   ├── domain mutation
   └── durable event/outbox record
             │
             ▼
          commit
             │
             ▼
      asynchronous publisher
```

Publication SHALL be retryable.

Consumers SHALL assume at-least-once delivery unless a stronger platform guarantee is explicitly established.

---

# 23. Idempotency

All integration consumers MUST tolerate duplicate delivery.

Commands that can be safely retried MUST accept an idempotency identifier.

For example:

```text
event_id
      │
      ▼
ERP consumer
      │
      ├── unseen → process
      └── seen   → return previous result
```

Duplicate events MUST NOT create duplicate:

- ERP orders;
- payments;
- refunds;
- fulfilments;
- inventory adjustments;
- canonical mappings.

---

# 24. Event Ordering

Global ordering SHALL NOT be assumed.

Where ordering matters, ordering SHALL be scoped to an aggregate or equivalent business subject.

Consumers MUST be resilient to:

- duplicates;
- delayed events;
- temporarily missing events;
- out-of-order events;
- replay.

Event schemas SHOULD include sufficient version/state information for safe reconciliation.

---

# 25. B2C Model

B2C commerce MAY include:

```text
anonymous browsing
anonymous cart
customer account
retail pricing
promotion
checkout
consumer payment
delivery/pickup
returns
refunds
```

Anonymous commerce SHALL NOT require premature creation of a Baobab tenant user.

Identity linkage MAY occur when authentication or business requirements demand it.

---

# 26. B2B Model

B2B commerce introduces additional concepts.

```text
Organisation
     │
     ├── Buyer
     ├── Buyer Role
     ├── Commercial Terms
     ├── Price Context
     ├── Credit Context
     ├── Delivery Context
     └── Purchase Authority
```

A B2B organisation SHALL NOT automatically be equated with a Baobab tenant.

B2B customer organisations are commerce-domain participants.

They MAY themselves also be Baobab tenants in other contexts, but that relationship MUST be explicit.

---

# 27. B2B Pricing

The architecture SHALL support:

- customer-specific pricing;
- organisation-specific pricing;
- contract pricing;
- quantity tiers;
- market pricing;
- price lists;
- negotiated discounts;
- effective dates;
- currency-specific terms.

Where contractual pricing originates outside Medusa, Medusa MAY maintain an operational projection.

The authoritative source MUST be documented by capability/attribute contract.

---

# 28. Payment Architecture

Medusa SHALL orchestrate commerce payment workflows through provider abstractions.

Sensitive payment credentials SHALL NOT be embedded in:

- repositories;
- container images;
- canonical events;
- frontend bundles;
- logs.

Canonical events SHOULD carry payment references and status rather than sensitive payment instrument data.

PCI scope SHALL be minimised through provider-hosted/tokenised payment mechanisms wherever practical.

---

# 29. Refunds

A refund is a distributed business process.

It SHALL NOT be modelled as a single database mutation spanning Commerce and ERP.

Conceptually:

```text
Refund requested
       │
       ▼
Commerce validation
       │
       ▼
Payment provider
       │
       ▼
Refund result
       │
       ▼
Canonical event
       │
       ▼
ERP financial consequence
```

Failures SHALL be recoverable and reconcilable.

---

# 30. Inventory

Inventory requires explicit authority boundaries.

Medusa MAY maintain commerce-available inventory.

iDempiere MAY remain authoritative for enterprise stock and valuation.

These are not necessarily identical quantities.

For example:

```text
ERP physical stock
       │
       ├── reserved
       ├── safety stock
       ├── unavailable stock
       └── channel allocation
              │
              ▼
       commerce availability
```

Inventory synchronisation MUST therefore be treated as a business projection rather than naïve row replication.

---

# 31. Overselling

Where exact synchronous stock locking across systems is impractical, the platform SHALL explicitly define its overselling policy.

Possible policies include:

- strict reservation;
- safety stock;
- controlled oversell;
- eventual confirmation;
- market-specific reservation.

The chosen policy SHALL be a commerce configuration/capability decision, not an accidental consequence of integration latency.

---

# 32. Fulfilment

Medusa SHALL orchestrate customer-facing fulfilment state.

Physical fulfilment MAY be executed by:

- iDempiere processes;
- warehouse systems;
- third-party logistics providers;
- carriers;
- external fulfilment services.

Provider-specific identifiers SHALL remain external references rather than becoming canonical identifiers.

---

# 33. Tax

Tax calculation SHALL be explicitly contextual.

Relevant dimensions include:

```text
legal seller
customer
jurisdiction
product classification
market
delivery destination
transaction type
currency
tax registration
```

Tax rules SHALL NOT be hard-coded into digital estates.

Where an external tax engine is introduced, it SHALL integrate through a defined capability contract.

---

# 34. Isolation Profiles

Baobab SHALL NOT require a single physical isolation model for every tenant or market.

An `IsolationProfile` SHALL determine required isolation.

Potential profiles may include:

```text
SHARED
LOGICALLY_ISOLATED
DEDICATED_SCHEMA
DEDICATED_DATABASE
DEDICATED_ENGINE_INSTANCE
DEDICATED_INFRASTRUCTURE
```

The precise supported enumeration SHALL be owned by the Control Plane specification.

Medusa deployment topology SHALL conform to the resolved profile.

---

# 35. Engine Instances

Baobab SHALL distinguish:

```text
Engine
```

from:

```text
EngineInstance
```

Example:

```text
Engine
  medusa-commerce
        │
        ├── EngineInstance
        │      shared-africa-01
        │
        ├── EngineInstance
        │      dedicated-enterprise-x
        │
        └── EngineInstance
               eu-commerce-01
```

This allows isolation and geography to evolve without changing canonical commerce identity.

---

# 36. Capability Binding

The Control Plane SHALL determine which Medusa instance supplies a commerce capability for a particular Context.

Conceptually:

```text
Context
   │
   ▼
CapabilityBinding
   │
   ├── capability = commerce.checkout
   ├── engine = medusa
   └── engine_instance = ...
```

Consumers MUST NOT hard-code infrastructure endpoints where capability resolution is required.

---

# 37. Data Residency

The architecture MUST permit commerce workloads to be geographically separated when required by:

- regulation;
- contractual obligation;
- data-residency policy;
- performance;
- risk;
- customer isolation requirements.

Canonical identity SHALL allow records to remain correlated without requiring all operational data to be centralised.

---

# 38. Database Ownership

Every Medusa EngineInstance SHALL own its persistence boundary.

The following are prohibited:

```text
iDempiere SQL → Medusa tables

Payload SQL → Medusa tables

Control Plane SQL → Medusa tables

Digital Estate SQL → Medusa tables

analytics scripts → production Medusa tables
```

unless explicitly classified as Medusa-owned administrative tooling operating within the Medusa boundary.

Integration SHALL occur through:

1. published APIs;
2. canonical events;
3. controlled exports;
4. engine-owned adapters.

---

# 39. Schema Independence

Baobab canonical schemas MUST NOT duplicate Medusa's entire internal data model.

Canonical contracts SHALL contain only information required for cross-boundary interoperability.

This is essential to preserve upgradeability.

A Medusa internal schema change SHOULD NOT automatically become a breaking Baobab contract change.

---

# 40. Medusa Customisation Policy

Customisation SHALL follow the hierarchy:

```text
Configuration
      ↓
Documented extension mechanism
      ↓
Plugin/module
      ↓
Workflow extension
      ↓
Adapter
      ↓
Minimal upstream modification
```

Direct modification of Medusa core SHOULD be treated as a last resort.

Every unavoidable core modification MUST have:

- documented rationale;
- owner;
- automated tests;
- upgrade impact assessment;
- corresponding ADR or exception;
- removal strategy where practical.

Forking upstream merely for convenience is prohibited.

---

# 41. Upstream Compatibility

The Baobab Commerce Engine SHALL remain upgradeable.

CI SHOULD continuously test:

- Baobab extensions;
- canonical contracts;
- database migrations;
- APIs;
- event publication;
- adapters;
- digital-estate integration;
- ERP integration.

Major Medusa upgrades SHALL undergo architectural compatibility assessment before adoption.

---

# 42. Authentication

Customer authentication, administrative authentication and machine authentication SHALL be treated separately.

The architecture SHALL distinguish:

```text
Customer Principal
Administrative Principal
Service Principal
Integration Principal
```

A service credential MUST NOT masquerade as an end user.

Authenticated platform context MUST be propagated through trusted claims or equivalent secure mechanisms.

---

# 43. Authorization

Medusa authorization SHALL consider relevant commerce context in addition to identity.

For example:

```text
principal
+
organisation membership
+
context
+
market
+
sales channel
+
resource
+
action
```

B2B access control MUST prevent a buyer from accessing another organisation's:

- orders;
- quotations;
- addresses;
- negotiated prices;
- payment terms;
- account data.

---

# 44. Service-to-Service Security

Cross-engine communication MUST use authenticated service identities.

Production integrations MUST NOT depend solely upon network location as proof of identity.

Requests SHOULD carry:

```text
correlation_id
trace_id
calling_service
context_id
```

where applicable.

Secrets SHALL be managed through approved secrets-management mechanisms.

---

# 45. Audit

Material commerce actions SHALL be auditable.

Audit records SHOULD identify:

- actor;
- service;
- action;
- subject;
- tenant/context;
- timestamp;
- correlation ID;
- source;
- outcome.

Business audit and infrastructure logging SHALL remain conceptually distinct.

---

# 46. Observability

Medusa SHALL emit platform-compatible:

- structured logs;
- metrics;
- traces;
- health status;
- readiness status;
- dependency status.

Cross-engine transactions SHOULD be traceable using common correlation and trace identifiers.

A commerce order should therefore be traceable conceptually as:

```text
Digital Estate
      │
      ▼
Medusa
      │
      ▼
Event
      │
      ▼
Integration
      │
      ▼
iDempiere
```

without manually searching unrelated log files.

---

# 47. Health and Readiness

The engine SHALL distinguish:

```text
liveness
```

from:

```text
readiness
```

A running process whose required database is unavailable MAY be alive but MUST NOT falsely report itself ready for commerce traffic.

---

# 48. Failure Isolation

Failure of one engine SHOULD NOT automatically make unrelated Baobab capabilities unavailable.

For example, temporary iDempiere unavailability SHOULD NOT necessarily prevent:

- product browsing;
- content browsing;
- cart creation;

provided the business operation does not require immediate ERP confirmation.

Operations requiring unavailable dependencies SHALL fail explicitly or enter an approved recoverable state.

---

# 49. Degraded Operation

The architecture SHOULD define degraded modes.

Example:

```text
iDempiere unavailable
       │
       ├── Browse       → available
       ├── Search       → available
       ├── Cart         → available
       └── Order        → according to configured risk policy
```

Such behaviour MUST be intentional.

It MUST NOT emerge accidentally from timeout behaviour.

---

# 50. Timeouts and Circuit Breaking

All remote calls SHALL have finite timeouts.

Cross-engine integration SHOULD implement appropriate:

- retry;
- exponential backoff;
- jitter;
- circuit breaking;
- dead-letter handling.

Infinite retries are prohibited.

---

# 51. Reconciliation

Because Baobab is distributed, reconciliation is a first-class requirement.

The platform SHALL provide mechanisms to detect discrepancies such as:

```text
Medusa order exists
ERP order missing

payment captured
ERP posting missing

ERP stock changed
commerce projection stale

refund completed
financial reversal missing
```

Critical integration processes MUST have deterministic reconciliation procedures.

---

# 52. Event Replay

Canonical events SHOULD be replayable where practical.

Consumers MUST distinguish replay from a new business transaction through stable event and idempotency identifiers.

Replay MUST NOT accidentally duplicate financial or physical actions.

---

# 53. API Versioning

Published Commerce Engine APIs consumed across repository boundaries SHALL follow Baobab API-versioning standards.

Breaking changes MUST NOT be introduced silently.

Internal Medusa APIs not declared part of the Baobab contract SHALL NOT be treated as stable platform interfaces.

---

# 54. Contract Repository

Organisation-wide commerce contracts SHALL be maintained through `nabhold/shared` or its designated successor.

Contracts SHOULD include:

```text
contracts/
├── commerce/
│   ├── product/
│   ├── customer/
│   ├── organisation/
│   ├── order/
│   ├── payment/
│   ├── fulfilment/
│   ├── return/
│   └── refund/
│
├── events/
├── identity/
├── context/
├── mapping/
└── errors/
```

OpenAPI, AsyncAPI and JSON Schema artefacts SHALL be machine-testable.

---

# 55. Contract Testing

`nabhold/baobab-trade` CI SHALL test conformance against applicable organisational contracts.

Tests SHOULD include:

```text
schema validation
event-envelope validation
API compatibility
mapping behaviour
idempotency
tenant/context isolation
authentication
authorization
upgrade compatibility
migration correctness
failure recovery
```

A contract-breaking pull request MUST fail CI unless accompanied by an approved versioned contract change.

---

# 56. Deployment

Medusa SHALL be independently deployable.

A deployment unit SHOULD conceptually consist of:

```text
Medusa application
       │
       ├── PostgreSQL
       ├── cache/coordination infrastructure where required
       ├── worker processes where required
       └── external providers
```

The Commerce Engine SHALL NOT share a runtime container with:

- iDempiere;
- Payload CMS;
- the Control Plane;
- a digital estate.

---

# 57. Development Environment

`nabhold/baobab-dev` SHALL provide the standard reproducible engineering environment rather than serving as the Medusa production runtime.

The established development-environment philosophy is therefore retained: the common development image is a toolbox for a heterogeneous platform, while engines retain purpose-built runtime containers.

---

# 58. Horizontal Scaling

Medusa SHALL be designed so stateless application workloads can be horizontally scaled where supported.

Persistent or coordination-dependent state MUST remain in appropriate external services.

No application instance SHALL assume exclusive ownership of globally shared commerce state merely because the initial production topology contains one replica.

---

# 59. Multi-Region Evolution

Initial deployment MAY be geographically simple.

The architecture MUST nevertheless avoid assumptions that prevent later topology such as:

```text
                    Control Plane

              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
          Africa      Europe      Asia
          Commerce    Commerce    Commerce
          Instance    Instance    Instance
```

Multi-region deployment SHALL be introduced because regulatory, resilience or workload requirements justify it—not merely to create architectural sophistication.

---

# 60. Backup and Recovery

Every production Medusa EngineInstance SHALL have documented:

- backup policy;
- retention policy;
- restore procedure;
- recovery point objective;
- recovery time objective.

Backup existence alone is insufficient.

Restore procedures MUST be periodically tested.

---

# 61. Personally Identifiable Information

Commerce data SHALL be classified.

Personally identifiable information SHOULD be minimised in:

- canonical events;
- logs;
- traces;
- analytics exports;
- dead-letter payloads.

Identifiers SHOULD be preferred where consumers can resolve information through authorised interfaces.

Applicable privacy and residency obligations, including POPIA where relevant, SHALL be incorporated into deployment and retention policy.

---

# 62. Logging

The following MUST NOT be logged in plaintext:

- passwords;
- access tokens;
- refresh tokens;
- payment credentials;
- card data;
- secrets;
- private cryptographic material.

Customer PII SHOULD be redacted or minimised according to Baobab logging policy.

---

# 63. Digital-Estate Independence

No Medusa deployment SHALL assume one specific frontend.

A capability may be consumed by:

```text
B2C website
B2B portal
mobile application
customer-service application
marketplace interface
machine client
future digital estate
```

provided the consumer is authorised and satisfies the published contract.

This is fundamental to the headless decision.

---

# 64. No Presentation Coupling

Commerce APIs SHALL expose commerce semantics, not HTML or frontend-specific page structures.

For example, Medusa may expose:

```text
product
price
availability
cart
order
```

but SHALL NOT own:

```text
homepage hero
navigation menu
brand story
editorial landing page
corporate news
```

Those belong elsewhere.

---

# 65. Analytics

Operational commerce persistence SHALL NOT become the long-term analytical warehouse.

Analytics consumers SHOULD receive:

- events;
- governed exports;
- replicated analytical projections.

Large analytical queries MUST NOT compromise transactional commerce workloads.

---

# 66. Search

Commerce search MAY initially use capabilities appropriate to Medusa and the current scale.

Adoption of a dedicated search engine SHALL be justified by measurable requirements.

Search infrastructure SHALL NOT be introduced merely because it is common in large commerce architectures.

---

# 67. External Providers

Payments, tax, shipping, email, search and other external systems SHALL be accessed through adapters/provider interfaces where practical.

Canonical contracts SHALL avoid unnecessary vendor-specific fields.

Provider identifiers SHALL normally be represented as `ExternalReference`s.

This preserves provider replaceability.

---

# 68. Configuration

Configuration SHALL be separated into:

```text
platform configuration
engine configuration
market configuration
tenant/context configuration
secrets
runtime infrastructure configuration
```

Secrets MUST NOT be stored in ordinary configuration documents.

Environment variables MAY bootstrap runtime configuration but SHOULD NOT become an uncontrolled substitute for governed platform configuration.

---

# 69. Infrastructure Independence

Medusa SHALL NOT encode AWS-specific semantics into core commerce-domain logic.

AWS MAY be the initial infrastructure provider.

Cloud-specific behaviour SHALL remain within infrastructure or adapter boundaries where practical.

---

# 70. Prohibited Couplings

The following architectural patterns are explicitly prohibited:

### Shared database integration

```text
Medusa ──SQL──> iDempiere
```

### ERP-owned storefront

```text
iDempiere
   └── customer-facing commerce UI
```

where this bypasses the designated digital-estate architecture.

### CMS-owned pricing

```text
Payload
   └── authoritative transactional price
```

### Digital-estate commerce duplication

```text
Thamani frontend
   └── custom order engine
```

### Market-as-tenant shortcut

```text
ZA market = tenant
```

### Primary-key reuse as integration

```text
Medusa ID == ERP ID
```

### Synchronous distributed transaction

```text
checkout
  BEGIN
    Medusa DB
    ERP DB
  COMMIT
```

### Hidden integration

```text
cron script
  → direct DB query
  → undocumented mutation
```

These violate the platform architecture.

---

# 71. Consequences — Positive

Adopting this architecture provides:

### Specialised commerce capability

Baobab benefits from Medusa's commerce focus rather than rebuilding commerce fundamentals.

### Headless digital estates

Different legal entities and brands may create different customer experiences while consuming the same platform capability.

### Polyglot independence

Commerce may evolve independently of Go, Java and Payload-based components.

### Replaceability

Strict contracts make eventual Medusa replacement possible without redefining Baobab itself.

### Multi-market scalability

Markets, currencies, channels and jurisdictions are explicitly modelled.

### Isolation flexibility

Small tenants may share infrastructure while larger or regulated tenants may receive dedicated engine instances.

### ERP separation

Commerce and enterprise accounting remain correctly separated.

### Content separation

Editorial concerns do not contaminate transactional commerce.

---

# 72. Consequences — Negative

The decision also creates costs.

### Distributed-system complexity

Cross-engine operations require events, reconciliation, idempotency and observability.

### Duplicate representations

Products, customers and orders may have representations in multiple systems.

This is intentional but requires disciplined mapping.

### Eventual consistency

Not every engine will reflect a business change immediately.

### Mapping infrastructure

Canonical identity and external-reference management become critical infrastructure.

### Operational diversity

Baobab must operate Go, TypeScript/Node.js, Java/iDempiere and Payload CMS workloads.

### Contract governance

Teams cannot casually change cross-engine APIs.

These costs are accepted because they preserve domain and organisational independence.

---

# 73. Alternatives Rejected

## 73.1 Build commerce in the Control Plane

**Rejected.**

The Control Plane would become a business monolith and duplicate specialised commerce functionality.

---

## 73.2 Use iDempiere as the storefront commerce engine

**Rejected.**

ERP and customer-facing commerce have different lifecycle, UX, scalability and integration concerns.

---

## 73.3 Put commerce logic in each digital estate

**Rejected.**

This would duplicate business logic and create inconsistent order, pricing and payment behaviour.

---

## 73.4 Shared Medusa/iDempiere database

**Rejected absolutely.**

It would destroy engine autonomy, upgradeability and replaceability.

---

## 73.5 One Medusa instance per legal entity by default

**Rejected as a universal rule.**

Dedicated instances MAY be appropriate, but topology SHALL be determined by `IsolationProfile`, scale, geography, regulation and risk.

---

## 73.6 One global Medusa instance forever

**Rejected.**

It would make regulatory, geographic and enterprise isolation unnecessarily difficult.

---

## 73.7 Make Medusa the canonical master-data authority

**Rejected.**

Medusa is authoritative within commerce capabilities, not for the whole Baobab enterprise model.

---

# 74. Architectural Invariants

The following invariants SHALL hold for every conforming implementation.

**INV-COM-001**  
Medusa SHALL remain independently deployable.

**INV-COM-002**  
Medusa SHALL own its database.

**INV-COM-003**  
No external engine SHALL directly mutate Medusa tables.

**INV-COM-004**  
Medusa SHALL NOT directly mutate another engine's database.

**INV-COM-005**  
Tenant, legal entity, market and digital estate SHALL remain distinct concepts.

**INV-COM-006**  
Cross-engine identity SHALL use canonical mappings.

**INV-COM-007**  
Engine-native identifiers SHALL remain engine-native.

**INV-COM-008**  
Material cross-engine state changes SHALL use governed APIs or canonical events.

**INV-COM-009**  
Material asynchronous events SHALL be durably published.

**INV-COM-010**  
Consumers SHALL be idempotent.

**INV-COM-011**  
Medusa SHALL NOT become the ERP accounting authority.

**INV-COM-012**  
Medusa SHALL NOT become the editorial CMS.

**INV-COM-013**  
Digital estates SHALL NOT become independent commerce authorities.

**INV-COM-014**  
Capability routing SHALL respect Control Plane bindings.

**INV-COM-015**  
Isolation SHALL be determined explicitly rather than inferred from legal-entity identity.

**INV-COM-016**  
Currency SHALL accompany monetary values crossing system boundaries.

**INV-COM-017**  
Production cross-engine calls SHALL be authenticated.

**INV-COM-018**  
Critical distributed processes SHALL be reconcilable.

**INV-COM-019**  
Medusa customisation SHALL minimise divergence from upstream.

**INV-COM-020**  
Commerce contracts SHALL be machine-testable.

---

# 75. Minimum Production Acceptance Criteria

A Baobab Medusa deployment SHALL NOT be considered production-grade until the following are demonstrated.

### Architecture

- independent deployment;
- explicit EngineInstance registration;
- capability binding;
- context resolution;
- tenant/context isolation.

### Commerce

- product lifecycle;
- pricing;
- cart;
- checkout;
- order;
- payment;
- fulfilment;
- return/refund paths applicable to the deployed business model.

### Integration

- canonical mappings;
- Medusa → iDempiere integration;
- Payload ↔ commerce composition;
- digital-estate API consumption;
- durable events;
- idempotent consumers;
- reconciliation.

### Security

- service authentication;
- customer authorization;
- B2B organisational isolation where applicable;
- secret management;
- PII-safe logging.

### Reliability

- backup;
- tested restore;
- health/readiness;
- retry;
- timeout;
- dead-letter handling;
- event replay/recovery procedure.

### Observability

- structured logging;
- metrics;
- distributed correlation;
- alerts for failed integration;
- reconciliation visibility.

### Engineering

- reproducible DevContainer;
- reproducible build;
- SHA-pinned GitHub Actions;
- dependency scanning;
- container scanning;
- contract tests;
- migration tests;
- documented upgrade procedure.

---

# 76. Conformance Tests

At minimum, automated architecture tests SHOULD prove that:

```text
1. Tenant A cannot retrieve Tenant B protected commerce data.

2. B2B Organisation A cannot retrieve Organisation B orders.

3. An unknown Context is rejected.

4. An invalid CapabilityBinding cannot route commerce traffic.

5. Duplicate commerce.order.placed events create only one ERP transaction.

6. ERP unavailability does not lose a successfully committed durable commerce event.

7. Event replay does not duplicate financial transactions.

8. A Medusa product can map independently to Payload and iDempiere representations.

9. Changing an engine-native identifier does not change the CanonicalEntity identity.

10. Monetary contracts reject missing currency.

11. Invalid event versions fail schema validation.

12. A digital estate can be replaced without migrating commerce state.

13. Payload unavailability does not corrupt transactional commerce state.

14. Medusa cannot obtain direct database credentials for iDempiere.

15. iDempiere cannot obtain direct database credentials for Medusa.

16. A dedicated IsolationProfile resolves to the correct EngineInstance.

17. Cross-engine requests contain correlation metadata.

18. Sensitive payment credentials never appear in canonical event payloads.

19. Medusa upgrades pass canonical contract tests before deployment.

20. Database restoration and event reconciliation can restore a known consistent operating state.
```

---

# 77. Implementation Sequence

Implementation SHALL proceed incrementally.

## Stage 1 — Engine Foundation

Establish:

```text
nabhold/baobab-trade
```

with:

- Medusa baseline;
- Baobab development profile;
- reproducible runtime image;
- CI;
- security scanning;
- configuration standards;
- architecture documentation.

## Stage 2 — Control Plane Integration

Implement:

```text
Engine
EngineInstance
Capability
CapabilityBinding
Context
IsolationProfile
```

integration.

## Stage 3 — Canonical Mapping

Implement mappings for initial:

```text
Product
Customer
Organisation
Order
```

entities.

## Stage 4 — Event Foundation

Implement:

- canonical envelope;
- transactional outbox;
- publisher;
- idempotency;
- correlation;
- event schema validation.

## Stage 5 — Digital Estate Vertical Slice

Prove:

```text
Digital Estate
     │
     ▼
Payload + Medusa
     │
     ▼
Cart
     │
     ▼
Checkout
     │
     ▼
Order
```

## Stage 6 — ERP Vertical Slice

Prove:

```text
Medusa Order
     │
     ▼
Canonical Event
     │
     ▼
Mapping
     │
     ▼
iDempiere
     │
     ▼
Acknowledgement
```

## Stage 7 — Production Hardening

Add:

- reconciliation;
- failure recovery;
- observability;
- backup/restore testing;
- performance testing;
- isolation testing;
- security testing;
- upgrade testing.

Only after these foundations are proven SHOULD additional complexity be introduced.

---

# 78. Governance

Changes affecting any of the following require architecture review:

- Medusa bounded-context ownership;
- tenant interpretation;
- market interpretation;
- canonical mapping;
- ERP authority;
- product authority;
- payment authority;
- isolation topology;
- canonical events;
- direct engine dependencies;
- shared persistence;
- upstream Medusa modifications.

An implementation convenience SHALL NOT silently redefine a platform boundary.

---

# 79. Final Decision

Baobab adopts MedusaJS as its strategic **headless Commerce Engine**.

The engine SHALL be:

```text
headless
independently deployable
independently persistent
multi-market
multi-currency
B2B-capable
B2C-capable
context-aware
contract-governed
event-driven
observable
replaceable
```

It SHALL participate in Baobab through:

```text
Control Plane
      │
      ├── Context
      ├── CapabilityBinding
      ├── IsolationProfile
      └── Canonical Mapping
             │
             ▼
          MedusaJS
             │
      ┌──────┼─────────┐
      │      │         │
      ▼      ▼         ▼
  Payload  iDempiere  Digital Estates
  Content     ERP       Experience
```

The defining boundary is:

> **The Baobab Commerce Engine owns commerce execution. It does not own the enterprise, the organisation, the digital experience, editorial content, or enterprise accounting.**

The defining integration rule is:

> **Engines exchange contracts, identities and events—not database tables.**

The defining scaling rule is:

> **Markets, legal entities, tenants, digital estates and engine instances are independently modelled dimensions.**

And the defining engineering rule is:

> **Baobab SHALL preserve MedusaJS as a specialised, replaceable engine by extending it through explicit contracts rather than absorbing the wider platform into it.**

These rules are architectural invariants, not implementation suggestions.
