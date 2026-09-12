# ADR-0019 — B2B Procurement, Supplier Commercial Workflow and Trade-to-ERP Boundary Model

**Status:** Proposed — Normative Commerce Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Repository:** `nabhold/baobab-trade`  
**Commerce Runtime:** MedusaJS  
**Procurement Transaction Authority:** `nabhold/baobab-erp` / iDempiere  
**Platform Context Authority:** `nabhold/baobab-cp`  
**Canonical Contract Authority:** `nabhold/shared`  
**Identity Authority:** `nabhold/baobab-iam`  
**Supplier-Facing Digital Estate:** ZuriBeans Supplier Portal / supplier context  
**Reference Tenant:** ZuriBeans

## Related Baobab Trade ADRs

- ADR-0007 — MedusaJS as the Baobab Commerce Engine
- ADR-0008 — Baobab Commerce Engine Implementation Contract
- ADR-0009 — MedusaJS Commerce Tenancy and Isolation Model
- ADR-0010 — MedusaJS Commerce Market, Region, Currency, Sales Channel and Legal Seller Model
- ADR-0011 — Commerce Product, Variant, Catalogue and Canonical Product Authority Model
- ADR-0012 — MedusaJS Commerce Pricing, Price Lists, Promotions and B2B Commercial Terms
- ADR-0013 — MedusaJS Commerce Inventory, Availability, Reservation and ERP Stock Authority Model
- ADR-0014 — MedusaJS Commerce Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0015 — MedusaJS Commerce Payment Orchestration, Provider Isolation and Financial Reconciliation
- ADR-0016 — MedusaJS Commerce Fulfilment, Shipping, Delivery and External Logistics Boundary
- ADR-0017 — MedusaJS Commerce Customer, B2B Organisation, Buyer Identity and Authorization Model
- ADR-0018 — MedusaJS Commerce Tax, Jurisdiction and Legal Transaction Context

## Related Platform ADRs

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading, Legal-Entity Relationship and Internal Settlement Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model

## Applies To

Supplier registration, supplier organisation, supplier qualification, sourcing, procurement requirements, supplier RFQs, supplier quotations, bid comparison, supplier selection, sourcing events, procurement approval, purchase requisitions, purchase orders, goods receipts, supplier invoices, supplier commercial terms, supplier price agreements, supplier performance, supplier-facing workflow, procurement events and Trade-to-ERP integration.

## Architecture Style

Headless B2B commerce, supplier-facing experience, ERP-backed procurement, contract-driven, event-driven, tenant-isolated, market-aware, legal-entity-aware, multi-currency, multi-jurisdiction and fail-closed.

---

# 1. Executive Decision

Baobab SHALL implement procurement as a coordinated capability spanning:

```text
ZuriBeans Supplier Digital Estate
            │
            ▼
       Baobab Trade
 supplier-facing workflow
 sourcing / quotations
 commercial interaction
            │
            ▼
       Baobab ERP
    procurement authority
 PR / PO / receipt / AP
```

`baobab-trade` SHALL own the **supplier-facing commercial and collaborative procurement experience**.

`baobab-erp` SHALL own the **authoritative enterprise procurement transaction** once a commercial sourcing decision becomes an accounting or stock commitment.

The architectural rule is:

> **Trade owns the interaction and commercial orchestration surrounding procurement; ERP owns committed procurement, receipt, liability and accounting.**

MedusaJS SHALL NOT be extended into a substitute ERP procurement ledger.

iDempiere SHALL NOT become the public supplier portal.

---

# 2. Why This ADR Is Required

ZuriBeans is not merely a seller.

It operates on both sides of the commercial relationship:

```text
BUY SIDE
+
SELL SIDE
```

In every authorised operating market, ZuriBeans may:

```text
source
procure
warehouse
sell
import
export
distribute
```

Therefore:

```text
Supplier → ZuriBeans
```

is as important as:

```text
ZuriBeans → Customer
```

The existing Commerce architecture is strong on the sell side.

A deliberate procurement boundary is required so that implementing supplier capabilities does not gradually turn Medusa into:

```text
an ERP
a purchasing ledger
an AP system
a financial inventory system
```

---

# 3. Core Architectural Boundary

The intended separation is:

```text
                SUPPLIER
                   │
                   ▼
        Supplier Digital Estate
                   │
                   ▼
             BAOBAB TRADE
       Commercial Procurement Layer
                   │
        ┌──────────┼───────────┐
        │          │           │
        ▼          ▼           ▼
     RFQ       Quotation    Sourcing
        │          │           │
        └──────────┼───────────┘
                   ▼
           Supplier Selection
                   │
                   ▼
           Procurement Commit
                   │
                   ▼
              BAOBAB ERP
           Enterprise Procurement
                   │
        ┌──────────┼───────────┐
        ▼          ▼           ▼
      PO      Goods Receipt   AP
                               │
                               ▼
                              GL
```

---

# 4. Authority Matrix

| Concern | Authority |
|---|---|
| Supplier portal experience | ZuriBeans Digital Estate |
| Supplier authentication | IAM |
| Supplier organisation canonical identity | Shared/CP according to canonical model |
| Supplier onboarding workflow | Trade |
| Supplier qualification | Trade / governance projection |
| Supplier commercial interaction | Trade |
| Supplier RFQ | Trade |
| Supplier quotation | Trade |
| Quote comparison | Trade |
| Supplier selection | Trade |
| Purchase requirement | ERP or authorised upstream workflow |
| Purchase requisition | ERP |
| Purchase order | ERP |
| Goods receipt | ERP |
| Financial inventory receipt | ERP |
| Supplier invoice | ERP |
| AP liability | ERP |
| Supplier payment | ERP |
| GL | ERP |
| Commercial supplier projection | Trade |
| Procurement readiness | CP |
| Canonical contracts | Shared |

---

# 5. Procurement Is Not Reverse Sales

Baobab SHALL NOT simply reuse customer/order abstractions backwards.

