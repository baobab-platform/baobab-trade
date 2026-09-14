# ADR-0018 Addendum — Multi-Jurisdiction, Cross-Border and Enterprise Tax Architecture

**Status:** Proposed Addendum to Accepted ADR-0018  
**Date:** 2026-09-12  
**Base Decision:** ADR-0018 — MedusaJS Commerce Tax, Jurisdiction and Legal Transaction Context  
**Base Decision Status:** Remains Accepted  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Contracts:** `nabhold/shared`  
**Context / Provider Resolution:** `nabhold/baobab-cp`  
**Financial and Statutory Accounting Authority:** `nabhold/baobab-erp`  
**Reference Tenant:** ZuriBeans

## Addendum Rule

This document **does not supersede ADR-0018**.

ADR-0018 and this Addendum SHALL be read together.

Where this Addendum introduces greater precision, new cross-platform boundaries or additional invariants arising from later ADRs, this Addendum governs that additional scope.

---

# 1. Audit Conclusion

ADR-0018 remains fundamentally correct.

Its central principle remains authoritative:

> **Tax is determined from the legal transaction context, not inferred from tenancy, geography or Product alone.**

The following decisions are expressly retained:

- Legal Seller is not Tenant;
- Legal Seller is not Market;
- Jurisdiction is not Market;
- tax is contextual;
- seller and customer tax registrations are explicit;
- B2B and B2C treatment may differ;
- product tax classification is explicit;
- zero-rated and exempt are distinct;
- reverse charge is explicit;
- tax-inclusive/exclusive presentation is policy-driven;
- committed transaction tax is preserved;
- tax rules are effective-dated;
- historical tax is immutable;
- Medusa/Trade owns customer-facing committed transaction tax;
- ERP owns tax accounting and statutory posting;
- provider failure must not cause invented tax;
- Commerce-versus-ERP tax discrepancies require reconciliation.

The audit therefore finds **no architectural justification to replace ADR-0018**.

It requires extension.

---

# 2. Gaps Identified

The subsequent Baobab architecture exposed material areas requiring additional normative treatment:

| Area                        | ADR-0018   | Addendum     |
| --------------------------- | ---------- | ------------ |
| Contextual tax              | Strong     | Retained     |
| Legal Seller                | Strong     | Retained     |
| Seller registrations        | Strong     | Extended     |
| B2B tax                     | Present    | Extended     |
| Cross-border tax            | High-level | Expanded     |
| Import VAT/GST              | Mentioned  | Formalized   |
| Export treatment            | Mentioned  | Formalized   |
| Export evidence             | Missing    | Added        |
| Customs duty boundary       | Present    | Strengthened |
| Tax point                   | Implicit   | Added        |
| Recoverability              | Missing    | Added        |
| Withholding tax             | Missing    | Added        |
| Intercompany tax            | Missing    | Added        |
| Inter-branch tax            | Missing    | Added        |
| Incoterm interaction        | Missing    | Added        |
| Importer/exporter of record | Missing    | Added        |
| Landed-cost interaction     | Missing    | Added        |
| Trade-document evidence     | Missing    | Added        |
| Tax provider capabilities   | Partial    | Formalized   |
| Effective rule provenance   | Present    | Strengthened |
| Tax decision snapshot       | Present    | Strengthened |
| ERP tax mapping             | Present    | Expanded     |
| Tax readiness               | Limited    | Added        |
| Tax reconciliation          | Present    | Expanded     |

---

# 3. Extended Governing Principle

The ADR-0018 governing principle is extended to:

> **Tax is a contextual, effective-dated legal determination based on the actual transaction, legal parties, registrations, jurisdictional facts, product/service classification and applicable rules. Tax SHALL NOT be inferred solely from Market, country, currency, Incoterm, customs classification, related-party status or physical movement.**

---

# 4. Fundamental Separation

Baobab SHALL preserve:

```text
Tax Jurisdiction
≠ Market
≠ Country
≠ Legal Entity
≠ Tax Registration
≠ Ship-To
≠ Ship-From
≠ Place of Supply
≠ Customs Territory
```

Likewise:

```text
Tax Type
≠ Tax Rate
≠ Tax Category
≠ Tax Registration
≠ Tax Determination
≠ Tax Accounting
≠ Tax Payment
```

---

# 5. Transaction Tax Context

ADR-0018's `TaxContext` SHALL be extended conceptually.

```text
TaxContext
├── tenant_id
├── transaction_id
├── transaction_class
├── seller_legal_entity_id
├── buyer_legal_entity_id?
├── seller_tax_registrations[]
├── buyer_tax_registrations[]
├── origin
├── destination
├── ship_from
├── ship_to
├── bill_from?
├── bill_to
├── place_of_supply?
├── importer_of_record?
├── exporter_of_record?
├── trade_lane_id?
├── product_tax_classification
├── transaction_type
├── quantity
├── taxable_value
├── transaction_currency
├── incoterm?
├── tax_point
├── effective_at
├── exemption_context?
├── reverse_charge_context?
└── provider_context
```

Not every field applies to every transaction.

---

# 6. Transaction Classification

Tax determination SHALL consume the canonical transaction classification established by subsequent platform ADRs.

