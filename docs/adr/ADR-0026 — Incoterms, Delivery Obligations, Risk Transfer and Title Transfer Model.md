# ADR-0026 — Incoterms, Delivery Obligations, Risk Transfer and Title Transfer Model

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Contracts:** `nabhold/shared`  
**Context Resolution:** `nabhold/baobab-cp`  
**Financial Consumer:** `nabhold/baobab-erp`  
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model
- ADR-BCP-014 — Canonical Counterparty Identity, Roles and Relationships Model
- ADR-0014 — Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0016 — Fulfilment, Shipping, Delivery and External Logistics Boundary
- ADR-0018 — Tax, Jurisdiction and Legal Transaction Context
- ADR-0019 — B2B Procurement and Supplier Commercial Workflow
- ADR-0020 — Landed Cost, Margin and Commercial Price Resolution
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture
- ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction
- ADR-0025 — Trade Documents, Evidence, Provenance and Document Lifecycle Architecture

---

# 1. Context

Cross-border transactions require explicit answers to several questions:

```text
Who arranges transport?

Who pays freight?

Who arranges export clearance?

Who arranges import clearance?

Who pays insurance?

Who bears risk while goods are moving?

At what point does risk transfer?

At what point does legal title transfer?

Who owns inventory while it is in transit?

When may revenue or inventory consequences be recognised?

Which costs belong in landed cost?
```

These questions are related but they are **not equivalent**.

A dangerous implementation would reduce them to:

```text
incoterm = "FOB"
```

and allow each engine to infer its own consequences.

That would eventually produce contradictions between:

```text
Trade
Logistics
Inventory
Customs
ERP
Accounting
```

Baobab therefore requires a canonical model for Incoterms and the contractual policies surrounding delivery, cost allocation, risk and title.

---

# 2. Decision

Baobab SHALL model Incoterms as **versioned commercial delivery-rule references combined with transaction-specific named places and explicit contractual policies**.

The governing principle is:

> **Incoterms define agreed delivery obligations, allocation of certain costs and transfer of risk between seller and buyer. Incoterms SHALL NOT be treated as determining legal title, accounting recognition, tax treatment or regulatory eligibility by themselves.**

The canonical composition is:

```text
Commercial Contract
        │
        ├── Incoterm Rule
        ├── Incoterm Version
        ├── Named Place / Port
        ├── Delivery Obligations
        ├── Cost Responsibility
        ├── Risk Transfer Policy
        ├── Title Transfer Policy
        └── Additional Contract Terms
```

---

# 3. Fundamental Separation

Baobab SHALL distinguish:

```text
DELIVERY
≠
RISK TRANSFER
≠
TITLE TRANSFER
≠
CUSTODY TRANSFER
≠
PHYSICAL POSSESSION
≠
CUSTOMS RELEASE
≠
ACCOUNTING RECOGNITION
≠
PAYMENT
```

These events MAY occur at different times.

---

# 4. Incoterm Is Not Title Policy

This invariant is mandatory:

> **Incoterms do not themselves determine when ownership/title to goods passes from seller to buyer.**

Therefore Baobab SHALL NOT implement:

```text
if incoterm == "FOB":
    transfer_title(...)
```

or equivalent assumptions.

Title SHALL be governed separately.

---

# 5. Incoterm Is Not Payment Terms

Likewise:

```text
FOB
CIF
DAP
```

do not mean:

```text
PREPAID
NET_30
LETTER_OF_CREDIT
CASH_AGAINST_DOCUMENTS
```

Payment and settlement terms SHALL remain separate.

---

# 6. Incoterm Is Not Tax Determination

Incoterm context MAY affect costs and transaction facts consumed by tax determination.

It SHALL NOT independently determine:

```text
VAT
GST
sales tax
import VAT
withholding
```

---

# 7. Incoterm Is Not Customs Eligibility

Incoterms allocate contractual responsibilities.

They SHALL NOT establish that:

```text
product may legally be imported
product may legally be exported
party has required licence
```

ADR-0021 and ADR-0024 remain authoritative.

---

# 8. Canonical Incoterm Reference

Conceptually:

```text
IncotermReference
├── code
├── rules_version
├── named_place
├── named_place_type
├── country?
├── location_reference?
└── agreed_text?
```

---

# 9. Rules Version Is Mandatory

Baobab SHALL NOT store only:

```text
CIF
```

It SHALL store a versioned reference such as conceptually:

```text
rule = CIF
rules_version = 2020
```

where applicable.

This prevents future rule revisions from silently changing historical transactions.

---

# 10. Historical Reproducibility

A transaction SHALL retain the Incoterm rules version agreed when the transaction was committed.

A future rules revision SHALL NOT mutate historical contracts.

---

# 11. Named Place Is Mandatory Where Applicable

An Incoterm code without its contractual location can be materially incomplete.

