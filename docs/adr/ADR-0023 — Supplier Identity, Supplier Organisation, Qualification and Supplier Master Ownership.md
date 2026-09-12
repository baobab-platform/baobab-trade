# ADR-0023 — Supplier Identity, Supplier Organisation, Qualification and Supplier Master Ownership

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Identity Authority:** `nabhold/baobab-cp` / `nabhold/shared`  
**ERP Authority:** `nabhold/baobab-erp` / iDempiere  
**IAM Authority:** `nabhold/baobab-iam` / Keycloak  
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-014 — Canonical Counterparty Identity, Roles and Relationships Model
- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading Model
- ADR-0017 — Customer, B2B Organisation, Buyer Identity and Authorization
- ADR-0019 — B2B Procurement, Supplier Commercial Workflow and Trade-to-ERP Boundary Model
- ADR-0020 — Landed Cost, Margin and Commercial Price Resolution
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture
- ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction

---

# 1. Context

Baobab requires supplier onboarding for organisations that may:

- supply goods;
- supply services;
- operate in one or several markets;
- provide different products by market;
- require regulatory qualification;
- have several portal users;
- transact in different currencies;
- have different payment terms;
- also act as customers or logistics providers.

The architecture therefore SHALL NOT model a supplier simply as:

```text
Supplier {
    id
    name
    email
}
```

A supplier exists across several distinct concerns:

```text
Canonical Organisation Identity
           │
           ▼
      Supplier Role
           │
           ▼
   Supplier Relationship
           │
           ▼
Supplier Qualification
           │
           ▼
Commercial Procurement
           │
           ▼
ERP Vendor Projection
           │
           ▼
Financial Settlement
```

These concerns require different authorities.

---

# 2. Decision

Baobab SHALL adopt a **federated supplier-master architecture**.

No single application shall own every dimension of a supplier.

The governing principle is:

> **The Control Plane owns canonical organisation identity and relationships; Trade owns supplier-facing commercial relationship and qualification; ERP owns committed vendor/procurement/accounting master data; IAM owns supplier-user access.**

In compact form:

```text
WHO IS IT?
    │
    ▼
CP / Canonical Identity
    │
    ▼
CAN WE BUY FROM IT?
    │
    ▼
Trade
    │
    ▼
CAN WE COMMIT AND ACCOUNT FOR PURCHASES?
    │
    ▼
ERP
    │
    ▼
WHO MAY ACT FOR THE SUPPLIER?
    │
    ▼
IAM
```

---

# 3. Supplier Is a Role

Following ADR-BCP-014:

```text
Supplier
≠
Canonical Identity
```

Instead:

```text
Canonical Organisation
        │
        ▼
    SUPPLIER Role
```

The same canonical organisation MAY also be:

```text
CUSTOMER
DISTRIBUTOR
CARRIER
CUSTOMS_BROKER
```

without duplicate identities.

---

# 4. Supplier Organisation

A Supplier Organisation is the Trade-domain projection of a canonical organisation participating in a supplier relationship.

Conceptually:

```text
SupplierOrganisation
├── id
├── tenant_id
├── canonical_organisation_id
├── supplier_status
├── onboarding_status
├── relationship_scope
├── qualification_summary
├── commercial_status
└── external_references[]
```

---

# 5. Supplier Organisation Is Not Canonical Identity

The following SHALL remain separate:

```text
Canonical Organisation
        │
        ▼
Supplier Organisation
        │
        ▼
ERP Business Partner
```

Therefore:

```text
SupplierOrganisation.id
≠
CanonicalOrganisation.id
≠
C_BPartner_ID
```

Mappings SHALL be explicit.

---

# 6. Ownership Matrix

| Information | Authority |
|---|---|
| Canonical legal identity | CP / Shared |
| Legal identifiers | CP canonical identity |
| Supplier role | CP relationship model |
| Supplier onboarding workflow | Trade |
| Supplier qualification | Trade |
| Supplier product capability | Trade |
| Supplier market eligibility | Trade + compliance provider |
| Supplier commercial terms | Trade |
| Supplier quotation | Trade |
| Supplier sourcing event | Trade |
| Supplier award | Trade |
| Purchase commitment | ERP |
| Purchase Order | ERP |
| Goods Receipt | ERP |
| Supplier Invoice | ERP |
| AP | ERP |
| Supplier payment | ERP |
| Bank/payment master | ERP with secured workflow |
| Supplier portal users | IAM |
| Supplier IAM organisation | IAM projection |
| Supplier screening | Compliance provider |
| Supplier performance analytics | Trade/Pulse projection |

---

# 7. Supplier Lifecycle

Generic supplier relationship lifecycle SHALL support:

```text
PROSPECT
   ↓
REGISTERED
   ↓
UNDER_REVIEW
   ↓
QUALIFIED
   ↓
APPROVED
   ↓
ACTIVE
```

And exceptional/end states:

```text
REJECTED
SUSPENDED
BLOCKED
EXPIRED
DEACTIVATED
```

---

# 8. Registration Is Not Approval

This invariant is mandatory:

```text
REGISTERED
≠
APPROVED
```

A supplier creating an account or submitting an application SHALL NOT automatically become eligible for procurement.

---

# 9. Identity Verification Is Not Qualification

Likewise:

```text
Identity Verified
≠
Supplier Qualified
```

A company may legally exist but not meet ZuriBeans' procurement requirements.

---

# 10. Qualification Is Not ERP Activation

And:

```text
QUALIFIED
≠
ERP Vendor Ready
```

ERP projection may still require:

- accounting configuration;
- payment terms;
- tax configuration;
- currency;
- Business Partner creation;
- bank/payment validation.

---

# 11. Supplier Readiness

For committed procurement:

```text
Supplier Ready
=
Canonical Identity Ready
+
Supplier Approved
+
Required Qualification Valid
+
Required Compliance Valid
+
ERP Projection Ready
+
IAM Ready where portal access required
```

---

# 12. Scope of Supplier Approval

Supplier approval SHALL support scope.

A supplier SHALL NOT necessarily be approved universally.

Example:

```text
Supplier X

Uganda:
    Coffee → APPROVED
    Vanilla → APPROVED

South Africa:
    Wine → NOT_APPROVED
```

---

# 13. Qualification Scope

Qualification MAY be scoped by:

```text
tenant
legal entity
market
product
product category
trade lane
sourcing programme
effective period
```

---

# 14. Supplier Qualification

Conceptually:

```text
SupplierQualification
├── supplier_organisation_id
├── qualification_type
├── scope
├── status
├── effective_from
├── effective_to
├── evidence[]
├── approved_by
└── approval_reference
```

---

# 15. Qualification Types

Initial extensible categories MAY include:

```text
IDENTITY
COMMERCIAL
FINANCIAL
QUALITY
REGULATORY
PRODUCT
CAPACITY
ESG
LOGISTICS
FOOD_SAFETY
OTHER
```

The platform SHALL not hard-code coffee-only qualification semantics.

---

# 16. Qualification Status

Suggested:

```text
NOT_STARTED
PENDING
UNDER_REVIEW
PASSED
PASSED_WITH_CONDITIONS
FAILED
EXPIRED
WAIVED
```

`WAIVED` SHALL require explicit authority and audit.

---

# 17. Evidence

Qualification SHALL reference evidence.

Examples:

```text
company registration
tax registration
licence
quality certification
food-safety certification
bank confirmation
insurance
product specification
capacity evidence
```

The evidence architecture SHALL preserve provenance.

---

# 18. Evidence Expiry

A qualification may expire because underlying evidence expires.

Example:

```text
Certificate valid until 2027-03-31
        ↓
Supplier qualification derived from certificate
        ↓
Qualification cannot remain indefinitely valid
```

---

# 19. Supplier Product Capability

Trade SHALL model what a supplier can supply.

Conceptually:

```text
SupplierProductCapability
├── supplier_id
├── canonical_product_id
├── supplier_product_reference
├── market
├── origin
├── capacity?
├── MOQ?
├── lead_time?
├── UOM
├── qualification_status
└── effective_period
```

---

# 20. Supplier Product ≠ Canonical Product

A supplier may describe:

```text
"AA Washed Arabica"
```

while Baobab maps it to a canonical product.

Mapping SHALL be explicit.

```text
Supplier Product
      ↓
Canonical Mapping
      ↓
Canonical Product
```

---

# 21. No Silent Product Mapping

Supplier product mapping SHALL NOT rely solely on fuzzy description matching for binding procurement.

Suggested matches may be automated.

Final authoritative mapping SHALL be verified.

---

# 22. Supplier Market Capability

A supplier operating in Uganda does not automatically become eligible to supply:

```text
every ZuriBeans market
```

Eligibility SHALL consider:

```text
supplier location
seller/buyer legal entity
product
origin
destination
qualification
trade lane
regulation
```

---

# 23. Local Supplier Scenario

Example:

```text
Uganda Coffee Cooperative
        ↓
ZuriBeans Uganda
```

may be:

```text
SUPPLIER
+
UG market approved
+
Coffee qualified
```

---

# 24. Cross-Border Supplier Scenario

A supplier in Kenya may supply ZuriBeans Uganda without ZuriBeans operating a Kenyan legal entity.

