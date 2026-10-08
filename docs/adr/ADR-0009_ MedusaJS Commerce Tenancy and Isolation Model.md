# ADR-0009: MedusaJS Commerce Tenancy and Isolation Model

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates
- **Supersedes:** Any implicit model in which a Medusa instance, Medusa region, sales channel, market, legal entity, or digital estate is automatically treated as a Baobab tenant

---

## 1. Context

The Baobab Commerce Engine is implemented using MedusaJS and is intended to serve multiple independently evolving organisations, digital estates, markets, currencies, jurisdictions, B2B relationships and B2C channels.

Baobab has already established an important organisational principle:

> A legal entity is the default tenant boundary, but a legal entity is not synonymous with tenancy.

The Commerce Engine must preserve this distinction.

MedusaJS has native commerce concepts useful for partitioning commerce behaviour, including regions, sales channels, customers, products, pricing and related commercial structures. None of these concepts, individually, represents the Baobab tenancy model.

Likewise, deployment topology cannot define tenancy.

The following assumptions are therefore invalid:

```text
Tenant = Medusa Instance
Tenant = Legal Entity
Tenant = Market
Tenant = Region
Tenant = Country
Tenant = Currency
Tenant = Sales Channel
Tenant = Digital Estate
Tenant = B2B Customer Organisation
```

Any of these concepts may correlate in a particular deployment, but correlation is not identity.

This ADR defines how the Commerce Engine receives, represents and enforces Baobab tenancy and isolation while remaining compatible with Medusa's native commerce model.

---

## 2. Decision

The Baobab Commerce Engine SHALL use **Control-Plane-resolved Context and IsolationProfile objects as the authoritative source of tenancy and isolation requirements**.

Medusa SHALL NOT independently determine the canonical tenant boundary.

A Commerce Engine operation requiring tenant-aware execution SHALL operate within a resolved Baobab `Context`.

The `Context` SHALL identify or make resolvable the platform dimensions necessary for the operation, including where applicable:

```text
Tenant
Organisation
Legal Entity
Market
Digital Estate
Engine
EngineInstance
Capability
CapabilityBinding
IsolationProfile
```

Medusa-native concepts SHALL implement commerce behaviour within that Context but SHALL NOT replace the canonical platform concepts.

Isolation SHALL be explicitly configured through an `IsolationProfile` and SHALL be capable of evolving from shared logical isolation to dedicated infrastructure without changing canonical tenant identity.

---

## 3. Decision Drivers

The decision is driven by the need to support:

- multiple legal entities;
- future legal entities not currently known;
- legal entities operating in multiple countries;
- multiple markets per legal entity;
- multiple currencies;
- multiple digital estates;
- B2B and B2C commerce;
- multiple brands;
- different regulatory jurisdictions;
- different data-residency requirements;
- shared infrastructure for economical deployments;
- dedicated infrastructure for regulated or high-scale deployments;
- future regional Medusa deployments;
- independent scaling;
- engine replacement;
- explicit Control Plane governance.

The model MUST avoid encoding today's organisational structure as tomorrow's infrastructure limitation.

---

## 4. Tenant Definition

A Baobab tenant represents a **platform isolation and consumption boundary**.

It answers:

> Whose governed platform boundary is this?

It does not answer:

> What organisational object is this?

The latter belongs to the organisation model.

Therefore:

```text
Tenancy
   │
   └── boundary / isolation / consumption

Organisation Model
   │
   ├── Legal Entity
   ├── Business Unit
   ├── Function
   └── Team
```

These models MAY intersect but SHALL remain conceptually independent.

---

## 5. Legal Entity as Default Boundary

For Baobab's initial operating model, a legal entity SHALL normally constitute the default tenant boundary.

Conceptually:

```text
Legal Entity
     │
     ▼
Default Tenant Boundary
```

However, the architecture SHALL support exceptions.

A legal entity MAY eventually require:

```text
one legal entity
     │
     ├── Tenant Boundary A
     ├── Tenant Boundary B
     └── Tenant Boundary C
```

Conversely, an authorised platform arrangement MAY permit multiple organisational entities to participate within a broader governed tenant context.

Such exceptions MUST be explicit.

They MUST NOT arise from accidental infrastructure sharing.

---

## 6. Tenant and Organisation Cardinality