At minimum:

```text
LOCAL_TRADE
EXTERNAL_CROSS_BORDER
INTERNAL_CROSS_MARKET
```

Internal cross-market transactions SHALL further resolve whether they represent:

```text
SAME_LEGAL_ENTITY
```

or:

```text
INTERCOMPANY
```

before tax treatment is determined.

---

# 7. Tax Point

Baobab SHALL introduce an explicit `TaxPoint`.

The tax point identifies the legally relevant time at which the applicable tax treatment/rule is determined.

Conceptually:

```text
TaxPoint
├── type
├── occurred_at
├── source_event
├── jurisdiction
└── rule_reference
```

Possible policy-driven anchors include:

```text
ORDER_COMMITMENT
INVOICE_ISSUE
PAYMENT_RECEIPT
SHIPMENT
DELIVERY
ACCEPTANCE
IMPORT
CUSTOM_EVENT
```

These are generic event abstractions.

The applicable jurisdictional rule determines which event matters.

---

# 8. Tax Point ≠ Order Date

Baobab SHALL NOT universally assume:

```text
tax_point = order_created_at
```

---

# 9. Tax Point ≠ Invoice Date

Likewise, invoice date SHALL NOT universally determine the tax point.

---

# 10. Effective Dating

The effective tax rule SHALL be resolved against the applicable tax point.

Historical reconstruction SHALL therefore use:

```text
Tax Context
+
Tax Point
+
Rule Version
```

rather than the current tax rule.

---

# 11. Tax Registration Model

ADR-0018's registration model is extended.

Conceptually:

```text
TaxRegistration
├── legal_entity_id
├── jurisdiction_id
├── tax_type
├── registration_identifier
├── status
├── valid_from
├── valid_to?
├── verification_state
├── verification_source?
└── evidence_refs[]
```

---

# 12. Registration Is Effective-Dated

A registration valid today SHALL not automatically be considered valid for a historical or future transaction.

---

# 13. Registration ≠ Legal Presence

A Legal Entity existing in a jurisdiction does not automatically mean it holds every required tax registration there.

---

# 14. Registration ≠ Market Participation

Likewise:

```text
Market Participation
≠
Tax Registration
```

---

# 15. Seller Registration Resolution

The relevant seller registration SHALL be resolved from:

```text
Legal Seller
+
Tax Type
+
Jurisdiction
+
Transaction
+
Effective Date
```

---

# 16. Customer Registration

B2B customer registrations SHALL follow the same contextual/effective-dated principle.

---

# 17. Registration Verification

Where verification is mandatory:

```text
UNVERIFIED
PENDING
VERIFIED
INVALID
EXPIRED
REVOKED
ERROR
```

SHOULD be represented explicitly.

---

# 18. Place of Supply

Baobab SHALL support an explicit place-of-supply determination where applicable.

It SHALL NOT implement one universal formula.

---

# 19. Place of Supply ≠ Ship-To

The architecture SHALL preserve:

```text
PlaceOfSupply != ShipTo
```

although destination may be an input.

---

# 20. Place of Supply ≠ Bill-To

Likewise:

```text
PlaceOfSupply != BillTo
```

---

# 21. Provider-Driven Place-of-Supply Rules

Where determination is legally complex, the applicable tax provider/policy SHALL resolve it.

Core Trade code SHALL not accumulate jurisdiction-specific branching.

---

# 22. Tax Types

The architecture SHALL support extensible tax types including where applicable:

```text
VAT
GST
SALES_TAX
IMPORT_VAT
IMPORT_GST
EXCISE
WITHHOLDING
OTHER_TRANSACTION_TAX
```

The existence of these generic categories does not imply that every jurisdiction uses them.

---

# 23. Customs Duty Remains Separate

The ADR-0018 distinction is strengthened:

```text
CUSTOMS_DUTY
≠
TRANSACTION_TAX
```

ADR-0021 governs customs duty and customs determination.

---

# 24. Import VAT/GST

Import VAT/GST SHALL be modelled independently from customs duty.

A cross-border import may therefore produce:

```text
Customs Duty
+
Import VAT/GST
+
Other Applicable Import Charges
```

without collapsing these into one tax amount.

---

# 25. Import Tax Context

Import tax determination MAY consume:

```text
importer of record
customs value
customs duty
product classification
origin
destination
tax registration
transaction date
tax rule
```

as applicable.

---

# 26. Customs Value ≠ Commerce Price

The architecture SHALL preserve:

```text
Customs Value
≠
Invoice Value
≠
Selling Price
≠
Inventory Value
≠
Transfer Price
```

even where one contributes to another.

---

# 27. Customs Provider Boundary

ADR-0021 remains authoritative for:

```text
classification
customs value
duty
customs declaration
customs release
```

Tax determination SHALL consume relevant customs results rather than duplicate customs logic.

---

# 28. Import VAT Authority

The authoritative financial/statutory accounting of import VAT belongs to ERP.

Trade MAY consume/project the amount where required for:

```text
landed cost
commercial visibility
transaction readiness
```

---

# 29. Recoverable vs Non-Recoverable Tax

Baobab SHALL explicitly distinguish:

```text
RECOVERABLE
PARTIALLY_RECOVERABLE
NON_RECOVERABLE
UNKNOWN
```

where applicable.

---

# 30. Recoverability Is Not a Tax Rate

Recoverability is an accounting/tax treatment of tax incurred.

It SHALL NOT modify the legal tax rate itself.

---

# 31. ERP Owns Recoverability Accounting

ERP SHALL be authoritative for:

```text
input tax
recoverable tax
non-recoverable tax
tax asset/liability
statutory posting
```

---

# 32. Landed Cost Interaction

ADR-0020 SHALL consume tax recoverability correctly.

Conceptually:

```text
Non-Recoverable Import Tax
        ↓
May contribute to Landed Cost
```

while:

```text
Recoverable Import Tax
        ↓
Generally not treated as permanent inventory cost
```

subject to applicable accounting/tax policy.

---

# 33. No Double Counting

The platform SHALL prevent:

```text
Import Tax
```

from being included simultaneously as:

```text
recoverable tax
+
landed cost
```

unless a defined partial-recoverability rule requires allocation.

---

# 34. Export Treatment

Cross-border export SHALL NOT automatically mean zero tax.

Instead:

```text
Export Transaction
      ↓
Tax Determination
      ↓
STANDARD / ZERO_RATED / EXEMPT / OUT_OF_SCOPE /
REVERSE_CHARGE / OTHER
```

according to applicable rules.

---

# 35. Foreign Destination ≠ Zero-Rated

This invariant is mandatory:

> **A foreign ship-to address SHALL NOT by itself authorize zero-rated export treatment.**

---

# 36. Export Evidence

Where preferential/zero-rated export treatment requires evidence, that evidence SHALL be explicit.

Potential evidence MAY include, depending on applicable rules:

```text
commercial invoice
transport document
customs export declaration
proof of export
proof of delivery
certificate
other regulatory evidence
```

The applicable tax provider/policy determines the required evidence.

---

# 37. ADR-0025 Integration

Tax evidence SHALL reference canonical `TradeDocument` / `Evidence` records.

File upload alone SHALL NOT prove entitlement to a tax treatment.

---

# 38. Provisional Export Treatment

Where business/legal policy permits tax treatment to remain provisional pending evidence:

```text
PENDING_EVIDENCE
```

MAY be represented.

---

# 39. Evidence Failure

If mandatory evidence is not obtained or becomes invalid, Baobab SHALL support:

```text
REASSESSMENT
ADJUSTMENT
REVIEW_REQUIRED
```

rather than preserving unsupported treatment indefinitely.

---

# 40. Tax Treatment States

A generic tax treatment SHOULD distinguish at least:

```text
STANDARD
REDUCED
ZERO_RATED
EXEMPT
OUT_OF_SCOPE
REVERSE_CHARGE
WITHHOLDING
OTHER
```

as applicable.

---

# 41. Zero-Rated ≠ Exempt ≠ Out of Scope

The ADR-0018 distinction is expanded:

```text
ZERO_RATED
≠
EXEMPT
≠
OUT_OF_SCOPE
```

---

# 42. Zero Amount ≠ Zero Rate

A zero tax amount may result from:

```text
zero rate
exemption
out-of-scope treatment
reverse charge
rounding
zero taxable base
```

The reason SHALL be preserved.

---

# 43. Reverse Charge

Reverse charge SHALL preserve:

```text
tax type
jurisdiction
legal basis/rule reference
customer registration context
taxable basis
treatment reason
```

where applicable.

---

# 44. Withholding Tax

The original ADR does not establish a withholding-tax model.

This Addendum introduces one.

---

# 45. Withholding Is Separate

The architecture SHALL preserve:

```text
WITHHOLDING TAX
≠
OUTPUT VAT/GST
≠
IMPORT VAT
≠
CUSTOMS DUTY
```

---

# 46. Withholding Context

Where applicable:

```text
WithholdingTaxDetermination
├── payer
├── payee
├── jurisdiction
├── tax_type
├── taxable_basis
├── rate
├── amount
├── currency
├── rule_reference
├── exemption/treaty_context?
├── effective_at
└── evidence_refs[]
```

---

# 47. Withholding Is Not Universally Applicable

Core Trade SHALL NOT assume that cross-border payment requires withholding.

The applicable provider/policy determines it.

---

# 48. Trade Finance Integration

ADR-0027 MAY consume withholding consequences when determining:

```text
gross amount
withheld amount
net settlement
```

but ERP remains authoritative for financial/statutory accounting.

---

# 49. Gross vs Net Settlement

The architecture SHALL support:

```text
Gross Obligation
-
Withholding
=
Net Settlement
```

where applicable.

A net payment SHALL not be interpreted as underpayment merely because tax was lawfully withheld.

---

# 50. Intercompany Tax

Related-party status SHALL NOT automatically create tax exemption.

---

# 51. Intercompany Transaction

Where ADR-BCP-012 resolves distinct related legal entities:

```text
INTERCOMPANY
```

the transaction SHALL undergo applicable tax determination.

---

# 52. Intercompany Tax Context

Tax determination MAY consume:

```text
seller legal entity
buyer legal entity
relationship
origin
destination
tax registrations
transfer price
product/service
place of supply
transaction date
```

---

# 53. Transfer Pricing ≠ Tax Determination

Transfer price MAY contribute to the taxable base.

It SHALL not itself determine:

```text
VAT/GST treatment
import tax
withholding
```

---

# 54. Intercompany ≠ Tax Free

Mandatory invariant:

> **A transaction between related Baobab legal entities SHALL never be assumed tax-free merely because both entities belong to NABHOLD or another common corporate group.**

---

# 55. Inter-Branch Tax

Where ADR-BCP-012 resolves:

```text
SAME_LEGAL_ENTITY
```

the movement SHALL NOT automatically be treated as a sale.

However, same-entity movement MAY still have:

```text
tax
customs
registration
reporting
```

consequences depending on jurisdiction.

---

# 56. Same Legal Entity ≠ No Tax Consequence

Mandatory invariant:

> **Absence of an intercompany sale does not prove absence of tax consequences.**

---

# 57. Internal Movement

Tax treatment for internal cross-market movement SHALL be resolved separately from commercial-sale tax treatment.

---

# 58. Incoterms

ADR-0026 is incorporated into the tax architecture.

Incoterm MAY provide relevant transaction facts.

It SHALL NOT independently determine tax.

---

# 59. Incoterm ≠ Tax Treatment

Mandatory invariant:

```text
Incoterm
≠
Tax Jurisdiction
≠
Tax Rate
≠
Tax Liability
```

---

# 60. Importer / Exporter of Record

Importer and exporter of record SHALL be explicit where material.

They SHALL NOT be blindly inferred from Incoterm.

---

# 61. Importer of Record ≠ Buyer

These may coincide, but are not universally equivalent.

---

# 62. Exporter of Record ≠ Seller

Likewise, these may coincide but SHALL remain conceptually distinct.

---

# 63. DDP and Similar Terms

Seller contractual responsibility for import-related costs does not itself prove:

```text
seller tax registration
seller importer-of-record capability
seller tax liability
```

The required legal/tax context SHALL still resolve.

---

# 64. Product Tax Classification

ADR-0018's distinction remains:

```text
Product Tax Classification
≠
Commercial Category
≠
Customs Classification
```

---

# 65. Regulatory Classification Integration

ADR-0024 MAY supply product attributes/classification context relevant to tax.

Tax SHALL still resolve its own tax classification.

---

# 66. Classification Mapping

Where mappings exist:

```text
Canonical Product
     ├── Commercial Classification
     ├── Customs Classification
     ├── Regulatory Classification
     └── Tax Classification
```

Each remains separately authoritative within its domain.

---

# 67. Tax Provider Architecture

The original provider model is strengthened to use the platform capability/provider architecture.

Potential capabilities include:

```text
tax.registration.resolve
tax.registration.verify
tax.jurisdiction.resolve
tax.place-of-supply.resolve
tax.transaction.determine
tax.import.determine
tax.export.determine
tax.withholding.determine
tax.exemption.verify
tax.reverse-charge.determine
tax.evidence.requirements
```

---

# 68. Capability Binding

`baobab-cp` SHALL resolve the applicable provider using contextual `CapabilityBinding`.

Potential resolution dimensions include:

```text
tenant
legal entity
market
jurisdiction
tax type
transaction type
effective date
```

---

# 69. Multiple Providers

Baobab SHALL support:

```text
Provider A → South Africa transaction tax
Provider B → Uganda transaction tax
Provider C → registration verification
Provider D → manual governed determination
```

without modifying core Trade logic.

---

# 70. Manual Tax Provider

A structured manual determination MAY be supported where automated capability is unavailable.

It SHALL record:

```text
authorised actor
tax context
determination
reason
rule/evidence
effective date
approval
audit
```

---

# 71. No Provider

Where mandatory authoritative determination cannot be made:

```text
Tax Readiness = NOT_READY
```

The transaction SHALL fail closed.

---

# 72. Tax Decision

A canonical tax determination SHOULD conceptually contain:

```text
TaxDetermination
├── id
├── transaction_id
├── context_snapshot
├── tax_point
├── jurisdiction
├── tax_type
├── tax_treatment
├── taxable_basis
├── components[]
├── total_tax
├── currency
├── provider
├── provider_reference?
├── rule_version
├── evidence_refs[]
├── calculated_at
└── status
```

---

# 73. Tax Component

Conceptually:

```text
TaxComponent
├── tax_type
├── jurisdiction
├── taxable_basis
├── rate?
├── amount
├── treatment
├── recoverability?
└── rule_reference?
```

---

# 74. Decision States

Suggested:

```text
NOT_EVALUATED
PENDING
DETERMINED
DETERMINED_WITH_CONDITIONS
REVIEW_REQUIRED
BLOCKED
EXPIRED
ERROR
```

---

# 75. Snapshot

At commercial commitment, Trade SHALL preserve the applicable tax snapshot.

It SHALL be sufficient to reproduce/explain:

```text
who sold
who bought
where
under which registration
what was taxed
tax point
taxable basis
tax treatment
tax components
amount
currency
rule/provider
evidence where required
```