This:

```text
Customer
   ↓
Sales Order
```

is not architecturally equivalent to:

```text
Supplier
   ↓
Purchase Order
```

Procurement introduces materially different concepts:

- sourcing;
- supplier qualification;
- competing quotations;
- requisition;
- budget authority;
- purchasing approvals;
- supplier terms;
- goods receipt;
- three-way matching;
- AP;
- vendor performance;
- purchase price variance.

Therefore procurement receives explicit domain treatment.

---

# 6. Supplier and Customer Roles

A counterparty MAY be:

```text
SUPPLIER
CUSTOMER
BOTH
```

but the roles SHALL remain explicit.

For example:

```text
Organisation X
   ├── supplies wine to ZuriBeans
   └── purchases coffee from ZuriBeans
```

This SHALL NOT require duplicate canonical organisations.

Role-specific commercial projections may exist.

---

# 7. Supplier Organisation

Supplier identity SHALL represent an organisation, not merely an individual user.

Conceptually:

```text
SupplierOrganisation
├── canonical_organisation_id
├── tenant_relationship_id
├── supplier_number?
├── legal_name
├── trading_name?
├── registrations
├── markets
├── supplier_categories
├── status
└── external_references[]
```

Users act on behalf of that organisation through IAM relationships.

---

# 8. Supplier User Is Not Supplier

The following SHALL remain distinct:

```text
Person
≠
Supplier Organisation
```

A supplier organisation may have:

```text
Owner
Sales Representative
Finance Representative
Compliance Representative
Operations Representative
```

with different permissions.

---

# 9. Supplier Lifecycle

The initial supplier lifecycle SHALL support:

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

Exceptional states:

```text
REJECTED
SUSPENDED
EXPIRED
BLOCKED
DEACTIVATED
```

---

# 10. Supplier Registration

Supplier self-registration SHOULD capture enough information to initiate due diligence without prematurely creating ERP vendor authority.

Conceptually:

```text
Supplier Registration
├── organisation details
├── contacts
├── countries/markets
├── products/categories
├── certifications
├── licences where applicable
├── bank-information reference
├── tax information
├── supporting documents
└── declarations
```

---

# 11. Registration Does Not Equal Approval

This inference is prohibited:

```text
supplier registered
=
supplier may receive purchase orders
```

Registration initiates onboarding.

Approval grants procurement eligibility.

---

# 12. Supplier Qualification

Qualification SHALL support evaluation dimensions such as:

```text
legal
tax
financial
product
quality
capacity
regulatory
sanctions/compliance
ESG where applicable
commercial
logistics
```

Different supplier/product combinations MAY require different qualification policies.

---

# 13. Supplier Qualification Scope

Approval MAY be scoped by:

```text
market
product class
product
legal entity
currency
trade lane
effective dates
```

Therefore:

```text
Approved Supplier
```

is potentially too broad.

The system SHOULD support:

```text
Supplier Qualification
    +
Scope
```

---

# 14. Example

A Ugandan cooperative may be approved for:

```text
Market: UG
Product class: COFFEE
Role: SUPPLIER
```

but not necessarily:

```text
Product class: WINE
```

or:

```text
Procurement context: ZA
```

---

# 15. Supplier Master vs Supplier Projection

ERP requires a procurement master.

Trade requires a supplier-facing projection.

These SHALL be mapped rather than conflated.

Conceptually:

```text
Canonical Organisation
         │
         ├─────────────► Trade Supplier Projection
         │
         └─────────────► ERP Business Partner
```

---

# 16. ERP Business Partner

Upon supplier approval, an authorised workflow MAY provision the supplier into iDempiere as an appropriate:

```text
Business Partner
Vendor
```

with:

- payment terms;
- tax context;
- currency context;
- organisation mapping;
- accounting context.

The canonical supplier identity remains external to provider-specific IDs.

---

# 17. No ERP ID as Canonical Supplier ID

The platform SHALL NOT expose:

```text
C_BPartner_ID
```

as Baobab's canonical supplier identity.

Instead:

```text
Canonical Organisation
       │
       ▼
ExternalReference
       │
       ▼
iDempiere C_BPartner
```

---

# 18. Procurement Demand Sources

Procurement requirements MAY originate from:

```text
manual planning
customer demand
reorder policy
inventory threshold
forecast
internal cross-market demand
production requirement
contract obligation
Pulse intelligence
```

The source SHALL be traceable.

---

# 19. Demand Does Not Automatically Create PO

The flow SHOULD be:

```text
Demand
   ↓
Requirement
   ↓
Procurement Decision
   ↓
Approval
   ↓
Sourcing / Supplier Selection
   ↓
Purchase Commitment
```

Automated replenishment MAY later shorten this path under policy.

---

# 20. Purchase Requirement

A canonical procurement requirement SHOULD conceptually include:

```text
ProcurementRequirement
├── id
├── tenant
├── legal_entity
├── market
├── required_product
├── quantity
├── uom
├── required_by
├── destination_location
├── source
├── budget_reference?
├── trade_lane_context?
└── status
```

---

# 21. Purchase Requisition

Where formal procurement requires it, the authoritative purchase requisition SHALL reside in ERP.

Conceptually:

```text
Requirement
     ↓
ERP Purchase Requisition
     ↓
Approval
```

Trade MAY expose status or initiate the request.

It SHALL NOT create a competing financial requisition ledger.

---

# 22. Supplier RFQ

The supplier-facing RFQ SHOULD be owned by Trade.

Reasons include:

- supplier portal interaction;
- collaborative messaging;
- bid deadlines;
- supplier invitations;
- digital quotation response;
- comparative commercial workflow.

---

# 23. Supplier RFQ Model

Conceptually:

```text
SupplierRFQ
├── id
├── tenant
├── legal_entity
├── market
├── requirement_refs[]
├── product_lines[]
├── invited_suppliers[]
├── currency_options[]
├── delivery_requirement
├── commercial_terms
├── submission_deadline
├── status
└── ERP_reference?
```

