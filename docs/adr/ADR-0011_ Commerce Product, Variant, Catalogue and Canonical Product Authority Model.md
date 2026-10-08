# ADR-0011: Commerce Product, Variant, Catalogue and Canonical Product Authority Model

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0010-medusajs-commerce-market-region-currency-sales-channel-and-legal-seller-model.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates
- **Decision Class:** Product Identity / Catalogue / Cross-Engine Authority

---

## 1. Context

The Baobab Platform contains several engines that require representations of what business users commonly call a product.

Those representations exist for different reasons.

MedusaJS requires products and variants for commerce execution.

Payload CMS requires product references and content structures for editorial presentation, storytelling, merchandising and digital experience composition.

iDempiere requires product or item representations for ERP processes such as:

- accounting;
- inventory;
- procurement;
- sales processing;
- warehouse operations;
- costing;
- tax;
- fulfilment;
- financial reporting.

The Baobab Control Plane requires canonical identities and mappings so that these representations can be understood as referring to the same real-world business concept without requiring them to share a database identifier.

This creates an architectural problem.

The platform must not treat the following as identical:

```text
Canonical Product
Medusa Product
Medusa Variant
iDempiere Product
Payload Product Content
Digital Estate Product Page
```

Neither should one engine become the universal owner of every product attribute merely because it contains a record named `Product`.

The architecture therefore requires an explicit authority and mapping model.

---

# 2. Decision

Baobab SHALL represent the cross-platform business identity of a product using a canonical `CanonicalEntity`.

Each engine SHALL maintain its own native representation according to its bounded context.

The relationship SHALL conceptually be:

```text
                     CanonicalEntity
                        PRODUCT
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
         Medusa         iDempiere       Payload
        Product /         Product        Product
         Variant           / Item        Content
```

Canonical identity SHALL provide identity correlation.

It SHALL NOT provide a universal shared product database.

Authority SHALL be determined at attribute and capability level.

---

# 3. Fundamental Principle

Baobab SHALL adopt the following rule:

> **A product is a canonical business identity with specialised representations in the engines that require it.**

The canonical entity answers:

> Which business concept is this?

The engine representation answers:

> How does this engine need to represent that concept in order to perform its responsibility?

This distinction SHALL remain foundational.

---

# 4. Product Identity

Every product requiring cross-engine interoperability SHALL be eligible for a canonical identity.

Conceptually:

```text
CanonicalEntity
    id = 019...
    type = PRODUCT
```

The canonical identifier SHALL remain stable across:

- Medusa upgrades;
- Payload migrations;
- ERP migrations;
- engine-instance changes;
- Market expansion;
- Digital Estate changes.

Canonical identity SHALL NOT depend upon an engine-native identifier.

---

# 5. External References

Each engine representation SHALL retain its native identifier.

For example:

```text
Canonical Product
      │
      ├── ExternalReference
      │      engine = medusa
      │      external_id = prod_...
      │
      ├── ExternalReference
      │      engine = idempiere
      │      external_id = ...
      │
      └── ExternalReference
             engine = payload
             external_id = ...
```

An engine-native ID SHALL NOT be reused as the canonical identifier.

---

# 6. Product and Variant

Baobab SHALL distinguish:

```text
Product
```

from:

```text
Product Variant
```

A Product represents the commercial family or conceptual offering.

A Product Variant represents a selectable commercial configuration of that Product.

Conceptually:

```text
Product
   │
   ├── Variant A
   ├── Variant B
   └── Variant C
```

For physical products, variant dimensions MAY include:

- size;
- colour;
- weight;
- packaging;
- grade;
- capacity;
- material;
- format.

For B2B commodities, variant distinctions MAY include:

- grade;
- crop year;
- origin;
- screen size;
- process;
- packaging format;
- lot characteristics.

The exact semantics SHALL belong to the relevant product domain.

---

# 7. Canonical Variant Identity

A Variant requiring cross-engine interoperability SHALL also be eligible for its own canonical identity.

Conceptually:

```text
CanonicalEntity
 type = PRODUCT
      │
      ▼
CanonicalEntity
 type = PRODUCT_VARIANT
```

or an equivalent canonical relationship defined by the Control Plane model.

The parent-child relationship SHALL be explicit.

---

# 8. Product and Variant Cardinality

A Product SHALL support:

```text
Product 1:N ProductVariant
```

where variants exist.

A Product MAY have exactly one effective variant where the commerce engine requires variant-level transactional representation for otherwise non-variable products.

This implementation detail SHALL NOT change the business meaning of the canonical Product.

---

# 9. SKU

A SKU SHALL identify a sellable or operational stock-keeping representation.

SKU SHALL NOT be treated as the canonical Product ID.

A Product Variant MAY have:

```text
canonical_variant_id
SKU
Medusa variant ID
iDempiere product/item ID
```

These identifiers serve different purposes.

---

# 10. SKU Uniqueness

SKU uniqueness SHALL be governed by business scope.

The architecture SHALL NOT assume global SKU uniqueness without an explicit organisational contract.

Possible uniqueness scopes include:

```text
organisation
legal entity
tenant
catalogue
ERP client
```

The authoritative scope SHALL be defined separately.

Canonical identity removes the need to depend on globally unique human-designed SKU values.

---

# 11. Medusa Product Authority

Medusa SHALL be authoritative for commerce-specific product state.

This includes, where applicable:

- commerce product;
- commerce variant;
- sellability;
- commerce options;
- sales-channel eligibility;
- Market eligibility;
- cart eligibility;
- transactional pricing relationships;
- commerce inventory availability;
- commerce tax-category relationships;
- promotion eligibility;
- commerce publication state.

Medusa SHALL NOT automatically become authoritative for all product information.

---

# 12. Payload Product Authority

Payload CMS SHALL be authoritative for editorial product content.

This MAY include:

- marketing title;
- editorial description;
- long-form copy;
- product storytelling;
- editorial media;
- campaign imagery;
- SEO metadata;
- merchandising narratives;
- editorial taxonomy;
- landing-page composition;
- localisation;
- content scheduling.

Payload SHALL NOT become authoritative for transactional commerce prices or order eligibility.

---

# 13. iDempiere Product Authority

iDempiere SHALL be authoritative for ERP-specific product information.

This MAY include:

- accounting classification;
- costing;
- inventory valuation;
- procurement configuration;
- warehouse behaviour;
- ERP tax classification;
- units of measure where ERP-governed;
- replenishment;
- enterprise product/item lifecycle;
- purchasing data;
- financial posting behaviour.

Exact ERP attribute authority SHALL be defined in the iDempiere integration ADRs.

---

# 14. Control Plane Authority

The Control Plane SHALL be authoritative for:

```text
CanonicalEntity
ExternalReference
Mapping
MappingScope
```

and related cross-engine identity.

It SHALL NOT become a product catalogue database.

The Control Plane answers:

> Which representations correspond?

It does not answer:

> What is today's retail price?

or:

> What marketing copy should be displayed?

---

# 15. Attribute-Level Authority

Baobab SHALL reject whole-record ownership where multiple engines legitimately own different attributes.

Authority SHALL instead be explicitly assigned by attribute or capability.

A conceptual authority matrix is:

| Attribute / Concern            | Authority     |
| ------------------------------ | ------------- |
| Canonical product identity     | Control Plane |
| Canonical variant identity     | Control Plane |
| Medusa product ID              | Medusa        |
| ERP item/product ID            | iDempiere     |
| Payload content ID             | Payload       |
| Commerce variant structure     | Medusa        |
| Transactional sellability      | Medusa        |
| Commerce price                 | Medusa        |
| Promotion eligibility          | Medusa        |
| Cart eligibility               | Medusa        |
| Editorial title                | Payload       |
| Long-form description          | Payload       |
| Marketing media                | Payload       |
| SEO content                    | Payload       |
| Accounting classification      | iDempiere     |
| Cost valuation                 | iDempiere     |
| Enterprise inventory valuation | iDempiere     |
| ERP procurement data           | iDempiere     |
| Canonical mapping              | Control Plane |

This matrix MAY be refined by later ADRs.

---

# 16. No Universal Product Master Record

Baobab SHALL NOT create a giant universal Product table containing every field required by every engine.

Such a model would cause the canonical layer to absorb:

- commerce implementation details;
- CMS structures;
- ERP attributes;
- search fields;
- frontend presentation concerns.

The canonical model SHALL remain intentionally narrow.

---

# 17. Canonical Product Minimum

A canonical Product SHOULD contain only identity and cross-platform metadata required for governance.

Conceptually:

```text
CanonicalEntity {
    canonical_entity_id
    entity_type
    lifecycle_state
    created_at
    updated_at
}
```

Additional canonical classification MAY be added only where genuinely cross-platform.

Engine-specific attributes SHALL remain with their engines.

---

# 18. Product Creation Authority

The architecture SHALL permit different product origination workflows.

For example:

```text
ERP-originated product
```

or:

```text
Commerce-originated product
```

or:

```text
Product onboarding workflow
      │
      ▼
Canonical registration
      │
      ├── ERP projection
      ├── Commerce projection
      └── Content projection
```

The platform SHALL NOT permanently assume that one engine always creates the product first unless a later business-governance ADR establishes that policy.

---

# 19. Product Onboarding

A production-grade product onboarding workflow SHOULD conceptually include:

```text
Business Product Approved
        │
        ▼
Canonical Product Created
        │
        ├── Canonical Variant(s)
        │
        ▼
Required Engine Projections
        │
        ├── Medusa
        ├── iDempiere
        └── Payload
        │
        ▼
Mappings Registered
        │
        ▼
Validation
        │
        ▼
Market Eligibility
        │
        ▼
Publication
```

Not every product requires every engine projection.

---

# 20. Projection

An engine representation SHALL be treated as a projection of the canonical business concept into that engine's bounded context.

For example:

```text
Canonical Product
      │
      ▼
Commerce Projection
      │
      ▼
Medusa Product
```

Projection does not imply read-only state.

The engine remains authoritative for attributes assigned to its bounded context.

---

# 21. Product Lifecycle

Canonical lifecycle and engine lifecycle SHALL remain distinguishable.

For example:

```text
Canonical Product = ACTIVE
```

does not necessarily imply:

```text
Medusa Product = published in every Market
```

The Product may be active as a business concept while unavailable in a particular Market.

---

# 22. Commerce Publication State

Commerce publication SHALL be governed by Medusa and applicable Market configuration.

Potential commerce states MAY include:

```text
draft
published
unpublished
archived
```

or the native Medusa lifecycle.

The Control Plane SHALL NOT attempt to duplicate all engine-native publication semantics.

---

# 23. Editorial Publication State

Payload publication state SHALL remain separate.

Therefore a product MAY be:

```text
Commerce: sellable
Payload: editorial content unpublished
```

or:

```text
Commerce: unavailable
Payload: article retained for historical/reference purposes
```

The Digital Estate SHALL determine how such combinations are presented.

---

# 24. ERP Lifecycle State

Likewise, iDempiere may represent statuses such as active/inactive independently.

Cross-engine lifecycle rules SHALL be defined explicitly.

One engine SHALL NOT infer another's lifecycle solely from local state.

---

# 25. Product Deactivation

Product deactivation SHALL distinguish:

```text
stop new commerce
```

from:

```text
delete historical product information
```

Historical orders MUST remain interpretable.

A product referenced by financial or legal records SHALL NOT be physically erased merely because it is no longer sold.

---

# 26. Product Deletion

Hard deletion of cross-engine Product representations SHOULD be exceptional.

Prefer:

```text
inactive
archived
retired
```

where legal, historical or accounting references exist.

Canonical IDs SHALL NOT be recycled.

---

# 27. Catalogue Definition

A Catalogue is a governed collection or projection of products available within a particular commercial context.

A Catalogue SHALL NOT be synonymous with the global set of Products.

Conceptually:

```text
Canonical Products
       │
       ▼
Eligibility Rules
       │
       ▼
Catalogue
```

---

# 28. Catalogue Dimensions

Catalogue membership MAY depend upon:

```text
Tenant
Market
Sales Channel
Legal Seller
Customer Segment
B2B Organisation
Product Status
Variant Status
Inventory Availability
Commercial Agreement
```

Not all dimensions SHALL be required in every use case.

---

# 29. Market Catalogue

A Market MAY expose a Market-specific catalogue.

Example:

```text
Canonical Product Set
      │
      ├── ZA Market Catalogue
      ├── UG Market Catalogue
      └── KE Market Catalogue
```

The same canonical Product MAY therefore be sellable in one Market and unavailable in another.

---

# 30. Sales Channel Catalogue

Sales Channel eligibility SHALL be independent of Market eligibility.

Example:

```text
Product
   │
   ├── ZA Market ✓
   │      ├── Web ✓
   │      ├── Mobile ✓
   │      └── Marketplace ✗
```

This distinction SHALL remain explicit.

---

# 31. B2B Catalogue

B2B commerce MAY require organisation-specific catalogues.

For example:

```text
South Africa B2B Market
       │
       ├── General Wholesale Catalogue
       ├── Distributor Catalogue
       └── Contract Customer Catalogue
```

Customer Organisation A MAY therefore see a different catalogue from Customer Organisation B.

---

# 32. B2B Catalogue Confidentiality

Restricted catalogue membership MAY itself be confidential commercial information.

A customer MUST NOT be able to discover products restricted exclusively to another B2B organisation unless business policy explicitly permits it.

Search, API access and direct identifier lookup SHALL respect these restrictions.

---

# 33. Product Availability

The architecture SHALL distinguish:

```text
Product exists
Product is active
Product is published
Product is eligible in Market
Product is eligible in Sales Channel
Variant is eligible
Inventory is available
Customer is authorised
```

These conditions SHALL NOT be represented by one overloaded boolean such as:

```text
available = true
```

---

# 34. Sellability

Final sellability SHALL be computed from applicable commerce rules.

Conceptually:

```text
Active Product
+
Active Variant
+
Market Eligibility
+
Sales Channel Eligibility
+
Customer Eligibility
+
Price
+
Inventory/Backorder Policy
=
Sellable
```

The exact decision MAY vary by business model.

---

# 35. Product Options

Medusa-native product options SHALL remain commerce-native structures.

Examples:

```text
Size
Colour
Pack Size
Grade
Format
```

Where an option has cross-engine meaning, a canonical mapping MAY be introduced.

Canonicalisation SHALL NOT be mandatory merely because Medusa has an option field.

---

# 36. Product Attributes

Attributes SHALL be classified according to ownership.

Examples:

```text
commerce attribute
ERP attribute
editorial attribute
canonical classification
```

The same semantic attribute SHOULD NOT have multiple authorities without an explicit conflict-resolution rule.

---

# 37. Shared Attributes

Where an attribute is required by several engines, the architecture SHALL designate one authoritative source.

For example:

```text
Net Weight
```

may be operationally required by:

- commerce;
- ERP;
- fulfilment;
- content.

A later domain contract SHALL decide its authority.

Consumers SHALL maintain projections rather than competing masters.

---

# 38. Units of Measure

Units of measure SHALL be explicit where quantities cross engines.

Values SHALL be transferred as:

```text
quantity
unit
```

rather than relying upon implicit assumptions.

iDempiere MAY remain authoritative for enterprise UOM definitions where appropriate.

---

# 39. Physical Product and Service Product

The canonical Product model SHALL support more than physical stock.

Future products MAY include:

```text
physical goods
services
subscriptions
digital products
licenses
bookings
bundles
```

Canonical Product identity SHALL therefore avoid assumptions that every Product necessarily has physical inventory.

---

# 40. Bundles

A Bundle MAY be represented as a commercial Product composed of other Products or Variants.

Bundle semantics SHALL be defined by the Commerce Engine where primarily commercial.

If ERP requires corresponding structures, they SHALL be separately mapped.

---

# 41. Product Kits and ERP BOMs

Commerce bundles SHALL NOT automatically be equated with iDempiere bills of materials.

A commerce bundle and ERP BOM may have different operational semantics.

Mappings SHALL be explicit when the concepts correspond.

---

# 42. Product Categories

Commerce categories SHALL remain Medusa commerce structures unless specifically canonicalised.

Payload editorial categories MAY differ from Commerce categories.

ERP product categories MAY also differ.

Therefore:

```text
Medusa Category
!=
Payload Editorial Taxonomy
!=
iDempiere Product Category
```

unless an explicit mapping establishes correspondence.

---

# 43. Canonical Classification

Where organisation-wide classification is genuinely required, a canonical classification model MAY be established.

It SHALL NOT be inferred merely from similarly named engine categories.

---

# 44. Product Media

Payload SHALL normally own rich editorial product media.

Medusa MAY maintain transactional imagery or references where required by commerce clients.

If the same asset is consumed across engines, an asset identity/reference contract MAY be introduced.

Media binary duplication SHOULD be avoided where practical.

---

# 45. Product Description

A distinction SHALL be made between:

```text
transactional product description
```

and:

```text
editorial product description
```

Transactional descriptions may be persisted with orders for historical/legal interpretation.

Editorial descriptions remain CMS-owned.

---

# 46. SEO

SEO metadata SHALL be owned by Payload or the Digital Estate content layer.

Commerce product identity SHALL not be coupled to canonical URL structures.

A Product can remain the same canonical entity even if its public URL changes.

---

# 47. Digital Estate Composition

A Digital Estate SHALL compose product experience using canonical correlation.

Conceptually:

```text
Canonical Product
      │
      ├── Payload Content
      │
      └── Medusa Commerce Data
               │
               ▼
          Digital Estate
```

The frontend MAY query engines independently or through an approved experience/API composition layer.

---

# 48. Frontend Product Model

The frontend MAY create a view model combining:

```text
Editorial Content
+
Commerce Product
+
Price
+
Availability
+
Customer Context
```

This view model SHALL remain frontend/application-specific.

It SHALL NOT become a new platform system of record.

---

# 49. Product Search

Search MAY index representations from:

- Medusa;
- Payload;
- canonical metadata.

The search index SHALL remain a projection.

It SHALL NOT become authoritative for Product state.

---

# 50. Search Documents

Search documents SHOULD include stable canonical identity where cross-engine composition is required.

For example:

```text
canonical_product_id
```

This permits search results to resolve the corresponding commerce and editorial representations.

---

# 51. Product Mapping Scope

Product mappings SHALL use `MappingScope` where mappings vary by:

```text
EngineInstance
Market
Tenant
Context
```

For example, one canonical Product may have:

```text
Medusa Product A in Africa instance
Medusa Product B in Europe instance
```

Both may represent the same canonical Product.

---

