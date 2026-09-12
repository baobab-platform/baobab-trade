# ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Repository:** `nabhold/baobab-trade`  
**Trade Runtime:** MedusaJS + Baobab Trade Extensions  
**ERP Authority:** `nabhold/baobab-erp` / iDempiere  
**Context & Capability Authority:** `nabhold/baobab-cp`  
**Canonical Contract Authority:** `nabhold/shared`  
**Identity Authority:** `nabhold/baobab-iam`  
**Content/Evidence Support:** `nabhold/baobab-cms` where applicable  
**Intelligence Support:** `nabhold/baobab-pulse` where applicable  
**Reference Tenant:** ZuriBeans

## Related ADRs

- ADR-0010 — Market, Region, Currency, Sales Channel and Legal Seller Model
- ADR-0011 — Product, Variant, Catalogue and Canonical Product Authority Model
- ADR-0013 — Inventory, Availability, Reservation and ERP Stock Authority Model
- ADR-0016 — Fulfilment, Shipping, Delivery and External Logistics Boundary
- ADR-0018 — Tax, Jurisdiction and Legal Transaction Context
- ADR-0019 — B2B Procurement, Supplier Commercial Workflow and Trade-to-ERP Boundary Model
- ADR-0020 — B2B Landed Cost, Margin and Commercial Price Resolution Model
- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading, Legal-Entity Relationship and Internal Settlement Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model

---

# 1. Decision

Baobab SHALL implement customs and trade compliance as a **provider-oriented trade capability**, not as hard-coded jurisdictional logic embedded in MedusaJS, the Control Plane, ERP or a digital estate.

The architecture SHALL separate:

```text
TRADE TRANSACTION
       │
       ▼
Canonical Regulatory Context
       │
       ▼
Compliance Requirement Resolution
       │
       ├── Product Classification
       ├── Restricted Party Screening
       ├── Import / Export Eligibility
       ├── Licence / Permit Requirements
       ├── Customs Valuation
       ├── Duty / Charge Determination
       ├── Origin Requirements
       └── Documentary Requirements
       │
       ▼
Provider Resolution
       │
       ▼
Compliance Decision / Evidence
       │
       ▼
Trade Execution
```

The governing principle is:

> **Baobab owns the canonical trade-compliance context, workflow and evidence lineage; specialised providers own regulatory determinations where appropriate.**

Baobab SHALL NOT attempt to encode the customs legislation of every African or international jurisdiction directly into its commerce core.

---

# 2. Why This ADR Is Necessary

ZuriBeans may conduct:

```text
UG → ZA
ZA → UG
UG → KE
ZA → KE
UG → UAE
ZA → other markets
```

and future Baobab tenants may trade completely different products through different jurisdictions.

Each transaction can be affected by:

```text
product
classification
origin
destination
export jurisdiction
import jurisdiction
seller
buyer
legal entity
trade lane
transaction value
currency
Incoterm
transport mode
trade agreement
licence
permit
effective date
```

Therefore:

```text
product + destination
```

alone is insufficient to determine compliance.

---

# 3. Architectural Boundary

```text
                       BAOBAB CONTROL PLANE
                  Context / Capability / Provider
                              │
                              ▼
                        BAOBAB TRADE
                    Trade Execution Workflow
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
             Customs      Compliance    Regulatory
             Provider      Provider      Provider
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                     Regulatory Decision
                              │
                              ▼
                         Evidence Set
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          Shipment        Inventory          ERP
```

---

# 4. Responsibilities

| Concern | Primary Authority |
|---|---|
| Tenant | CP |
| Market participation | CP |
| Trade lane | CP |
| Provider binding | CP |
| Product identity | Shared / product authority |
| Product classification | Regulatory/compliance provider |
| Trade workflow | Trade |
| Import/export eligibility | Compliance provider |
| Customs declaration workflow | Trade/provider |
| Customs valuation | Customs provider + ERP inputs |
| Duties | Customs/tax provider |
| Financial posting | ERP |
| Customs inventory status | Trade/ERP projection |
| Compliance evidence | Evidence architecture |
| Identity/access | IAM |
| Regulatory intelligence | Pulse where applicable |

---

# 5. Compliance Is Not One Boolean

The platform SHALL NOT reduce compliance to:

```text
compliant = true
```

A transaction may have multiple independent decisions.

Conceptually:

```text
ComplianceAssessment
├── classification
├── import_eligibility
├── export_eligibility
├── restricted_party
├── licensing
├── origin
├── customs_valuation
├── documentary_requirements
├── product_regulation
├── sanctions
└── other_controls
```

---

# 6. Compliance Decision States

A generic decision SHOULD support:

```text
NOT_EVALUATED
PENDING
PASS
PASS_WITH_CONDITIONS
REVIEW_REQUIRED
BLOCKED
EXPIRED
ERROR
```

---

# 7. Fail-Closed Principle