---

# 24. Supplier RFQ State Model

```text
DRAFT
  ↓
APPROVED
  ↓
PUBLISHED
  ↓
OPEN
  ↓
CLOSED
  ↓
EVALUATED
  ↓
AWARDED
```

Exceptional:

```text
CANCELLED
SUSPENDED
NO_AWARD
```

---

# 25. Supplier Invitation

Only eligible suppliers SHALL be invited where qualification policy requires.

Conceptually:

```text
Supplier
   +
Qualification
   +
Product Scope
   +
Market Scope
   +
Status
   =
RFQ Eligible
```

---

# 26. Supplier Quotation

Supplier responses SHALL be represented as explicit quotations.

Conceptually:

```text
SupplierQuotation
├── supplier
├── RFQ
├── lines[]
├── unit_prices
├── currency
├── MOQ
├── available_quantity
├── lead_time
├── delivery_terms
├── Incoterm?
├── payment_terms
├── quote_validity
├── taxes
├── attachments
└── status
```

---

# 27. Quotation Versioning

Suppliers MAY revise quotations before close where policy allows.

Historical versions SHALL remain available.

The final awarded quotation SHALL be unambiguous.

---

# 28. Quote Evaluation

Trade SHOULD support deterministic comparison across dimensions such as:

```text
price
landed cost estimate
lead time
quality
supplier score
MOQ
currency
Incoterm
payment terms
availability
regulatory status
```

Lowest unit price SHALL NOT automatically mean best quotation.

---

# 29. Landed-Cost Awareness

Cross-border procurement comparison SHOULD support:

```text
Supplier Price
      +
Origin Costs
      +
Freight
      +
Insurance
      +
Duty
      +
Import Tax where cost-bearing
      +
Brokerage
      +
Destination Costs
      =
Estimated Landed Cost
```

The detailed landed-cost architecture is governed by the separate pricing/landed-cost ADR.

---

# 30. Supplier Selection

Supplier selection SHALL produce an auditable award.

Conceptually:

```text
RFQ
  ↓
Supplier Quotations
  ↓
Evaluation
  ↓
Approval
  ↓
Award
```

The award is not yet necessarily the accounting purchase order.

---

# 31. Award to Purchase Commitment

The critical domain boundary is:

```text
Trade Award
      │
      ▼
Canonical Procurement Commitment
      │
      ▼
ERP Purchase Order
```

The ERP purchase order is the authoritative committed purchase transaction.

---

# 32. Purchase Order Authority

iDempiere SHALL own the authoritative purchase order.

Medusa SHALL NOT maintain an independent authoritative PO that may diverge from ERP.

Trade MAY maintain a projection:

```text
PurchaseOrderProjection
```

for supplier-facing experience.

---

# 33. Purchase Order Projection

The Supplier Portal may display:

```text
PO number
status
product
quantity
delivery address
delivery date
price
currency
terms
shipment requirement
```

from ERP-backed projections.

The projection SHALL not become a second PO authority.

---

# 34. Procurement Commitment Flow

```text
Supplier Award
      │
      ▼
Create Procurement Commitment Command
      │
      ▼
ERP Adapter
      │
      ▼
iDempiere Purchase Order
      │
      ▼
ERP Event
      │
      ▼
Trade PO Projection
      │
      ▼
Supplier Portal
```

---

# 35. Idempotency

The command creating an ERP purchase order SHALL be idempotent.

Repeated delivery SHALL not create:

```text
PO-1001
PO-1002
PO-1003
```

for the same procurement commitment.

Canonical idempotency/correlation keys SHALL be used.

---

# 36. Supplier Acceptance

Where business policy requires supplier confirmation, the Supplier Portal MAY support:

```text
ACCEPT
REQUEST_CHANGE
REJECT
```

against the projected PO.

Material changes SHALL follow governed amendment workflow.

---

# 37. No Uncontrolled PO Mutation

Supplier-facing changes SHALL NOT directly mutate ERP purchasing records without validation and policy.

The pattern SHALL be:

```text
Supplier Request
      ↓
Trade Workflow
      ↓
Approval / Validation
      ↓
ERP Command
```

---

# 38. Goods Receipt Authority

Goods receipt SHALL be ERP-authoritative because it affects:

```text
inventory
purchase commitment
received quantity
valuation
liability/matching
```

The actual physical receipt MAY originate from:

```text
warehouse
WMS
operations UI
scanner
3PL
```

but must ultimately reconcile into ERP.

---

# 39. Goods Receipt Flow

```text
Shipment Arrives
      ↓
Physical Receipt
      ↓
Quantity Inspection
      ↓
ERP Material Receipt
      ↓
Inventory Projection Event
      ↓
Trade Supplier Status Projection
```

---

# 40. Receipt Does Not Necessarily Mean Available

Goods may be:

```text
RECEIVED
```

while still:

```text
QUALITY_HOLD
CUSTOMS_HOLD
QUARANTINED
```

The inventory ADR governs availability.

---

# 41. Supplier Advance Shipping Notice

Supplier Portal MAY support ASN capability:

```text
Supplier
   ↓
Advance Shipping Notice
   ↓
Expected Receipt
   ↓
Warehouse Planning
```

ASN SHALL reference the authoritative PO.

---

# 42. ASN Is Not Goods Receipt

This inference is prohibited:

```text
ASN submitted
=
inventory received
```

---

# 43. Supplier Invoice

Supplier invoices SHALL ultimately be ERP/AP authority.

Invoice capture MAY originate from:

```text
supplier portal
email/document ingestion
operations
EDI/API
```

but financial liability SHALL be created in ERP.

---

# 44. Supplier Invoice Flow

```text
Supplier Invoice
      ↓
Document Capture
      ↓
Validation
      ↓
ERP AP Invoice
      ↓
Matching
      ↓
Approval
      ↓
Payment
```

---