Therefore:

```text
supplier source market
≠
tenant operating market
```

shall be supported where policy/legal context permits.

---

# 25. Supplier Origin ≠ Product Origin

A South African supplier may supply Ugandan-origin coffee.

Therefore:

```text
Supplier Country
≠
Country of Origin
```

---

# 26. Supplier Qualification vs Product Origin

Origin SHALL be determined through product/batch/evidence context, not merely supplier registered address.

---

# 27. Procurement Boundary

ADR-0019 remains authoritative:

> Trade owns supplier-facing commercial workflow; ERP owns committed procurement, receipt, liability and accounting.

This ADR clarifies supplier-master responsibilities underneath that workflow.

---

# 28. Supplier RFQ

Trade SHALL own:

```text
Supplier RFQ
Supplier Quotation
Sourcing Event
Quote Comparison
Commercial Evaluation
Award
```

---

# 29. Award Does Not Create Financial Commitment by Itself

A Trade award becomes a committed procurement transaction only after the canonical procurement commitment is accepted by ERP.

```text
Trade Award
     ↓
Procurement Commitment
     ↓
ERP Purchase Order
```

---

# 30. ERP Vendor Projection

Approved suppliers requiring committed procurement SHALL map to an iDempiere Business Partner.

```text
Canonical Organisation
        │
        ▼
Supplier Organisation
        │
        ▼
ExternalReference
        │
        ▼
C_BPartner
```

---

# 31. ERP Business Partner Is Not Supplier Identity

`C_BPartner` SHALL remain an ERP projection.

---

# 32. ERP Vendor Activation

ERP projection MAY require:

```text
Business Partner
Vendor status
Payment terms
Currency
Tax context
Accounts
Organisation scope
```

depending on iDempiere configuration.

---

# 33. Projection Failure

If:

```text
Supplier = APPROVED
ERP Business Partner creation = FAILED
```

then:

```text
supplier onboarding
```

may be complete while:

```text
procurement commitment
```

remains NOT_READY.

---

# 34. Supplier Portal Identity

Supplier portal access SHALL use IAM.

Conceptually:

```text
Canonical Supplier Organisation
          │
          ▼
Keycloak Organisation
          │
          ▼
Supplier Users
```

---

# 35. IAM Organisation Is Not Supplier Master

Keycloak SHALL own:

```text
membership
login
roles
authentication
session
MFA
```

not:

```text
supplier approval
bank account
qualification
commercial status
```

---

# 36. Supplier User vs Supplier Organisation

A supplier may have:

```text
10 users
```

but still one Supplier Organisation.

Likewise:

```text
user disabled
```

does not necessarily imply:

```text
supplier deactivated.
```

---

# 37. Supplier User Roles

Possible IAM roles MAY include:

```text
SUPPLIER_ADMIN
SUPPLIER_SALES
SUPPLIER_FINANCE
SUPPLIER_LOGISTICS
SUPPLIER_READ_ONLY
```

Exact authorization remains IAM policy.

---

# 38. Supplier Administrator

Supplier administrators MAY manage organisation membership, but SHALL NOT gain permission to:

```text
self-approve supplier
approve qualification
alter internal risk assessment
approve own bank change
```

---

# 39. Internal Supplier Roles

Baobab operational roles may include:

```text
PROCUREMENT_OFFICER
SUPPLIER_REVIEWER
SUPPLIER_APPROVER
COMPLIANCE_OFFICER
FINANCE_APPROVER
```

Separation of duties SHOULD be enforced.

---

# 40. Supplier Bank Details

Bank information is security-sensitive.

It SHALL NOT be treated as ordinary editable profile metadata.

---

# 41. Bank Detail Ownership

Financial settlement data SHOULD be authoritative in ERP or a dedicated secured payment/master-data workflow integrated with ERP.

Trade MAY expose a controlled onboarding interface.

---

# 42. Bank Change Workflow

Bank-detail change SHOULD follow:

```text
Change Request
      ↓
Independent Verification
      ↓
Approval
      ↓
ERP Update
      ↓
Audit
```

---

# 43. No Supplier Self-Activation of Bank Changes

A supplier portal user SHALL NOT directly change authoritative payment destination without governed verification.

---

# 44. Fraud Control

Sensitive supplier-master changes SHALL support:

```text
maker-checker
MFA
audit
notifications
hold period where policy requires
```

---

# 45. Payment Terms

Payment terms are commercial/financial configuration.

Trade MAY negotiate/display them.

ERP SHALL own the terms used for committed AP transactions.

---

# 46. Supplier Currency

Supplier commercial currency and ERP transaction currency SHALL be explicitly resolved.