The platform SHALL NOT enforce a permanent one-to-one database assumption between `Tenant` and `LegalEntity`.

The canonical model MAY express relationships such as:

```text
Tenant 1 ───── LegalEntity 1
```

as the common case while remaining capable of representing more complex relationships through Context and MappingScope.

Commerce code SHALL therefore avoid assumptions such as:

```typescript
tenantId === legalEntityId
```

even where the initial data happens to make them equivalent.

---

## 7. Tenant and Medusa Engine

A tenant SHALL NOT be synonymous with a Medusa `EngineInstance`.

Valid topology includes:

### Shared instance

```text
             Medusa EngineInstance
                    │
          ┌─────────┼─────────┐
          │         │         │
       Tenant A  Tenant B  Tenant C
```

### Dedicated instance

```text
Tenant A
   │
   ▼
Medusa EngineInstance A
```

### Regional instances

```text
                     Tenant A
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼
     Africa EngineInstance   EU EngineInstance
```

The topology SHALL be resolved through capability and isolation configuration.

---

## 8. Tenant and Market

A Baobab `Market` represents a commercial operating context.

A tenant MAY operate:

```text
Tenant
  │
  ├── South Africa Market
  ├── Uganda Market
  ├── Kenya Market
  └── Future Market
```

Therefore:

```text
Tenant 1:N Market
```

is valid.

A Market SHALL NOT serve as the tenant identifier.

---

## 9. Market and Legal Entity

Markets and legal entities SHALL also remain independent.

A legal entity MAY participate in multiple markets:

```text
Legal Entity
     │
     ├── ZA Market
     ├── UG Market
     └── KE Market
```

A market definition SHALL explicitly identify the legal seller or other required legal participant rather than assuming it from geography.

---

## 10. Tenant and Currency

Currency SHALL NOT define tenancy.

A tenant MAY transact in multiple currencies.

A currency MAY be used by multiple tenants.

Therefore:

```text
Tenant N:M Currency
```

is conceptually valid.

Currency SHALL be resolved through commercial context.

---

## 11. Tenant and Country

Country SHALL NOT define tenancy.

The platform SHALL support:

```text
Tenant A
   │
   ├── South Africa
   ├── Uganda
   └── Kenya
```

without creating a new tenant merely because commercial operations cross a national border.

A new tenant boundary MAY nevertheless be required for regulatory or organisational reasons.

That decision belongs to Control Plane governance.

---

## 12. Tenant and Digital Estate

A `DigitalEstate` is a customer-, employee-, partner- or stakeholder-facing digital property.

Examples include:

- corporate website;
- B2C storefront;
- B2B portal;
- mobile application;
- supplier portal.

A tenant MAY own or operate multiple digital estates.

A digital estate MAY expose capabilities from multiple engines.

Therefore:

```text
Tenant
  │
  ├── Digital Estate A
  ├── Digital Estate B
  └── Digital Estate C
```

is expected.

`DigitalEstate` SHALL NOT be used as a synonym for `Tenant`.

---

## 13. Digital Estate and Commerce Context

A digital estate MAY provide one of the inputs used to resolve commerce Context.

For example:

```text
request
   │
   ▼
shop.example.com
   │
   ▼
DigitalEstate
   │
   ▼
Context
   │
   ├── Tenant
   ├── Market
   ├── Legal Seller
   ├── Currency
   ├── Sales Channel
   └── Commerce CapabilityBinding
```

The hostname itself SHALL NOT be treated as sufficient authoritative tenant identity.

---

## 14. B2B Organisation Is Not Tenant

A Medusa B2B customer organisation represents a commercial buyer.

For example:

```text
Thamani
   │
   │ sells to
   ▼
Customer Organisation X
```

`Customer Organisation X` does not thereby become a Baobab tenant.

A customer organisation MAY independently become a Baobab tenant if it consumes Baobab platform products under its own governed boundary.

That is a separate relationship.

---

## 15. Context as Execution Boundary

The canonical Baobab `Context` SHALL serve as the principal execution boundary passed into tenant-aware Commerce Engine operations.

Conceptually:

```text
Context
  │
  ├── context_id
  ├── tenant
  ├── organisation scope
  ├── legal entity
  ├── market
  ├── digital estate
  ├── capability
  ├── capability binding
  └── isolation profile
```

Not every operation requires every dimension.

The Context contract SHALL define mandatory fields by use case.

