# ADR-0024 — Product Regulatory Classification, Market Eligibility and Tradeability Model

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Contracts:** `nabhold/shared`  
**Context/Provider Resolution:** `nabhold/baobab-cp`  
**ERP Consumer:** `nabhold/baobab-erp`  
**Compliance Architecture:** ADR-0021  
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model
- ADR-BCP-014 — Canonical Counterparty Identity, Roles and Relationships Model
- ADR-0011 — Product, Variant, Catalogue and Canonical Product Authority
- ADR-0013 — Inventory, Availability, Reservation and ERP Stock Authority
- ADR-0018 — Tax, Jurisdiction and Legal Transaction Context
- ADR-0019 — B2B Procurement and Supplier Commercial Workflow
- ADR-0020 — Landed Cost, Margin and Commercial Price Resolution
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture
- ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction
- ADR-0023 — Supplier Identity, Qualification and Supplier Master Ownership

---

# 1. Context

Baobab operates across multiple markets and product categories.

ZuriBeans may, for example:

```text id="3egh6e"
source coffee in Uganda
sell coffee in Uganda
export coffee to South Africa

source wine in South Africa
sell wine in South Africa
export wine to Uganda

source vanilla in Uganda
sell/export vanilla to other markets
```

Future tenants may trade entirely different categories.

A product being present in the Baobab catalogue does not establish that it is legally or operationally eligible for every transaction.

The architecture must distinguish:

```text id="4r3gzh"
Product Exists
       ≠
Product Listed
       ≠
Product Offered
       ≠
Product Qualified
       ≠
Product Importable
       ≠
Product Exportable
       ≠
Product Sellable
       ≠
Product Tradeable
```

---

# 2. Decision

Baobab SHALL establish a canonical, effective-dated and jurisdiction-aware product regulatory model that determines whether a product may participate in a particular commercial or trade context.

The governing principle is:

> **Commercial catalogue presence does not establish regulatory eligibility. Product tradeability SHALL be resolved from product identity, classification, origin, jurisdiction, transaction context, effective date, evidence and applicable regulatory-provider decisions.**

The architecture SHALL follow:

```text id="clafhl"
Canonical Product
       │
       ▼
Regulatory Classification
       │
       ▼
Market Requirements
       │
       ▼
Product Eligibility
       │
       ▼
Trade-Lane Eligibility
       │
       ▼
Transaction Assessment
       │
       ▼
ALLOW / REVIEW / BLOCK
```

---

# 3. Product Identity vs Regulatory Identity

ADR-0011 remains authoritative for canonical product/catalogue identity.

ADR-0024 adds regulatory dimensions.

Therefore:

```text id="eup0h7"
CanonicalProduct
       │
       ├── Commercial Projection
       └── Regulatory Profile
```

---

# 4. Regulatory Profile

Conceptually:

```text id="rgdx5a"
ProductRegulatoryProfile
├── canonical_product_id
├── classifications[]
├── origin_requirements[]
├── market_requirements[]
├── licences[]
├── certificates[]
├── restrictions[]
├── evidence[]
├── effective_period
└── provenance
```

This SHALL NOT replace the canonical product.

---

# 5. Catalogue Category Is Not Regulatory Classification

This is prohibited:

```text id="2f18vg"
Catalogue Category
      ↓
assume tariff classification
```

For example:

```text id="vpm42n"
Beverages
Coffee
Wine
Agriculture
```

are commercial/category concepts.

They are not necessarily customs or regulatory classifications.

---

# 6. Regulatory Classification

A product MAY have multiple classifications depending on:

```text id="iz1jdl"
classification system
jurisdiction
product characteristics
processing state
origin
effective date
```

---

# 7. Classification Model

Conceptually:

```text id="7tqdzp"
ProductClassification
├── canonical_product_id
├── classification_system
├── code
├── description
├── jurisdiction
├── source
├── authority
├── confidence/status
├── effective_from
├── effective_to?
└── evidence_reference?
```

---

# 8. Classification Systems

The architecture SHALL support extensible systems such as:

```text id="d0ev9a"
HS
national tariff extensions
commodity classifications
food classifications
dangerous-goods classifications
phytosanitary classifications
other regulatory schemes
```

Baobab SHALL NOT assume one classification system solves all regulatory questions.

---

# 9. HS Code Is Not Universal Regulatory Identity

Even where Harmonized System classifications are used:

```text id="1rh5d4"
HS classification
≠
complete regulatory eligibility
```

A tariff classification may help determine customs treatment while other regulations determine:

```text id="9rb2v3"
food safety
labelling
licensing
sanitary controls
phytosanitary controls
product standards
import permissions
```

---

# 10. Classification Source

Every authoritative classification SHALL identify its source.

Possible sources include:

```text id="brq4je"
customs authority
regulatory authority
specialist provider
customs broker
approved internal classification
binding ruling
verified government dataset
```

---

# 11. Classification Provenance

Classification SHALL retain:

```text id="ab3q0l"
who determined it
when
under which rules
for which jurisdiction
using what evidence
```

---

# 12. Effective Dating

Classification SHALL be effective-dated.

A classification valid in 2026 SHALL NOT automatically be assumed valid indefinitely.

---

# 13. Historical Reproducibility

Baobab SHALL be able to answer:

> What classification and eligibility decision was used when this transaction occurred?

This is mandatory for audit and reconciliation.

---

# 14. Classification Confidence

Where classification is not authoritative, status SHOULD distinguish:

```text id="cwnjmh"
PROPOSED
UNDER_REVIEW
VERIFIED
AUTHORITATIVE
DISPUTED
EXPIRED
```

---

# 15. AI Classification

AI MAY suggest classification.

AI SHALL NOT silently create authoritative regulatory classification.

Flow:

```text id="onp8xe"
Product
   ↓
AI Suggestion
   ↓
PROPOSED
   ↓
Provider / Human Verification
   ↓
VERIFIED
```

---

# 16. Product Characteristics

Classification MAY depend on characteristics such as:

```text id="8blq9p"
composition
processing level
material
intended use
alcohol content
packaging
weight
form
species
origin
```

The architecture SHALL permit structured regulatory attributes.

---

# 17. No Product-Specific Core Logic

Generic Trade code SHALL NOT contain logic such as:

```text id="7ughhk"
if product == "coffee":
    hs_code = ...
```

or:

```text id="2d38xe"
if product == "wine":
    require_certificate(...)
```

These belong in governed data, policy or provider determinations.

---

# 18. Market Eligibility

Product eligibility SHALL be contextual.

Conceptually:

```text id="suh1o6"
ProductMarketEligibility
├── product
├── market
├── legal_entity?
├── transaction_type
├── eligibility
├── conditions[]
├── requirements[]
├── effective_period
├── provider_decision?
└── evidence[]
```

---

# 19. Eligibility States

Canonical states SHOULD include:

```text id="z4w4mw"
NOT_EVALUATED
PENDING
ELIGIBLE
ELIGIBLE_WITH_CONDITIONS
REVIEW_REQUIRED
INELIGIBLE
SUSPENDED
EXPIRED
ERROR
```

---

# 20. Eligibility Is Directional

The fact that a product may be:

```text id="2jqdtv"
exported from Uganda
```

does not establish that it may be:

```text id="n8n8ro"
imported into South Africa.
```

Both sides SHALL be assessed.

---

# 21. Export Eligibility

Conceptually:

```text id="9vksj3"
Product
+
Origin Market
+
Seller / Exporter
+
Product Origin
+
Transaction Date
        ↓
Export Eligibility
```

---

# 22. Import Eligibility

Conceptually:

```text id="w7iv5o"
Product
+
Destination Market
+
Buyer / Importer
+
Product Origin
+
Transaction Date
        ↓
Import Eligibility
```

---

# 23. Trade-Lane Eligibility

Full cross-border tradeability requires composition:

```text id="zwvrk8"
Export Eligibility
        +
Transport / Handling Eligibility
        +
Import Eligibility
        +
Counterparty Compliance
        +
Required Evidence
        ↓
Trade-Lane Eligibility
```

---

# 24. Active Trade Lane Does Not Mean Product Eligible

ADR-BCP-011 may establish:

```text id="ewvhyj"
UG → ZA = ACTIVE
```

This does NOT mean:

```text id="lvcs8o"
every product may travel UG → ZA.
```

---

# 25. Product Subscription Does Not Mean Eligibility

Likewise:

```text id="6zkwas"
Tenant subscribes to product
```

does not imply:

```text id="ryu4ae"
product legally sellable in all tenant markets.
```

---

# 26. Market Assortment

The commercial model remains:

```text id="c56ryb"
Canonical Product
       ↓
Market Assortment
       ↓
Commercial Offer
```

Regulatory eligibility SHALL gate that chain where mandatory.

---

# 27. Commercial Offer Gate

Before an offer becomes active:

```text id="jpywxf"
Product
   ↓
Market Eligibility
   ↓
Commercial Offer
```

Policy MAY require:

```text id="rjqv8i"
ELIGIBLE
```

or:

```text id="5h2h60"
ELIGIBLE_WITH_CONDITIONS
```

---

# 28. Inventory Does Not Mean Sellable

A product may physically exist in a warehouse while regulatory status is:

```text id="5e7rx3"
HELD
SUSPENDED
REVIEW_REQUIRED
```

Therefore:

```text id="5n8nkm"
On Hand
≠
Available to Promise
```

---

# 29. Inventory Regulatory Hold

ADR-BCP-013 inventory SHALL support regulatory blocking.

Example:

```text id="tlgr29"
Inventory Position
    │
    ├── quantity_on_hand = 1000
    ├── regulatory_hold = 1000
    └── available = 0
```

---

# 30. Quality vs Regulatory Hold

These SHALL remain distinguishable:

```text id="3wxycb"
QUALITY_HOLD
CUSTOMS_HOLD
REGULATORY_HOLD
COMMERCIAL_HOLD
```

---

# 31. Product Origin

Product origin SHALL be first-class where regulation requires it.

Origin SHALL NOT be inferred merely from:

```text id="fssqen"
supplier address
warehouse location
seller country
```

---

# 32. Origin Dimensions

The system SHALL distinguish where relevant:

```text id="8jv43s"
country of production
country of manufacture
customs origin
country of dispatch
commercial origin
```

---

# 33. Batch/Lot Origin

Origin may differ by lot.

Example:

```text id="i88m30"
Canonical Coffee Product
├── Lot A → Uganda origin
└── Lot B → Ethiopia origin
```

Eligibility may therefore be inventory-lot specific.

---

# 34. Product Eligibility May Be Lot-Specific

A canonical product MAY be generally eligible while a particular lot is blocked due to:

```text id="5md58j"
origin
certificate
inspection
quality
regulatory event
```

---

# 35. Certificates

Product eligibility MAY require certificates such as:

```text id="4ly0qs"
certificate of origin
phytosanitary certificate
health certificate
quality certificate
conformity certificate
analysis certificate
inspection certificate
```

The architecture SHALL not hard-code these as universally mandatory.

---

# 36. Certificate Requirement

Requirement SHALL be resolved from context:

```text id="hdz09h"
Product
+
Origin
+
Destination
+
Transaction
+
Effective Date
        ↓
Required Evidence
```

---

# 37. Licence Requirements

A product may require licences associated with:

```text id="p6rlnu"
exporter
importer
seller
buyer
product
facility
shipment
```

These SHALL remain distinguishable.

---

# 38. Product Registration

Some jurisdictions/categories may require product registration before sale/import.

The model SHALL support:

```text id="4ny86n"
ProductRegistration
├── product
├── jurisdiction
├── holder
├── registration_number
├── status
├── effective_from
├── effective_to
└── evidence
```

---

# 39. Facility Registration

Regulation may depend on the producing or processing facility.

Therefore:

```text id="9x39bc"
Product Eligible
```

may require:

```text id="13dlj9"
Facility Eligible
```

The architecture SHALL allow this relationship.

---

# 40. Supplier Approval Does Not Mean Product Eligibility

ADR-0023 may determine:

```text id="e8djoh"
Supplier X = APPROVED
```

while ADR-0024 determines:

```text id="26n4ja"
Product Y from Supplier X = INELIGIBLE
```

Both states SHALL coexist.

---

# 41. Product Eligibility Does Not Mean Supplier Approved

Conversely:

```text id="8a4hwq"
Product Y = generally importable
```

does not mean:

```text id="94a5zu"
Supplier X = approved.
```

---

# 42. Counterparty Eligibility

ADR-0021 governs restricted-party and compliance checks.

Final transaction tradeability therefore composes:

```text id="xjs72j"
Product Eligibility
+
Counterparty Eligibility
+
Trade-Lane Eligibility
+
Evidence
```

---

# 43. Transaction Context

Regulatory decisions SHALL consume canonical transaction context.

At minimum where relevant:

```text id="txnn1g"
tenant
legal entity
seller
buyer
product
variant
lot
quantity
UOM
origin
destination
trade lane
transaction class
Incoterm
transport mode
value
currency
transaction date
```

---

# 44. Transaction Date Is Mandatory

Regulation changes.

Therefore eligibility SHALL be evaluated against an explicit effective date.

---

# 45. Quantity May Matter

Some restrictions may depend on:

```text id="9n2vmw"
quantity
value
weight
commercial vs sample use
```

The provider/policy architecture SHALL support such context.

---

# 46. Intended Use May Matter

The same product may receive different treatment depending on intended use.

The model SHOULD support intended-use attributes where required.

---