No assumption SHALL be made from supplier country.

---

# 47. Supplier Tax Information

Tax registration identifiers belong to canonical verified identity/regulatory data.

Tax treatment for a transaction remains governed by tax context.

---

# 48. Supplier Compliance

Supplier qualification MAY consume ADR-0021 capabilities:

```text
restricted-party screening
licence validation
product eligibility
regulatory status
```

---

# 49. Screening Frequency

Supplier screening MAY occur:

```text
on onboarding
on requalification
periodically
at transaction time
```

depending on policy.

---

# 50. Supplier Approved ≠ Transaction Cleared

A supplier approved last month does not guarantee today's purchase is compliant.

Transaction-level checks remain possible.

---

# 51. Quality Qualification

Trade SHALL support product/category-specific quality approval.

Example:

```text
Supplier approved as organisation
        │
        ├── Coffee → APPROVED
        └── Vanilla → PENDING
```

---

# 52. Capacity

Supplier capacity is time-varying operational information.

It SHALL NOT be stored as permanent canonical identity.

---

# 53. Supplier Capacity

Conceptually:

```text
SupplierCapacity
├── supplier
├── product
├── market
├── period
├── available_quantity
├── UOM
└── confidence/source
```

This MAY be Release 1.1.

---

# 54. Supplier Performance

Performance is relationship data.

Suggested dimensions:

```text
on-time delivery
quality acceptance
quantity variance
price variance
documentation accuracy
claim rate
responsiveness
```

---

# 55. Supplier Performance Is Not Canonical Identity

Performance remains tenant-specific.

ZuriBeans' supplier assessment SHALL NOT automatically become Thamani's supplier assessment.

---

# 56. Supplier Suspension

Suspension SHOULD support scopes.

Example:

```text
Organisation active
Supplier role active

Coffee / Uganda:
    SUSPENDED

Vanilla / Uganda:
    ACTIVE
```

---

# 57. Supplier Block

A block MAY derive from:

```text
compliance
quality
fraud
commercial dispute
financial risk
policy violation
```

Reason and authority SHALL be auditable.

---

# 58. Supplier Reinstatement

Reinstatement SHALL require explicit approval when the prior status was blocked/suspended.

---

# 59. Supplier Expiry

Qualification MAY expire without deactivating the canonical organisation.

Example:

```text
Organisation = ACTIVE
Supplier Relationship = ACTIVE
Coffee Qualification = EXPIRED
```

Procurement of coffee SHALL then fail closed if qualification is mandatory.

---

# 60. Supplier Deactivation

Deactivation SHALL prevent new commitments but SHALL NOT delete historical:

```text
RFQs
orders
receipts
invoices
payments
shipments
```

---

# 61. Supplier Merge

Canonical identity merge remains governed by ADR-BCP-014.

Trade SHALL remap supplier projections safely.

---

# 62. Duplicate Supplier Prevention

The same canonical organisation SHALL NOT have uncontrolled duplicate SupplierOrganisation projections for the same tenant/scope.

---

# 63. Supplier Relationship per Tenant

Example:

```text
Canonical Organisation X
       │
       ├── ZuriBeans Supplier Profile
       └── Thamani Supplier Profile
```

The two profiles MAY have completely different:

```text
qualification
products
terms
status
performance
```

---

# 64. ZuriBeans and Thamani Independence

The fact both are Nabhold subsidiaries SHALL NOT cause automatic supplier approval sharing.

This is mandatory.

---

# 65. Shared Supplier Identity, Independent Commercial Relationship

The preferred invariant:

```text
shared canonical identity
+
isolated tenant supplier relationship
```

---

# 66. Supplier Relationship with Multiple Legal Entities

Within one tenant, a supplier MAY transact with different legal entities where tenant/legal architecture permits.

Commercial/accounting configuration MAY therefore require legal-entity scope.

---

# 67. Business Partner Mapping Scope

ERP mappings SHALL include sufficient context:

```text
tenant
engine instance
legal entity / client / organisation scope
external ID
```

---

# 68. Supplier Account Number

Internal supplier/vendor account numbers SHALL NOT replace canonical IDs.

---

# 69. Supplier Registration Flow

```text
Supplier Applicant
      │
      ▼
Registration Form
      │
      ▼
Counterparty Candidate
      │
      ▼
Canonical Identity Resolution
      │
      ▼
Supplier Role Assignment
      │
      ▼
Supplier Organisation
      │
      ▼
Qualification
      │
      ▼
Approval
      │
      ▼
ERP + IAM Provisioning
      │
      ▼
ACTIVE
```

---

# 70. Existing Organisation Flow

If the organisation already exists:

```text
Registration
     ↓
Identity Match
     ↓
Existing Canonical Organisation
     ↓
New Supplier Relationship
```

No duplicate organisation SHALL be created.

---

# 71. Dual-Role Flow

Existing customer becomes supplier:

```text
Canonical Organisation
      │
      ├── CUSTOMER
      │
      └── SUPPLIER ← add role
```

No duplicate identity.

---

# 72. Self-Registration

Supplier self-registration SHALL create a candidate/onboarding record, not an authoritative supplier master directly.

---

# 73. Invite-Based Registration

Baobab SHOULD also support:

```text
Procurement Team
      ↓
Supplier Invitation
      ↓
Supplier Registration
```

---

# 74. Invitation Does Not Imply Approval

Invitation merely authorises participation in onboarding.

---

# 75. Supplier Onboarding Tasks

A supplier onboarding case MAY contain:

```text
identity verification
tax details
market selection
product capability
certifications
bank details
compliance screening
quality review
commercial review
approval
ERP provisioning
IAM provisioning
```

---

# 76. Onboarding State Machine

Suggested:

```text
DRAFT
   ↓
SUBMITTED
   ↓
IDENTITY_REVIEW
   ↓
QUALIFICATION_REVIEW
   ↓
APPROVAL_PENDING
   ↓
APPROVED
   ↓
PROVISIONING
   ↓
ACTIVE
```

Exceptions:

```text
MORE_INFORMATION_REQUIRED
REJECTED
WITHDRAWN
EXPIRED
```

---

# 77. Workflow Resumption

Supplier applicants SHALL be able to resume incomplete applications securely where policy permits.

---

# 78. Requested Changes

Reviewers SHOULD be able to return specific sections for correction rather than requiring complete restart.

---

# 79. Immutable Decision History

Approval/rejection history SHALL be auditable.

---

# 80. Rejection

Supplier rejection SHALL record:

```text
reason
actor
timestamp
scope
```

Internal sensitive reasons MAY require restricted visibility.

---

# 81. Applicant Visibility

Supplier-facing responses SHALL not expose confidential compliance/security information unnecessarily.

---

# 82. Document Upload Security

Supplier-uploaded files SHALL be:

```text
type validated
size bounded
malware scanned
tenant scoped
access controlled
```

before trusted use.

---

# 83. Document Storage

Raw supplier evidence SHALL not live inside IAM.

Use the designated evidence/document architecture.

---

# 84. Supplier Change Requests

After activation, changes SHOULD be made through governed change requests for material fields.

Examples:

```text
legal name
tax identifier
bank account
ownership
licence
registered address
```

---

# 85. Material Identity Changes

Canonical identity changes SHALL follow ADR-BCP-014 authority rules.

Trade SHALL not independently overwrite verified identity.

---

# 86. Supplier Commercial Changes

Trade owns changes such as:

```text
supplier product capability
lead time
MOQ
commercial contact
supplier qualification
```

subject to governance.

---

# 87. Purchase Commitment Readiness

Before ERP PO creation, system SHALL validate at least:

```text
supplier identity resolved
supplier role valid
supplier approved for scope
product mapping valid
market participation valid
mandatory compliance valid
ERP Business Partner resolved
```

---

# 88. Fail-Closed Rule

If a mandatory supplier dependency is unresolved:

```text
Purchase Commitment
       ↓
BLOCKED
```

The platform SHALL NOT manufacture placeholder vendor IDs.

---

# 89. Emergency Procurement

Emergency procurement MAY bypass some normal workflow only under explicitly authorised policy.

It SHALL NOT bypass:

```text
canonical identity
mandatory legal/compliance checks
audit
financial controls
```

---

# 90. Framework Suppliers

Framework agreements MAY prequalify suppliers for:

```text
products
markets
period
commercial conditions
```

but transaction-level checks still apply.

---

# 91. Spot Suppliers

Spot procurement MAY use an accelerated qualification path where policy permits.

The supplier SHALL still resolve to canonical identity.

---

# 92. Internal Supplier

A related Nabhold legal entity MAY act as supply counterparty.

ADR-BCP-012 decides legal relationship classification.

No duplicate external supplier identity SHALL be created.

---

# 93. Internal Supply

For related entities:

```text
Supplier Organisation
```

may reference the internal canonical LegalEntity.

---

# 94. Inter-Branch Supply

Same legal entity movement SHOULD not be represented as external supplier procurement where the legal model determines it is an internal stock transfer.

---

# 95. Procurement Classification

System SHALL resolve:

```text
external procurement
intercompany procurement
internal transfer
```

before choosing downstream transaction path.

---

# 96. Events

Canonical supplier events SHOULD include:

```text
supplier.registration-submitted
supplier.identity-resolved
supplier.role-assigned
supplier.qualification-started
supplier.qualification-completed
supplier.approved
supplier.rejected
supplier.activated
supplier.suspended
supplier.reinstated
supplier.deactivated

supplier.product-capability-added
supplier.product-capability-removed

supplier.erp-provisioning-requested
supplier.erp-provisioned
supplier.erp-provisioning-failed

supplier.iam-provisioned
```

---

# 97. Event Envelope

Events SHALL include:

```text
tenant_id
supplier_organisation_id
canonical_organisation_id
legal_entity where relevant
correlation_id
causation_id
schema_version
occurred_at
```

---

# 98. Idempotency

Repeated supplier provisioning events SHALL NOT create duplicate:

```text
ERP Business Partners
IAM Organisations
supplier roles
```

---

# 99. Projection Reconciliation

Baobab SHALL reconcile:

```text
Canonical Organisation
↕
Trade Supplier Organisation

Trade Supplier Organisation
↕
ERP Business Partner

Supplier Organisation
↕
IAM Organisation
```

---

# 100. Reconciliation States

Suggested:

```text
MATCHED
PENDING
MISSING
STALE
MISMATCH
CONFLICT
BLOCKED
```

---

# 101. Supplier Readiness Projection

Trade SHOULD expose a summary such as:

```text
SupplierReadiness
├── identity
├── qualification
├── compliance
├── trade_projection
├── erp_projection
├── iam_projection
└── overall
```

---

# 102. Readiness State

Use established progression:

```text
DECLARED
   ↓
CONTRACTED
   ↓
IMPLEMENTED
   ↓
PROVISIONED
   ↓
INTEGRATED
   ↓
TESTED
   ↓
READY
```

---

# 103. No READY by Database Presence

A SupplierOrganisation database row alone SHALL NOT imply supplier readiness.

---

# 104. API Boundary

Trade MAY expose canonical supplier-facing APIs such as:

```text
POST /supplier-applications
GET  /supplier-applications/{id}

GET  /suppliers/{id}
POST /suppliers/{id}/qualifications
POST /suppliers/{id}/products
POST /suppliers/{id}/suspend
POST /suppliers/{id}/reinstate
```

Exact endpoint design remains implementation-specific.

---

# 105. Supplier Self-Service API

Supplier portal APIs SHALL expose only permitted organisation-specific operations.

Internal approval/status mutation endpoints SHALL require internal authorization.

---

# 106. ERP API

Trade SHALL interact with ERP through canonical integration contracts.

It SHALL NOT manipulate iDempiere tables directly.

---

# 107. IAM API

Trade SHALL request/provision IAM organisation mappings through supported IAM integration boundaries.

It SHALL NOT modify Keycloak persistence directly.

---

# 108. Security Boundary

Supplier portal requests SHALL resolve:

```text
Authenticated User
      ↓
IAM Organisation
      ↓
Canonical Organisation
      ↓
Supplier Organisation
      ↓
Tenant
```

before access is granted.

---

# 109. Cross-Supplier Isolation

Supplier A SHALL NOT read:

```text
Supplier B RFQs
Supplier B quotations
Supplier B qualification evidence
Supplier B bank details
```

---

# 110. Cross-Tenant Isolation

A ZuriBeans supplier relationship SHALL NOT automatically expose Thamani supplier data.

---

# 111. Sensitive Fields

Fields such as:

```text
bank details
tax identifiers
beneficial ownership
risk findings
compliance findings
internal ratings
```

SHALL receive stricter authorization.

---

# 112. Audit

Audit SHALL cover at minimum:

```text
registration
identity resolution
qualification
approval
rejection
suspension
reinstatement
product capability change
bank change
ERP provisioning
IAM provisioning
role change
```

---

# 113. Observability

Recommended metrics:

```text
supplier_application_total
supplier_application_pending
supplier_approval_total
supplier_rejection_total

supplier_qualification_expired_total
supplier_suspended_total

supplier_erp_projection_failure_total
supplier_iam_projection_failure_total

supplier_readiness_blocked_total
supplier_reconciliation_mismatch_total
```

---

# 114. Alerts

Production alerts SHOULD cover:

- provisioning backlog;
- ERP projection failures;
- identity-resolution ambiguity;
- expired mandatory qualifications;
- compliance blocks;
- bank-detail approval anomalies;
- cross-system reconciliation failures.

---

# 115. Test — New Supplier

Prove:

```text
registration
→ canonical identity
→ supplier role
→ qualification
→ approval
→ ERP Business Partner
→ IAM Organisation
→ ACTIVE
```

---

# 116. Test — Existing Customer Becomes Supplier