---

## 16. Context Resolution

The preferred request path SHALL be:

```text
Incoming Request
      │
      ▼
Authentication
      │
      ▼
Trusted Origin / Digital Estate
      │
      ▼
Context Resolution
      │
      ▼
Capability Resolution
      │
      ▼
Isolation Enforcement
      │
      ▼
Commerce Operation
```

Context MUST be established before access to protected tenant-sensitive resources.

---

## 17. Control Plane Authority

`nabhold/baobab-cp` SHALL remain authoritative for:

```text
Tenant
Context
IsolationProfile
Engine
EngineInstance
Capability
CapabilityBinding
Market
DigitalEstate
```

as defined by the canonical Control Plane model.

Medusa MAY maintain projections or caches required for runtime efficiency.

Those projections SHALL NOT supersede Control Plane authority.

---

## 18. IsolationProfile

`IsolationProfile` SHALL describe the isolation guarantees required for a Context or capability binding.

The implementation contract MAY support profiles conceptually equivalent to:

```text
SHARED
LOGICALLY_ISOLATED
DEDICATED_DATABASE
DEDICATED_ENGINE_INSTANCE
DEDICATED_INFRASTRUCTURE
```

The canonical Control Plane specification SHALL own the final enumeration and semantics.

Medusa SHALL consume rather than independently redefine those semantics.

---

## 19. Logical Isolation

A shared Medusa EngineInstance MAY serve multiple tenants only where the applicable IsolationProfile permits it.

Every tenant-sensitive object MUST then possess a deterministic isolation path.

The implementation SHALL guarantee that a query executing for:

```text
Tenant A
```

cannot retrieve protected resources belonging exclusively to:

```text
Tenant B
```

merely by supplying another object's identifier.

---

## 20. Defence in Depth

Isolation SHALL NOT depend solely on frontend filtering.

The following is prohibited:

```text
GET /orders

frontend filters Tenant A
```

while the backend returns all orders.

Tenant enforcement MUST occur server-side.

Where practical, isolation SHOULD be enforced at multiple layers:

```text
Context
   ↓
Authorization
   ↓
Application Query Scope
   ↓
Domain Validation
   ↓
Persistence Constraint / Projection
```

---

## 21. Native Medusa Objects

Where a Medusa-native object does not natively carry sufficient Baobab Context information, the implementation SHALL provide an extension or deterministic relationship capable of establishing the appropriate scope.

The precise physical implementation SHALL be specified separately.

This ADR deliberately does not require modifying Medusa primary keys or upstream tables merely for platform uniformity.

---

## 22. Context Metadata

Baobab-specific context metadata MAY be stored alongside Medusa resources where necessary.

Such metadata SHALL use stable platform identifiers rather than display names.

Preferred:

```text
tenant_id = "019..."
market_id = "019..."
context_id = "019..."
```

Not:

```text
tenant = "Thamani"
market = "South Africa Shop"
```

Human-readable names are mutable.

Canonical identifiers are not.

---

## 23. Dedicated Database Isolation

Where an IsolationProfile requires database isolation:

```text
Tenant A
   │
   ▼
Medusa EngineInstance
   │
   ▼
PostgreSQL Database A
```

SHALL be supported by deployment architecture.

A dedicated database MUST NOT cause the canonical identity of the tenant, market, product or order to change.

---

## 24. Dedicated Engine Isolation

Where stronger isolation is required:

```text
Tenant A
   │
   ▼
EngineInstance A
   │
   ▼
Database A
```

and:

```text
Tenant B
   │
   ▼
EngineInstance B
   │
   ▼
Database B
```

MAY be deployed.

Both instances SHALL still implement the same Baobab Commerce Engine contracts.

---

## 25. Infrastructure Isolation

A future high-isolation deployment MAY use:

```text
dedicated account
dedicated VPC
dedicated cluster
dedicated compute
dedicated database
dedicated encryption boundary
```

where required.

These are deployment characteristics.

They SHALL NOT alter canonical business identity.

---

## 26. Isolation Escalation

The architecture SHALL permit a tenant to move from:

```text
Shared Engine
```

to:

```text
Dedicated Engine
```

without redefining the tenant.

Conceptually:

```text
Tenant A
   │
   │ before
   ▼
Shared EngineInstance
```

becomes:

```text
Tenant A
   │
   │ after
   ▼
Dedicated EngineInstance
```

through CapabilityBinding and Mapping changes.

This is a fundamental requirement.

---

## 27. Isolation De-escalation

Moving from stronger isolation to weaker isolation SHALL require explicit governance approval.

Such migration MUST consider:

- data separation;
- regulatory requirements;
- contractual commitments;
- encryption;
- backup boundaries;
- residency;
- customer expectations.

It SHALL NOT happen automatically for cost optimisation.

---

## 28. Capability-Specific Isolation

Isolation MAY differ by capability.

For example, a tenant might consume:

```text
commerce.catalog
```

from shared infrastructure while:

```text
commerce.checkout
```

is provided by a dedicated instance in a future architecture.

The Control Plane model SHALL therefore allow capability bindings to participate in isolation resolution.

Medusa code SHALL not assume all commerce capabilities are permanently hosted by one universal instance.

---

## 29. Regional Isolation

A tenant operating in multiple regions MAY require:

```text
Tenant A
     │
     ├── Africa Context
     │      └── Africa Commerce EngineInstance
     │
     └── EU Context
            └── EU Commerce EngineInstance
```

The canonical tenant remains unchanged.

Market and EngineInstance bindings determine execution location.

---

## 30. Data Residency

Data residency SHALL be expressed as an infrastructure and policy constraint rather than encoded into tenant identity.

For example:

```text
Tenant A
   │
   ├── Context ZA
   │      residency = africa
   │
   └── Context EU
          residency = eu
```

The final residency model SHALL be defined by the Control Plane and infrastructure contracts.

---

## 31. Product Identity Across Isolation Boundaries

A canonical product MAY have representations in multiple Commerce EngineInstances.

For example:

```text
Canonical Product
      │
      ├── ExternalReference
      │      engine_instance = Africa
      │      product = prod_A
      │
      └── ExternalReference
             engine_instance = Europe
             product = prod_B
```

The canonical identity SHALL remain stable.

Engine-native identity SHALL remain local.

---

## 32. Order Identity Across Isolation Boundaries

Orders are operational transactions and SHALL normally belong to one execution Context and EngineInstance.

An order MUST NOT silently migrate between active engine instances during its transaction lifecycle.

Canonical mapping MAY allow enterprise systems to correlate the order after creation.

---

## 33. MappingScope

Cross-engine mappings SHALL use `MappingScope` where the relationship is not globally valid.

Possible scopes include:

```text
tenant
context
market
engine instance
digital estate
```

as defined by the canonical mapping specification.

This prevents false assumptions that one external representation applies globally.

---

## 34. Cache Isolation

Caches MUST preserve the same isolation semantics as authoritative storage.

A cache key such as:

```text
product:123
```

is unsafe where `123` may exist or vary across contexts.

Tenant/context-sensitive caches SHOULD use appropriately scoped keys such as:

```text
context:<context-id>:product:<id>
```

or an equivalent collision-safe structure.

---

## 35. Background Jobs

Background jobs SHALL execute with explicit Context when operating on tenant-sensitive data.

A worker MUST NOT rely upon ambient global tenant state.

Job payloads SHOULD contain or resolve:

```text
context_id
correlation_id
subject reference
```

as required.

---

## 36. Events

Canonical events originating from tenant-sensitive commerce operations SHALL carry sufficient context to establish their scope.

At minimum, where applicable:

```text
context_id
tenant_id
engine_instance_id
```

SHALL be available through the event envelope.

Market and legal-entity references SHOULD be included where required by consumers.

---

## 37. Event Consumers

Consumers SHALL NOT infer tenancy from:

```text
product ID
order ID
currency
market name
topic name
```

unless the corresponding contract explicitly makes such inference safe.

Canonical Context metadata is preferred.

---

## 38. Outbox Isolation

A shared Commerce Engine outbox MAY contain events belonging to multiple contexts.

Each event SHALL preserve its own Context.

Publisher batching MUST NOT strip or replace tenant metadata.

---

## 39. Observability

Operational telemetry SHOULD permit isolation-aware diagnosis.

Where permitted by data-classification policy, structured logs and metrics SHOULD expose:

```text
engine_instance_id
context_id
tenant_id
market_id
correlation_id
```

as appropriate.

Human-readable tenant names SHOULD not be required for telemetry correlation.