---

# 76. Snapshot Immutability

A later rule/rate/registration change SHALL NOT silently rewrite a committed tax determination.

---

# 77. Reassessment

Where a legally relevant fact changes before final commitment:

```text
seller
buyer
registration
ship-from
ship-to
product
quantity
price
discount
Incoterm
importer/exporter of record
tax point
exemption
```

tax SHALL be reassessed.

---

# 78. Post-Commitment Correction

After commitment, corrections SHALL use explicit:

```text
adjustment
credit note
debit note
replacement/corrective document
```

as appropriate.

Historical originals SHALL remain preserved.

---

# 79. Credit Notes

ADR-0018's credit-note decision remains authoritative and is extended through ADR-0025.

A credit/debit note SHALL retain an explicit relationship to:

```text
original invoice
original tax determination
reason
adjustment amount
adjusted tax
```

---

# 80. Refund ≠ Tax Reversal

A commercial refund SHALL NOT automatically be assumed to create a full tax reversal.

Applicable tax policy determines the tax consequence.

---

# 81. Cancellation ≠ Tax Reversal

Likewise.

---

# 82. ERP Authority

ERP remains authoritative for:

```text
tax accounting
tax liability
tax receivable
recoverable input tax
non-recoverable input tax
statutory reporting
GL posting
tax settlement
```

---

# 83. Trade Authority

Trade remains authoritative for:

```text
customer-facing transaction tax orchestration
quote/cart/order tax calculation
committed commercial tax snapshot
tax presentation
transaction tax readiness
```

---

# 84. Tax Provider Authority

Tax providers are authoritative only for the determinations/capabilities delegated to them.

They SHALL NOT determine:

```text
tenant
legal seller identity
canonical customer identity
transaction ownership
```

---

# 85. Customs Authority

Customs provider remains authoritative for delegated customs determinations.

---

# 86. No Shadow Tax Ledger

Trade SHALL NOT become a statutory tax ledger.

---

# 87. ERP Mapping

Canonical tax determinations SHALL map to appropriate iDempiere constructs without using ERP IDs as canonical tax identity.

Mappings MAY include:

```text
tax category
tax rate
tax jurisdiction
tax account
Business Partner tax context
organisation/legal entity
```

---

# 88. ERP Validation

ERP MAY independently validate tax for accounting integrity.

A difference SHALL NOT silently overwrite the committed Trade tax.

---

# 89. Reconciliation

Reconciliation SHALL cover:

```text
Trade committed tax
↔ ERP posted tax

Tax provider determination
↔ Trade snapshot

Customs import tax
↔ ERP import tax

Tax registration
↔ provider verification

Tax evidence
↔ tax treatment

Credit/debit adjustment
↔ original tax
```

---

# 90. Reconciliation States

Suggested:

```text
MATCHED
PENDING
PARTIAL
MISMATCH
MISSING
STALE
DISPUTED
UNRESOLVED
```

---

# 91. Reconciliation Tolerance

Rounding tolerances MAY be configured where legally permissible.

They SHALL NOT hide material tax differences.

---

# 92. Evidence Reconciliation

A zero-rated/export treatment requiring evidence SHALL not remain fully reconciled when mandatory evidence is:

```text
MISSING
INVALID
EXPIRED
REVOKED
```

---

# 93. Tax Readiness

Tax SHALL participate in platform readiness.

Conceptually:

```text
TaxReadiness
├── seller_resolved
├── registrations_resolved
├── jurisdiction_resolved
├── tax_classification_resolved
├── provider_resolved
├── determination_complete
├── evidence_complete
├── ERP_mapping_ready
└── overall_status
```

---

# 94. Readiness States

Use the broader Baobab readiness vocabulary where applicable:

```text
UNKNOWN
DECLARED
CONTRACTED
IMPLEMENTED
PROVISIONED
INTEGRATED
TESTED
READY
```

with:

```text
DEGRADED
BLOCKED
SUSPENDED
DEFERRED
```

where relevant.

---

# 95. No False READY

A tax table existing in Medusa SHALL NOT mean tax capability is READY.

---

# 96. Tax Capability Definition of Done

Tax capability requires:

```text
Contract
+
Implementation
+
Provider/Rules
+
Registration Context
+
Authorization
+
Integration
+
Tests
+
Isolation
+
Audit
+
Metrics
+
Reconciliation
+
Runbook
```

---

# 97. Events

Canonical events MAY include:

```text
tax.context.resolved
tax.determination.completed
tax.determination.failed
tax.registration.verified
tax.registration.expired
tax.evidence.required
tax.evidence.satisfied
tax.evidence.failed
tax.reassessment.required
tax.adjustment.created
tax.reconciliation.mismatch
```

These SHALL supplement—not unnecessarily duplicate—existing commerce events.

---

# 98. Idempotency

Repeated provider responses SHALL NOT create duplicate tax decisions or adjustments.

---

# 99. Out-of-Order Events

Tax consumers SHALL tolerate:

```text
late verification
late customs determination
late evidence
late ERP posting
```

through version/effective-time semantics.

---

# 100. Security

Tax registrations, tax identifiers and tax documents SHALL receive appropriate classification and access control.