# 52. Variant Mapping Scope

Variant mappings SHALL independently support scoped representation.

The existence of a Product mapping SHALL NOT imply that corresponding Variants use identical external identifiers across engines.

---

# 53. Cross-Region Product Projection

A canonical Product MAY have multiple Medusa projections.

Example:

```text
                Canonical Product
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
 Africa Medusa Product       EU Medusa Product
```

This SHALL be permitted where data residency, isolation or regional topology requires it.

---

# 54. Product Synchronisation

Cross-engine product synchronisation SHALL follow attribute authority.

The prohibited model is:

```text
copy complete Medusa product
      ↓
overwrite complete ERP product
      ↓
overwrite complete Payload product
```

Instead:

```text
Authoritative Attribute Change
          │
          ▼
Canonical Event
          │
          ▼
Interested Projection
```

SHALL be preferred.

---

# 55. Eventual Consistency

Product projections MAY be temporarily inconsistent across engines.

For example:

```text
ERP weight updated
      │
      ▼
event pending
      │
      ▼
Medusa still has previous weight
```

The architecture SHALL define acceptable propagation and reconciliation behaviour.

Distributed transactions across engines SHALL NOT be introduced merely to eliminate short-lived projection lag.

---

# 56. Product Events

Canonical Product events SHOULD describe business facts.

Potential events include:

```text
product.created
product.activated
product.updated
product.retired

product_variant.created
product_variant.updated
product_variant.retired
```

The authoritative producer SHALL depend upon the attribute/lifecycle ownership contract.

---

# 57. Commerce Product Events

Medusa MAY additionally publish commerce-specific facts:

```text
commerce.product.created
commerce.product.updated
commerce.product.published
commerce.product.unpublished

commerce.variant.created
commerce.variant.updated
```

These events describe Commerce Engine state.

They SHALL NOT necessarily redefine canonical Product authority.

---

# 58. Event Payload Design

Product events SHOULD carry:

```text
canonical_product_id
external_reference
event version
context where applicable
changed attributes or resulting projection
```

Payloads SHALL avoid reproducing complete engine database records unnecessarily.

---

# 59. Change Provenance

Where an attribute is synchronised across engines, the receiving projection SHOULD retain enough information to determine:

```text
source
source version
effective time
synchronised time
```

where required for reconciliation.

---

# 60. Conflict Resolution

Two engines MUST NOT be permitted to independently author the same governed attribute without a defined resolution policy.

When conflicting changes occur:

```text
authoritative source wins
```

unless the domain contract explicitly defines merge behaviour.

Timestamp-last-write-wins SHALL NOT be the default conflict-resolution strategy.

---

# 61. Product Provisioning

Creating a Commerce representation SHOULD be idempotent.

Conceptually:

```text
Canonical Product
       │
       ▼
Provision Commerce Projection
       │
       ▼
Check Existing Mapping
       │
       ├── exists → reconcile/update
       │
       └── missing → create
                         │
                         ▼
                    Register Mapping
```

Duplicate provisioning commands MUST NOT create duplicate products.

---

# 62. Variant Provisioning

Variant creation SHALL use the same idempotent pattern.

Stable canonical variant identity SHOULD be supplied to the provisioning workflow.

---

# 63. Product Reconciliation

The platform SHALL support detection of discrepancies including:

```text
canonical product missing Medusa projection
Medusa product missing canonical mapping
canonical variant missing ERP mapping
Payload content mapped to wrong product
orphan external reference
duplicate projection
stale governed attribute
```

---

# 64. Orphan Detection

An engine record claiming canonical association with a missing canonical entity SHALL be treated as potentially orphaned.

Operations tooling SHALL support investigation and repair.

---

# 65. Duplicate Detection

Provisioning SHALL attempt to prevent multiple engine representations being unintentionally registered for the same scoped canonical entity.

Where multiplicity is valid, MappingScope SHALL make it explicit.

---

# 66. Product Merge

Canonical Product merge is a destructive identity operation and SHALL require explicit governance.

A merge MUST consider:

- Medusa references;
- ERP references;
- Payload references;
- historical orders;
- inventory;
- prices;
- analytics;
- search indexes.

Automatic duplicate merging SHALL NOT occur without an approved rule.

---

# 67. Product Split

Likewise, splitting one canonical Product into multiple Products SHALL be treated as an explicit lifecycle/migration operation.

Historical transactions MUST retain their original interpretation.

---

# 68. Historical Order Lines

Order line items SHALL preserve sufficient product information to remain understandable if the Product later changes.

Order history SHALL not depend solely on resolving current Product state.

A historical line SHOULD retain, where relevant:

```text
product reference
variant reference
SKU
description snapshot
quantity
price
currency
tax
```

---

# 69. Product Rename