---

## 40. Audit

Tenant-sensitive administrative actions MUST identify the Context under which they occurred.

An administrator with access to Tenant A SHALL NOT automatically receive access to Tenant B merely because both are served by the same Medusa EngineInstance.

---

## 41. Administrative Isolation

Infrastructure administration and business administration SHALL be distinguished.

An infrastructure operator MAY maintain the shared runtime without automatically possessing unrestricted commerce-business authority.

Commerce administrative permissions SHOULD remain context-aware.

---

## 42. B2B Isolation

Within one tenant, B2B customer organisations SHALL receive an additional isolation boundary for customer-owned commerce information.

Conceptually:

```text
Tenant
  │
  ├── Customer Organisation A
  │      ├── buyers
  │      ├── prices
  │      └── orders
  │
  └── Customer Organisation B
         ├── buyers
         ├── prices
         └── orders
```

Buyer A MUST NOT access Organisation B protected resources.

This is commerce authorization isolation, not Baobab tenancy.

---

## 43. Price Isolation

Negotiated or organisation-specific prices MUST be scoped appropriately.

The existence of a product in multiple contexts MUST NOT permit a customer to retrieve another organisation's confidential pricing.

Pricing authorization SHALL occur server-side.

---

## 44. Search Isolation

Search results MUST respect the same Context and commercial visibility rules as direct resource retrieval.

A search subsystem SHALL NOT become a side channel through which another tenant's:

- products;
- prices;
- customers;
- orders;
- commercial information

become discoverable.

---

## 45. File and Object Storage Isolation

Commerce-generated files SHALL preserve tenant/context boundaries.

Object keys SHOULD be structured or cryptographically authorised so one Context cannot enumerate another's objects.

Signed access SHOULD be scoped and time-limited where appropriate.

---

## 46. Payment Isolation

Payment-provider configuration MAY vary by:

```text
tenant
legal seller
market
currency
region
```

Credentials SHALL be resolved from trusted configuration.

A payment transaction MUST NOT accidentally execute using another tenant or seller's merchant account.

---

## 47. Fulfilment Isolation

Fulfilment providers MAY likewise vary by Context.

Provider selection MUST occur from trusted commercial configuration.

Client-provided provider identifiers SHALL be validated against the active Context.

---

## 48. Tax Isolation

Tax configuration MUST resolve from the applicable commercial and legal Context.

Tax behaviour SHALL NOT be selected solely from the tenant ID where market, seller and jurisdiction are also relevant.

---

## 49. Failure Isolation

Failure affecting Tenant A SHOULD NOT unnecessarily prevent Tenant B from operating when both use shared infrastructure.

Where possible:

```text
tenant-specific integration failure
```

SHOULD remain tenant-specific.

Infrastructure-wide failures remain possible and SHALL be addressed through resilience architecture.

---

## 50. Rate Limiting

Rate limits MAY be enforced at multiple levels:

```text
platform
engine instance
tenant
digital estate
principal
endpoint
```

A high-volume tenant SHOULD NOT be able to exhaust shared resources without controls.

---

## 51. Resource Quotas

Future commercial plans MAY introduce tenant-aware quotas.

Quota policy SHALL remain a platform/commercial concern and SHOULD NOT be hard-coded into Medusa domain logic.

---

## 52. Provisioning

Provisioning a new commerce-consuming tenant SHOULD conceptually execute:

```text
Tenant exists
     │
     ▼
Context created
     │
     ▼
Market configured
     │
     ▼
IsolationProfile resolved
     │
     ▼
EngineInstance selected/provisioned
     │
     ▼
CapabilityBinding created
     │
     ▼
Medusa projection provisioned
     │
     ▼
Mappings registered
     │
     ▼
Commerce activated
```

Every step SHOULD be idempotent.

---

## 53. Deprovisioning

Tenant deprovisioning SHALL NOT be equivalent to immediately deleting commerce data.

The lifecycle SHOULD distinguish:

```text
ACTIVE
   ↓
SUSPENDED
   ↓
DECOMMISSIONING
   ↓
RETAINED / ARCHIVED
   ↓
PURGED where legally permitted
```

Canonical lifecycle definitions SHALL be governed by the Control Plane specification.

---

## 54. Tenant Suspension

A suspended tenant SHOULD be prevented from initiating prohibited new commerce operations while existing legal, accounting and operational records remain accessible to authorised administrative processes as required.