Mandatory compliance requirements SHALL fail closed.

```text
Required Compliance Check
          │
          ▼
Provider unavailable
          │
          ▼
UNKNOWN
          │
          ▼
BLOCK TRANSACTION
```

The system SHALL NOT interpret provider failure as regulatory approval.

---

# 8. Regulatory Context

Every material cross-border compliance request SHALL carry sufficient canonical context.

Conceptually:

```text
TradeComplianceContext
├── tenant_id
├── legal_entity_id
├── seller_id
├── buyer_id
├── origin_market
├── destination_market
├── origin_country
├── destination_country
├── trade_lane_id
├── product_id
├── product_classification?
├── quantity
├── uom
├── transaction_value
├── currency
├── incoterm?
├── transport_mode?
├── transaction_date
└── provider_context
```

---

# 9. Effective Date Is Mandatory

Regulations change.

Therefore:

```text
Compliance Decision
=
Rules applicable at Transaction Effective Date
```

not necessarily today's rules.

Historical transactions must remain reproducible.

---

# 10. Product Classification

Products SHALL support regulatory classification independent of Baobab catalogue categories.

For example:

```text
Commercial Category
    COFFEE

Regulatory Classification
    tariff/customs classification
```

These are different concerns.

---

# 11. Classification Authority

Classification MAY come from:

- trusted external customs provider;
- approved internal classification workflow;
- authorised broker;
- government source;
- specialist compliance provider.

The source SHALL be recorded.

---

# 12. Classification Model

Conceptually:

```text
ProductRegulatoryClassification
├── canonical_product_id
├── classification_system
├── code
├── jurisdiction_scope
├── effective_from
├── effective_to?
├── confidence/status
├── source
├── approved_by?
└── evidence_reference
```

---

# 13. No Universal Hard-Coded Tariff Code

The platform SHALL NOT assume one tariff classification is universally valid across every jurisdiction or date.

Classification SHALL support:

```text
jurisdiction
+
classification system
+
effective period
```

---

# 14. Classification Versioning

Historical classification SHALL remain available after replacement.

This is required for:

- audit;
- customs reconciliation;
- historical shipment investigation;
- disputes.

---

# 15. Product Regulatory Eligibility

Product eligibility SHALL resolve independently of catalogue visibility.

```text
Product exists
      │
      ▼
Product listed commercially
      │
      ▼
Regulatory eligibility?
      │
     / \
   YES  NO
   │     │
   ▼     ▼
Trade  BLOCK
```

A product being sellable in Medusa does not make it legally importable.

---

# 16. Import Eligibility

Import eligibility MAY depend on:

```text
destination
product
product classification
importer
licences
permits
origin
quantity
transaction date
```

---

# 17. Export Eligibility

Likewise export eligibility MAY depend on:

```text
origin
exporter
product
licence
destination
trade restriction
effective date
```

---

# 18. Market Participation Does Not Equal Regulatory Permission

CP may authorise:

```text
EXPORTING
```

for ZuriBeans Uganda.

That means the tenant is configured to perform export activity.

It does NOT mean:

```text
every product
to every country
under every circumstance
```

is legally exportable.

---

# 19. Trade Lane Does Not Equal Regulatory Approval

An active:

```text
UG → ZA
```

TradeLane means the platform permits the route operationally.

Individual transactions still require regulatory evaluation.

---

# 20. Restricted Party Screening

Where required, Baobab SHALL support screening of relevant counterparties.

Potential subjects include:

```text
seller
buyer
supplier
consignee
shipper
beneficial owner
financial counterparty
```

depending on provider/policy.

---

# 21. Screening Provider

Baobab SHALL integrate specialised screening providers rather than maintain its own authoritative sanctions/restricted-party database.

---

# 22. Screening Result

Conceptually:

```text
ScreeningResult
├── subject_id
├── provider
├── screening_type
├── result
├── score?
├── matched_records?
├── screened_at
├── expires_at?
└── evidence_reference
```

---

# 23. Potential Match

A fuzzy-name match SHALL not automatically be interpreted as a confirmed prohibited party.

The system SHOULD support:

```text
NO_MATCH
POTENTIAL_MATCH
CONFIRMED_MATCH
CLEARED
```

with human review where appropriate.

---

# 24. Compliance Case

Ambiguous or exceptional assessments SHOULD create:

```text
ComplianceCase
```

rather than being resolved through ad hoc comments.

Conceptually:

```text
ComplianceCase
├── case_id
├── tenant
├── transaction
├── reason
├── risk_level
├── assigned_to
├── evidence
├── decisions
├── status
└── audit_history
```

---

# 25. Human Review

Some decisions SHALL permit:

```text
AUTOMATED
```

while others require:

```text
HUMAN_REVIEW
```

Provider confidence and policy determine which path applies.

---

# 26. Compliance Override

A user SHALL NOT simply toggle:

```text
BLOCKED → PASS
```

without authority.

Overrides require:

```text
actor
authority
reason
evidence
original decision
new decision
timestamp
```

---

# 27. Licence and Permit Requirements

Compliance resolution SHALL support requirements such as:

```text
licence
permit
certificate
registration
inspection
authorisation
```

without hard-coding product-specific legislation into generic Trade modules.

---

# 28. Regulatory Requirement Model

Conceptually:

```text
RegulatoryRequirement
├── requirement_type
├── jurisdiction
├── product_scope
├── party_scope
├── trade_lane_scope?
├── required_document_type?
├── effective_from
├── effective_to?
└── provider_reference
```

---

# 29. Licence Model

Conceptually:

```text
RegulatoryAuthorisation
├── holder
├── type
├── jurisdiction
├── reference_number
├── product_scope?
├── valid_from
├── valid_until
├── verification_status
└── evidence_reference
```

---

# 30. Expiry

An expired authorisation SHALL NOT satisfy a current regulatory requirement.

---

# 31. Documentary Requirements

Cross-border execution may require documents such as:

```text
commercial documents
transport documents
origin evidence
customs documents
permits
certificates
inspection evidence
insurance evidence
```

The exact set SHALL be resolved through policy/provider context.

---

# 32. Documents Are Evidence

A compliance document SHALL have:

```text
type
issuer
holder
transaction
version
issued_at
validity
verification
hash/provenance
```

where applicable.

Raw file upload alone is insufficient for production-grade compliance evidence.

---

# 33. Customs Declaration

Customs declaration SHOULD be modelled separately from shipment.

```text
Shipment
≠
Customs Declaration
```

A shipment may have multiple declarations or procedures over its lifecycle.

---

# 34. Customs Declaration Model

Conceptually:

```text
CustomsDeclaration
├── id
├── tenant
├── shipment
├── declaration_type
├── jurisdiction
├── declarant
├── importer/exporter
├── product_lines
├── classification
├── origin
├── customs_value
├── currency
├── duties
├── taxes
├── status
├── provider
└── evidence
```

---

# 35. Customs Status

Suggested generic lifecycle:

```text
NOT_REQUIRED
DRAFT
PREPARING
SUBMITTED
ACCEPTED
UNDER_REVIEW
HELD
INSPECTION_REQUIRED
CLEARED
RELEASED
REJECTED
CANCELLED
```

Provider-specific states SHALL map into canonical states.

---

# 36. Provider State Mapping

Baobab SHALL not leak provider-specific customs state throughout the platform.

Instead:

```text
Provider Status
      ↓
Adapter
      ↓
Canonical Customs Status
```

Raw provider state MAY be retained for diagnostics.

---

# 37. Customs Valuation

Customs value SHALL be separate from:

```text
supplier invoice price
inventory valuation
commercial selling price
```

because valuation rules may differ.

---

# 38. Valuation Context

A customs valuation request MAY require:

```text
transaction value
related-party status
freight
insurance
assists
royalties
packing
adjustments
currency
Incoterm
```

depending on applicable rules.

The provider determines legally applicable treatment.

---

# 39. Commercial Price ≠ Customs Value

This invariant SHALL be explicit:

```text
Commercial Selling Price
≠
Customs Value
```

even where the numbers happen to coincide.

---

# 40. Transfer Price ≠ Customs Value

Likewise:

```text
Intercompany Transfer Price
≠ automatically
Customs Value
```

ADR-BCP-012 and this ADR SHALL remain coordinated.

---

# 41. Customs Value Model

Conceptually:

```text
CustomsValuation
├── transaction_id
├── valuation_method
├── base_amount
├── additions[]
├── deductions[]
├── final_value
├── currency
├── exchange_rate_reference
├── provider
└── evidence
```

---

# 42. Duty Determination

Duty SHALL be resolved from regulatory inputs rather than static product markup.

Conceptually:

```text
Classification
+
Origin
+
Destination
+
Value
+
Quantity
+
Trade Agreement
+
Effective Date
=
Duty Determination
```

---

# 43. Duty Result

Conceptually:

```text
DutyAssessment
├── duty_type
├── basis
├── rate
├── amount
├── currency
├── preference_applied?
├── provider
├── effective_at
└── evidence
```

---

# 44. Preferential Treatment

Where a trade preference or agreement may apply, the platform SHALL require the necessary eligibility/evidence rather than assuming preferential duty solely from origin and destination.

---

# 45. Origin

The architecture SHALL distinguish:

```text
shipment origin
commercial origin
country of production
customs origin
```

where applicable.

They SHALL not be silently conflated.

---

# 46. Origin Determination

Origin SHOULD be provider/policy-driven where regulatory rules are non-trivial.

---

# 47. Origin Evidence

Origin determinations SHOULD reference supporting evidence.

This becomes especially important where preferential treatment is claimed.

---

