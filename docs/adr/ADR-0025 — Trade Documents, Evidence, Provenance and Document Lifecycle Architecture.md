# ADR-0025 — Trade Documents, Evidence, Provenance and Document Lifecycle Architecture

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Contracts:** `nabhold/shared`  
**Context/Provider Resolution:** `nabhold/baobab-cp`  
**Content/Document Services:** `nabhold/baobab-cms` where appropriate  
**Financial Consumers:** `nabhold/baobab-erp`  
**Identity/Authorization:** `nabhold/baobab-iam`  
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model
- ADR-BCP-014 — Canonical Counterparty Identity, Roles and Relationships Model
- ADR-0014 — Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0019 — B2B Procurement and Supplier Commercial Workflow
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture
- ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction
- ADR-0023 — Supplier Identity, Qualification and Supplier Master Ownership
- ADR-0024 — Product Regulatory Classification, Market Eligibility and Tradeability Model

---

# 1. Context

Cross-border B2B trade produces and consumes many documents and evidence artifacts.

Examples include:

```text
supplier quotation
purchase order
sales order
commercial invoice
pro forma invoice
packing list
certificate of origin
phytosanitary certificate
quality certificate
bill of lading
air waybill
road consignment note
customs declaration
import permit
export permit
proof of delivery
insurance certificate
inspection certificate
credit note
debit note
payment evidence
```

These artifacts differ in legal significance, authority, source, retention, lifecycle, mutability and storage.

Baobab therefore SHALL NOT model all documents as:

```text
File {
    id
    filename
    url
}
```

A trade document is not merely a file.

---

# 2. Decision

Baobab SHALL establish a canonical **Trade Document and Evidence architecture** that separates:

```text
Document Identity
Document Metadata
Document Content
Document Version
Document Evidence
Document Relationship
Transactional Reference
External Authority
Storage Location
```

The governing principle is:

> **Baobab owns the canonical identity, metadata, provenance, relationship and lifecycle of trade documents; authoritative transactional systems own the business records they generate; immutable evidence content SHALL be stored in governed document storage and referenced canonically rather than duplicated across engines.**

---

# 3. Document ≠ File

This distinction is fundamental.

```text
Trade Document
     │
     ├── identity
     ├── semantic type
     ├── business context
     ├── provenance
     ├── lifecycle
     ├── versions
     └── content reference
```

A file is merely one representation.

---

# 4. Canonical Trade Document

Conceptually:

```text
TradeDocument
├── id
├── tenant_id
├── document_type
├── document_number?
├── document_status
├── issuer
├── recipient?
├── source_system
├── source_reference
├── legal_entity
├── transaction_context
├── effective_date?
├── issued_at?
├── expires_at?
├── current_version
├── confidentiality
└── created_at
```

---

# 5. Document Content

Content SHALL remain separately addressable.

Conceptually:

```text
DocumentContent
├── document_id
├── version
├── storage_reference
├── media_type
├── size
├── checksum
├── encryption_metadata?
├── created_at
└── immutable
```

---

# 6. Canonical Identity vs Source Document

A source system may generate:

```text
ERP Invoice #INV-20382
```

Baobab SHALL preserve:

```text
Canonical TradeDocument ID
        │
        ▼
ExternalReference
        │
        ▼
ERP Invoice #INV-20382
```

The ERP identifier SHALL NOT become the cross-platform document identity.

---

# 7. Authority

A canonical document record SHALL indicate its authority.

Possible authorities:

```text
TRADE
ERP
CUSTOMS_PROVIDER
LOGISTICS_PROVIDER
SUPPLIER
BUYER
REGULATORY_AUTHORITY
BANK
INSURER
OTHER_PROVIDER
```

---

# 8. Authority Is Document-Specific

No single engine owns all documents.

Examples:

| Document                       | Likely Authority                       |
| ------------------------------ | -------------------------------------- |
| Supplier quotation             | Trade                                  |
| Purchase order                 | ERP                                    |
| Customer quotation             | Trade                                  |
| Sales order                    | ERP / canonical transaction projection |
| Commercial invoice             | ERP                                    |
| Customs declaration            | Customs provider                       |
| Transport document             | Logistics provider                     |
| Proof of delivery              | Logistics provider                     |
| Qualification certificate      | External authority / supplier evidence |
| Product compliance certificate | Regulatory authority/provider          |

---

# 9. CMS Is Not Automatically the Transactional Document Authority

Payload CMS MAY provide:

```text
document management
media storage integration
metadata presentation
content retrieval
```

but SHALL NOT become the authority for financial or regulated transactional records merely because it can store files.

---

# 10. Trade Does Not Own Every Document Either

Trade SHALL orchestrate and reference documents required by trade workflows.