# 47. Packaging May Matter

Regulatory eligibility may depend on:

```text id="2dj83w"
bulk
retail packaged
container size
labelling
packaging material
```

These SHALL be available to regulatory providers when necessary.

---

# 48. Label Requirements

Market eligibility MAY include labelling requirements.

Examples of dimensions:

```text id="fsqdut"
language
ingredient declaration
origin statement
warning
lot identification
producer/importer details
```

Specific jurisdictional rules SHALL remain provider/policy data, not generic core code.

---

# 49. Market Eligibility vs Market Offer

If regulatory eligibility expires:

```text id="2ruw1w"
Commercial Offer
        ↓
SUSPEND / BLOCK
```

according to policy.

---

# 50. Existing Orders

Eligibility changes after order acceptance require governed treatment.

The platform SHALL NOT simply erase or silently cancel existing commitments.

---

# 51. Reassessment

Regulatory eligibility SHALL be reassessed when material context changes.

Triggers SHOULD include:

```text id="n55a5f"
product classification change
origin change
destination change
seller change
buyer change
quantity change
Incoterm change
regulatory update
certificate expiry
licence expiry
material shipment delay
```

---

# 52. Reassessment Does Not Mean Historical Rewrite

A new decision SHALL not overwrite the regulatory decision used historically.

---

# 53. Decision Snapshot

Each material transaction SHOULD retain:

```text id="fzhw6x"
RegulatoryDecisionSnapshot
├── product
├── classification
├── eligibility result
├── provider
├── rule/version
├── effective date
├── evidence references
└── assessed_at
```

---

# 54. Provider Architecture

ADR-0021 remains authoritative for provider resolution.

Flow:

```text id="c2dx4h"
Trade
  │
  ▼
Control Plane
  │
  ▼
CapabilityBinding
  │
  ▼
Regulatory Provider
  │
  ▼
Canonical Decision
```

---

# 55. Regulatory Capabilities

Potential capability family:

```text id="f4g45p"
product.classification.resolve
product.market-eligibility.resolve
product.export-eligibility.resolve
product.import-eligibility.resolve
product.requirements.resolve
product.registration.verify
product.certificate.verify
product.origin.verify
```

---

# 56. Different Providers by Capability

Baobab SHALL support:

```text id="gbpv0f"
Provider A → tariff classification
Provider B → food regulation
Provider C → certification verification
Provider D → manual specialist review
```

No universal provider SHALL be assumed.

---

# 57. Different Providers by Market

Uganda and South Africa MAY use different regulatory providers.

Future markets may use others.

Core Trade logic SHALL remain unchanged.

---

# 58. Manual Regulatory Provider

Where no automated provider exists:

```text id="ox1twz"
Manual Regulatory Review
```

MAY satisfy a capability if explicitly configured.

Manual SHALL mean:

```text id="a8myhc"
structured
assigned
evidence-backed
approved
auditable
```

not informal interpretation.

---

# 59. No Provider

If a mandatory capability has no provider:

```text id="ekvg7p"
Capability Required
       +
No Provider
       ↓
NOT_READY
```

The system SHALL NOT assume eligibility.

---

# 60. Provider Failure

A provider timeout or error SHALL produce:

```text id="g6g9qo"
ERROR / PENDING / REVIEW_REQUIRED
```

according to policy.

Never:

```text id="p1x3nt"
provider failed
→ product allowed
```

---

# 61. Fail Closed

Mandatory regulatory uncertainty SHALL fail closed.

---

# 62. Human Review

Ambiguous cases SHALL support:

```text id="cr0qnr"
ComplianceCase
      ↓
Regulatory Specialist
      ↓
Evidence
      ↓
Decision
```

---

# 63. Override

A human MAY resolve an ambiguity where legally permitted.

A human SHALL NOT override an explicit legal prohibition merely to complete an order.

---

# 64. Regulatory Restriction

Conceptually:

```text id="rmcdbm"
ProductRestriction
├── product
├── jurisdiction
├── restriction_type
├── scope
├── status
├── conditions
├── source
├── effective_from
└── effective_to?
```

---

# 65. Restriction Types

Generic categories MAY include:

```text id="s5j6hb"
PROHIBITED
RESTRICTED
LICENCE_REQUIRED
CERTIFICATE_REQUIRED
INSPECTION_REQUIRED
QUOTA_CONTROLLED
CONDITIONAL
```

---

# 66. Quotas

Architecture SHOULD permit future quota constraints without requiring immediate full quota-management implementation.

---

# 67. Product Market State

For operational simplicity, Trade MAY project:

```text id="lg6c3o"
ProductMarketState
├── product
├── market
├── procurement_allowed
├── sale_allowed
├── import_allowed
├── export_allowed
├── conditions
└── freshness
```

This SHALL be a derived projection, not the regulatory authority itself.

---

# 68. Procurement Gate

Before procurement:

```text id="c69pjc"
Supplier
+
Product
+
Origin
+
Receiving Market
        ↓
Procurement Eligibility
```

SHALL be resolved where mandatory.

---

# 69. RFQ Gate

Policy MAY allow RFQ before full eligibility while blocking award/commitment.

Example:

```text id="e8lchj"
RFQ = ALLOWED
PO = BLOCKED until compliance passes
```

---

# 70. Sales Quote Gate

Likewise:

```text id="4ecw18"
Quote
```

may be allowed conditionally while:

```text id="np5t4l"
Order Commitment
```

requires stronger eligibility.

---

# 71. Pre-Shipment Gate

A valid order SHALL NOT guarantee shipment permission.

Eligibility may need reassessment before dispatch.

---

# 72. Import Release Gate

A shipment that reaches the destination SHALL still obey customs/regulatory release.

---

# 73. Eligibility Gates

Suggested policy points:

```text id="66cpq6"
CATALOGUE_ACTIVATION
PROCUREMENT_RFQ
PROCUREMENT_AWARD
PURCHASE_COMMITMENT
SALES_QUOTE
SALES_ORDER
PRE_SHIPMENT
EXPORT
IMPORT
INVENTORY_RELEASE
SALE
```

Not all products/markets require every gate.

---

# 74. Commercial Availability

Commercial availability SHOULD compose:

```text id="5suvhr"
Inventory Available
+
Regulatory Eligible
+
Commercially Active
+
Customer Eligible
=
Sellable
```

---

# 75. ATP

Available-to-Promise SHALL not include regulatory-blocked inventory when regulation prohibits sale.

---

# 76. Cross-Border Flow

```text id="2qkxju"
Canonical Product
       │
       ▼
Classification
       │
       ▼
Origin Determination
       │
       ▼
Export Eligibility
       │
       ▼
Trade Lane
       │
       ▼
Import Eligibility
       │
       ▼
Required Evidence
       │
       ▼
Transaction Compliance
       │
       ▼
Shipment
```

---

# 77. Local Trade Flow

Local trade SHALL not unnecessarily invoke export/import controls.

```text id="47mvbt"
Product
   ↓
Local Market Eligibility
   ↓
Sale
```

---

# 78. Internal Cross-Market Flow

Intercompany or inter-branch status SHALL NOT bypass product regulation.

Physical cross-border movement remains subject to applicable requirements.

---

# 79. Internal Does Not Mean Exempt

Explicit invariant:

```text id="r0c5ik"
Internal corporate relationship
≠
regulatory exemption
```

---

# 80. Customs Classification

ADR-0021 consumes product regulatory classification for customs assessment.

ADR-0024 owns the canonical product classification/profile semantics.

---

# 81. Customs Value

ADR-0024 SHALL NOT determine customs value.

ADR-0021 governs customs valuation architecture.

---

# 82. Duty

ADR-0024 supplies classification context.

ADR-0021 determines customs/duty through appropriate provider architecture.

---

# 83. Tax

ADR-0018 governs tax.

Product regulatory classification MAY influence tax determination but SHALL NOT replace the tax engine/context.

---

# 84. Landed Cost

ADR-0020 consumes:

```text id="1vnhfl"
duties
fees
regulatory costs
inspection costs
```

where applicable.

ADR-0024 SHALL not calculate commercial margin.

---

# 85. Logistics

ADR-0022 consumes regulatory handling attributes.

Examples:

```text id="q6kmco"
temperature
dangerous-goods classification
restricted transport mode
inspection requirement
```

---

# 86. Supplier Integration

ADR-0023 supplier product capability SHALL reference canonical product.

Product capability alone does not establish regulatory eligibility.

---

# 87. ERP Integration

ERP MAY consume:

```text id="fqppbv"
product classification
tax category references
regulatory references
origin
landed-cost consequences
```

where needed.

ERP SHALL not independently invent Baobab canonical classifications.

---

# 88. Product Master Synchronisation

Classification changes SHALL propagate through governed canonical events.

---

# 89. Events

Canonical events SHOULD include:

```text id="8ejqvt"
product-classification.proposed
product-classification.verified
product-classification.changed
product-classification.expired

product-market-eligibility.assessed
product-market-eligibility.changed
product-market-eligibility.blocked

product-restriction.created
product-restriction.changed

product-registration.verified
product-registration.expired

product-regulatory-evidence.expired
```