# 45. Three-Way Match

Where applicable:

```text
Purchase Order
      │
      ├──────────────┐
      ▼              ▼
Goods Receipt    Supplier Invoice
      │              │
      └──────┬───────┘
             ▼
       Three-Way Match
```

The match SHOULD compare:

```text
product
quantity
price
currency
tax
receipt
invoice
```

---

# 46. Match Outcomes

Suggested states:

```text
MATCHED
WITHIN_TOLERANCE
PRICE_VARIANCE
QUANTITY_VARIANCE
TAX_VARIANCE
DUPLICATE_INVOICE
BLOCKED
```

---

# 47. Match Authority

ERP SHOULD own final financial matching.

Trade MAY expose supplier-facing dispute/status information.

---

# 48. Purchase Price Variance

Differences between:

```text
expected procurement price
```

and:

```text
actual invoiced / landed cost
```

SHALL be visible to ERP/accounting and reporting.

---

# 49. Supplier Payment Terms

Payment terms MAY include:

```text
prepayment
cash on delivery
net 7
net 30
net 60
milestone
document-triggered
```

These SHALL be explicit commercial terms.

---

# 50. Supplier Payment

Payment SHALL NOT be executed by the supplier portal.

Supplier Portal may display:

```text
invoice accepted
payment scheduled
paid
```

but ERP/payment providers own execution and accounting.

---

# 51. Procurement Across Markets

Procurement SHALL be market-aware.

For example:

```text
ZuriBeans Uganda
   ↓
Ugandan Supplier
```

or:

```text
ZuriBeans Uganda
   ↓
South African Supplier
```

or:

```text
ZuriBeans South Africa
   ↓
Ugandan Supplier
```

are all legitimate procurement scenarios subject to policy.

---

# 52. Local Procurement

```text
Buyer Legal Entity
       ↓
Same-Market Supplier
       ↓
PO
       ↓
Receipt
```

may not require an international trade lane.

---

# 53. Cross-Border Procurement

```text
Buyer Market
     │
     ▼
Foreign Supplier
```

requires relevant:

```text
origin
destination
trade lane
import/export context
customs
tax
shipping
Incoterm
```

---

# 54. Internal Supply

When supplier is another related ZuriBeans legal entity:

```text
ZuriBeans Uganda
        ↓
ZuriBeans South Africa
```

ADR-BCP-012 determines whether the flow becomes:

```text
intercompany
```

or:

```text
inter-branch
```

The Procurement domain SHALL consume that classification.

---

# 55. Procurement Market Participation

A legal entity SHALL not procure in a market merely because Trade supports procurement.

Relevant CP participation must resolve:

```text
PROCUREMENT
```

and other necessary permissions.

---

# 56. Procurement Readiness

Conceptually:

```text
PROCUREMENT participation
        +
Supplier capability
        +
ERP provider
        +
Product mapping
        +
Supplier mapping
        +
Financial configuration
        =
PROCUREMENT READY
```

---

# 57. Product Mapping

Every PO line SHALL resolve a canonical product to ERP product identity.

```text
CanonicalProduct
       ↓
ExternalReference
       ↓
iDempiere M_Product
```

No fragile name matching.

---

# 58. Supplier Mapping

Likewise:

```text
CanonicalSupplier
       ↓
ExternalReference
       ↓
iDempiere Business Partner
```

---

# 59. Warehouse Mapping

Destination warehouse SHALL resolve canonically:

```text
Canonical Stock Location
       ↓
ExternalReference
       ↓
iDempiere Warehouse / Locator
```

as appropriate.

---

# 60. Currency

Procurement SHALL preserve:

```text
quote currency
PO currency
invoice currency
functional currency
settlement currency
```

where they differ.

---

# 61. FX

Cross-currency procurement SHALL allow ERP to account for:

```text
PO FX
invoice FX
payment FX
realised gain/loss
```

Trade MAY show commercial estimates.

ERP owns accounting.

---

# 62. Tax

Procurement tax SHALL resolve using:

```text
buyer legal entity
supplier
supplier tax registration
origin
destination
product
transaction
effective date
```

It SHALL not be inferred only from supplier country.

---

# 63. Customs

Foreign procurement MAY create customs obligations.

Procurement SHALL pass sufficient canonical context into the customs/trade execution workflow rather than duplicating customs law in the procurement module.

---

# 64. Incoterms

Cross-border RFQs and supplier quotations SHOULD support:

```text
Incoterm
+
Named Place
+
Version
```

not merely:

```text
FOB
```

The title/risk ADR will govern deeper semantics.

---

# 65. Supplier Logistics

A supplier quotation may offer:

```text
supplier-arranged transport
buyer-arranged transport
third-party carrier
```

The logistics provider architecture SHALL execute physical movement.

---

# 66. Framework Agreements

Procurement SHALL support future:

```text
framework agreements
blanket purchase agreements
contract pricing
call-off orders
```

without requiring supplier RFQ for every purchase.

---

# 67. Contracted Supplier Flow

```text
Approved Framework Agreement
       ↓
Demand
       ↓
Call-Off / Purchase Order
```

Supplier RFQ MAY be bypassed according to policy.

---

# 68. Spot Procurement

Spot procurement:

```text
Demand
  ↓
RFQ
  ↓
Quotes
  ↓
Award
  ↓
PO
```

remains supported.

---

# 69. Direct Award

Direct award MAY be allowed under controlled policy.

Required:

```text
reason
approval
supplier eligibility
audit
```

---

# 70. Emergency Procurement

Emergency procurement MAY use shortened approval workflows.

It SHALL NOT disable:

- tenant isolation;
- supplier identity;
- audit;
- accounting;
- compliance requirements.

---

# 71. Approval Architecture

Approval may occur at:

```text
supplier approval
requisition approval
RFQ publication
supplier award
PO approval
PO amendment
invoice variance
payment
```

Approval authority SHALL be policy-driven.

---

# 72. Approval Thresholds