Baobab SHALL therefore model:

```text
Incoterm
+
Named Place / Port
```

as a combined commercial term where the rule requires one.

Example conceptually:

```text
CIF
+
Named Port of Destination
```

rather than merely:

```text
CIF
```

---

# 12. Named Place Is Structured

Where practical, named places SHOULD reference canonical locations.

Conceptually:

```text
NamedPlace
├── display_name
├── location_type
├── country
├── canonical_location_id?
├── external_location_code?
└── free_text_fallback?
```

---

# 13. Location Types

Suggested extensible types:

```text
WAREHOUSE
PORT
AIRPORT
TERMINAL
BORDER_POST
CUSTOMER_SITE
SUPPLIER_SITE
OTHER_LOCATION
```

---

# 14. Free Text

Free text MAY be retained for contractual fidelity.

Where operational routing depends on the place, however, Baobab SHOULD resolve it to structured location identity.

---

# 15. Initial Rule Set

Baobab SHALL be capable of representing the Incoterms® 2020 rules:

```text
EXW
FCA
CPT
CIP
DAP
DPU
DDP

FAS
FOB
CFR
CIF
```

The platform SHALL distinguish rules applicable to any mode of transport from those intended for sea/inland-waterway transport.

---

# 16. No Mode-Incompatible Silent Acceptance

If a selected term conflicts materially with the intended transport context, Trade SHOULD:

```text
WARN
REQUIRE_REVIEW
or
BLOCK
```

according to policy.

It SHALL NOT silently normalize the contract into another term.

---

# 17. Commercial Delivery Policy

Baobab SHALL derive a canonical delivery policy from the agreed term.

Conceptually:

```text
DeliveryPolicy
├── incoterm_reference
├── seller_obligations
├── buyer_obligations
├── delivery_point
├── risk_transfer_point
├── cost_allocations
├── transport_responsibility
├── insurance_responsibility
├── export_clearance_responsibility
└── import_clearance_responsibility
```

---

# 18. Policy Derivation

The rule interpretation SHOULD come from a governed, versioned policy/rules provider or approved rules dataset.

It SHALL NOT be scattered through arbitrary application conditionals.

---

# 19. Incoterm Provider Capability

Baobab MAY expose a capability such as:

```text
trade.incoterm.resolve
```

that accepts:

```text
rule
version
named place
transport mode
origin
destination
```

and returns canonical obligations.

---

# 20. Policy Authority

Baobab's implementation SHALL preserve the distinction between:

```text
official contractual rule
```

and:

```text
Baobab operational projection of that rule.
```

---

# 21. Seller Obligations

The canonical policy MAY identify seller responsibilities such as:

```text
packaging
delivery to agreed point
origin transport
main carriage
export formalities
insurance
destination handling
import formalities
destination delivery
```

as applicable.

---

# 22. Buyer Obligations

The same model SHALL identify corresponding buyer responsibilities.

---

# 23. Cost Responsibility

Cost allocation SHALL be represented separately from physical execution.

Example:

```text
Freight Booker
≠
Freight Payer
```

ADR-0022 already establishes this distinction.

---

# 24. Cost Responsibility Model

Conceptually:

```text
CostResponsibility
├── cost_category
├── responsible_party
├── responsibility_basis
├── effective_stage
└── policy_reference
```

---

# 25. Cost Categories

Potential categories include:

```text
ORIGIN_HANDLING
ORIGIN_TRANSPORT
EXPORT_CLEARANCE
EXPORT_DOCUMENTATION
MAIN_FREIGHT
INSURANCE
DESTINATION_HANDLING
IMPORT_CLEARANCE
CUSTOMS_DUTY
IMPORT_TAX
DESTINATION_TRANSPORT
UNLOADING
```

The list SHALL remain extensible.

---

# 26. Responsibility ≠ Actual Cost

Incoterm resolution determines responsibility.

ADR-0020 determines how actual/estimated cost contributes to landed cost and commercial pricing.

---

# 27. No Double Counting

If seller-paid freight is already embedded in purchase/commercial price, landed-cost calculation SHALL not automatically add the same cost again.

---

# 28. Risk Transfer

Risk transfer SHALL be explicit.

Conceptually:

```text
RiskTransferPolicy
├── rule
├── transfer_event_type
├── transfer_location
├── conditions
└── source
```

---

# 29. Risk State

A transaction MAY project:

```text
SELLER_RISK
TRANSFER_PENDING
BUYER_RISK
DISPUTED
UNKNOWN
```

---

# 30. Risk Transfer Is Event-Driven

Risk SHALL transfer only when the relevant real-world/canonical event has occurred.

Example conceptually:

```text
Goods handed to carrier
        ↓
Canonical Logistics Event
        ↓
Risk Policy Evaluation
        ↓
RiskTransferred Event
```