It SHALL not recreate authoritative ERP invoices, customs declarations or carrier documents as competing records.

---

# 11. Evidence

A document may act as evidence.

Evidence SHALL be modelled explicitly.

Conceptually:

```text
Evidence
├── id
├── evidence_type
├── subject_type
├── subject_id
├── document_id
├── issuer
├── verification_state
├── verified_by?
├── verified_at?
├── valid_from?
├── valid_to?
└── provenance
```

---

# 12. Document ≠ Evidence

A document can exist without currently being accepted as evidence.

For example:

```text
Supplier uploads certificate
        ↓
TradeDocument exists
        ↓
Evidence verification pending
```

---

# 13. Evidence Verification

Canonical verification states SHOULD include:

```text
UNVERIFIED
PENDING
VERIFIED
REJECTED
EXPIRED
REVOKED
DISPUTED
```

---

# 14. Provenance

Every critical trade document SHALL retain provenance.

At minimum where applicable:

```text
issuer
source system
source identifier
created_at
received_at
uploaded_by
generated_by
provider
verification source
checksum
version
```

---

# 15. Provenance Chain

Conceptually:

```text
External Authority
       │
       ▼
Document Issued
       │
       ▼
Provider / Upload Channel
       │
       ▼
Baobab Canonical Document
       │
       ▼
Evidence Verification
       │
       ▼
Transaction / Compliance Decision
```

---

# 16. Document Types

The type system SHALL be extensible.

Initial families MAY include:

```text
COMMERCIAL
PROCUREMENT
LOGISTICS
CUSTOMS
REGULATORY
FINANCIAL
QUALITY
INSURANCE
IDENTITY
PAYMENT
CONTRACT
OTHER
```

---

# 17. Procurement Documents

Examples:

```text
SUPPLIER_RFQ
SUPPLIER_QUOTATION
PURCHASE_REQUISITION
PURCHASE_ORDER
GOODS_RECEIPT
SUPPLIER_INVOICE
```

---

# 18. Sales Documents

Examples:

```text
CUSTOMER_RFQ
CUSTOMER_QUOTATION
SALES_ORDER
PRO_FORMA_INVOICE
COMMERCIAL_INVOICE
CREDIT_NOTE
DEBIT_NOTE
```

---

# 19. Logistics Documents

Examples:

```text
PACKING_LIST
BILL_OF_LADING
AIR_WAYBILL
ROAD_CONSIGNMENT_NOTE
DELIVERY_NOTE
PROOF_OF_DELIVERY
FREIGHT_INVOICE
```

---

# 20. Regulatory Documents

Examples:

```text
CERTIFICATE_OF_ORIGIN
PHYTOSANITARY_CERTIFICATE
HEALTH_CERTIFICATE
QUALITY_CERTIFICATE
CONFORMITY_CERTIFICATE
IMPORT_PERMIT
EXPORT_PERMIT
INSPECTION_CERTIFICATE
PRODUCT_REGISTRATION
```

---

# 21. Customs Documents

Examples:

```text
CUSTOMS_DECLARATION
CUSTOMS_ASSESSMENT
CUSTOMS_RELEASE
DUTY_ASSESSMENT
IMPORT_TAX_ASSESSMENT
```

---

# 22. Financial Documents

Examples:

```text
PAYMENT_ADVICE
BANK_CONFIRMATION
LETTER_OF_CREDIT
BANK_GUARANTEE
INSURANCE_POLICY
INSURANCE_CERTIFICATE
```

Trade finance details are governed separately by the future Trade Finance ADR.

---

# 23. Type ≠ Filename

The platform SHALL NOT infer document semantics from filenames such as:

```text
invoice_final_2_REAL.pdf
```

Document type SHALL be explicit metadata.

---

# 24. Document Number

Business document numbers MAY exist independently of canonical IDs.

Example:

```text
Canonical ID:
doc_01J...

Business Number:
INV-ZA-2026-001248
```

Both SHALL be preserved.

---

# 25. External References

Provider/system references SHALL use governed external mappings.

Example:

```text
Canonical Document
       │
       ├── ERP Invoice ID
       ├── Carrier Document ID
       └── Customs Declaration ID
```

---

# 26. One Document May Have Multiple Representations

Example:

```text
Commercial Invoice
├── PDF
├── XML
├── JSON
└── provider-native representation
```

These MAY be representations of the same semantic document.

---

# 27. Representation Model

Conceptually:

```text
DocumentRepresentation
├── document_id
├── format
├── version
├── storage_reference
├── checksum
└── generated_at
```

---

# 28. Versioning

Documents SHALL support versioning where modification is legally/operationally permitted.

---

# 29. Version ≠ Silent Replacement

A new version SHALL NOT erase the previous version.