Examples:

```text
≤ ZAR X
department manager

> ZAR X
procurement head

> ZAR Y
finance / executive
```

Values SHALL be configuration, not code.

---

# 73. Budget Control

Where enabled, ERP SHOULD enforce budget availability before purchase commitment.

Trade may display budget-result projections.

Trade SHALL not become the financial budgeting authority.

---

# 74. Supplier Price Agreements

Trade MAY manage commercially negotiated supplier prices or projections.

The authoritative procurement contract/terms SHALL map consistently into ERP purchasing.

---

# 75. Buy-Side Pricing Is Separate From Sell-Side Pricing

This distinction SHALL remain explicit:

```text
Supplier Purchase Price
≠
Customer Selling Price
```

even for the same canonical product.

---

# 76. Supplier Catalogue

Supplier-specific offered products MAY be represented separately from ZuriBeans' canonical product master.

Conceptually:

```text
Supplier Product
       ↓
Supplier Product Mapping
       ↓
Canonical Product
```

---

# 77. Supplier Product Mapping

Example:

```text
Supplier SKU:
AA-G1-50KG

Canonical:
Arabica Green Coffee Grade 1 / 50kg
```

The mapping SHALL be explicit.

---

# 78. Unmapped Supplier Product

An unmapped supplier product SHALL NOT silently become a canonical product.

It requires:

```text
review
mapping
or
new product-master workflow
```

---

# 79. Supplier Capacity

Supplier qualification MAY track:

```text
production capacity
available capacity
lead time
seasonality
MOQ
```

but these SHALL not become authoritative inventory unless supplied through an inventory contract.

---

# 80. Supplier Performance

Supplier performance MAY include:

```text
on-time delivery
fill rate
quality acceptance
price variance
claim rate
documentation accuracy
response time
```

---

# 81. Performance Feedback Loop

```text
Purchase Orders
      ↓
Receipts
      ↓
Quality
      ↓
Invoices
      ↓
Claims
      ↓
Supplier Performance
      ↓
Future Sourcing Decisions
```

---

# 82. Supplier Suspension

A suspended supplier SHALL not receive new awards or POs where policy blocks them.

Existing open transactions require explicit treatment.

They SHALL not disappear.

---

# 83. Supplier Deactivation

Deactivation SHALL preserve historical:

```text
RFQs
quotes
POs
receipts
invoices
payments
audit
```

---

# 84. Supplier Documents

Supplier onboarding may require:

```text
registration certificates
tax documents
licences
quality certificates
bank verification
insurance
product certificates
```

Document authority should use Baobab's governed document/evidence architecture rather than raw untracked uploads.

---

# 85. Document Expiry

Qualification documents MAY have:

```text
issued_at
expires_at
verified_at
verification_status
```

Expiry MAY alter procurement eligibility.

---

# 86. Supplier Bank Details

Supplier bank-detail changes SHALL be high-risk operations.

At minimum:

```text
strong authentication
approval
audit
verification
```

SHALL be required before payment master data changes.

---

# 87. Supplier Portal Security

A supplier user SHALL only access:

```text
their supplier organisation
their invitations
their quotations
their purchase orders
their shipments
their invoices
their documents
```

unless explicitly authorised otherwise.

---

# 88. Cross-Supplier Isolation

This SHALL fail:

```text
Supplier A user
      ↓
Supplier B quotation
```

---

# 89. Cross-Tenant Isolation

This SHALL fail:

```text
Thamani supplier principal
      ↓
ZuriBeans procurement
```

unless an explicit inter-tenant relationship is designed.

---

# 90. Supplier IAM

IAM SHALL authenticate supplier users.

Trade SHALL authorise the supplier-domain operation using:

```text
principal
organisation relationship
tenant
supplier status
capability
resource ownership
```

---

# 91. Supplier Organisation Provisioning

An IAM organisation SHALL not by itself constitute an approved procurement supplier.

Identity relationship and supplier commercial eligibility are different.

---

# 92. Supplier Workflow States Must Be Domain-Owned

Keycloak SHALL NOT become the database of:

```text
supplier approved
supplier qualification
RFQ status
quotation status
```

IAM owns identity.

Trade owns supplier workflow.

ERP owns vendor transactions.

---

# 93. Trade-to-ERP Commands

Canonical commands SHOULD include concepts equivalent to:

```text
CreatePurchaseRequisition
CreatePurchaseOrder
AmendPurchaseOrder
CancelPurchaseOrder
CreateMaterialReceipt
CreateSupplierInvoice
```

depending on integration architecture.

---

# 94. ERP-to-Trade Events

ERP SHOULD emit canonical events such as:

```text
purchase-order.created
purchase-order.approved
purchase-order.amended
purchase-order.cancelled

goods-receipt.created
goods-receipt.completed

supplier-invoice.created
supplier-invoice.approved
supplier-invoice.paid
```

---

# 95. Procurement Events

Trade domain events SHOULD include:

```text
supplier.registered
supplier.qualification-submitted
supplier.approved
supplier.suspended

supplier-rfq.created
supplier-rfq.published
supplier-rfq.closed

supplier-quotation.submitted
supplier-quotation.revised

supplier-award.approved
procurement-commitment.created
```

---

# 96. Transactional Outbox

Trade and ERP SHALL use transactional outbox/inbox patterns for mandatory cross-engine procurement events.

```text
Domain transaction
      │
      ├── State mutation
      └── Outbox record
              ↓
            Broker
              ↓
           Consumer
              ↓
            Inbox
```

---

# 97. No Distributed Database Transaction

Baobab SHALL NOT attempt a single database transaction across:

```text
Medusa PostgreSQL
+
iDempiere PostgreSQL
```

Consistency SHALL use:

```text
workflow
idempotency
events
reconciliation
```

---

# 98. Failure — Award Succeeds, PO Creation Fails

Expected state:

```text
Trade Award:
APPROVED

ERP PO:
FAILED / PENDING

Procurement Commitment:
BLOCKED
```