where that is the applicable contractual rule.

---

# 31. Planned Event Is Not Actual Transfer

A scheduled pickup SHALL NOT transfer risk merely because the event was expected.

---

# 32. Evidence

Risk-transfer events SHOULD reference supporting evidence where material.

Examples:

```text
carrier acceptance
transport document
terminal receipt
delivery confirmation
proof of delivery
```

---

# 33. Logistics Integration

ADR-0022 provides physical transport events.

ADR-0026 interprets relevant events against contractual risk policy.

---

# 34. Logistics Does Not Determine Contractual Risk

A carrier reporting:

```text
PICKED_UP
```

does not universally mean buyer risk has begun.

The applicable commercial policy must resolve the consequence.

---

# 35. Title Transfer

Title SHALL be represented by an independent contractual policy.

Conceptually:

```text
TitleTransferPolicy
├── policy_type
├── transfer_event_type
├── transfer_location?
├── payment_condition?
├── document_condition?
├── contract_reference
└── governing_law_context?
```

---

# 36. Title Policy Types

Baobab SHOULD support extensible title policies such as:

```text
ON_CONTRACT
ON_DISPATCH
ON_CARRIER_HANDOVER
ON_SHIPMENT
ON_DOCUMENT_TRANSFER
ON_CUSTOMS_RELEASE
ON_DELIVERY
ON_ACCEPTANCE
ON_PAYMENT
ON_FULL_PAYMENT
CUSTOM
```

These are canonical policy abstractions, not universal legal conclusions.

---

# 37. Custom Title Policy

Complex contracts MAY define title using multiple conditions.

Example:

```text
Delivered
+
Full Payment Received
=
Title Transfer
```

The architecture SHALL support compound conditions.

---

# 38. Governing Law

Title consequences may depend on contract and applicable law.

Baobab SHALL therefore avoid claiming that its generic title policy independently determines legal ownership outside the contractual/legal context.

---

# 39. Contract Is Authoritative

Where a signed commercial contract explicitly defines title transfer, that contractual policy SHALL govern Baobab's operational projection, subject to applicable law and configured controls.

---

# 40. Title Transfer Event

When resolved conditions are satisfied:

```text
TitleTransferPolicy
        +
Canonical Event
        ↓
title.transferred
```

SHALL be emitted idempotently.

---

# 41. Risk Transfer ≠ Title Transfer

Example:

```text
Risk → Buyer
Title → Seller
```

MAY be a valid intermediate state.

Baobab SHALL support it.

---

# 42. Title Transfer ≠ Custody Transfer

Likewise:

```text
Owner = Buyer
Custodian = Carrier
```

MAY be valid.

---

# 43. Title Transfer ≠ Physical Location

Goods may be:

```text
owned by Buyer
physically in transit
held by Carrier
located in another country
```

simultaneously.

ADR-BCP-013 SHALL represent these independently.

---

# 44. Inventory Ownership Integration

Before title transfer:

```text
legal_owner = seller
```

After a valid title-transfer event:

```text
legal_owner = buyer
```

where the relevant canonical inventory model represents legal ownership.

---

# 45. Ownership History

Inventory ownership changes SHALL preserve history.

---

# 46. In-Transit Inventory

Baobab SHALL support:

```text
Location = IN_TRANSIT
Custodian = Carrier
Owner = Seller
RiskBearer = Buyer
```

or other combinations resulting from the actual policies.

This is one reason these concepts cannot be collapsed.

---

# 47. Canonical Responsibility State

A shipment/transaction MAY expose a derived projection:

```text
TradeResponsibilityState
├── freight_responsible_party
├── insurance_responsible_party
├── export_clearance_party
├── import_clearance_party
├── current_risk_bearer
├── current_title_holder
└── last_evaluated_at
```

---

# 48. Projection Is Not Authority

This state is derived from:

```text
contract
+
Incoterm policy
+
title policy
+
actual events
```

It SHALL not become a competing contractual source.

---

# 49. Contract Snapshot

At commitment, Trade SHALL retain an immutable-enough snapshot of:

```text
Incoterm
Incoterm version
named place
title-transfer policy
payment terms
material deviations
contract version
```

---

# 50. Quote Stage

A quote MAY contain proposed Incoterm terms.

---

# 51. Quote Expiry

Changing Incoterm after quote creation MAY require price re-resolution.

---

# 52. Order Commitment

At order acceptance, agreed delivery terms SHALL become committed transaction terms.

They SHALL not silently follow later customer/supplier defaults.

---

# 53. Contract Amendment

Changing committed Incoterm or title terms SHALL require explicit amendment workflow.

---

# 54. No Silent Mutation

The system SHALL NOT silently change:

```text
FOB → CIF
```

because logistics configuration changes.

---

# 55. Pricing Integration