---

# 101. Tenant Isolation

ZuriBeans tax information SHALL NEVER leak into Thamani tax context.

---

# 102. Legal-Entity Isolation

A registration belonging to one legal entity SHALL not be silently used by another.

---

# 103. Registration Selection Attack

Clients SHALL NOT be allowed to submit arbitrary:

```text
seller_tax_registration_id
```

and thereby influence tax treatment.

Trusted server-side context SHALL resolve it.

---

# 104. Customer Tax-ID Abuse

A supplied customer tax identifier SHALL not automatically grant:

```text
reverse charge
zero rate
exemption
```

without required validation.

---

# 105. Audit

Audit SHALL include material changes/actions involving:

```text
tax registration
tax classification
tax determination
provider override
manual determination
exemption
reverse charge
zero-rate evidence
withholding
tax adjustment
reconciliation override
```

---

# 106. Observability

Recommended metrics include:

```text
tax_determination_total
tax_determination_failure_total
tax_provider_error_total

tax_registration_verification_failure_total
tax_registration_expired_total

tax_evidence_missing_total
tax_reassessment_total

tax_reconciliation_mismatch_total

import_tax_determination_total
export_tax_determination_total
withholding_tax_determination_total
```

---

# 107. Alerts

Production alerts SHOULD include:

- tax provider failure;
- mandatory provider missing;
- registration expired;
- unresolved seller registration;
- missing export evidence;
- import tax reconciliation mismatch;
- Trade/ERP tax mismatch;
- unsupported jurisdiction;
- stale tax rules;
- unexplained zero-tax transaction;
- excessive manual overrides.

---

# 108. ZuriBeans — Local Uganda Purchase

```text
Uganda Supplier
      ↓
ZuriBeans Uganda
      ↓
Applicable Domestic Tax Context
      ↓
Supplier Invoice
      ↓
ERP Input Tax / Cost Treatment
```

Procurement tax SHALL not be forced through customer-order tax logic.

---

# 109. ZuriBeans — Local Uganda Sale

```text
ZuriBeans Seller
      ↓
Uganda Buyer
      ↓
Seller Registration
      ↓
Customer Context
      ↓
Domestic Tax Determination
      ↓
Trade Order
      ↓
ERP Posting
```

---

# 110. ZuriBeans — Uganda Coffee → South Africa

```text
Uganda Seller
      ↓
Export Tax Determination
      ↓
Export Evidence
      ↓
Cross-Border Shipment
      ↓
South Africa Import
      ↓
Customs Duty
      +
Import Tax
      ↓
Recoverability Determination
      ↓
ERP Accounting / Landed Cost
```

---

# 111. ZuriBeans — South Africa Wine → Uganda

The same architecture SHALL operate in the reverse direction.

No core rule SHALL encode:

```text
Uganda = source
South Africa = destination
```

---

# 112. External Third-Market Sale

A new route SHALL require:

```text
market participation
tax registrations
provider/rule configuration
trade lane
compliance
```

not source-code branching.

---

# 113. Intercompany Cross-Border Scenario

```text
Related Legal Entity A
      ↓
Intercompany Sale
      ↓
Tax Determination
      ↓
Customs Determination
      ↓
Related Legal Entity B
      ↓
ERP AR/AP + Tax
```

Related-party status SHALL not bypass tax.

---

# 114. Inter-Branch Scenario

```text
Same Legal Entity
Branch / Market A
      ↓
Internal Movement
      ↓
Tax Consequence Resolution
      ↓
Branch / Market B
```

No artificial external sale SHALL be manufactured merely to obtain tax processing.

---

# 115. Export Evidence Failure Scenario

Transaction initially receives conditional export treatment.

Required evidence is not obtained.

Expected:

```text
Tax Evidence = FAILED/MISSING
      ↓
REASSESSMENT_REQUIRED
      ↓
Tax Adjustment / Review
```

according to applicable policy.

---

# 116. Expired Registration Scenario

Seller registration expires before applicable tax point.

Expected:

```text
Tax Readiness = BLOCKED / REVIEW_REQUIRED
```

rather than silently using the stale registration.

---

# 117. Customer Tax-ID Scenario

Customer provides tax number.

Expected:

```text
Provided
≠
Verified
≠
Eligible for Special Treatment
```

---

# 118. Import VAT Recoverability Scenario

Import tax is assessed.

ERP determines:

```text
80% recoverable
20% non-recoverable
```

Only the appropriate non-recoverable portion may feed permanent landed cost according to policy.

---

# 119. Withholding Scenario

Gross invoice:

```text
100,000
```

Applicable withholding:

```text
5,000
```

Net settlement:

```text
95,000
```

ERP SHALL preserve the gross obligation, withholding tax consequence and settlement correctly rather than classifying the transaction as an unexplained 5,000 underpayment.

---

# 120. Credit Note Scenario

A tax-bearing invoice is corrected.

Expected:

```text
Original Invoice
      ↓
Credit/Debit Adjustment
      ↓
Adjusted Tax
      ↓
ERP Posting
```

The original tax snapshot remains immutable.

---

# 121. Incoterm Scenario

Changing:

```text
FCA → DDP
```

MAY change commercial/import responsibility facts.

It SHALL trigger tax reassessment where relevant.

It SHALL NOT itself prescribe the resulting tax treatment.

---

# 122. Rejected Alternative — Rewrite ADR-0018

Rejected.

The original architecture remains sound.

---

# 123. Rejected Alternative — Create a Competing Tax ADR

Rejected.

This Addendum extends ADR-0018.

---

# 124. Rejected Alternative — Country Determines Tax

Already rejected by ADR-0018 and reaffirmed.

---

# 125. Rejected Alternative — Foreign Destination Means Zero Tax

Rejected.

Evidence and jurisdictional rules may be required.

---

# 126. Rejected Alternative — Intercompany Means Tax Free

Rejected.

---

# 127. Rejected Alternative — Same Legal Entity Means No Tax Consequence

Rejected.

---

# 128. Rejected Alternative — Customs Duty and Import VAT Are One Thing

Rejected.

---

# 129. Rejected Alternative — All Import Tax Is Landed Cost

Rejected.

Recoverability must be determined.

---

# 130. Rejected Alternative — Incoterm Determines Tax

Rejected.

---

# 131. Rejected Alternative — Tax Provider Determines Legal Seller

Rejected.

---

# 132. Rejected Alternative — Customer-Supplied Tax ID Automatically Enables Exemption

Rejected.

---

# 133. Rejected Alternative — ERP Silently Recalculates Commerce Tax

Rejected and already prohibited by ADR-0018.

---

# 134. Rejected Alternative — Trade Becomes Statutory Tax Ledger

Rejected.

---

# 135. Rejected Alternative — Hard-Code South Africa/Uganda Tax Logic

Rejected.

Country-specific tax configuration/rules/providers belong behind governed interfaces.

---

# 136. Repository Responsibilities

| Repository             | Responsibility                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| `nabhold/shared`       | Canonical tax context, determination, component, registration and events |
| `nabhold/baobab-cp`    | Tenant/legal-entity/market/provider/capability resolution                |
| `nabhold/baobab-trade` | Customer-facing transaction-tax orchestration and committed snapshot     |
| `nabhold/baobab-erp`   | Tax accounting, recoverability, statutory posting/reporting              |
| `nabhold/baobab-iam`   | Authorization for sensitive tax operations                               |
| `nabhold/baobab-cms`   | Tax-document presentation where appropriate, not tax authority           |
| External Tax Providers | Delegated jurisdictional determination                                   |
| Customs Providers      | Customs/duty/import context under ADR-0021                               |

---

# 137. Cross-ADR Authority Matrix

| Concern                        | Governing Decision  |
| ------------------------------ | ------------------- |
| Transaction tax                | ADR-0018 + Addendum |
| Legal entity relationship      | ADR-BCP-012         |
| Inventory ownership            | ADR-BCP-013         |
| Counterparty identity          | ADR-BCP-014         |
| Landed cost                    | ADR-0020            |
| Customs/duty                   | ADR-0021            |
| Product regulatory eligibility | ADR-0024            |
| Evidence/documents             | ADR-0025            |
| Incoterms/risk/title           | ADR-0026            |
| Credit/settlement              | ADR-0027            |
| ERP accounting                 | ERP ADR series      |

---

# 138. Implementation Sequence

```text
ADR-0018 Existing Model
          ↓
Canonical Tax Contract Extension
          ↓
Tax Registration + Tax Point
          ↓
Provider Capability Resolution
          ↓
Domestic Tax
          ↓
Export Tax + Evidence
          ↓
Import Tax
          ↓
Recoverability
          ↓
Withholding
          ↓
Intercompany / Inter-Branch
          ↓
ERP Tax Mapping
          ↓
Reconciliation
          ↓
ZuriBeans Golden-Tenant Tests
```

---

# 139. Release 1 P0 Addendum Scope

Release 1 SHALL add or verify:

- explicit TaxPoint;
- effective-dated registrations;
- provider capability binding;
- domestic transaction tax;
- export tax treatment;
- export evidence;
- import VAT/GST separation from customs duty;
- recoverable/non-recoverable tax;
- ERP recoverability authority;
- landed-cost integration;
- B2B tax-ID verification;
- reverse-charge context;
- exemption/zero-rate/out-of-scope distinction;
- intercompany tax determination;
- inter-branch tax consequence resolution;
- importer/exporter-of-record context;
- Incoterm interaction;
- tax snapshots;
- tax evidence;
- tax reconciliation;
- tenant/legal-entity isolation;
- audit and observability.

Withholding SHALL be implemented where required by the initial operating-market transaction set; otherwise its canonical contract/provider boundary SHALL be established without pretending the capability is READY.

---

# 140. Definition of Done

The ADR-0018 Addendum is implemented when:

- [ ] ADR-0018 remains preserved;
- [ ] Addendum is explicitly linked from ADR-0018;
- [ ] canonical TaxContext includes required cross-border context;
- [ ] TaxPoint exists;
- [ ] tax rules are evaluated at correct effective time;
- [ ] seller registrations are effective-dated;
- [ ] customer registrations can be verified;
- [ ] tax-ID submission cannot self-authorize special treatment;
- [ ] place-of-supply is provider/policy driven;
- [ ] customs duty and import tax remain separate;
- [ ] import VAT/GST can be represented;
- [ ] recoverability is explicit;
- [ ] partial recoverability works;
- [ ] non-recoverable tax integrates with landed cost;
- [ ] recoverable tax is not double-counted into cost;
- [ ] export treatment is contextual;
- [ ] foreign destination does not automatically zero-rate;
- [ ] required export evidence is canonical;
- [ ] evidence expiry/failure can trigger reassessment;
- [ ] reverse charge remains explicit;
- [ ] withholding contract exists where required;
- [ ] intercompany tax is evaluated;
- [ ] same-entity movement does not automatically imply no tax;
- [ ] Incoterm does not directly determine tax;
- [ ] importer/exporter of record are explicit where material;
- [ ] tax provider capabilities resolve through CP;
- [ ] mandatory provider absence blocks readiness;
- [ ] Trade preserves committed tax;
- [ ] ERP preserves accounting authority;
- [ ] ERP cannot silently replace committed Commerce tax;
- [ ] tax adjustments preserve original snapshots;
- [ ] tax reconciliation exists;
- [ ] tax events are idempotent;
- [ ] audit exists;
- [ ] observability exists;
- [ ] tenant isolation passes;
- [ ] legal-entity isolation passes;
- [ ] Uganda local purchase scenario passes;
- [ ] Uganda local sale scenario passes;
- [ ] South Africa local purchase/sale scenarios pass;
- [ ] Uganda → South Africa scenario passes;
- [ ] South Africa → Uganda scenario passes;
- [ ] external-market scenario passes;
- [ ] intercompany scenario passes;
- [ ] inter-branch scenario passes;
- [ ] expired-registration scenario passes;
- [ ] export-evidence-failure scenario passes;
- [ ] recoverability scenario passes;
- [ ] credit/debit adjustment scenario passes.

---

# 141. Final Architecture

```text
                       COMMERCIAL TRANSACTION
                                │
                                ▼
                          TAX CONTEXT
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
   LEGAL PARTIES           JURISDICTION          TRANSACTION
         │                      │                      │
         ▼                      ▼                      ▼
 REGISTRATIONS            PLACE OF SUPPLY         TAX POINT
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                ▼
                       TAX DETERMINATION
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
           DOMESTIC           EXPORT            IMPORT
              │                 │                 │
              │                 ▼                 ├── Customs Duty
              │              Evidence             │   (ADR-0021)
              │                                   │
              │                                   └── Import Tax
              │                                           │
              │                                           ▼
              │                                    Recoverability
              │                                           │
              └─────────────────┬─────────────────────────┘
                                ▼
                       COMMITTED TAX SNAPSHOT
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
                TRADE                       ERP
          Customer-facing             Accounting /
          tax commitment              statutory authority
                   │                         │
                   └────────────┬────────────┘
                                ▼
                         RECONCILIATION
```

Cross-border separation:

```text
                  CROSS-BORDER TRANSACTION
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      INCOTERM          CUSTOMS             TAX
      ADR-0026          ADR-0021       ADR-0018 + ADD.
          │                │                │
          ▼                ▼                ▼
   Responsibility     Duty / Customs    VAT/GST/etc.
                           │                │
                           └───────┬────────┘
                                   ▼
                              LANDED COST
                               ADR-0020
                                   │
                        Recoverability-aware
```

Intercompany separation:

```text
              INTERNAL CROSS-MARKET MOVEMENT
                           │
                           ▼
                   LEGAL RELATIONSHIP
                     ADR-BCP-012
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       SAME LEGAL ENTITY       DISTINCT LEGAL ENTITIES
              │                         │
       INTER-BRANCH                 INTERCOMPANY
              │                         │
              └────────────┬────────────┘
                           ▼
                  TAX CONSEQUENCE
                      RESOLUTION
                           │
                           ▼
                   NEVER ASSUMED ZERO
```

The strengthened central invariant is:

> **Baobab SHALL never infer tax treatment merely from country, Market, currency, Incoterm, customs classification, customer type, related-party status or the fact that goods crossed a border. Tax is a contextual, effective-dated determination grounded in the actual legal transaction, applicable registrations, jurisdictional rules, tax point and required evidence.**

And the authority invariant is:

> **Trade owns the tax committed to the commercial transaction; tax providers own only the determinations delegated to them; customs providers own customs determinations; and ERP owns tax accounting, recoverability, statutory posting and reporting. None may silently substitute its authority for another.**

---

# Decision Outcome

**ADDENDUM TO ADR-0018 — ACCEPTED WHEN APPROVED**

ADR-0018 remains the base tax decision.

This Addendum extends it for Baobab's evolved:

```text
multi-tenant
multi-legal-entity
multi-market
multi-jurisdiction
B2B
B2C
cross-border
intercompany
inter-branch
provider-oriented
ERP-integrated
```

architecture.

Together:

```text
ADR-0018
    +
ADR-0018 Addendum
    =
Baobab Tax Architecture
```

No implementation SHALL treat the Addendum as a separate competing tax architecture.