Suspension SHALL NOT silently destroy data.

---

## 55. Tenant Migration

Migration between EngineInstances SHALL be treated as a controlled platform operation.

It MUST address:

- database state;
- external references;
- mappings;
- capability bindings;
- events;
- payment configuration;
- fulfilment configuration;
- secrets;
- DNS/gateway routing where relevant;
- rollback;
- reconciliation.

---

## 56. Migration Consistency

During tenant migration, the platform MUST prevent split-brain commerce where both old and new instances independently accept conflicting writes for the same Context.

Migration SHALL therefore include a defined cutover strategy.

---

## 57. Backup Isolation

Shared database backups MAY contain data for multiple tenants.

Access to such backups SHALL therefore be treated as access to all contained tenants.

Where contractual requirements demand tenant-specific backup boundaries, a stronger IsolationProfile SHALL be selected.

---

## 58. Restore Isolation

Restoring a shared database for the benefit of one tenant MUST consider the impact on every other tenant.

The platform SHOULD support logical recovery mechanisms where practical, but SHALL NOT promise tenant-granular restore capabilities unless technically demonstrated.

---

## 59. Encryption

Encryption at rest and in transit SHALL apply according to platform security standards.

Where dedicated encryption keys are contractually or regulatorily required, the relevant IsolationProfile SHALL express or imply that requirement.

---

## 60. Secrets Isolation

Tenant-, seller- or market-specific secrets MUST be namespaced and access-controlled.

For example:

```text
Tenant A payment secret
```

MUST NOT be available merely because the same process also serves Tenant B unless the runtime legitimately requires and securely isolates both configurations.

---

## 61. CI Isolation Tests

Every shared-instance implementation SHALL include automated cross-tenant tests.

Minimum cases include:

```text
Tenant A cannot fetch Tenant B order.

Tenant A cannot mutate Tenant B cart.

Tenant A cannot retrieve Tenant B customer.

Tenant A cannot access Tenant B B2B price.

Tenant A cannot use Tenant B payment configuration.

Tenant A cannot use Tenant B fulfilment configuration.

Tenant A cannot discover Tenant B protected data through search.

Tenant A cannot resolve a CapabilityBinding belonging exclusively to Tenant B.
```

---

## 62. Adversarial Testing

Tests SHALL attempt identifier substitution attacks.

For example:

```text
Authenticated as Tenant A

GET /orders/<tenant-b-order-id>
```

MUST fail regardless of whether the attacker knows a valid external identifier.

---

## 63. Context Spoofing

Tests SHALL prove that untrusted clients cannot establish a different tenant merely by modifying:

```text
headers
query parameters
request body
cookies
hostnames
market IDs
sales-channel IDs
```

Trusted context resolution MUST override or reject conflicting untrusted assertions.

---

## 64. Isolation Conformance Gate

A Commerce Engine release that fails tenant isolation tests MUST NOT be promoted to production.

Isolation failure SHALL be classified as a security defect.

---

## 65. Rejected Alternative: Tenant Equals Medusa Instance

Rejected because it forces dedicated infrastructure for every tenant and prevents economical shared deployments.

It also incorrectly binds business identity to infrastructure topology.

---

## 66. Rejected Alternative: Tenant Equals Region

Rejected because Medusa region is a commerce concept and may be shared or reused differently from Baobab tenancy.

---

## 67. Rejected Alternative: Tenant Equals Sales Channel

Rejected because a tenant may have multiple sales channels and a sales channel does not define organisational ownership.

---

## 68. Rejected Alternative: Tenant Equals Legal Entity

Rejected as an absolute invariant.

Legal entity remains the default boundary but must not become an architectural synonym for tenancy.

---

## 69. Rejected Alternative: Tenant Equals Digital Estate

Rejected because one tenant may operate multiple estates and one estate may compose capabilities from multiple engines.

---

## 70. Rejected Alternative: Application Filtering Only

Rejected because query mistakes could expose cross-tenant data.

Defence in depth is required.

---

## 71. Rejected Alternative: Separate Medusa Fork per Tenant

Rejected.

Tenant variation SHALL be configuration-, context- and capability-driven wherever practical.

Separate forks would create:

- upgrade divergence;
- security divergence;
- inconsistent features;
- excessive operational cost.