The supplier SHALL NOT be told that a final PO exists when ERP has not created it.

---

# 99. Failure — Duplicate PO Command

Repeated command:

```text
procurement commitment PC-001
```

must resolve to the same ERP purchase order.

---

# 100. Failure — ERP PO Changed Out of Band

Reconciliation SHALL detect:

```text
Trade projection ≠ ERP authority
```

ERP wins for ERP-authoritative fields unless controlled recovery policy says otherwise.

---

# 101. Failure — Goods Received Above PO Quantity

System SHALL apply tolerance policy.

Possible outcomes:

```text
accept within tolerance
hold
reject excess
require approval
```

No silent quantity inflation.

---

# 102. Failure — Invoice Without Receipt

Policy may allow or block depending on procurement type.

The decision belongs to ERP matching policy.

---

# 103. Failure — Duplicate Supplier Invoice

Duplicate detection SHOULD consider:

```text
supplier
invoice number
invoice date
amount
currency
PO
```

and other provider controls.

---

# 104. Reconciliation

Procurement reconciliation SHALL cover:

```text
Trade Award
      ↕
ERP Purchase Order

ERP PO
      ↕
Goods Receipt

Goods Receipt
      ↕
Supplier Invoice

Supplier Invoice
      ↕
Payment
```

---

# 105. Reconciliation States

Suggested cross-engine states:

```text
PENDING
MATCHED
EXPECTED_DIFFERENCE
MISMATCH
FAILED
RESOLVED
```

---

# 106. Observability

Recommended metrics:

```text
supplier_onboarding_total
supplier_approval_duration
supplier_rfq_total
supplier_quote_response_rate
supplier_award_total

procurement_commitment_total
procurement_po_creation_failure_total

purchase_order_cycle_time
goods_receipt_variance_total
supplier_invoice_variance_total

procurement_reconciliation_failure_total
```

---

# 107. Audit

The platform SHALL audit:

- supplier approval;
- supplier rejection;
- suspension;
- qualification change;
- RFQ publication;
- supplier invitations;
- quotation revisions;
- evaluation;
- award;
- direct award rationale;
- PO creation;
- PO amendment;
- receipt exceptions;
- invoice exceptions.

---

# 108. Canonical Correlation

The chain SHOULD remain traceable:

```text
Demand
 ↓
Requirement
 ↓
Requisition
 ↓
RFQ
 ↓
Supplier Quote
 ↓
Award
 ↓
Procurement Commitment
 ↓
Purchase Order
 ↓
Shipment / ASN
 ↓
Goods Receipt
 ↓
Supplier Invoice
 ↓
Payment
```

---

# 109. Canonical IDs

Each major domain object SHALL have a stable canonical identifier or correlation reference where cross-engine traceability is required.

ERP-native IDs remain mappings.

---

# 110. ZuriBeans Scenario A — Uganda Coffee Procurement

```text
UG coffee requirement
       ↓
RFQ to approved Ugandan suppliers
       ↓
Supplier quotations
       ↓
Commercial comparison
       ↓
Award
       ↓
iDempiere PO
       ↓
Supplier ASN
       ↓
Kampala receipt
       ↓
Quality inspection
       ↓
ERP inventory
       ↓
AP invoice
       ↓
Payment
```

---

# 111. Scenario B — South African Wine Procurement

```text
ZA wine requirement
       ↓
RFQ to approved wineries/distributors
       ↓
Quotation
       ↓
Award
       ↓
ERP PO
       ↓
ZA receipt
       ↓
Quality/regulatory checks
       ↓
Inventory
       ↓
Supplier invoice
```

Same architecture.

Different products.

---

# 112. Scenario C — Foreign Supplier

```text
ZuriBeans Uganda
       ↓
Foreign Supplier
       ↓
Supplier RFQ
       ↓
PO
       ↓
Export from origin
       ↓
International shipment
       ↓
UG import
       ↓
Goods receipt
       ↓
AP
```

The procurement workflow composes with trade-lane, customs, logistics and tax capabilities.

---

# 113. Scenario D — Internal ZuriBeans Supply

```text
ZuriBeans ZA demand
       ↓
ZuriBeans UG supply
```

CP resolves legal relationship.

If separate entities:

```text
ZA purchase order
↕
UG sales order
```

through intercompany workflow.

If same entity:

```text
internal stock transfer
```

may replace commercial procurement.

---

# 114. Scenario E — Direct Purchase Without RFQ

Contracted supplier:

```text
Active supply agreement
       ↓
Requirement
       ↓
Approved PO
```

No RFQ required if policy permits.

---

# 115. Scenario F — Partial Supply

```text
PO: 1,000 kg

Supplier ships:
600 kg

Receipt:
600 kg

Remaining:
400 kg open
```

The PO remains partially fulfilled.

---

# 116. Scenario G — Quality Rejection

```text
Received:
1,000 kg

Accepted:
850 kg

Rejected:
150 kg
```

ERP, inventory, supplier performance and invoice matching SHALL reflect the exception.

---

# 117. Procurement Read Model

Trade SHOULD maintain projections optimised for supplier-facing queries.

Example:

```text
Supplier Dashboard
├── Open RFQs
├── Submitted Quotes
├── Awards
├── Open POs
├── Expected Deliveries
├── Invoice Status
└── Performance
```

These are projections.

They are not financial authority.

---

# 118. Supplier Portal Boundary

The Supplier Portal SHALL communicate through Baobab APIs.

It SHALL NOT directly connect to:

```text
iDempiere database
Medusa database
Keycloak database
```

---

# 119. No Shared Database Integration

This is prohibited:

```text
Trade SQL
    ↓
iDempiere tables
```

Integration SHALL use:

```text
canonical APIs
events
mappings
```

---

# 120. Medusa Extension Strategy

Medusa custom modules MAY implement:

```text
Supplier Organisation Projection
Supplier Qualification
Supplier RFQ
Supplier Quotation
Sourcing Event
Supplier Award
Procurement Commitment
Supplier Portal Projection
```

They SHALL NOT implement substitute:

```text
AP ledger
GL
authoritative PO accounting
financial goods receipt
```

---

# 121. ERP Extension Strategy

iDempiere SHOULD use native procurement capabilities wherever appropriate:

```text
Business Partner
Purchase Requisition
Purchase Order
Material Receipt
AP Invoice
Payment
Accounting
```

Baobab extensions SHOULD focus on:

```text
canonical IDs
integration APIs
event publication
idempotency
context
mapping
observability
```

rather than rewriting native ERP functions.

---

# 122. Provider Neutrality

Although iDempiere is the selected ERP, canonical procurement contracts SHALL not be named around iDempiere internals.

Example:

Preferred:

```text
PurchaseOrder
```

Not:

```text
COrderRecord
```

---

# 123. Future ERP Replacement

If Baobab later replaces iDempiere, Trade supplier workflows SHOULD remain largely unchanged because:

```text
Trade
   ↓
Canonical Procurement Contract
   ↓
ERP Provider
```

defines the boundary.

---

# 124. Product-Specific Procurement

Generic procurement architecture SHALL not create:

```text
CoffeePurchaseOrder
WinePurchaseOrder
VanillaPurchaseOrder
```

Instead:

```text
Procurement
    +
Product Regulatory Classification
    +
Product-Specific Attributes
```

---

# 125. Quality Integration

Product categories MAY invoke different quality workflows.

Example:

```text
Coffee
→ moisture, grade, defect, cupping etc.

Wine
→ regulatory, vintage, packaging etc.
```

These attributes SHALL be modular.

---

# 126. Compliance

Supplier eligibility MAY depend on compliance provider results.

A compliance failure MAY:

```text
BLOCK APPROVAL
SUSPEND SUPPLIER
BLOCK AWARD
```

according to policy.

---

# 127. Sanctions and Restricted Parties

Where required, supplier onboarding SHALL support restricted-party screening through appropriate providers.

Trade SHALL store result/evidence references rather than pretending to be the sanctions-data authority.

---

# 128. Supplier Bank Verification

Bank account master data SHOULD be verified separately from supplier login identity.

Compromising a supplier account SHALL NOT make arbitrary bank-detail changes automatically trusted.

---

# 129. Privacy

Supplier data SHALL be scoped and protected according to:

```text
tenant
purpose
role
jurisdiction
retention policy
```

---

# 130. Readiness Definition

Procurement is not READY simply because supplier RFQ screens exist.

Required chain:

```text
Supplier Identity
      +
Supplier Qualification
      +
Product Mapping
      +
ERP Business Partner Mapping
      +
ERP Procurement
      +
Receipt
      +
AP
      +
Events
      +
Reconciliation
      =
PROCUREMENT READY
```

---

# 131. Release 1 P0 Scope

ZuriBeans Release 1 SHALL include:

- supplier organisation registration;
- supplier review;
- approval/rejection/suspension;
- product/category qualification;
- supplier RFQ;
- supplier quotation;
- quotation comparison;
- award;
- procurement commitment;
- ERP vendor mapping;
- ERP purchase order;
- PO supplier projection;
- goods receipt;
- quantity exception;
- supplier invoice;
- basic three-way matching;
- AP status;
- events;
- audit;
- reconciliation.

---

# 132. Release 1.1 Candidates

May follow after initial go-live:

- advanced supplier scoring;
- reverse auctions;
- automatic replenishment;
- complex framework agreements;
- multilateral procurement;
- advanced spend analytics;
- automated supplier risk scoring;
- procurement optimisation from Pulse.

---

# 133. Tests — Supplier Onboarding

At minimum:

```text
valid supplier registration
duplicate supplier detection
cross-tenant duplicate isolation
qualification approval
qualification rejection
document expiry
supplier suspension
unauthorised supplier access
```

---

# 134. Tests — Sourcing

At minimum:

```text
RFQ creation
eligible supplier invitation
ineligible supplier blocked
quote submission
quote revision
deadline enforcement
bid isolation
quote comparison
award approval
direct award audit
```

---

# 135. Tests — ERP Boundary

At minimum:

```text
award → PO
duplicate award event
ERP unavailable
invalid product mapping
invalid supplier mapping
invalid warehouse mapping
PO amendment
PO cancellation
```

---

# 136. Tests — Receiving

At minimum:

```text
full receipt
partial receipt
over-receipt
damaged receipt
quality rejection
wrong product
wrong lot
duplicate receipt event
```

---

# 137. Tests — Invoice

At minimum:

```text
matched invoice
price variance
quantity variance
duplicate invoice
invoice before receipt
currency mismatch
tax mismatch
```

---

# 138. Security Tests

Prove:

```text
Supplier A cannot view Supplier B RFQ response

Supplier A cannot alter PO authority

Buyer user cannot approve supplier without permission

UG procurement user cannot exercise ZA authority without grant

Thamani principal cannot access ZuriBeans supplier records
```

---

# 139. Business Simulation — Uganda Coffee

The production-readiness simulation SHALL prove:

```text
supplier registration
→ qualification
→ RFQ
→ quotation
→ award
→ PO
→ shipment
→ receipt
→ quality
→ inventory
→ invoice
→ AP
→ settlement
→ reconciliation
```

---

# 140. Business Simulation — South African Wine

The same architecture SHALL prove:

```text
ZA supplier
→ ZA procurement
→ ZA stock
→ optional ZA→UG export
```

without custom procurement logic for wine.

---

# 141. Rejected Alternative — Build Full Procurement in Medusa

Rejected because it would duplicate:

- purchase-order authority;
- goods receipt;
- AP;
- accounting;
- purchasing controls already belonging in ERP.

It would create two sources of truth.

---

# 142. Rejected Alternative — Put Entire Supplier Experience in iDempiere