Prove:

```text
existing canonical organisation
+
existing CUSTOMER role
+
new SUPPLIER role
```

without duplicate identity.

---

# 117. Test — Same Supplier Across Tenants

Prove:

```text
Organisation X
├── ZuriBeans Supplier Profile
└── Thamani Supplier Profile
```

with isolated:

```text
terms
qualification
approval
performance
```

---

# 118. Test — Product-Specific Approval

Supplier approved for coffee but not vanilla.

Coffee PO allowed.

Vanilla PO blocked.

---

# 119. Test — Market-Specific Approval

Supplier approved for Uganda procurement but not South Africa procurement.

Scope SHALL be enforced.

---

# 120. Test — Expired Qualification

Mandatory certificate expires.

New commitment SHALL fail according to policy.

---

# 121. Test — ERP Provisioning Failure

Supplier remains approved, but procurement readiness SHALL remain blocked.

---

# 122. Test — IAM Failure

Where supplier portal access is required:

```text
IAM provisioning failure
```

shall prevent portal readiness but SHALL NOT corrupt supplier identity.

---

# 123. Test — Duplicate Registration

Second registration using verified legal identifier SHALL resolve existing organisation rather than create uncontrolled duplicate.

---

# 124. Test — Similar Name

Similar legal names without sufficient authoritative match SHALL produce review, not automatic merge.

---

# 125. Test — Bank Change Attack

Supplier user attempts direct replacement of payment bank account.

System SHALL require governed verification/approval.

---

# 126. Test — Cross-Supplier Attack

Supplier A user attempts Supplier B resources.

Result:

```text
DENY
```

---

# 127. Test — Cross-Tenant Attack

Thamani operator attempts to access ZuriBeans supplier qualification.

Result:

```text
DENY
```

---

# 128. Test — Internal Legal Entity

Related legal entity used as supplier.

System SHALL reference canonical LegalEntity and ADR-BCP-012 relationship rather than create external duplicate.

---

# 129. Test — Same-Entity Transfer

Same legal entity branch-to-branch movement SHALL not accidentally generate external supplier AP workflow.

---

# 130. Rejected Alternative — Trade Owns All Supplier Master Data

Rejected because Trade SHALL NOT own:

- canonical legal identity;
- financial accounting master;
- authentication.

---

# 131. Rejected Alternative — ERP Business Partner Is Supplier Master

Rejected because ERP does not own:

- supplier registration;
- portal workflow;
- qualification;
- product capability;
- sourcing events.

---

# 132. Rejected Alternative — IAM Organisation Is Supplier Master

Rejected because identity/access does not represent commercial supplier qualification.

---

# 133. Rejected Alternative — Separate Canonical Supplier Identity

Rejected because ADR-BCP-014 already provides canonical organisation identity.

Supplier is a role/relationship.

---

# 134. Rejected Alternative — One Supplier Approval Globally

Rejected because approval can vary by:

```text
tenant
market
product
legal entity
trade lane
```

---

# 135. Rejected Alternative — Supplier Registration Creates ERP Vendor Immediately

Rejected because unverified/unqualified entities SHALL NOT automatically become finance-ready vendors.

---

# 136. Rejected Alternative — Supplier Controls Authoritative Bank Master

Rejected due to fraud and financial-control risk.

---

# 137. Rejected Alternative — Share ZuriBeans Supplier Approval with Thamani

Rejected.

The companies are separate legal entities with independent operations.

Canonical identity may be shared; approval SHALL not be presumed shared.

---

# 138. Positive Consequences

This architecture provides:

- one canonical organisation identity;
- independent supplier relationships;
- clean procurement boundaries;
- safe supplier self-service;
- ERP accounting integrity;
- secure bank-master workflow;
- multi-market supplier approval;
- product-specific qualification;
- cross-border supplier support;
- strong tenant isolation;
- future supplier analytics.

---

# 139. Costs

It requires:

- supplier onboarding workflow;
- qualification models;
- cross-system projection;
- reconciliation;
- document/evidence handling;
- IAM organisation mapping;
- ERP Business Partner provisioning;
- approval controls.

These are necessary costs for production-grade B2B procurement.

---

# 140. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Supplier contracts/events |
| `nabhold/baobab-cp` | Canonical organisation/role/relationship/mapping |
| `nabhold/baobab-trade` | Supplier relationship, onboarding, qualification, sourcing |
| `nabhold/baobab-erp` | Vendor projection, PO, receipt, AP, settlement |
| `nabhold/baobab-iam` | Supplier organisation users/access |
| `nabhold/baobab-cms` | Evidence/content support where applicable |
| `nabhold/baobab-pulse` | Optional supplier intelligence |
| `nabhold/infrastructure` | Events, secrets, storage, observability |