---

# 90. Event Envelope

Events SHALL include:

```text id="0btj7v"
tenant where applicable
canonical_product_id
market
jurisdiction
trade_lane where relevant
correlation_id
causation_id
occurred_at
schema_version
```

---

# 91. Idempotency

Duplicate eligibility events SHALL NOT repeatedly:

```text id="jsh4x5"
suspend offer
release stock
block order
```

---

# 92. Out-of-Order Events

Consumers SHALL tolerate delayed regulatory events.

Effective date and version SHALL determine valid state.

---

# 93. Regulatory Cache

Eligibility decisions MAY be cached.

Cache SHALL include:

```text id="vbm2iw"
context key
provider
decision version
assessed_at
valid_until
```

---

# 94. Cache Invalidation

Invalidate when material context or underlying regulatory data changes.

---

# 95. Stale Decision

A stale regulatory decision SHALL not silently be treated as current where freshness is mandatory.

---

# 96. Reconciliation

Baobab SHALL reconcile:

```text id="bfw8pp"
Canonical Product
↕
Regulatory Classification

Regulatory Eligibility
↕
Active Market Offer

Regulatory Hold
↕
Inventory Availability

Customs Classification
↕
Transaction Classification Snapshot
```

---

# 97. Reconciliation States

Suggested:

```text id="x4s8a3"
MATCHED
PENDING
STALE
MISMATCH
MISSING
CONFLICT
UNRESOLVED
```

---

# 98. Audit

Audit SHALL capture:

```text id="7l80ut"
classification creation
classification verification
classification change
eligibility assessment
manual review
override
restriction
evidence expiry
offer suspension/release
inventory regulatory hold/release
```

---

# 99. Security

Only authorised users/services SHALL modify authoritative regulatory profiles.

---

# 100. Separation of Duties

Where appropriate:

```text id="42l07c"
classifier
≠
approver
```

for high-risk classifications.

---

# 101. Sensitive Regulatory Information

Certain licences, findings or regulatory evidence MAY require restricted access.

---

# 102. Observability

Recommended metrics:

```text id="egiwac"
product_classification_missing_total
product_classification_expired_total

product_eligibility_assessment_total
product_eligibility_blocked_total
product_eligibility_review_total

regulatory_provider_error_total
regulatory_provider_latency

regulatory_evidence_expiry_total

product_offer_regulatory_suspension_total

regulatory_reconciliation_mismatch_total
```

---

# 103. Alerts

Alert on:

- missing mandatory classification;
- expiring mandatory registration;
- expiring certificates;
- regulatory-provider outage;
- unresolved product eligibility;
- active offer with blocked eligibility;
- available inventory under mandatory regulatory hold;
- reconciliation mismatch.

---

# 104. ZuriBeans Scenario — Uganda Coffee → South Africa

```text id="uwqfe6"
Coffee Product
      ↓
Lot Origin = Uganda
      ↓
Classification
      ↓
UG Export Eligibility
      ↓
UG→ZA Trade Lane
      ↓
ZA Import Eligibility
      ↓
Required Evidence
      ↓
Compliance
      ↓
Shipment
```

No coffee-specific logic SHALL exist in generic orchestration.

---

# 105. ZuriBeans Scenario — South African Wine → Uganda

```text id="jjwnsp"
Wine Product
      ↓
Lot Origin
      ↓
Classification
      ↓
ZA Export Eligibility
      ↓
ZA→UG Trade Lane
      ↓
UG Import Eligibility
      ↓
Required Evidence
      ↓
Compliance
      ↓
Shipment
```

The same architecture SHALL work.

---

# 106. ZuriBeans Scenario — Local Uganda Coffee

```text id="umg8ks"
UG Product
    ↓
UG Local Market Eligibility
    ↓
Commercial Offer
    ↓
UG B2B Buyer
```

Export/import controls SHALL not be unnecessarily applied.

---

# 107. ZuriBeans Scenario — Local South African Wine

Same generic local-market path.

---

# 108. External Market Scenario

Example:

```text id="u6fw4z"
Uganda
   ↓
Kenya
```

The architecture SHALL resolve Kenya eligibility through configuration/provider binding without changing Trade core code.

---

# 109. Different-Origin Lot Test

Same canonical product:

```text id="sfyc30"
Lot A → Uganda
Lot B → Ethiopia
```

prove eligibility can differ.

---

# 110. Expired Certificate Test

Mandatory certificate expires.

Expected:

```text id="9xj5vh"
new regulated transaction
→ BLOCK / REVIEW
```