ADR-0020 SHALL consume cost responsibility.

Conceptually:

```text
Incoterm
    ↓
Cost Responsibility
    ↓
Expected Seller Cost
    ↓
Commercial Cost Basis
    ↓
Minimum Commercial Price
```

---

# 56. Procurement Pricing

Supplier quote comparison SHALL normalize differences in delivery terms where possible.

Example:

```text
Supplier A price under EXW
vs
Supplier B price under CIF
```

SHALL NOT be compared solely on invoice unit price.

---

# 57. Comparable Cost

Trade SHOULD calculate an evaluation basis:

```text
Quoted Purchase Price
+
Buyer-Borne Estimated Costs
=
Comparable Procurement Cost
```

subject to ADR-0020.

---

# 58. Sales Pricing

Seller-borne costs under the agreed term MAY contribute to commercial price resolution.

---

# 59. Freight Recovery

Seller paying freight does not necessarily mean freight is economically absorbed by seller.

Trade MAY recover it through commercial price.

---

# 60. Customs Integration

ADR-0021 SHALL consume responsibility context for:

```text
export formalities
import formalities
customs broker coordination
```

---

# 61. Responsibility Does Not Mean Regulatory Authority

If seller is responsible for export clearance, that does not make seller the customs authority.

---

# 62. Importer of Record

Where required, importer-of-record SHALL be modelled explicitly.

It SHALL NOT be inferred solely from Incoterm code.

---

# 63. Exporter of Record

Likewise exporter-of-record SHALL be explicit where required.

---

# 64. DDP Caution

The platform SHALL NOT interpret DDP merely as:

```text
seller pays everything
```

and ignore whether the seller can lawfully perform required destination/import obligations.

---

# 65. Capability Validation

Where a commercial term requires a party to perform a regulated function, Baobab SHOULD validate the required capability/registration.

Conceptually:

```text
Contractual Responsibility
        +
Legal Capability
        ↓
Operational Feasibility
```

---

# 66. Impossible Obligation

If seller is contractually assigned an obligation it cannot legally perform:

```text
REVIEW_REQUIRED / BLOCKED
```

according to policy.

---

# 67. Product Eligibility Integration

ADR-0024 remains authoritative for whether the product may enter/leave the market.

Incoterm cannot override product prohibition.

---

# 68. Document Requirements

ADR-0025 SHALL consume contractual responsibilities.

Example:

```text
seller responsible for transport document
```

may affect document-package ownership/workflow.

---

# 69. Document Responsibility

Baobab SHOULD distinguish:

```text
document issuer
document procurer
document uploader
document recipient
```

These may differ.

---

# 70. Insurance

Insurance responsibility SHALL be modelled separately.

---

# 71. Insurance Requirement

Certain Incoterm rules include specific seller insurance obligations.

Baobab SHALL resolve these through the versioned rule policy rather than generic assumptions.

---

# 72. Additional Insurance

Parties MAY contract for insurance beyond the standard rule obligations.

Therefore:

```text
Incoterm Insurance Requirement
+
Additional Contract Insurance
=
Effective Insurance Policy
```

---

# 73. Insurance Provider

Insurer identity SHALL use the canonical counterparty architecture.

---

# 74. Insurance Evidence

Insurance certificate/policy SHALL use ADR-0025.

---

# 75. Claims

Damage/loss claims SHALL consume:

```text
risk bearer
title holder
custodian
insurance policy
shipment event
evidence
```

---

# 76. Damage Does Not Automatically Determine Liability

Physical custody, contractual risk and legal liability SHALL remain distinguishable.

---

# 77. ERP Integration

ERP SHALL consume the resolved commercial/legal consequences needed for:

```text
procurement
sales
inventory
landed cost
AR/AP
accounting
```

but SHALL not independently reinterpret the Incoterm.

---

# 78. Accounting Recognition

Accounting recognition SHALL be determined by ERP/accounting policy.

Baobab SHALL NOT equate:

```text
Risk Transfer
=
Revenue Recognition
```

as a universal rule.

---

# 79. Revenue Recognition

Relevant contractual delivery/risk/title facts MAY be supplied to ERP.

ERP applies the accounting policy.

---

# 80. Inventory Recognition

Similarly:

```text
Title Transfer
```

may influence inventory accounting, but accounting authority remains ERP.

---

# 81. Accounts Payable

Supplier invoice/payment timing SHALL remain governed by procurement/payment terms rather than Incoterm alone.

---

# 82. Intercompany Trade

Intercompany transactions SHALL support Incoterms where physical cross-border trade occurs.

---

# 83. Related Parties Do Not Eliminate Incoterms

Related legal entities MAY still need explicit:

```text
delivery responsibility
risk allocation
title transfer
customs responsibility
```

---

# 84. Inter-Branch Transfers

Same-entity branch transfers may not require a commercial Incoterm.