```text
Document v1
    ↓
Correction
    ↓
Document v2
```

Historical references remain resolvable.

---

# 30. Immutable Documents

Certain document types SHALL become immutable once issued or accepted.

Examples may include:

```text
invoice
customs declaration submission
signed contract
proof of delivery
regulatory certificate
```

according to policy/source authority.

---

# 31. Correction

Where an immutable document must be corrected, use:

```text
original document
       │
       ▼
superseding / corrective document
```

rather than overwriting history.

---

# 32. Supersession

Canonical relation types SHALL include:

```text
SUPERSEDES
SUPERSEDED_BY
CORRECTS
CANCELS
AMENDS
REPLACES
```

---

# 33. Document Relationships

Documents frequently depend on one another.

Example:

```text
Quotation
   ↓
Purchase Order
   ↓
Packing List
   ↓
Commercial Invoice
   ↓
Customs Declaration
   ↓
Transport Document
   ↓
Proof of Delivery
```

These relationships SHALL be explicit.

---

# 34. Relationship Model

Conceptually:

```text
DocumentRelationship
├── source_document_id
├── target_document_id
├── relationship_type
└── created_at
```

---

# 35. Relationship Types

Initial types MAY include:

```text
GENERATED_FROM
SUPPORTS
EVIDENCES
REFERENCES
AMENDS
SUPERSEDES
FULFILS
DERIVED_FROM
ATTACHED_TO
```

---

# 36. Transaction Associations

A document MAY relate to:

```text
RFQ
quotation
contract
order
shipment
transport leg
inventory transfer
customs declaration
invoice
payment
supplier qualification
product qualification
compliance case
```

---

# 37. Many-to-Many Association

A document SHALL not be forced into a single transaction.

Example:

```text
Certificate of Origin
```

may support:

```text
shipment
customs declaration
commercial invoice
product lot
```

simultaneously.

---

# 38. Document Subject

Conceptually:

```text
DocumentSubject
├── document_id
├── subject_type
└── subject_id
```

---

# 39. Business Context

Documents SHOULD retain relevant context such as:

```text
tenant
legal entity
market
trade lane
seller
buyer
supplier
shipment
product
lot
currency
transaction class
```

without duplicating the authoritative transaction itself.

---

# 40. Cross-Border Evidence Package

A cross-border transaction may require a document package.

Conceptually:

```text
TradeDocumentPackage
├── transaction_id
├── required_documents[]
├── present_documents[]
├── missing_documents[]
├── invalid_documents[]
└── readiness
```

---

# 41. Package Is a Projection

A document package SHALL be derived from regulatory/commercial requirements.

It is not itself the authority determining what is legally required.

---

# 42. Required Documents

ADR-0021 and ADR-0024/provider decisions may return:

```text
required document types
```

Trade SHALL orchestrate collection and validation.

---

# 43. Document Readiness

Canonical states SHOULD include:

```text
NOT_REQUIRED
MISSING
UPLOADED
PENDING_VERIFICATION
VALID
INVALID
EXPIRED
REVOKED
```

---

# 44. Transaction Readiness

Where a document is mandatory:

```text
Required Document = MISSING
        ↓
Transaction Gate = BLOCKED
```

unless explicitly permitted by policy.

---

# 45. Fail Closed

Missing mandatory regulatory evidence SHALL fail closed.

---

# 46. Commercial Documents

Not all missing documents require a block.

Policies SHALL distinguish:

```text
MANDATORY
OPTIONAL
CONDITIONAL
INFORMATIONAL
```

---

# 47. Effective Dating

Documents such as licences and certificates SHALL support:

```text
valid_from
valid_to
```

---

# 48. Expiry

Expiry SHALL generate state transition/events where relevant.

Example:

```text
Certificate VALID
       ↓
expiry date reached
       ↓
EXPIRED
```

---

# 49. Expiry May Affect Other State

An expired document MAY cause:

```text
supplier qualification → EXPIRED
product eligibility → REVIEW_REQUIRED
shipment readiness → BLOCKED
```

according to policy.

---

# 50. Revocation

Revocation SHALL be distinct from expiry.

```text
EXPIRED
≠
REVOKED
```

---

# 51. Retention

Retention policy SHALL be configurable according to:

```text
document type
jurisdiction
legal entity
transaction type
regulatory requirement
contract
```

---

# 52. Retention Is Not Universal

Baobab SHALL NOT hard-code a single retention period for all trade documents.

---

# 53. Legal Hold

The architecture SHOULD support:

```text
LEGAL_HOLD
```

to prevent deletion where litigation, investigation or regulatory requirements require preservation.

---

# 54. Deletion

Documents referenced by financial, compliance or regulatory records SHOULD generally not be hard-deleted unless lawful retention/privacy requirements explicitly require it.