---

## 72. Consequences

### Positive

The architecture permits:

- inexpensive shared deployments;
- dedicated enterprise deployments;
- regional deployments;
- future data-residency requirements;
- tenant migration;
- multiple markets;
- multiple currencies;
- multiple digital estates;
- B2B and B2C coexistence;
- independent legal-entity evolution.

Most importantly, business identity does not become permanently coupled to today's deployment topology.

### Negative

The model requires:

- explicit Context propagation;
- careful query scoping;
- stronger automated testing;
- Control Plane dependency;
- mapping infrastructure;
- provisioning orchestration;
- migration tooling;
- additional observability.

These costs are accepted.

---

## 73. Architectural Invariants

The following are mandatory.

**TEN-COM-001**  
Tenant SHALL NOT be inferred from Medusa EngineInstance alone.

**TEN-COM-002**  
Tenant SHALL NOT be synonymous with Market.

**TEN-COM-003**  
Tenant SHALL NOT be synonymous with currency.

**TEN-COM-004**  
Tenant SHALL NOT be synonymous with DigitalEstate.

**TEN-COM-005**  
LegalEntity SHALL remain distinct from Tenant even where it is the default tenant boundary.

**TEN-COM-006**  
B2B CustomerOrganisation SHALL NOT automatically become a Baobab Tenant.

**TEN-COM-007**  
Protected commerce operations SHALL execute under trusted Context.

**TEN-COM-008**  
Shared instances SHALL enforce server-side tenant isolation.

**TEN-COM-009**  
Context spoofing by untrusted clients SHALL fail.

**TEN-COM-010**  
EngineInstance changes SHALL NOT change canonical tenant identity.

**TEN-COM-011**  
IsolationProfile changes SHALL NOT require redefining canonical business identity.

**TEN-COM-012**  
Canonical mappings SHALL remain valid or be explicitly migrated when EngineInstance topology changes.

**TEN-COM-013**  
Background processing SHALL preserve Context.

**TEN-COM-014**  
Canonical events SHALL preserve Context.

**TEN-COM-015**  
Caches SHALL preserve isolation boundaries.

**TEN-COM-016**  
Search SHALL preserve isolation boundaries.

**TEN-COM-017**  
B2B organisation authorization SHALL be enforced independently of tenant isolation.

**TEN-COM-018**  
Payment and fulfilment configuration SHALL be resolved within trusted Context.

**TEN-COM-019**  
Tenant-specific code forks SHALL NOT be the normal customisation mechanism.

**TEN-COM-020**  
Isolation conformance tests SHALL gate production releases.

---

## 74. Implementation Implications

This ADR requires subsequent implementation specifications for:

```text
Baobab Context middleware
Context claims
Control Plane Context resolver
Medusa resource scoping
IsolationProfile enforcement
EngineInstance routing
Market projection
cache namespacing
background-job Context
canonical event Context
B2B organisation authorization
provisioning
tenant migration
deprovisioning
isolation tests
```

The physical data model SHALL be derived after these semantics are fixed.

---

## 75. Decision Outcome

Baobab Commerce tenancy shall be **context-driven rather than Medusa-driven**.

The resulting model is:

```text
                       BAOBAB CONTROL PLANE
                               │
                        Tenant Boundary
                               │
                               ▼
                            Context
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
             ▼                 ▼                 ▼
          Market         Digital Estate    Legal Entity
             │
             └─────────────────┬─────────────────┘
                               │
                               ▼
                       CapabilityBinding
                               │
                               ▼
                        IsolationProfile
                               │
                               ▼
                         EngineInstance
                               │
                               ▼
                         MEDUSA COMMERCE
```

This establishes the critical separation:

> **Tenant defines whose governed platform boundary applies.**

> **Context defines the circumstances under which a capability is consumed.**

> **Market defines where and under what commercial conditions commerce occurs.**

> **Legal Entity defines organisational and legal identity.**

> **Digital Estate defines the consuming digital experience.**

> **EngineInstance defines where the capability executes.**

> **IsolationProfile defines how strongly that execution must be separated.**

None of these concepts SHALL be collapsed merely because an initial deployment happens to map them one-to-one.

That separation is the foundation on which Baobab can move from a few initial operating companies to diverse organisations, regions, markets and infrastructure topologies without redesigning its Commerce Engine tenancy model.