---

# 141. Implementation Sequence

```text
ADR-BCP-014 Contracts
        ↓
Supplier Role
        ↓
Supplier Organisation
        ↓
Application / Onboarding
        ↓
Qualification
        ↓
Product Capability
        ↓
Approval
        ↓
IAM Projection
        ↓
ERP Business Partner Projection
        ↓
Readiness
        ↓
Procurement Integration
        ↓
Reconciliation
        ↓
Golden-Tenant Tests
```

---

# 142. Release 1 P0 Scope

ZuriBeans Release 1 SHALL provide:

- supplier self-registration;
- invited registration;
- canonical identity resolution;
- Supplier Organisation;
- supplier role assignment;
- product capability;
- market/product qualification;
- approval/rejection;
- evidence references;
- expiry;
- suspension/reinstatement;
- IAM organisation provisioning;
- ERP Business Partner provisioning;
- readiness state;
- tenant isolation;
- auditing;
- reconciliation;
- controlled bank-master workflow.

---

# 143. Deferred Enhancements

Possible Release 1.1+:

- supplier scorecards;
- automated registry verification;
- capacity forecasts;
- AI-assisted document review;
- supplier discovery;
- supplier recommendation;
- ESG scoring;
- supplier network intelligence;
- automated requalification;
- supplier-risk prediction.

AI recommendations SHALL remain advisory unless explicitly governed.

---

# 144. Definition of Done

ADR-0023 is implemented when:

- [ ] Supplier is represented as a role, not duplicate identity;
- [ ] SupplierOrganisation references canonical organisation;
- [ ] registration does not imply approval;
- [ ] identity verification differs from qualification;
- [ ] qualification can be scoped by market/product/legal entity;
- [ ] evidence supports qualification;
- [ ] qualification expiry works;
- [ ] supplier product mapping works;
- [ ] duplicate registrations resolve canonical identity;
- [ ] dual customer/supplier role works;
- [ ] supplier approval remains tenant-specific;
- [ ] ZuriBeans and Thamani supplier data remain isolated;
- [ ] supplier portal IAM mapping works;
- [ ] ERP Business Partner provisioning works;
- [ ] ERP projection failure blocks procurement readiness;
- [ ] bank-detail changes use controlled approval;
- [ ] compliance screening integrates;
- [ ] supplier suspension works;
- [ ] historical procurement survives deactivation;
- [ ] events are idempotent;
- [ ] reconciliation works;
- [ ] security tests pass;
- [ ] local supplier scenario passes;
- [ ] cross-border supplier scenario passes;
- [ ] internal-related-party scenario passes;
- [ ] same-entity internal movement does not become false external procurement.

---

# 145. Final Architecture

```text
                  CANONICAL ORGANISATION
                          │
                          ▼
                    SUPPLIER ROLE
                          │
                          ▼
                 SUPPLIER ORGANISATION
                          │
          ┌───────────────┼─────────────────┐
          ▼               ▼                 ▼
     Qualification   Product Capability   Commercial
          │               │              Relationship
          └───────────────┼─────────────────┘
                          ▼
                       APPROVED
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
            IAM                       ERP
             │                         │
      Supplier Users             C_BPartner
                                       │
                                       ▼
                                Purchase Order
                                       │
                                       ▼
                                Goods Receipt
                                       │
                                       ▼
                                      AP
```

The authority boundary is:

```text
CP
│
├── Who is the organisation?
└── What role/relationship does it have?

Trade
│
├── May we source from it?
├── For what?
├── Where?
└── Under what commercial conditions?

ERP
│
├── Can we commit procurement?
├── Can we receive?
├── Can we recognise liability?
└── Can we pay?

IAM
│
└── Who may act on behalf of the supplier?
```

The central invariant is:

> **There is no single monolithic Supplier Master. Baobab uses a governed canonical identity with domain-owned supplier projections, each authoritative only for the state it legitimately owns.**

And specifically:

> **ZuriBeans' approval of a supplier SHALL never automatically mean that Thamani has approved that supplier, even when both relationships reference the same canonical organisation.**

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0023
    ↓
Canonical Supplier Contracts
    ↓
Supplier Organisation
    ↓
Onboarding + Qualification
    ↓
Product / Market Eligibility
    ↓
Approval
    ↓
IAM + ERP Provisioning
    ↓
Procurement Readiness
    ↓
Reconciliation
    ↓
ZuriBeans Golden-Tenant Validation
```

No Baobab implementation SHALL establish a second independent supplier identity where a canonical organisation already exists, and no supplier SHALL become procurement-ready merely because registration succeeded.