---

# 55. Archival

Lifecycle MAY include:

```text
ACTIVE
ARCHIVED
RETAINED
LEGAL_HOLD
DISPOSED
```

---

# 56. Storage

Document binaries SHOULD be stored in an object-storage architecture rather than transactional relational databases.

---

# 57. Metadata Storage

Canonical metadata MAY live in Trade/CMS/document service relational storage.

Binary content SHALL be referenced.

---

# 58. Payload CMS Role

Payload MAY provide:

```text
document metadata administration
media APIs
document discovery
content governance
```

where useful.

However:

> Payload SHALL NOT become the sole source of truth for transactional document semantics.

---

# 59. Storage Provider Abstraction

The architecture SHOULD permit storage providers such as:

```text
S3-compatible object storage
cloud object storage
regional object stores
archive storage
```

through configuration.

---

# 60. Storage Region

Data residency requirements MAY require different storage regions.

CP/provider context SHALL resolve appropriate document storage where necessary.

---

# 61. Encryption

Sensitive document content SHALL support:

```text
encryption at rest
encryption in transit
provider-managed or customer-managed keys
```

according to infrastructure policy.

---

# 62. Checksums

All important content SHOULD be checksummed.

Example:

```text
SHA-256
```

or current approved equivalent.

Purpose:

```text
integrity verification
duplicate detection
evidence integrity
audit
```

---

# 63. Content Hash ≠ Identity

Checksum SHALL not itself become canonical document identity.

---

# 64. Tamper Evidence

For regulated documents, checksum/version/provenance SHALL permit detection of content alteration.

---

# 65. Digital Signatures

Architecture SHALL permit document-signature metadata.

Conceptually:

```text
DocumentSignature
├── document_id
├── signer
├── signature_type
├── signature_reference
├── signed_at
├── verification_status
└── provider
```

---

# 66. Signature Verification

Digital signature verification MAY be provider-based.

Baobab SHALL preserve the verification result and source.

---

# 67. Electronic vs Scanned Document

The model SHALL distinguish where relevant:

```text
native electronic document
scanned paper document
generated PDF
structured electronic record
```

because evidentiary strength may differ.

---

# 68. Upload Source

Upload provenance SHALL include where possible:

```text
supplier portal
buyer portal
internal user
provider API
ERP
customs provider
logistics provider
system generation
```

---

# 69. User-Provided Files Are Untrusted

Uploaded content SHALL be considered untrusted until security processing completes.

---

# 70. File Security

Required controls SHOULD include:

```text
media-type validation
file-size limits
malware scanning
extension/content consistency
quarantine
access control
```

---

# 71. Quarantine

New uploads MAY enter:

```text
QUARANTINED
```

before becoming usable evidence.

---

# 72. Security Scan Failure

A failed scan SHALL block normal retrieval/use according to policy.

---

# 73. Sensitive Documents

Examples:

```text
bank confirmations
identity records
tax registrations
contracts
compliance findings
```

MAY require restricted visibility.

---

# 74. Classification

Documents SHALL support data classification.

Possible levels:

```text
PUBLIC
BAOBAB_INTERNAL
TENANT
CONFIDENTIAL
RESTRICTED
```

aligning with broader platform classification policy.

---

# 75. Tenant Isolation

A ZuriBeans document SHALL NOT be accessible to Thamani merely because both use the same document service.

---

# 76. Legal-Entity Isolation

Within a tenant, legal-entity scope MAY further restrict documents.

---

# 77. Supplier Isolation

Supplier A SHALL NOT retrieve Supplier B's:

```text
quotations
certificates
bank records
contracts
invoices
```

unless explicitly authorised.

---

# 78. Buyer Isolation

Buyer organisations likewise receive only authorised documents.

---

# 79. Document Sharing

Sharing SHALL be explicit.

Conceptually:

```text
DocumentAccessGrant
├── document_id
├── grantee
├── permissions
├── purpose
├── valid_from
└── valid_to?
```

---

# 80. Access ≠ Ownership

A buyer receiving an invoice does not become owner of the canonical document record.

---

# 81. External Sharing

Secure external delivery MAY use:

```text
authenticated portal
time-bound signed URL
provider delivery
secure API
```

according to policy.

---

# 82. Public URLs

Regulated/private trade documents SHALL NOT default to public unauthenticated URLs.

---

# 83. Generated Documents

Baobab MAY generate representations from structured transaction data.

Example:

```text
Canonical Invoice Data
        ↓
Template
        ↓
PDF Representation
```

---

# 84. Structured Data Remains Important

A rendered PDF SHALL NOT be the sole machine-readable record where canonical structured data exists.

---

# 85. Template Version