Renaming editorial or commerce display information SHALL not change canonical Product identity.

URLs and titles are mutable attributes.

Identity is not.

---

# 70. SKU Change

If business policy permits SKU changes, canonical identity SHALL remain stable.

Mappings and historical records SHALL preserve necessary old identifiers.

---

# 71. ERP Product Number Change

An iDempiere product identifier or business code change SHALL not force a canonical Product identity change unless the underlying business concept has actually changed.

---

# 72. Market Eligibility

Product Market eligibility SHALL be a commerce relationship.

Conceptually:

```text
Product
   │
   ├── Market A ✓
   ├── Market B ✓
   └── Market C ✗
```

Eligibility MAY be represented using Medusa-native constructs.

Canonical Product identity remains independent.

---

# 73. Legal Seller Eligibility

A Product MAY also be restricted to particular legal sellers.

This relationship SHALL be resolved through Market/commercial configuration.

The existence of the Product globally does not imply every seller may offer it.

---

# 74. Regulatory Product Restrictions

Some products MAY be restricted by:

- jurisdiction;
- customer type;
- age;
- certification;
- licensing;
- export rules.

The architecture SHALL support policy-based restriction.

Such restrictions MUST NOT be reduced to simple frontend hiding.

---

# 75. B2B Product Entitlements

A B2B customer organisation MAY have:

```text
allowed products
restricted products
contract products
exclusive products
```

Entitlement SHALL be enforced server-side.

---

# 76. Product and Inventory

Product identity SHALL remain separate from inventory state.

A Product may exist with:

```text
inventory = 0
```

without ceasing to exist.

Likewise, non-stock Products may have no inventory concept.

---

# 77. Variant and Inventory

Physical inventory SHOULD normally bind to the appropriate Variant or stock-managed unit rather than the abstract Product where variant-level stock exists.

The exact inventory authority SHALL be governed by the inventory ADR.

---

# 78. Product and Price

Product identity SHALL remain separate from price.

A Product can exist in multiple Markets with different prices.

Therefore:

```text
Product != Price
```

Price SHALL be modelled as a commercial relationship/context.

---

# 79. Variant and Price

Pricing MAY occur at Variant level.

Where Medusa requires variant-level pricing, canonical Product identity SHALL not be distorted to accommodate it.

---

# 80. Product and Tax

Tax classification MAY exist at Product or Variant level depending on domain requirements.

Commerce and ERP representations MAY use different native tax identifiers.

Canonical mapping SHALL relate them where necessary.

---

# 81. Product and Fulfilment

Fulfilment characteristics MAY include:

```text
weight
dimensions
hazard classification
temperature requirements
shipping class
```

Authority for each attribute SHALL be explicit.

These SHALL not automatically become CMS-owned simply because they are shown to customers.

---

# 82. Product and Procurement

Procurement characteristics belong primarily to ERP.

Examples:

```text
preferred supplier
reorder quantity
procurement lead time
purchase cost
```

These SHALL not be pushed into Medusa unless commerce requires an approved projection.

---

# 83. Product and Cost

Internal cost SHALL remain ERP/financial information.

Commerce SHOULD NOT expose internal cost through Store APIs or customer-facing events.

Cost and sales price SHALL remain conceptually distinct.

---

# 84. Confidential Product Attributes

Some Product data MAY be confidential, particularly in B2B scenarios.

Examples:

```text
internal cost
supplier details
margin
contract restrictions
customer-specific terms
```

API schemas SHALL expose only fields appropriate to the caller.

---

# 85. Administrative API

Commerce administration MAY manipulate Medusa-owned Product attributes.

It SHALL NOT automatically permit modification of ERP- or CMS-authoritative attributes.

Where a unified administrative experience is introduced, writes SHALL be routed to the proper authority.

---

# 86. Unified Product Administration

A future Baobab administrative application MAY present one unified Product view.

Such a UI SHALL be understood as composition:

```text
Canonical identity
+
Commerce attributes
+
ERP attributes
+
CMS attributes
```

not as evidence of a universal Product database.

---

# 87. Import

Bulk Product import SHALL respect authority.

An import targeting Commerce SHALL not silently overwrite ERP-owned attributes.

Imports SHOULD identify:

```text
target authority
canonical identity
mapping scope
```

where applicable.

---

# 88. Export

Exports SHALL distinguish:

```text
commerce product export
ERP product export
editorial product export
canonical mapping export
```

No single export SHALL be assumed to contain the complete truth of a Product unless explicitly designed for that purpose.

---

# 89. API Design

Commerce APIs SHALL expose Medusa-owned Product capabilities.

Cross-platform API consumers requiring canonical correlation SHOULD receive the canonical Product/Variant reference where authorised.

Internal Medusa details SHALL not be unnecessarily exposed.

---