# 48. Tax Boundary

Customs duty and tax SHALL remain distinct concepts.

ADR-0018 governs transaction tax.

This ADR governs customs/trade compliance.

They SHALL compose.

---

# 49. Landed Cost Integration

ADR-0020 consumes customs outputs:

```text
Duty
Brokerage
Non-Recoverable Import Charges
        ↓
Landed Cost
```

Customs SHALL not independently determine commercial margin.

---

# 50. ERP Integration

ERP SHALL receive financial consequences including:

```text
customs duty
import tax
brokerage
clearing cost
other allocable landed costs
```

where applicable.

---

# 51. Inventory Integration

ADR-BCP-013 provides customs inventory states.

Example:

```text
IN_TRANSIT
    ↓
ARRIVED
    ↓
CUSTOMS_HELD
    ↓
CUSTOMS_RELEASED
    ↓
AVAILABLE
```

---

# 52. Customs Release Is Not Goods Receipt

Goods may physically arrive before customs release.

Therefore:

```text
ARRIVED
≠
CUSTOMS_RELEASED
```

---

# 53. Customs Release Is Not Quality Release

Likewise:

```text
CUSTOMS_RELEASED
≠
QUALITY_APPROVED
```

Both may be required before commercial availability.

---

# 54. Logistics Boundary

ADR-0016 owns shipment and fulfilment.

Customs consumes shipment context.

It SHALL not become the carrier-management system.

---

# 55. Shipment Compliance Gate

Before dispatch:

```text
Shipment Ready
      ↓
Export Compliance Gate
     / \
   PASS BLOCK
```

At destination:

```text
Arrival
   ↓
Import Compliance Gate
   ↓
Customs Release
```

---

# 56. Pre-Trade Compliance

Some checks SHOULD happen before a quote or order becomes binding.

Example:

```text
Can this product legally be supplied
from origin to destination?
```

---

# 57. Pre-Shipment Compliance

Before dispatch, Trade SHOULD verify:

```text
export eligibility
licence validity
required documents
counterparty screening
shipment documentation
```

according to policy.

---

# 58. Border Compliance

During border processing:

```text
declaration
inspection
customs assessment
duty
release
```

may occur.

---

# 59. Post-Trade Compliance

After execution, Baobab SHALL preserve evidence necessary for:

```text
audit
reconciliation
claims
regulatory inquiry
financial review
```

---

# 60. Compliance Gate Model

Conceptually:

```text
ComplianceGate
├── PRE_QUOTE
├── PRE_ORDER
├── PRE_SHIPMENT
├── EXPORT
├── IMPORT
├── PRE_RELEASE
└── POST_TRANSACTION
```

Not every transaction requires every gate.

---

# 61. Policy-Driven Gates

Example:

```text
Local UG sale
```

may not invoke international customs gates.

```text
UG → ZA coffee
```

does.

---

# 62. Provider Abstraction

The platform SHALL expose canonical capabilities such as:

```text
trade-compliance.product-classify
trade-compliance.import-eligibility
trade-compliance.export-eligibility
trade-compliance.party-screen
trade-compliance.requirements-resolve

customs.value
customs.duty-assess
customs.declaration.create
customs.declaration.submit
customs.declaration.status
customs.release.status
```

---

# 63. Provider Binding

CP SHALL resolve:

```text
Capability
+
Context
      ↓
CapabilityBinding
      ↓
Provider
```

---

# 64. Different Providers May Serve Different Markets

Example:

```text
UG customs capability
→ Provider A

ZA customs capability
→ Provider B

restricted-party screening
→ Provider C
```

Baobab SHALL support this.

---

# 65. Different Providers May Serve Different Capabilities

One provider need not perform:

```text
classification
+
screening
+
declaration
+
duty
```

all together.

---

# 66. Provider Adapter

Provider-specific integration SHALL live behind an adapter.

```text
Canonical Request
      ↓
Provider Adapter
      ↓
External API
      ↓
Provider Response
      ↓
Canonical Decision
```

---

# 67. Provider Credentials

External provider credentials SHALL be managed through infrastructure secret management.

They SHALL NOT reside in:

```text
source code
tenant configuration committed to Git
frontend applications
```

---

# 68. Provider Health

Mandatory providers SHALL participate in readiness.

```text
provider unhealthy
      ↓
mandatory compliance unavailable
      ↓
trade lane DEGRADED/BLOCKED
```

according to policy.

---

# 69. No Provider Means No Fiction

If a mandatory compliance capability has no provider:

```text
Capability Resolution
       ↓
NO_PROVIDER
       ↓
NOT_READY
```

The platform SHALL not silently bypass it.

---

# 70. Manual Provider

For early markets, a controlled human workflow MAY serve as a provider.

Example:

```text
Customs Valuation Request
       ↓
Authorised Compliance Officer
       ↓
Decision + Evidence
```