Generated document representations SHALL record template/version where material.

---

# 86. Generation Determinism

Where audit requires reproducibility, Baobab SHOULD retain sufficient data/template references to reproduce or verify generated documents.

---

# 87. ERP Documents

For ERP-generated invoices/orders:

```text
ERP structured record = authoritative transaction
PDF = representation
Baobab TradeDocument = canonical cross-platform reference
```

---

# 88. Customs Documents

For customs-provider documents:

```text
Customs Provider
       ↓
External Declaration Record
       ↓
Canonical TradeDocument
       ↓
Stored Representation / Evidence
```

---

# 89. Logistics Documents

Carrier/forwarder documents SHALL preserve provider reference and shipment/leg association.

---

# 90. Proof of Delivery

POD SHALL be linked to:

```text
shipment
delivery
receiver
received_at
provider
```

and remain immutable/auditable where accepted.

---

# 91. Proof of Delivery Is Not Shipment State Alone

A shipment status:

```text
DELIVERED
```

and a POD document are related but distinct.

---

# 92. Procurement Evidence

Supplier quotation and qualification evidence SHALL remain distinguishable.

---

# 93. Supplier Qualification Evidence

ADR-0023 SHALL reference documents/evidence by canonical ID rather than embed arbitrary file URLs.

---

# 94. Product Regulatory Evidence

ADR-0024 SHALL use canonical evidence references.

---

# 95. Compliance Evidence

ADR-0021 SHALL use the same evidence framework.

This avoids separate document models for:

```text
supplier
product
customs
shipment
```

---

# 96. Evidence Reuse

One verified document MAY support multiple assessments where legally valid.

---

# 97. Evidence Scope

Reusing evidence SHALL consider:

```text
subject
jurisdiction
purpose
validity
transaction
effective period
```

---

# 98. Evidence Reuse Is Not Blind

A certificate valid for one product or facility SHALL NOT automatically qualify unrelated products/facilities.

---

# 99. Document Package Assembly

Trade MAY assemble a transaction package dynamically.

Example:

```text
Shipment
   │
   ├── Commercial Invoice
   ├── Packing List
   ├── Certificate of Origin
   ├── Transport Document
   └── Regulatory Certificate
```

---

# 100. Package Completeness

Completeness SHALL derive from requirement rules/provider decisions.

---

# 101. Document Lifecycle

Suggested generic lifecycle:

```text
DRAFT
  ↓
GENERATED / UPLOADED
  ↓
PENDING_VERIFICATION
  ↓
VALID
  ↓
SUPERSEDED / EXPIRED / REVOKED / ARCHIVED
```

Not every document SHALL use every state.

---

# 102. Issued Documents

Some documents begin at:

```text
ISSUED
```

rather than DRAFT.

---

# 103. External Authority State

External provider/authority states SHALL map into canonical states.

Provider-native states SHALL not leak into generic Trade core.

---

# 104. Document Number Uniqueness

Uniqueness SHALL be contextual.

A document number may require:

```text
issuer
document type
jurisdiction
period
```

for uniqueness.

---

# 105. Duplicate Detection

Duplicate uploads MAY be detected using:

```text
checksum
issuer
document number
date
subject
```

but SHALL not automatically merge semantically distinct documents solely due to identical filenames.

---

# 106. OCR

OCR MAY be used to assist metadata extraction.

OCR output SHALL be treated as derived data, not authoritative content unless verified.

---

# 107. AI Extraction

AI MAY extract:

```text
document number
dates
parties
amounts
product lines
certificate fields
```

for review.

AI SHALL NOT silently overwrite authoritative metadata.

---

# 108. Human Verification

AI/OCR-extracted regulated fields MAY require reviewer confirmation.

---

# 109. Document Comparison

Baobab SHOULD permit comparison between:

```text
commercial invoice
packing list
purchase order
shipment
customs declaration
```

for reconciliation.

---

# 110. Quantity Reconciliation

Examples:

```text
PO quantity
vs
packing list quantity
vs
shipment quantity
vs
goods receipt quantity
```

---

# 111. Value Reconciliation

Examples:

```text
invoice value
vs
customs declared value
vs
ERP posting
```

Differences SHALL be surfaced rather than silently normalized.

---

# 112. Document Reconciliation

Suggested states:

```text
MATCHED
PARTIAL_MATCH
MISMATCH
MISSING
DUPLICATE
STALE
UNVERIFIED
```

---

# 113. Financial Reconciliation

ERP remains authoritative for accounting.

Trade documents support reconciliation but SHALL not create parallel financial ledgers.

---

# 114. Events

Canonical document events SHOULD include:

```text
trade-document.created
trade-document.uploaded
trade-document.generated
trade-document.issued
trade-document.verified
trade-document.rejected
trade-document.expired
trade-document.revoked
trade-document.superseded
trade-document.archived

trade-document.evidence-linked
trade-document.access-granted
trade-document.access-revoked

document-package.completed
document-package.blocked
```

---

# 115. Event Envelope

Events SHALL include where relevant:

```text
tenant_id
legal_entity_id
document_id
document_type
transaction_id
shipment_id
counterparty_id
correlation_id
causation_id
schema_version
occurred_at
```

---

# 116. Idempotency

Duplicate provider callbacks or uploads SHALL NOT create unintended duplicate authoritative documents.

---

# 117. Out-of-Order Events

Consumers SHALL tolerate:

```text
verification result before projection update
late provider callback
duplicate revocation notice
```

through version/effective-state controls.

---

# 118. Document Version Events

Events SHOULD identify:

```text
document_id
version
prior_version
```

where applicable.

---

# 119. Reconciliation Jobs

Baobab SHOULD reconcile:

```text
canonical document
↔ object storage

canonical document
↔ source engine

document requirement
↔ document package

financial document
↔ ERP transaction

shipment document
↔ logistics provider
```

---

# 120. Missing Binary

If metadata exists but binary is missing:

```text
RECONCILIATION_MISMATCH
```

SHALL be raised.

---

# 121. Missing Source Record

If canonical metadata points to deleted/unavailable source record, reconciliation SHALL flag it.

---

# 122. Object Immutability

Where infrastructure supports it, highly regulated evidence MAY use object-lock/WORM-like controls according to retention policy.

---

# 123. Backup

Document binaries SHALL participate in backup/disaster recovery strategy.

---

# 124. Recovery Verification

Backups are not sufficient without restore testing.

Document recovery SHALL be tested.

---

# 125. Regional Recovery

Regional document stores SHALL align with data-residency and DR policies.

---

# 126. Audit

At minimum audit:

```text
creation
upload
download
verification
rejection
revision
supersession
revocation
access grant
access revoke
metadata change
retention change
legal hold
deletion/disposal
```

---

# 127. Download Audit

Highly sensitive documents SHOULD record access/download events.

---

# 128. Observability

Recommended metrics:

```text
trade_document_created_total
trade_document_upload_total

document_verification_pending_total
document_verification_failed_total

document_missing_required_total
document_expired_total

document_storage_failure_total
document_scan_failure_total

document_reconciliation_mismatch_total

document_access_denied_total
document_package_incomplete_total
```

---

# 129. Alerts

Production alerts SHOULD include:

- storage failures;
- malware scan failures;
- expiring mandatory evidence;
- required document missing near shipment;
- provider document retrieval failure;
- reconciliation mismatch;
- abnormal document access;
- retention/legal-hold failure.

---

# 130. Supplier Registration Scenario

```text
Supplier
   ↓
Uploads Registration Certificate
   ↓
TradeDocument
   ↓
Security Scan
   ↓
Evidence Verification
   ↓
Canonical Organisation Verification
```

---

# 131. Supplier Qualification Scenario

```text
Quality Certificate
       ↓
TradeDocument
       ↓
Evidence
       ↓
Supplier Qualification
```

---

# 132. Uganda Coffee → South Africa Scenario

A transaction package may include:

```text
Supplier Quotation
Purchase Order
Commercial Invoice
Packing List
Certificate of Origin
Required Regulatory Certificate(s)
Export Documentation
Transport Document
Import Documentation
Proof of Delivery
Goods Receipt
Supplier Invoice
```

The exact set SHALL come from applicable requirements rather than hard-coded coffee logic.

---

# 133. South Africa Wine → Uganda Scenario

The same document architecture SHALL support a different package and different regulatory requirements without modifying generic Trade core.

---

# 134. Local Trade Scenario

Local trade may require a smaller package.

The architecture SHALL not unnecessarily require cross-border documents.

---

# 135. Intercompany Scenario

Related-party transactions may generate:

```text
intercompany sales order
purchase order
invoice
transfer-pricing evidence
shipment documents
customs evidence
```

where applicable.

Related-party status SHALL not eliminate document requirements.

---

# 136. Inter-Branch Scenario

Same-entity transfers MAY use internal stock-transfer documents rather than intercompany invoices.

ADR-BCP-012 governs transaction classification.

---

# 137. Partial Shipment Scenario

One order may produce several:

```text
packing lists
transport documents
PODs
```

Document associations SHALL support partial fulfilment.

---

# 138. Split Shipment Scenario

```text
Order
 ├── Shipment A
 │     └── Transport Document A
 └── Shipment B
       └── Transport Document B
```

---

# 139. Consolidated Shipment Scenario

One shipment may reference multiple order lines or transactions where permitted.