# 90. Digital Estate Product Requests

A Digital Estate SHOULD be able to request a Product within explicit Context:

```text
Digital Estate
      │
      ▼
Context
      │
      ▼
Canonical/Commerce Product Reference
      │
      ▼
Commerce Projection
```

Market and customer eligibility SHALL be validated before returning restricted commerce information.

---

# 91. Cache Keys

Product caches MUST include all dimensions relevant to the cached representation.

For example, a commerce product detail cache MAY require:

```text
Market
Locale
Sales Channel
Customer Segment
```

depending upon content.

Canonical Product ID alone may be insufficient.

---

# 92. Search Cache

Search caching SHALL likewise respect Catalogue and Market eligibility.

A cached unrestricted result set MUST NOT be reused for restricted B2B customers.

---

# 93. Product Metrics

Operational metrics MAY use product identifiers carefully.

Canonical Product IDs MAY aid aggregation across engines.

High-cardinality Product IDs SHOULD NOT be used indiscriminately as infrastructure metric labels.

---

# 94. Audit

Material Product administration SHOULD record:

```text
actor
authority
product
change
context
timestamp
correlation ID
```

where appropriate.

The audit trail SHOULD indicate which engine accepted the authoritative change.

---

# 95. Security

Knowledge of a canonical Product or Medusa Product ID SHALL NOT bypass:

- Market eligibility;
- Sales Channel eligibility;
- B2B entitlement;
- Product status;
- authorization.

Direct identifier access SHALL enforce the same restrictions as search and catalogue browsing.

---

# 96. Product ID Enumeration

APIs SHALL NOT assume obscurity of identifiers as a security control.

Even if an attacker guesses or obtains another Product ID, authorization and Catalogue rules SHALL still apply.

---

# 97. Rejected Alternative: Medusa as Universal Product Master

**Rejected.**

Medusa owns commerce representation but does not own:

- ERP costing;
- procurement;
- accounting classification;
- editorial content;
- canonical identity.

Making it universal authority would violate engine boundaries.

---

# 98. Rejected Alternative: iDempiere as Universal Product Master

**Rejected.**

ERP is not the appropriate authority for:

- editorial content;
- commerce publication;
- sales-channel behaviour;
- customer-specific catalogue visibility;
- commerce merchandising.

ERP may originate many product facts without owning every product concern.

---

# 99. Rejected Alternative: Payload as Universal Product Master

**Rejected.**

A CMS is not appropriate authority for:

- transactional price;
- inventory;
- accounting;
- order eligibility;
- ERP operations.

---

# 100. Rejected Alternative: Control Plane as Product Master

**Rejected.**

The Control Plane owns platform identity and mappings, not product-domain operational data.

---

# 101. Rejected Alternative: Shared Product Database

**Rejected absolutely.**

A shared Product database across Medusa, Payload and iDempiere would couple:

- persistence;
- upgrades;
- schemas;
- ownership;
- availability.

The engines SHALL exchange contracts rather than database rows.

---

# 102. Rejected Alternative: Use SKU as Canonical ID

**Rejected.**

SKUs may:

- change;
- collide across organisational scopes;
- be reformatted;
- have business meaning;
- differ between systems.

Canonical identity requires a stable opaque identifier.

---

# 103. Rejected Alternative: Synchronise Entire Product Objects

**Rejected.**

Full-object synchronisation produces conflicting ownership and unnecessary coupling.

Only governed attributes SHALL be projected.

---

# 104. Consequences

### Positive

The decision provides:

- stable Product identity;
- independent engine evolution;
- explicit ownership;
- clean CMS/commerce/ERP separation;
- regional Product projections;
- safe multi-Market catalogues;
- support for B2B restricted catalogues;
- replaceable engines;
- controlled synchronisation;
- improved reconciliation.

### Negative

The architecture introduces:

- canonical mapping;
- multiple Product representations;
- projection workflows;
- event propagation;
- reconciliation;
- explicit authority governance.

This complexity is accepted because the underlying domains genuinely require different representations.

---

# 105. Architectural Invariants

**PRD-COM-001**  
Canonical Product identity SHALL be distinct from Medusa Product identity.

**PRD-COM-002**  
Canonical Variant identity SHALL be distinct from Medusa Variant identity.

**PRD-COM-003**  
Medusa SHALL own commerce Product attributes.

**PRD-COM-004**  
Payload SHALL own editorial Product content.

**PRD-COM-005**  
iDempiere SHALL own ERP Product attributes.

**PRD-COM-006**  
Control Plane SHALL own canonical identity and mapping.

**PRD-COM-007**  
No engine SHALL become universal Product authority merely because it contains a Product record.

**PRD-COM-008**  
A Product SHALL remain distinct from its price.