Baobab SHALL NOT manufacture a fictitious sale term for internal stock movement.

---

# 85. Internal Transfer Policy

Inter-branch logistics SHOULD use explicit:

```text
InternalTransferPolicy
```

where no sale contract exists.

---

# 86. Internal Transfer Risk

Operational risk/custody may still need tracking even when legal title does not change.

---

# 87. Transaction Classification First

Flow:

```text
Transaction
      ↓
LOCAL_TRADE
EXTERNAL_CROSS_BORDER
INTERCOMPANY
INTER_BRANCH
      ↓
Applicable Commercial / Transfer Policy
```

---

# 88. Local Trade

Incoterms MAY be used for domestic contracts if commercially appropriate, but Baobab SHALL not require them universally for local sales.

---

# 89. Cross-Border Trade

Cross-border external/intercompany sales SHOULD have explicit delivery terms before commitment.

---

# 90. Defaults

Tenant/market/customer/supplier defaults MAY propose an Incoterm.

They SHALL NOT silently become committed terms without transaction resolution.

---

# 91. Customer Default

Example:

```text
Customer Default = DAP
```

means:

```text
proposal
```

not immutable contract rule.

---

# 92. Supplier Default

Likewise supplier default terms are negotiation inputs.

---

# 93. Trade-Lane Defaults

A TradeLane MAY define:

```text
allowed_incoterms
preferred_incoterms
prohibited_incoterms
```

---

# 94. Allowed Does Not Mean Selected

Trade lane policy:

```text
FCA, CPT, CIP
```

does not choose one automatically unless explicit pricing/contract policy does so.

---

# 95. Prohibited Terms

A tenant MAY prohibit terms operationally unsuitable for a trade lane.

---

# 96. Trade-Lane Validation

Before commitment:

```text
Selected Incoterm
        ↓
TradeLane Policy
        ↓
ALLOW / REVIEW / BLOCK
```

---

# 97. Mode Validation

Before commitment/booking:

```text
Selected Rule
+
Transport Mode
        ↓
Compatibility Check
```

---

# 98. Named Place Validation

Baobab SHOULD validate that named place is coherent with:

```text
rule
origin
destination
trade lane
transport mode
```

where possible.

---

# 99. Responsibility Resolution API

Conceptually:

```text
resolveTradeResponsibilities(context)
```

Input:

```text
tenant
seller
buyer
origin
destination
trade lane
incoterm
rules version
named place
transaction date
contract overrides
```

Output:

```text
delivery obligations
cost responsibilities
risk-transfer policy
insurance responsibility
clearance responsibilities
```

Title SHALL come from the separate contractual title policy.

---

# 100. Determinism

Given the same:

```text
contract snapshot
rule version
context
events
```

responsibility resolution SHALL be reproducible.

---

# 101. Contract Overrides

Parties may modify commercial obligations contractually.

Such deviations SHALL be explicit.

---

# 102. No Hidden Override

An override SHALL record:

```text
rule affected
standard obligation
agreed obligation
reason/reference
contract clause
```

---

# 103. Modified Incoterm

If contractual changes materially alter standard Incoterm obligations, the system SHOULD clearly indicate:

```text
STANDARD_RULE_WITH_OVERRIDES
```

rather than pretending the unmodified standard rule applies.

---

# 104. Contractual Conflict

If override creates contradictory obligations:

```text
REVIEW_REQUIRED
```

SHALL be raised.

---

# 105. Risk Transfer Event Types

Canonical types MAY include:

```text
GOODS_MADE_AVAILABLE
CARRIER_HANDOVER
LOADED_ON_BOARD
DELIVERED_TO_TERMINAL
ARRIVED_AT_DESTINATION
DELIVERED_TO_NAMED_PLACE
UNLOADED_AT_NAMED_PLACE
BUYER_ACCEPTANCE
CUSTOM
```

These are abstractions interpreted against the applicable rule.

---

# 106. Title Transfer Event Types

Title policies MAY consume:

```text
ORDER_COMMITTED
INVOICE_ISSUED
PAYMENT_RECEIVED
FULL_PAYMENT_RECEIVED
GOODS_DISPATCHED
CARRIER_HANDOVER
LOADED_ON_BOARD
CUSTOMS_RELEASED
DELIVERED
ACCEPTED
DOCUMENTS_TRANSFERRED
CUSTOM
```

---

# 107. Event Correlation

Physical events SHALL correlate to:

```text
transaction
shipment
transport leg
inventory transfer
```

as appropriate.

---

# 108. Idempotency

Repeated carrier callback:

```text
LOADED_ON_BOARD
```

SHALL NOT transfer risk/title multiple times.

---

# 109. Out-of-Order Events

A late event SHALL be evaluated using:

```text
actual occurred_at
policy
existing state
```

rather than callback arrival order alone.