Document relationships SHALL preserve traceability.

---

# 140. Amended Invoice Scenario

Original invoice SHALL remain preserved.

Correction SHALL create:

```text
credit note
debit note
replacement invoice
```

as appropriate through authoritative ERP processes.

---

# 141. Expired Certificate Scenario

Certificate expires before shipment.

Expected:

```text
Evidence = EXPIRED
Document Package = INCOMPLETE/BLOCKED
Shipment Gate = BLOCKED
```

where certificate is mandatory.

---

# 142. Revoked Certificate Scenario

Revocation SHALL trigger reassessment even before nominal expiry.

---

# 143. Provider Failure Scenario

Customs/logistics provider cannot supply required document.

Expected:

```text
document requirement unresolved
→ transaction not falsely READY
```

---

# 144. Storage Failure Scenario

Business transaction SHALL NOT be reported fully complete if mandatory evidence could not be durably stored.

---

# 145. Duplicate Upload Scenario

Same file uploaded twice.

System MAY deduplicate binary storage while preserving appropriate logical upload/audit semantics.

---

# 146. Tamper Scenario

Content checksum differs from canonical version.

Expected:

```text
integrity failure
security alert
document invalid/review
```

---

# 147. Cross-Tenant Attack

Thamani user attempts access to ZuriBeans trade evidence.

Expected:

```text
DENY
```

---

# 148. Cross-Supplier Attack

Supplier A user requests Supplier B certificate.

Expected:

```text
DENY
```

unless an explicit authorised sharing relationship exists.

---

# 149. Rejected Alternative — Store All Documents in Trade Database

Rejected because binary storage does not belong in the transactional relational database at scale.

---

# 150. Rejected Alternative — Payload CMS Owns All Trade Documents

Rejected because CMS does not own authoritative transactional, accounting, customs or logistics records.

---

# 151. Rejected Alternative — ERP Owns Every Document

Rejected because many supplier, customs, compliance and logistics documents originate outside ERP.

---

# 152. Rejected Alternative — Direct External URLs as Document Model

Rejected because URLs alone do not provide:

```text
identity
provenance
version
access policy
retention
integrity
```

---

# 153. Rejected Alternative — Overwrite Files on Update

Rejected because trade/legal evidence requires historical traceability.

---

# 154. Rejected Alternative — Filename Determines Document Type

Rejected.

---

# 155. Rejected Alternative — One File per Transaction

Rejected because real trade transactions require multiple independent documents.

---

# 156. Rejected Alternative — Duplicate Files into Every Engine

Rejected due to:

```text
inconsistency
storage waste
security complexity
version drift
poor provenance
```

---

# 157. Rejected Alternative — AI/OCR Extracted Metadata Is Automatically Authoritative

Rejected.

Machine extraction is advisory until verified where authority matters.

---

# 158. Positive Consequences

This architecture provides:

- canonical document identity;
- evidence provenance;
- immutable history;
- multi-engine integration;
- supplier document support;
- regulatory evidence;
- shipment documentation;
- auditability;
- data-residency compatibility;
- strong access isolation;
- future digital-signature support;
- future AI extraction without sacrificing authority.

---

# 159. Costs

Implementation requires:

- canonical metadata;
- object storage;
- access-control integration;
- malware scanning;
- checksum validation;
- versioning;
- evidence verification;
- retention management;
- reconciliation;
- source-engine mappings.

These are justified for cross-border production trade.

---

# 160. Repository Responsibilities

| Repository               | Responsibility                                                         |
| ------------------------ | ---------------------------------------------------------------------- |
| `nabhold/shared`         | Canonical document/evidence contracts and events                       |
| `nabhold/baobab-cp`      | Context, tenant, legal entity, provider/storage resolution             |
| `nabhold/baobab-trade`   | Trade-document orchestration, packages, transaction associations       |
| `nabhold/baobab-cms`     | Document/media management capabilities where selected                  |
| `nabhold/baobab-erp`     | Financial/procurement document authority                               |
| `nabhold/baobab-iam`     | Document authorization and identity                                    |
| `nabhold/infrastructure` | Object storage, encryption, scanning, backup, retention infrastructure |
| External providers       | Authoritative external documents                                       |

---

# 161. Implementation Sequence

```text
Canonical Contracts
      ↓
TradeDocument Metadata
      ↓
Object Storage
      ↓
Checksum / Integrity
      ↓
Versioning
      ↓
Evidence Model
      ↓
Document Relationships
      ↓
Transaction Associations
      ↓
Access Control
      ↓
Provider / Engine Mapping
      ↓
Document Packages
      ↓
Retention / Archive
      ↓
Reconciliation
      ↓
Golden-Tenant Validation
```

---