This is preferable to pretending the capability is automated.

---

# 71. Manual Decisions Must Be Structured

Manual processing SHALL still produce:

```text
canonical decision
actor
timestamp
evidence
reason
effective date
```

---

# 72. Broker Integration

Customs brokers MAY operate as providers.

Baobab SHALL retain canonical transaction identity even when the broker owns declaration execution.

---

# 73. Broker Does Not Become Platform Authority

The broker may be execution authority for a declaration.

Baobab remains authority for:

```text
which transaction
which tenant
which legal entity
which shipment
which provider
which canonical status
```

---

# 74. Customs Reference Numbers

Provider/government declaration references SHALL be stored as external references.

They SHALL not replace canonical Baobab IDs.

---

# 75. Evidence Architecture

Every material regulatory decision SHOULD be traceable:

```text
Transaction
    ↓
Compliance Assessment
    ↓
Provider Decision
    ↓
Evidence
```

---

# 76. Evidence Immutability

Final regulatory evidence SHOULD be protected against silent mutation.

Updated documents should create new versions.

---

# 77. Evidence Hashing

Where appropriate, document/evidence integrity MAY be supported with cryptographic hashes.

---

# 78. Retention

Regulatory evidence SHALL have retention policies appropriate to:

```text
jurisdiction
document type
transaction type
legal entity
```

The generic Trade module SHALL not assume one universal retention period.

---

# 79. Data Residency

Provider integration and evidence storage SHALL respect applicable data-residency policy.

CP/infrastructure SHALL resolve appropriate deployment/storage context.

---

# 80. Sensitive Data

Compliance records may contain:

```text
company information
identity information
financial information
licence information
shipping information
```

Access SHALL be least-privilege.

---

# 81. IAM

Roles MAY include:

```text
TRADE_OPERATOR
COMPLIANCE_ANALYST
COMPLIANCE_APPROVER
CUSTOMS_SPECIALIST
AUDITOR
```

Exact roles remain IAM policy.

---

# 82. Separation of Duties

Where policy requires, the same user SHOULD NOT:

```text
create high-risk compliance override
+
approve own override
```

---

# 83. Supplier Compliance

Supplier approval may depend on:

```text
licences
product certifications
restricted-party screening
market eligibility
```

ADR-0019 consumes these decisions.

---

# 84. Buyer Compliance

Customer onboarding or order commitment may similarly require:

```text
counterparty screening
end-use checks
destination checks
```

where applicable.

---

# 85. Product Regulatory Classification

This ADR establishes the provider boundary.

A later ADR SHALL define the deeper canonical product-regulatory classification and market-eligibility model.

---

# 86. No Product-Specific Core

This SHALL NOT exist in generic platform code:

```text
if product == "coffee" and country == "Uganda"
```

or:

```text
if product == "wine" and destination == "Uganda"
```

Rules belong in regulatory policy/providers.

---

# 87. No Country-Specific Core

Likewise:

```text
if destination == "South Africa":
    duty = ...
```

is prohibited in generic Trade code.

---

# 88. Configuration Is Not Regulation Engine

Moving hard-coded regulatory rules into YAML does not automatically create a sound regulatory architecture.

Complex regulatory determinations SHALL use an appropriate rules/provider architecture.

---

# 89. Rule Provenance

Any rule used for an authoritative decision SHALL be traceable to:

```text
source
version
jurisdiction
effective period
```

where appropriate.

---

# 90. Decision Provenance

A compliance result SHOULD record:

```text
provider
provider version?
rule/policy version
input context
decision
timestamp
evidence
```

---

# 91. Reproducibility

Baobab SHOULD be able to explain:

> Why was this shipment permitted on this date?

and:

> Why was this shipment blocked?

---

# 92. Event Model

Canonical events SHOULD include:

```text
trade-compliance.assessment-requested
trade-compliance.assessment-completed
trade-compliance.review-required
trade-compliance.blocked
trade-compliance.cleared

customs.declaration-created
customs.declaration-submitted
customs.declaration-accepted
customs.declaration-held
customs.declaration-cleared
customs.declaration-released

customs.duty-assessed
customs.value-determined
```

---

# 93. Event Envelope

Events SHALL carry:

```text
tenant
legal entity
market
trade lane
transaction
shipment where relevant
correlation ID
causation ID
event time
schema version
```

---

# 94. Idempotency

Duplicate:

```text
customs.declaration-released
```

events SHALL NOT release inventory twice or duplicate financial posting.

---

# 95. Outbox/Inbox

Mandatory compliance events SHALL use transactional outbox/inbox where appropriate.

---

# 96. Saga Integration

Cross-border execution may resemble:

```text
Order
 ↓
Compliance
 ↓
Shipment
 ↓
Export
 ↓
Transit
 ↓
Import
 ↓
Customs
 ↓
Receipt
 ↓
Inventory
 ↓
ERP
```