according to policy.

---

# 111. Classification Change Test

A classification changes with a new effective date.

Historical orders SHALL retain old snapshot.

New transactions SHALL use new classification.

---

# 112. Provider Failure Test

Mandatory provider unavailable.

Expected:

```text id="6q83jd"
NOT READY / REVIEW / ERROR
```

not automatic approval.

---

# 113. Manual Review Test

No automated provider exists.

Structured manual provider produces:

```text id="0q4ntb"
reviewer
decision
evidence
effective period
audit
```

---

# 114. Inventory Hold Test

Product physically present:

```text id="6blswm"
on_hand = 100
```

but regulatory block:

```text id="4v5xpx"
available = 0
```

---

# 115. Supplier Approval Test

Supplier approved.

Product not approved for destination.

Purchase commitment SHALL be blocked if mandatory.

---

# 116. Active Offer Test

Regulatory eligibility changes to INELIGIBLE.

Commercial offer SHALL be suspended according to policy.

---

# 117. Cross-Tenant Isolation Test

ZuriBeans regulatory/private assessment data SHALL not leak into Thamani relationship context unless explicitly canonical/public and authorised.

---

# 118. Internal Cross-Market Test

Related-party movement crosses border.

Regulatory checks SHALL still execute.

---

# 119. Rejected Alternative — Catalogue Category as Regulatory Classification

Rejected.

Commercial taxonomy and regulatory classification solve different problems.

---

# 120. Rejected Alternative — Hard-Coded HS Codes in Product Code

Rejected.

Classifications change and may be jurisdiction/context dependent.

---

# 121. Rejected Alternative — One Global Product Eligibility Flag

Rejected.

Eligibility depends on:

```text id="i4p6db"
market
origin
destination
transaction
party
date
evidence
```

---

# 122. Rejected Alternative — Trade Lane Determines Product Eligibility

Rejected.

Trade lane existence and product eligibility are independent dimensions.

---

# 123. Rejected Alternative — Supplier Approval Determines Product Eligibility

Rejected.

Supplier qualification and product regulatory eligibility are distinct.

---

# 124. Rejected Alternative — Inventory Presence Determines Sellability

Rejected.

Goods may be physically present but legally unavailable.

---

# 125. Rejected Alternative — ERP Owns Regulatory Classification

Rejected.

ERP consumes regulatory/financial consequences but SHALL not become Baobab's canonical regulatory authority.

---

# 126. Rejected Alternative — AI as Regulatory Authority

Rejected.

AI MAY assist classification and research but SHALL not silently establish authoritative legal eligibility.

---

# 127. Rejected Alternative — Provider Failure Means Allow

Rejected categorically.

Mandatory regulatory uncertainty SHALL fail closed.

---

# 128. Positive Consequences

This architecture provides:

- jurisdiction-aware product eligibility;
- N-to-N market expansion;
- origin-aware trade;
- lot-specific eligibility;
- clean customs integration;
- safe catalogue activation;
- regulatory inventory holds;
- provider-neutral compliance;
- effective-dated classifications;
- auditable decisions;
- future regulatory automation.

---

# 129. Costs

The architecture introduces:

- regulatory product profiles;
- classification mappings;
- eligibility assessment;
- evidence lifecycle;
- provider integration;
- regulatory state;
- reconciliation;
- historical snapshots.

These are necessary for credible cross-border commerce.

---

# 130. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical regulatory contracts/events |
| `nabhold/baobab-cp` | Context, capability and provider resolution |
| `nabhold/baobab-trade` | Regulatory product projection, eligibility gates, transaction orchestration |
| `nabhold/baobab-erp` | Financial/accounting consequences |
| `nabhold/baobab-iam` | Regulatory roles and authorization |
| `nabhold/baobab-pulse` | Optional regulatory intelligence |
| External providers | Authoritative/specialist regulatory determinations where configured |

---

# 131. Implementation Sequence

```text id="k8e9hs"
Canonical Product
      ↓
Regulatory Profile Contract
      ↓
Classification Model
      ↓
Origin Model
      ↓
Market Eligibility
      ↓
Trade-Lane Eligibility
      ↓
Provider Resolution
      ↓
Evidence / Registration
      ↓
Commercial Gates
      ↓
Inventory Holds
      ↓
Customs Integration
      ↓
Reconciliation
      ↓
Golden-Tenant Validation
```

---

# 132. Release 1 P0 Scope

ZuriBeans Release 1 SHALL support:

- regulatory profile per canonical product;
- effective-dated classifications;
- jurisdiction scope;
- origin context;
- lot-specific origin where required;
- product-market eligibility;
- export eligibility;
- import eligibility;
- eligibility conditions;
- evidence references;
- registration/licence references;
- provider resolution;
- manual provider path;
- regulatory gates;
- regulatory inventory holds;
- commercial-offer gating;
- customs integration;
- historical decision snapshots;
- audit;
- observability;
- reconciliation.

---

# 133. Release 1.1 Candidates

Future capabilities MAY include:

- AI-assisted classification;
- automated regulatory-change detection;
- regulatory knowledge graph;
- product labelling intelligence;
- trade-agreement optimisation;
- preferential-origin analysis;
- quota optimisation;
- automated licence renewal;
- product compliance recommendation;
- market-entry eligibility analysis.

---

# 134. Definition of Done

ADR-0024 is implemented when:

- [ ] canonical product remains separate from regulatory profile;
- [ ] commercial categories are not treated as regulatory classifications;
- [ ] classifications are effective-dated;
- [ ] classification provenance exists;
- [ ] jurisdiction scope exists;
- [ ] product origin is explicit;
- [ ] lot-specific origin is supported where required;
- [ ] product-market eligibility exists;
- [ ] export/import eligibility are separate;
- [ ] active trade lane does not imply product eligibility;
- [ ] supplier approval does not imply product eligibility;
- [ ] inventory presence does not imply sellability;
- [ ] regulatory holds affect ATP appropriately;
- [ ] evidence/registration references exist;
- [ ] provider resolution works;
- [ ] mandatory provider absence fails closed;
- [ ] manual provider path is structured/auditable;
- [ ] historical decision snapshots exist;
- [ ] offer gating works;
- [ ] procurement gating works;
- [ ] shipment gating works;
- [ ] customs integration works;
- [ ] events are idempotent;
- [ ] reconciliation exists;
- [ ] audit exists;
- [ ] UG→ZA scenario passes;
- [ ] ZA→UG scenario passes;
- [ ] local UG scenario passes;
- [ ] local ZA scenario passes;
- [ ] external-market scenario passes;
- [ ] internal cross-market scenario passes;
- [ ] no product/country-specific regulatory logic exists in generic Trade core.

---

# 135. Final Architecture

```text id="8iz2ao"
                         CANONICAL PRODUCT
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
       COMMERCIAL PROFILE                  REGULATORY PROFILE
              │                                   │
              │                         ┌─────────┼─────────┐
              │                         ▼         ▼         ▼
              │                  Classification Origin   Evidence
              │                         │         │         │
              │                         └─────────┼─────────┘
              │                                   ▼
              │                          MARKET ELIGIBILITY
              │                                   │
              │                                   ▼
              │                           TRADE-LANE CHECK
              │                                   │
              └──────────────────┬────────────────┘
                                 ▼
                         COMMERCIAL OFFER
                                 │
                                 ▼
                              ORDER
                                 │
                                 ▼
                       TRANSACTION CHECK
                                 │
                                 ▼
                             SHIPMENT
```

Cross-border eligibility:

```text id="zgpkye"
Product
   +
Lot / Origin
   +
Seller / Exporter
   +
Origin Market
   │
   ▼
EXPORT ELIGIBILITY
   │
   ▼
TRADE LANE
   │
   ▼
IMPORT ELIGIBILITY
   ▲
   │
Product
   +
Buyer / Importer
   +
Destination Market
   +
Effective Date
```

Operational availability:

```text id="8e27e3"
On-Hand Inventory
        │
        ├── Quality Hold?
        ├── Customs Hold?
        ├── Regulatory Hold?
        └── Reservation?
                │
                ▼
          AVAILABLE TO PROMISE
```

The central invariant is:

> **A product is not tradeable merely because Baobab knows about it, a supplier can provide it, inventory exists, a trade lane is active, or a commercial offer has been configured. Tradeability is a contextual, effective-dated decision that must satisfy the regulatory conditions applicable to the actual transaction.**

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text id="x67zqn"
ADR-0024
    ↓
Canonical Regulatory Contracts
    ↓
Product Regulatory Profile
    ↓
Classification + Origin
    ↓
Market / Trade-Lane Eligibility
    ↓
Provider Resolution
    ↓
Evidence + Regulatory Gates
    ↓
Inventory / Catalogue Integration
    ↓
Customs Integration
    ↓
Reconciliation
    ↓
ZuriBeans Golden-Tenant Validation
```

No production Baobab workflow SHALL infer regulatory eligibility solely from catalogue presence, supplier approval, inventory availability, active market participation or an active trade lane.