# 162. Release 1 P0 Scope

ZuriBeans Release 1 SHALL support:

- canonical TradeDocument;
- canonical Evidence;
- document types;
- object storage;
- tenant/legal-entity scope;
- checksums;
- upload security;
- provenance;
- source-system references;
- immutable versions;
- document relationships;
- transaction associations;
- supplier evidence;
- product regulatory evidence;
- logistics documents;
- customs documents;
- financial-document references;
- document packages;
- required-document gating;
- expiry/revocation;
- access controls;
- audit;
- events;
- reconciliation;
- backup/recovery.

---

# 163. Release 1.1 Candidates

Future enhancements MAY include:

- e-signatures;
- qualified digital signatures;
- electronic bills of lading;
- electronic certificates of origin;
- AI document classification;
- AI metadata extraction;
- automated document comparison;
- fraud detection;
- document authenticity providers;
- OCR workflows;
- trade-document interoperability standards;
- verifiable credentials;
- distributed-ledger anchoring of document hashes.

A blockchain SHALL NOT be introduced merely for document storage.

---

# 164. Definition of Done

ADR-0025 is implemented when:

- [ ] TradeDocument canonical contract exists;
- [ ] Evidence contract exists;
- [ ] document and file are distinct concepts;
- [ ] document authority/source is explicit;
- [ ] canonical IDs differ from provider/ERP IDs;
- [ ] object storage is used for binary content;
- [ ] checksums exist;
- [ ] upload malware scanning exists;
- [ ] quarantine path exists;
- [ ] versions are preserved;
- [ ] immutable documents cannot be silently overwritten;
- [ ] supersession/correction relationships work;
- [ ] document relationships work;
- [ ] transaction associations are many-to-many;
- [ ] supplier qualification references canonical evidence;
- [ ] product eligibility references canonical evidence;
- [ ] customs compliance references canonical evidence;
- [ ] logistics references canonical documents;
- [ ] ERP financial documents map canonically;
- [ ] required-document packages work;
- [ ] missing mandatory evidence blocks readiness;
- [ ] expiry and revocation work;
- [ ] tenant isolation passes;
- [ ] supplier isolation passes;
- [ ] access grants are explicit;
- [ ] sensitive documents have restricted authorization;
- [ ] retention policy is configurable;
- [ ] legal hold is supported or formally deferred;
- [ ] reconciliation works;
- [ ] audit works;
- [ ] backups include document content;
- [ ] restore test succeeds;
- [ ] UG→ZA package scenario passes;
- [ ] ZA→UG package scenario passes;
- [ ] local trade scenario passes;
- [ ] intercompany/inter-branch scenarios pass;
- [ ] partial shipment document scenario passes;
- [ ] expired certificate scenario passes;
- [ ] duplicate upload scenario passes;
- [ ] tamper scenario passes.

---

# 165. Final Architecture

```text
                         TRADE TRANSACTION
                                │
                                ▼
                       DOCUMENT REQUIREMENTS
                                │
               ┌────────────────┼────────────────┐
               ▼                ▼                ▼
          COMMERCIAL        REGULATORY       LOGISTICS
          DOCUMENTS         EVIDENCE          DOCUMENTS
               │                │                │
               └────────────────┼────────────────┘
                                ▼
                       CANONICAL DOCUMENT
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
          METADATA           CONTENT           PROVENANCE
             │                  │                  │
             ▼                  ▼                  ▼
       Canonical DB       Object Storage       Source /
                                              Authority
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                           VERSION / HASH
                                │
                                ▼
                             EVIDENCE
                                │
                                ▼
                      TRANSACTION READINESS
```

Cross-system authority:

```text
Trade ───────────► Supplier quotations / workflow docs
ERP ─────────────► Orders / invoices / receipts
Logistics ───────► Transport docs / POD
Customs ─────────► Declarations / releases
Regulators ──────► Certificates / licences
                           │
                           ▼
                  Canonical TradeDocument
                           │
                           ▼
                      Evidence Graph
```

The central invariant is:

> **Baobab SHALL never confuse possession of a file with possession of valid evidence. A trade document must retain its identity, authority, provenance, version, integrity, relationships and lifecycle independently of the binary representation used to render or store it.**

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0025
    ↓
Canonical Document Contracts
    ↓
Metadata + Object Storage
    ↓
Integrity + Versioning
    ↓
Evidence + Provenance
    ↓
Transaction Associations
    ↓
Document Requirements / Packages
    ↓
Engine / Provider Integration
    ↓
Security + Retention
    ↓
Reconciliation
    ↓
ZuriBeans Golden-Tenant Validation
```

No Baobab engine SHALL use unmanaged file URLs, provider filenames or CMS media IDs as substitutes for canonical trade-document identity.