**PRD-COM-009**  
A Product SHALL remain distinct from inventory.

**PRD-COM-010**  
A Product SHALL remain distinct from Catalogue membership.

**PRD-COM-011**  
Catalogue eligibility SHALL be server-side enforceable.

**PRD-COM-012**  
B2B restricted catalogues SHALL prevent cross-organisation discovery.

**PRD-COM-013**  
SKU SHALL NOT be the canonical Product identifier.

**PRD-COM-014**  
Engine-native identifiers SHALL remain external references.

**PRD-COM-015**  
Cross-engine synchronisation SHALL follow attribute authority.

**PRD-COM-016**  
Whole-object overwrite synchronisation SHALL NOT be the default pattern.

**PRD-COM-017**  
Canonical Product identity SHALL survive EngineInstance migration.

**PRD-COM-018**  
Historical order lines SHALL retain sufficient Product snapshot information.

**PRD-COM-019**  
Hard deletion SHALL NOT destroy required transaction history.

**PRD-COM-020**  
Duplicate provisioning SHALL NOT create duplicate Product projections.

**PRD-COM-021**  
Canonical mappings SHALL be reconcilable.

**PRD-COM-022**  
Product search SHALL enforce Market and Catalogue visibility.

**PRD-COM-023**  
Direct identifier lookup SHALL enforce the same visibility constraints.

**PRD-COM-024**  
Internal cost SHALL not be exposed through customer-facing commerce interfaces.

**PRD-COM-025**  
A unified Product UI SHALL remain a composed view rather than a new system of record.

---

# 106. Required Conformance Tests

A conforming implementation SHALL prove:

```text
1. One canonical Product can map to Medusa, Payload and iDempiere.

2. Medusa, Payload and iDempiere may retain different native IDs.

3. Changing a Payload document ID does not change canonical Product identity.

4. Moving a Product to another Medusa EngineInstance does not change canonical identity.

5. Product and Variant mappings remain distinguishable.

6. Duplicate Product provisioning is idempotent.

7. Duplicate Variant provisioning is idempotent.

8. A Product unavailable in Market A cannot be purchased in Market A.

9. The same Product can remain available in Market B.

10. A Product excluded from a Sales Channel cannot be purchased through that channel.

11. Customer Organisation A cannot discover Organisation B's exclusive Product.

12. Direct Product ID lookup cannot bypass Catalogue restrictions.

13. Search cannot bypass Catalogue restrictions.

14. Medusa price changes do not overwrite Payload editorial content.

15. Payload content changes do not overwrite Medusa price.

16. ERP costing changes are not exposed to Store APIs.

17. Historical orders remain readable after Product retirement.

18. Product rename does not alter canonical identity.

19. SKU change does not alter canonical identity where policy permits SKU changes.

20. A missing mapping becomes visible to reconciliation.

21. An orphan Medusa Product can be detected.

22. A duplicate scoped mapping can be detected.

23. Regional Medusa projections can map to the same canonical Product.

24. One engine cannot overwrite another engine's authoritative attributes through general synchronisation.

25. Product events carry sufficient canonical correlation.
```

---

# 107. Implementation Implications

This ADR requires subsequent specifications and ADRs covering:

```text
canonical Product mapping
canonical Variant mapping
Product provisioning
Variant provisioning
attribute authority
Catalogue eligibility
B2B catalogue entitlement
Product events
Product reconciliation
regional Product projection
Product lifecycle
SKU governance
units of measure
search projection
historical Product snapshots
```

The physical persistence design SHALL follow these semantics.

---

# 108. Decision Outcome

Baobab adopts a federated Product architecture:

```text
                         CANONICAL PRODUCT
                                │
                 Identity + Cross-Engine Mapping
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
       MEDUSAJS              IDEMPIERE           PAYLOAD CMS
       Commerce                 ERP                Content
            │                   │                   │
            │                   │                   │
     sellability             costing            editorial
     variants                inventory           media
     catalogue               accounting          SEO
     commerce price          procurement         localisation
            │                   │                   │
            └───────────────────┼───────────────────┘
                                │
                                ▼
                         DIGITAL ESTATE
                         Composed Experience
```

The central rule is:

> **Canonical Product identity establishes sameness across the platform; it does not establish universal attribute ownership.**

The second rule is:

> **Each engine owns only the Product attributes required by its bounded context.**

The third rule is:

> **Catalogue membership, sellability, price, inventory and editorial publication are separate concerns and shall not be collapsed into a single Product status.**

And the integration rule is:

> **Product representations are correlated through canonical mappings and synchronised according to explicit attribute authority—not by sharing primary keys, databases or whole Product objects.**

This model allows Baobab to operate a sophisticated headless commerce architecture while preserving MedusaJS, iDempiere and Payload CMS as independently evolving specialised engines.