---

# 110. Disputed Event

If evidence conflicts:

```text
risk/title state = DISPUTED
```

MAY be required rather than silently choosing one source.

---

# 111. Event Evidence

Critical transfer events SHOULD reference ADR-0025 evidence.

---

# 112. Events

Canonical events SHOULD include:

```text
trade-terms.committed
trade-terms.amended

delivery-obligation.resolved

risk-transfer.pending
risk.transferred
risk-transfer.disputed

title-transfer.pending
title.transferred
title-transfer.disputed

trade-responsibility.changed
```

---

# 113. Event Envelope

Events SHALL include where relevant:

```text
tenant_id
legal_entity_id
transaction_id
shipment_id
trade_lane_id
seller_id
buyer_id
incoterm
rules_version
correlation_id
causation_id
occurred_at
schema_version
```

---

# 114. Audit

Audit SHALL record:

```text
term proposed
term negotiated
term accepted
named place
rules version
contract override
risk policy
title policy
responsibility resolution
transfer event
manual correction
dispute
```

---

# 115. Reconciliation

Baobab SHALL reconcile:

```text
Contract Terms
↕
Trade Responsibility Projection

Risk Transfer
↕
Logistics Evidence

Title Transfer
↕
Inventory Ownership

Cost Responsibility
↕
Landed Cost

Commercial Terms
↕
ERP Transaction Context
```

---

# 116. Reconciliation States

Suggested:

```text
MATCHED
PENDING
MISMATCH
MISSING_EVENT
CONFLICT
DISPUTED
UNRESOLVED
```

---

# 117. Observability

Recommended metrics:

```text
incoterm_resolution_total
incoterm_validation_failure_total
incoterm_mode_mismatch_total

risk_transfer_pending_total
risk_transfer_disputed_total

title_transfer_pending_total
title_transfer_disputed_total

trade_responsibility_mismatch_total
incoterm_override_total
```

---

# 118. Alerts

Alert on:

- committed cross-border order without resolved delivery terms;
- missing named place where required;
- incompatible transport mode;
- impossible import/export responsibility;
- unresolved risk transfer after expected milestone;
- title/inventory ownership mismatch;
- ERP/Trade term mismatch;
- contradictory contract override.

---

# 119. ZuriBeans Scenario — Uganda Coffee → South Africa

The platform SHALL support:

```text
Seller
    ZuriBeans Uganda / applicable selling entity

Buyer
    external buyer or related entity

Origin
    Uganda

Destination
    South Africa

Incoterm
    negotiated rule + named place

Title Policy
    explicit contract policy
```

The engine SHALL derive responsibilities from those terms.

It SHALL NOT assume that Uganda is permanently the exporting side.

---

# 120. ZuriBeans Scenario — South Africa Wine → Uganda

The same architecture SHALL operate in the reverse direction without new core logic.

---

# 121. ZuriBeans External-Market Scenario

Example:

```text
Uganda → Kenya
South Africa → Namibia
Uganda → UAE
```

SHALL require configuration/provider data, not code changes.

---

# 122. Local Sale Scenario

Local sale SHALL support explicit delivery/risk/title terms without unnecessary customs/export processing.

---

# 123. Intercompany Scenario

Two related legal entities SHALL support:

```text
commercial Incoterm
risk transfer
title transfer
transfer pricing
cross-border customs
```

independently.

---

# 124. Inter-Branch Scenario

Same legal entity SHALL preserve:

```text
legal owner
```

while custody/location/risk-management states may change.

---

# 125. Carrier Handover Test

When carrier handover occurs:

- custody SHALL update according to ADR-BCP-013;
- risk SHALL update only if applicable policy says so;
- title SHALL update only if title policy says so.

---

# 126. Delivery Test

When delivery occurs:

```text
shipment = DELIVERED
```

but:

```text
title
risk
acceptance
payment
```

SHALL each follow their respective policies.

---

# 127. Payment Test

Full payment SHALL trigger title transfer only where the explicit title policy requires it.

---

# 128. Customs Release Test

Customs release SHALL NOT universally trigger:

```text
risk transfer
title transfer
revenue recognition
```

---

# 129. Damage-in-Transit Test

When goods are damaged:

Baobab SHALL be able to determine separately:

```text
owner
risk bearer
custodian
carrier
insurer
shipment state
```

---

# 130. Lost-in-Transit Test

The same independent dimensions SHALL remain resolvable.

---

# 131. Partial Shipment Test

Different quantities MAY reach transfer milestones at different times.

Risk/title policy SHALL support line/quantity/lot/shipment scope where required.

---

# 132. Split Shipment Test

One order with multiple shipments SHALL not transfer all quantities merely because one shipment reached a milestone.

---

# 133. Partial Delivery Test

Likewise partial delivery SHALL support quantity-scoped consequences.