No distributed database transaction SHALL span this process.

---

# 97. Failure — Compliance Provider Unavailable

```text
mandatory check
      ↓
provider unavailable
      ↓
PENDING / ERROR
      ↓
BLOCK
```

not:

```text
ALLOW
```

---

# 98. Failure — Classification Missing

If classification is mandatory:

```text
NO CLASSIFICATION
       ↓
NO DUTY DETERMINATION
       ↓
NO CUSTOMS READINESS
       ↓
BLOCK
```

---

# 99. Failure — Licence Expired

```text
Licence valid yesterday
Transaction today
Licence expired
```

shall not pass merely because a historical document exists.

---

# 100. Failure — Screening Match

Potential match:

```text
REVIEW_REQUIRED
```

Confirmed prohibited match:

```text
BLOCKED
```

subject to provider/policy.

---

# 101. Failure — Customs Hold

```text
Shipment arrived
      ↓
Customs hold
```

Inventory remains non-released.

The system SHALL preserve the reason and status.

---

# 102. Failure — Customs Rejection

A rejected declaration SHALL not silently disappear.

It SHALL become an operational exception/case.

---

# 103. Failure — Provider Disagreement

If two authoritative sources disagree:

```text
Provider A → PASS
Provider B → BLOCK
```

policy SHALL determine escalation.

The platform SHALL not arbitrarily choose the permissive answer.

---

# 104. Failure — Rule Changes During Shipment

The system SHALL preserve:

```text
assessment timestamp
effective rule reference
```

and support reassessment where legally/operationally required.

---

# 105. Compliance Reassessment

Certain events MAY trigger reassessment:

```text
destination change
product change
quantity change
value change
buyer change
Incoterm change
shipment delay
regulatory update
```

---

# 106. Material Change

Compliance assessments SHOULD identify which inputs are decision-material.

A material change invalidates or reopens relevant assessments.

---

# 107. Caching

Compliance results MAY be cached only when:

```text
context remains identical
+
decision remains valid
+
provider policy allows reuse
```

---

# 108. Screening Freshness

Restricted-party screening SHALL have freshness policy.

A year-old screening result SHALL not automatically satisfy a current high-risk transaction.

---

# 109. Pre-Quote Eligibility

For expensive cross-border RFQs, Trade SHOULD perform lightweight eligibility before producing a commercially binding offer.

```text
Product
+
Origin
+
Destination
      ↓
Can Trade?
```

---

# 110. Full Pre-Shipment Assessment

Before shipment:

```text
actual parties
actual product
actual quantity
actual value
actual route
actual documentation
```

SHALL be assessed as required.

---

# 111. Customs Financial Flow

```text
Customs Assessment
       ↓
Duty / Charges
       ↓
ERP Payable / Cost
       ↓
Landed Cost
       ↓
Inventory Value
       ↓
Margin Analysis
```

---

# 112. Customs Payment

Trade SHALL NOT become the accounting authority for customs payments.

ERP/payment integration owns financial settlement.

---

# 113. Reconciliation

Baobab SHALL reconcile:

```text
Shipment
↕
Customs Declaration

Customs Assessment
↕
ERP Cost

Customs Release
↕
Inventory Status

Regulatory Decision
↕
Trade Execution
```

---

# 114. Reconciliation States

Suggested:

```text
MATCHED
PENDING
EXPECTED_DIFFERENCE
MISMATCH
STALE
UNRESOLVED
```

---

# 115. Observability

Recommended metrics include:

```text
compliance_assessment_total
compliance_block_total
compliance_review_total

customs_declaration_total
customs_hold_total
customs_clearance_duration

classification_missing_total
licence_expiry_block_total
restricted_party_match_total

provider_error_total
provider_latency

compliance_reconciliation_mismatch_total
```

---

# 116. Alerting

Production alerts SHOULD cover:

- mandatory provider outage;
- unusual block spike;
- declaration backlog;
- customs hold backlog;
- expired critical authorisation;
- reconciliation drift;
- compliance event-processing failure.

---

# 117. ZuriBeans Scenario — Uganda Coffee to South Africa

```text
UG Supplier
    ↓
ZuriBeans UG Procurement
    ↓
Coffee Classification
    ↓
Export Eligibility
    ↓
Buyer / Counterparty Checks
    ↓
Shipment Preparation
    ↓
UG Export Requirements
    ↓
Export Clearance
    ↓
International Transit
    ↓
ZA Import Requirements
    ↓
Customs Valuation
    ↓
Duty / Tax Assessment
    ↓
Customs Release
    ↓
ZA Inventory
```

The exact legal/regulatory determinations SHALL come from verified rules/providers.

---

# 118. ZuriBeans Scenario — South African Wine to Uganda