Rejected because iDempiere is not the intended external B2B digital experience layer.

Doing so would:

- tightly couple suppliers to ERP;
- weaken headless architecture;
- complicate IAM;
- expose ERP semantics;
- make supplier UX provider-specific.

---

# 143. Rejected Alternative — Supplier Portal Writes Directly to ERP

Rejected because it bypasses:

- Trade workflow;
- canonical contracts;
- policy;
- provider abstraction;
- audit boundaries.

---

# 144. Rejected Alternative — Supplier as Medusa Customer

Rejected as the canonical supplier model.

Medusa customer functionality MAY be reused internally where appropriate, but supplier semantics SHALL not be constrained by buyer/customer semantics.

---

# 145. Rejected Alternative — Duplicate Supplier Masters

Rejected:

```text
Trade Supplier A
ERP Vendor B
IAM Organisation C
```

with no canonical mapping.

The correct model is:

```text
Canonical Organisation
       │
       ├── IAM Projection
       ├── Trade Supplier Projection
       └── ERP Vendor Projection
```

---

# 146. Consequences — Positive

This decision gives Baobab:

- a proper buy-side architecture;
- supplier self-service;
- competitive sourcing;
- procurement transparency;
- strong ERP accounting authority;
- cross-border procurement;
- intercompany compatibility;
- provider neutrality;
- clear domain boundaries;
- end-to-end auditability.

---

# 147. Consequences — Complexity

The cost is:

- supplier canonical mapping;
- workflow state;
- cross-engine integration;
- idempotency;
- reconciliation;
- additional approval architecture;
- ERP procurement configuration.

This complexity is justified.

Without it, Baobab would have a mature sell side and an improvised buy side—which is unacceptable for ZuriBeans' operating model.

---

# 148. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical supplier/procurement contracts |
| `nabhold/baobab-cp` | Market participation, context, provider resolution, readiness |
| `nabhold/baobab-iam` | Supplier-user identity and organisation relationships |
| `nabhold/baobab-trade` | Supplier commercial workflow, RFQ, quote, award, projections |
| `nabhold/baobab-erp` | Vendor, requisition, PO, receipt, AP, accounting |
| `nabhold/zuribeans` | Supplier-facing digital experience |
| `nabhold/baobab-cms` | Supplier guidance/content where applicable |
| `nabhold/baobab-pulse` | Optional sourcing intelligence |
| `nabhold/infrastructure` | Event/runtime/observability infrastructure |

---

# 149. Implementation Sequence

```text
Canonical Supplier Contracts
          ↓
Supplier IAM Relationship
          ↓
Supplier Registration
          ↓
Qualification
          ↓
ERP Supplier Mapping
          ↓
Supplier RFQ
          ↓
Supplier Quote
          ↓
Evaluation / Award
          ↓
Procurement Commitment
          ↓
ERP Purchase Order
          ↓
Supplier PO Projection
          ↓
Shipment / ASN
          ↓
ERP Receipt
          ↓
Inventory
          ↓
Supplier Invoice
          ↓
AP / Payment
          ↓
Reconciliation
```

---

# 150. Definition of Done

ADR-0019 is implemented when:

- [ ] canonical supplier organisation mapping exists;
- [ ] supplier IAM relationships exist;
- [ ] supplier onboarding is tenant-isolated;
- [ ] supplier qualification exists;
- [ ] supplier eligibility is scope-aware;
- [ ] ERP supplier mapping works;
- [ ] supplier RFQ exists;
- [ ] supplier quotation exists;
- [ ] quotation comparison exists;
- [ ] award workflow exists;
- [ ] purchase commitment is canonical;
- [ ] ERP PO is authoritative;
- [ ] Trade receives PO projection;
- [ ] goods receipt is ERP-authoritative;
- [ ] partial and exception receipt works;
- [ ] supplier invoice is ERP-authoritative;
- [ ] basic matching works;
- [ ] payment status projects back safely;
- [ ] cross-engine commands are idempotent;
- [ ] transactional outbox/inbox exists;
- [ ] reconciliation exists;
- [ ] audit exists;
- [ ] supplier isolation tests pass;
- [ ] UG procurement simulation passes;
- [ ] ZA procurement simulation passes;
- [ ] no Medusa-based shadow procurement ledger exists.

---

# 151. Final Architecture

```text
                        SUPPLIER
                           │
                           ▼
                 ZURIBEANS SUPPLIER
                    DIGITAL ESTATE
                           │
                           ▼
                    BAOBAB TRADE
                 ┌─────────┼─────────┐
                 ▼         ▼         ▼
             Onboarding   RFQ      Quotation
                 │         │         │
                 └─────────┼─────────┘
                           ▼
                         Award
                           │
                           ▼
               Procurement Commitment
                           │
                           ▼
                    BAOBAB ERP
        ┌─────────────┬────┼─────┬─────────────┐
        ▼             ▼          ▼             ▼
   Requisition       PO       Receipt       AP Invoice
                                    │            │
                                    ▼            ▼
                                Inventory      Payment
                                    │            │
                                    └─────┬──────┘
                                          ▼
                                         GL
```

The governing rule is:

> **Baobab Trade owns supplier-facing commerce and sourcing collaboration. Baobab ERP owns committed procurement and its financial consequences.**

This boundary SHALL apply to ZuriBeans procurement in Uganda, South Africa and future markets, regardless of whether the supplier is local, foreign, related or external.

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

The implementation path is:

```text
ADR-0019
   ↓
Shared Procurement Contracts
   ↓
Supplier Identity / Mapping
   ↓
Trade Supplier Workflow
   ↓
ERP Procurement Spine
   ↓
Events / Integration
   ↓
Goods Receipt / AP
   ↓
Reconciliation
   ↓
ZuriBeans Golden-Tenant Validation
```

No production implementation SHALL turn MedusaJS into a parallel procurement ERP or expose iDempiere directly as the supplier-facing application.