---

# 134. Incoterm Amendment Test

Changing agreed Incoterm after commitment SHALL:

```text
create amendment
re-resolve responsibilities
re-evaluate pricing
re-evaluate logistics
re-evaluate compliance
preserve prior snapshot
```

---

# 135. Rules-Version Test

Historical transaction under one rule version SHALL remain reproducible after a later rules version is introduced.

---

# 136. Invalid Mode Test

A transport-rule/mode incompatibility SHALL produce policy-controlled review/block rather than silent acceptance.

---

# 137. Missing Named Place Test

Where required:

```text
Incoterm present
Named Place absent
```

SHALL prevent full readiness.

---

# 138. Impossible DDP-like Obligation Test

Seller assigned destination import obligations but cannot legally perform them.

Expected:

```text
REVIEW_REQUIRED / BLOCKED
```

not silent execution.

---

# 139. Cost Comparison Test

Compare supplier quotations under materially different Incoterms using buyer-borne estimated landed cost rather than raw unit price.

---

# 140. Cross-Tenant Isolation

ZuriBeans contractual terms SHALL not leak into Thamani transactions.

---

# 141. Rejected Alternative — Incoterm Determines Title

Rejected categorically.

Incoterms do not themselves determine legal title transfer.

---

# 142. Rejected Alternative — Incoterm Determines Revenue Recognition

Rejected.

Accounting policy belongs to ERP/accounting governance.

---

# 143. Rejected Alternative — Incoterm Determines Tax

Rejected.

Tax has separate jurisdictional determination.

---

# 144. Rejected Alternative — Incoterm Determines Product Eligibility

Rejected.

ADR-0024 governs product eligibility.

---

# 145. Rejected Alternative — One Risk/Ownership Flag

Rejected because:

```text
risk
title
custody
location
```

can differ simultaneously.

---

# 146. Rejected Alternative — Hard-Code Incoterm Logic Across Engines

Rejected.

Rule interpretation SHALL be canonical/versioned.

---

# 147. Rejected Alternative — Store Only Incoterm Code

Rejected.

The model requires:

```text
code
+
rules version
+
named place
+
contract overrides
```

---

# 148. Rejected Alternative — Logistics Provider Determines Risk Transfer

Rejected.

Providers report physical events; contractual policy determines their consequences.

---

# 149. Rejected Alternative — ERP Independently Interprets Incoterms

Rejected because Trade, Logistics, Inventory and ERP could derive contradictory outcomes.

ERP SHALL consume canonical resolved context.

---

# 150. Rejected Alternative — Internal Trade Needs No Delivery Policy

Rejected for intercompany physical trade.

Related-party status does not remove logistical/customs/risk requirements.

---

# 151. Positive Consequences

This architecture provides:

- consistent Incoterm handling;
- explicit named places;
- rules-version reproducibility;
- clear seller/buyer obligations;
- landed-cost integration;
- freight-responsibility clarity;
- independent risk/title/custody;
- inventory ownership accuracy;
- logistics integration;
- customs responsibility clarity;
- safer intercompany trading;
- auditable contract amendments;
- N-to-N market scalability.

---

# 152. Costs

Implementation requires:

- versioned Incoterm rules;
- structured named places;
- responsibility resolution;
- risk-transfer policy;
- title-transfer policy;
- event evaluation;
- contract snapshots;
- reconciliation;
- quantity-scoped transfers.

The complexity reflects actual international trade rather than artificial software complexity.

---

# 153. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical Incoterm, responsibility, risk/title contracts and events |
| `nabhold/baobab-cp` | Tenant/market/trade-lane context and provider resolution |
| `nabhold/baobab-trade` | Negotiation, contract terms, responsibility orchestration, risk/title policy evaluation |
| `nabhold/baobab-erp` | Accounting/inventory financial consequences |
| `nabhold/baobab-iam` | Authorization for commercial-term changes |
| `nabhold/baobab-cms` | Contract/document representations where applicable |
| Logistics providers | Physical transport events |
| Compliance providers | Regulatory determinations |
| `nabhold/baobab-pulse` | Optional freight/risk intelligence |

---

# 154. Implementation Sequence

```text
Canonical Incoterm Contract
          ↓
Rules Versioning
          ↓
Named Place Model
          ↓
Trade-Lane Validation
          ↓
Delivery Obligations
          ↓
Cost Responsibility
          ↓
Risk Transfer Policy
          ↓
Title Transfer Policy
          ↓
Contract Snapshot
          ↓
Logistics Events
          ↓
Inventory Ownership
          ↓
ERP Integration
          ↓
Reconciliation
          ↓
Golden-Tenant Validation
```

---

# 155. Release 1 P0 Scope

ZuriBeans Release 1 SHALL support:

- Incoterms® 2020 rule references;
- rule version;
- named place/port;
- trade-lane allowed/preferred/prohibited terms;
- transport-mode validation;
- seller/buyer obligation resolution;
- freight responsibility;
- insurance responsibility;
- export/import clearance responsibility;
- risk-transfer policy;
- title-transfer policy;
- independent custody;
- contract snapshot;
- contractual overrides;
- landed-cost integration;
- logistics event integration;
- inventory ownership integration;
- ERP context integration;
- quantity/partial-shipment handling;
- events;
- audit;
- reconciliation.

---

# 156. Release 1.1 Candidates

Future enhancements MAY include:

- guided Incoterm recommendation;
- landed-cost comparison by Incoterm;
- automated negotiation suggestions;
- contract-clause extraction;
- AI-assisted Incoterm validation;
- route/term optimisation;
- insurance optimisation;
- trade-risk modelling;
- automated contractual deviation detection.

AI SHALL remain advisory for contractual/legal interpretation unless governed otherwise.

---

# 157. Definition of Done

ADR-0026 is implemented when:

- [ ] Incoterm code and rules version are explicit;
- [ ] named place/port is structured where applicable;
- [ ] mode compatibility is validated;
- [ ] seller/buyer obligations resolve deterministically;
- [ ] cost responsibilities are explicit;
- [ ] freight payer and freight booker remain distinct;
- [ ] insurance responsibility is explicit;
- [ ] export/import clearance responsibility is explicit;
- [ ] importer/exporter of record are not blindly inferred;
- [ ] risk transfer is independent;
- [ ] title transfer is independent;
- [ ] custody is independent;
- [ ] physical location is independent;
- [ ] payment terms are independent;
- [ ] tax determination is independent;
- [ ] accounting recognition is independent;
- [ ] contract snapshot exists;
- [ ] contractual overrides are versioned/audited;
- [ ] logistics events drive actual milestone evaluation;
- [ ] inventory ownership integrates with title;
- [ ] landed-cost calculation consumes responsibility;
- [ ] ERP consumes resolved context;
- [ ] partial shipment/quantity scope works;
- [ ] duplicate events are idempotent;
- [ ] out-of-order events are handled;
- [ ] reconciliation exists;
- [ ] UG→ZA scenario passes;
- [ ] ZA→UG scenario passes;
- [ ] local trade passes;
- [ ] external-market trade passes;
- [ ] intercompany trade passes;
- [ ] inter-branch movement passes;
- [ ] damage/loss scenario passes;
- [ ] missing named place fails readiness where mandatory;
- [ ] no engine independently interprets Incoterm into contradictory title/risk state.

---

# 158. Final Architecture

```text
                       COMMERCIAL CONTRACT
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          INCOTERM         TITLE POLICY     PAYMENT TERMS
              │                │
              ▼                │
      DELIVERY OBLIGATIONS     │
              │                │
       ┌──────┼──────┐         │
       ▼      ▼      ▼         │
     COST   RISK   CLEARANCE   │
       │      │                 │
       │      ▼                 ▼
       │  RISK TRANSFER    TITLE TRANSFER
       │      │                 │
       │      └────────┬────────┘
       │               ▼
       │        INVENTORY OWNERSHIP
       │
       ▼
   LANDED COST
```

Physical execution remains separate:

```text
                     LOGISTICS PROVIDER
                            │
                            ▼
                     PHYSICAL EVENT
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
       CUSTODY         RISK POLICY       TITLE POLICY
       UPDATE          EVALUATION        EVALUATION
          │                 │                 │
          ▼                 ▼                 ▼
      Custodian        Risk Bearer        Legal Owner
```

A legitimate in-transit state can therefore be:

```text
Physical Location : IN_TRANSIT
Custodian         : Freight Forwarder
Risk Bearer       : Buyer
Legal Owner       : Seller
Freight Payer     : Seller
Importer of Record: Buyer
Payment Status    : UNPAID
```

No field in that state SHALL be inferred merely from another.

The fundamental invariant is:

> **Incoterms govern contractual delivery obligations, allocation of specified costs and transfer of risk. They do not independently determine legal title, custody, payment, taxation, customs eligibility, inventory accounting or revenue recognition. Baobab SHALL model each consequence explicitly and connect them through governed contractual policies and actual events.**

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0026
    ↓
Canonical Incoterm Contracts
    ↓
Rules + Named Places
    ↓
Responsibility Resolution
    ↓
Risk Policy
    ↓
Title Policy
    ↓
Contract Snapshots
    ↓
Logistics Event Integration
    ↓
Inventory Ownership Integration
    ↓
Landed Cost + ERP Integration
    ↓
Reconciliation
    ↓
ZuriBeans Golden-Tenant Validation
```

No Baobab engine SHALL infer title transfer, revenue recognition, tax treatment or regulatory eligibility solely from an Incoterm code.