```text
ZA Supplier
    ↓
ZuriBeans ZA Procurement
    ↓
Wine Regulatory Classification
    ↓
Export Eligibility
    ↓
Product Documentation
    ↓
ZA Export
    ↓
Transit
    ↓
UG Import Eligibility
    ↓
Applicable Regulatory Checks
    ↓
Customs
    ↓
Release
    ↓
UG Inventory
```

The architecture is the same.

The regulatory rules differ.

---

# 119. External Market Scenario

```text
ZuriBeans UG
     ↓
Kenyan B2B Customer
```

SHALL resolve:

```text
UG export context
+
UG→KE trade lane
+
Kenyan import context
+
product regulatory context
+
provider bindings
```

without requiring Kenya-specific application code.

---

# 120. Local Trade Scenario

```text
UG supplier
   ↓
ZuriBeans UG
   ↓
UG customer
```

shall not invoke international customs workflows unnecessarily.

Applicable local regulatory checks remain possible.

---

# 121. Intercompany Scenario

```text
ZuriBeans UG
      ↓
ZuriBeans ZA
```

Customs SHALL still apply where legally required even if both parties belong to Nabhold.

Corporate relationship does not erase border obligations.

---

# 122. Inter-Branch Scenario

Even if both operations are branches of the same legal entity:

```text
UG branch
   ↓
ZA branch
```

cross-border customs requirements may still apply.

Legal ownership continuity does not eliminate customs.

---

# 123. Testing — Classification

At minimum:

```text
valid classification
missing classification
expired classification
jurisdiction mismatch
classification version change
```

---

# 124. Testing — Eligibility

At minimum:

```text
eligible import
blocked import
eligible export
blocked export
conditional approval
provider unavailable
```

---

# 125. Testing — Screening

At minimum:

```text
no match
potential match
confirmed match
cleared false positive
expired screening
duplicate screening event
```

---

# 126. Testing — Customs

At minimum:

```text
declaration creation
submission
acceptance
hold
inspection
release
rejection
duplicate release event
```

---

# 127. Testing — Financial Integration

At minimum:

```text
duty assessment → ERP
customs cost → landed cost
customs value update
duplicate financial event
currency conversion
```

---

# 128. Testing — Inventory

At minimum:

```text
arrival before clearance
customs hold
release
partial release if supported
rejection
inventory availability blocked before release
```

---

# 129. Security Testing

Prove:

```text
Tenant A cannot access Tenant B declaration

Supplier cannot alter customs decision

Buyer cannot view internal compliance evidence

Trade operator cannot approve restricted override without authority

External provider cannot act outside bound tenant/context
```

---

# 130. Golden Tenant Simulation

ZuriBeans staging SHALL prove at least:

```text
UG → ZA coffee
ZA → UG wine
UG → external third market
local UG trade
local ZA trade
```

including failure scenarios.

---

# 131. Provider Simulation

At least one compliance provider path SHALL be exercised end-to-end.

If production provider integration is not yet available, an explicitly designated structured manual provider MAY be used for staging—but SHALL not be represented as automated compliance.

---

# 132. Rejected Alternative — Customs Logic Inside Medusa Core

Rejected because it:

- couples commerce to jurisdictional regulation;
- creates upgrade risk;
- scales poorly across markets;
- encourages hard-coded rules.

---

# 133. Rejected Alternative — Customs in Control Plane

Rejected.

CP determines:

```text
which capability
which provider
which context
```

not:

```text
what customs law says
```

---

# 134. Rejected Alternative — Customs Entirely in ERP

Rejected because compliance gates must influence:

```text
quote
order
shipment
availability
```

before financial posting.

ERP consumes financial consequences.

---

# 135. Rejected Alternative — Logistics Provider Owns All Compliance

Rejected because carrier/broker execution does not replace Baobab's canonical compliance state, evidence and orchestration.

---

# 136. Rejected Alternative — Static Tariff Tables in Application Code

Rejected because regulations and classifications evolve.

---

# 137. Rejected Alternative — Assume Customs Release From Shipment Delivery

Rejected:

```text
delivered to port
≠
customs released
```

---

# 138. Rejected Alternative — Corporate Relationship Bypasses Customs

Rejected.

Intercompany and inter-branch movements remain subject to applicable border rules.

---

# 139. Positive Consequences

This architecture enables:

- multi-country trade;
- provider neutrality;
- regulatory evolution;
- auditable decisions;
- customs automation;
- manual fallback;
- broker integration;
- regulatory evidence;
- correct inventory holds;
- accurate landed cost;
- cross-border scalability.

---

# 140. Complexity Consequences

It introduces:

- provider adapters;
- compliance cases;
- rule/evidence provenance;
- regulatory states;
- additional events;
- readiness dependencies;
- reconciliation;
- specialised master data.

That complexity is inherent in cross-border trade.

---

# 141. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical compliance/customs contracts |
| `nabhold/baobab-trade` | Compliance workflow and trade gates |
| `nabhold/baobab-cp` | Capability/provider/context resolution |
| `nabhold/baobab-erp` | Financial customs consequences |
| `nabhold/baobab-iam` | Compliance roles/access |
| `nabhold/baobab-cms` | Governed content/evidence support where appropriate |
| `nabhold/baobab-pulse` | Regulatory intelligence where appropriate |
| `nabhold/infrastructure` | Provider connectivity/secrets/events |
| External providers | Regulatory determinations/execution |

---

# 142. Implementation Sequence

```text
Canonical Compliance Contracts
          ↓
Compliance Context
          ↓
Product Classification
          ↓
Provider Capability Model
          ↓
Eligibility Resolution
          ↓
Restricted-Party Screening
          ↓
Licence / Permit Model
          ↓
Customs Valuation
          ↓
Duty Assessment
          ↓
Declaration Workflow
          ↓
Customs Status
          ↓
Inventory / ERP Integration
          ↓
Evidence
          ↓
Reconciliation
          ↓
Golden-Tenant Simulation
```

---

# 143. Release 1 P0 Scope

ZuriBeans Release 1 SHALL provide:

- canonical regulatory context;
- product classification references;
- import/export eligibility;
- provider resolution;
- licence/permit references;
- compliance gates;
- compliance case handling;
- customs valuation contract;
- duty assessment contract;
- customs declaration lifecycle;
- customs status;
- inventory hold/release integration;
- ERP landed-cost integration;
- evidence lineage;
- audit;
- idempotent events;
- reconciliation.

---

# 144. Release 1.1 Candidates

May follow:

- advanced automated tariff optimisation;
- trade-agreement preference optimisation;
- AI-assisted classification;
- regulatory-change impact analysis;
- automated licence-renewal intelligence;
- advanced customs broker marketplace;
- predictive customs-delay modelling through Pulse.

---

# 145. Definition of Done

ADR-0021 is implemented when:

- [ ] canonical compliance context exists;
- [ ] product classifications are effective-dated;
- [ ] classification provenance exists;
- [ ] import eligibility can resolve;
- [ ] export eligibility can resolve;
- [ ] restricted-party provider abstraction exists;
- [ ] licence/permit model exists;
- [ ] compliance cases exist;
- [ ] provider binding is context-aware;
- [ ] missing mandatory provider fails closed;
- [ ] customs valuation is separate from commercial price;
- [ ] duty assessment exists;
- [ ] customs declaration is separate from shipment;
- [ ] canonical customs status exists;
- [ ] customs hold blocks inventory availability;
- [ ] customs release propagates safely;
- [ ] ERP receives financial customs consequences;
- [ ] evidence is auditable;
- [ ] events are idempotent;
- [ ] reconciliation exists;
- [ ] cross-tenant isolation passes;
- [ ] UG→ZA scenario passes;
- [ ] ZA→UG scenario passes;
- [ ] external-market scenario passes;
- [ ] intercompany scenario passes;
- [ ] no country/product-specific regulatory logic exists in generic Trade core.

---

# 146. Final Architecture

```text
                         TRADE TRANSACTION
                                │
                                ▼
                         BAOBAB TRADE
                                │
                                ▼
                       COMPLIANCE CONTEXT
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
       Classification       Counterparty       Regulatory
                              Screening        Requirements
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                       COMPLIANCE DECISION
                                │
                       ┌────────┴────────┐
                       ▼                 ▼
                     PASS              BLOCK
                       │
                       ▼
                    SHIPMENT
                       │
                       ▼
                 CUSTOMS WORKFLOW
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Valuation       Duty      Declaration
          │            │            │
          └────────────┼────────────┘
                       ▼
                 Customs Release
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
         Inventory              ERP
      Availability          Financial Cost
```

And provider resolution remains:

```text
Transaction Context
       │
       ▼
Baobab Control Plane
       │
       ▼
Capability Binding
       │
       ├── Classification Provider
       ├── Screening Provider
       ├── Customs Provider
       └── Manual Provider
                │
                ▼
         Canonical Results
                │
                ▼
           Baobab Trade
```

The governing principle is:

> **Baobab must know whether a trade may proceed, why it may proceed, which authority or provider made that determination, which evidence supports it, and which version of the applicable regulatory context was used.**

It SHALL never confuse:

```text
platform permission
with
regulatory permission
```

or:

```text
physical arrival
with
customs release.
```

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0021
   ↓
Shared Regulatory Contracts
   ↓
Trade Compliance Context
   ↓
Provider Resolution
   ↓
Classification / Eligibility
   ↓
Compliance Gates
   ↓
Customs Workflow
   ↓
Inventory + ERP Integration
   ↓
Evidence + Reconciliation
   ↓
ZuriBeans Golden-Tenant Validation
```

No production cross-border trade SHALL proceed merely because an order, shipment or TradeLane exists. Mandatory regulatory gates must resolve successfully before the corresponding controlled action is permitted.