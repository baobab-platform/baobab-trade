# ADR-0016: MedusaJS Commerce Fulfilment, Shipping, Delivery and External Logistics Boundary

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0015-medusajs-commerce-payment-orchestration-provider-isolation-and-financial-reconciliation.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Baobab Digital Estates, WMS, 3PL Providers, Carriers, Customs/Trade Services
- **Decision Class:** Fulfilment / Shipping / Delivery / Logistics Integration

---

## 1. Purpose

This ADR defines the authority boundary between:

- MedusaJS Commerce;
- iDempiere ERP;
- warehouses;
- future Warehouse Management Systems;
- third-party logistics providers;
- carriers;
- cross-border logistics services;
- Digital Estates.

Its purpose is specifically to answer:

> **Once Baobab has accepted a Commerce Order, which system decides how that Order is fulfilled, which system executes the physical logistics, and which system owns each resulting state?**

This ADR does not redefine the architectural rules established by ADR-0008 through ADR-0015.

Those ADRs remain authoritative for:

- tenancy and Context;
- Market and Legal Seller;
- canonical identity;
- Product identity;
- pricing;
- inventory authority;
- Order commitment;
- payment;
- transactional outbox;
- canonical events;
- idempotency;
- retries;
- reconciliation;
- cross-engine isolation;
- prohibition of shared databases;
- distributed transaction boundaries.

---

# 2. Context

Commerce fulfilment crosses two fundamentally different domains.

The customer thinks in terms such as:

```text
Delivery
Collection
Shipping Method
Estimated Arrival
Tracking
Shipped
Delivered
Return
```

Enterprise logistics operates with concepts such as:

```text
Warehouse
Locator
Pick
Pack
Goods Issue
Shipment
Transfer
Carrier
Consignment
Proof of Delivery
Customs
```

These concepts overlap, but they are not interchangeable.

Baobab therefore requires a boundary that permits Medusa to execute the customer-facing Commerce lifecycle without turning Medusa into a warehouse-management or enterprise logistics system.

Likewise, iDempiere must not become a synchronous storefront shipping engine.

---

# 3. Decision

Baobab SHALL adopt a **federated fulfilment model**.

Medusa SHALL be authoritative for the **Commerce fulfilment lifecycle**.

iDempiere, WMS, 3PL or another explicitly bound logistics capability SHALL be authoritative for the **physical execution of fulfilment** where that capability manages the relevant stock and logistics process.

Accordingly:

```text
Commerce Order
      │
      ▼
MEDUSA
Commerce Fulfilment Authority
      │
      ├── fulfilment eligibility
      ├── customer shipping selection
      ├── fulfilment request
      ├── commerce fulfilment status
      └── customer-facing tracking projection
      │
      ▼
LOGISTICS EXECUTION BOUNDARY
      │
      ├── iDempiere
      ├── WMS
      ├── 3PL
      └── Carrier
      │
      ▼
Physical Fulfilment
      │
      ├── allocate
      ├── pick
      ├── pack
      ├── dispatch
      ├── transport
      └── deliver
```

The defining rule is:

> **Medusa owns the customer's Commerce fulfilment promise and lifecycle; the bound logistics authority owns physical execution.**

---

# 4. Fulfilment Is Not Inventory

This ADR preserves the distinction established in ADR-0013:

```text
Inventory != Fulfilment
```

Inventory answers:

> What stock is available?

Fulfilment answers:

> How will committed demand be physically satisfied?

A Stock Location therefore does not automatically constitute a complete fulfilment capability.

---

# 5. Fulfilment Is Not Shipping

Baobab SHALL distinguish:

```text
Fulfilment
Shipping
Delivery
```

**Fulfilment** is the process of satisfying an Order or Order Line.

**Shipping** is one possible method of moving fulfilled goods.

**Delivery** represents receipt or completion of the customer-facing movement.

Examples of fulfilment that need not involve conventional shipping include:

- customer collection;
- store pickup;
- digital delivery;
- service fulfilment.

---

# 6. Commerce Fulfilment Authority

Medusa SHALL own Commerce-facing facts including:

- available shipping options presented at checkout;
- customer shipping-method selection;
- Commerce fulfilment creation;
- Commerce fulfilment status;
- Commerce tracking representation;
- Commerce cancellation eligibility;
- relationship between Order Lines and Fulfilments.

Medusa SHALL NOT automatically own:

- warehouse picking;
- warehouse packing;
- physical stock movement;
- warehouse labour;
- vehicle dispatch;
- carrier operations;
- customs clearance;
- enterprise goods issue.

---

# 7. Physical Fulfilment Authority

The physical fulfilment authority SHALL depend on the capability bound to the applicable Context.

Initially, this will commonly be:

```text
iDempiere
```

for ERP-managed warehouse operations.

Future deployments MAY bind:

```text
WMS
3PL
specialised logistics platform
```

without changing the Commerce Order contract.

---

# 8. No Permanent iDempiere Assumption

Although iDempiere is Baobab's initial ERP Engine, Commerce SHALL NOT encode:

```text
physical_fulfilment_authority = iDempiere
```

as an immutable platform assumption.

The architecture SHALL permit specialised logistics systems later.

---

# 9. Fulfilment Provider

Medusa Fulfilment Provider abstractions SHOULD be used to isolate provider-specific fulfilment behaviour.

Conceptually:

```text
Medusa
   │
   ▼
Fulfilment Provider Boundary
   │
   ├── Baobab ERP Adapter
   ├── 3PL Adapter
   ├── Carrier Adapter
   └── Future WMS Adapter
```

Baobab SHALL prefer supported Medusa extension mechanisms over modifications to Medusa core.

---

# 10. Shipping Option

A Shipping Option represents a customer-selectable Commerce delivery proposition.

Examples:

```text
Standard Delivery
Express Delivery
Customer Collection
Same-Day Delivery
Freight Delivery
```

A Shipping Option SHALL NOT be treated as a warehouse.

---

# 11. Shipping Method

The Shipping Method selected on an Order SHALL preserve the commercial delivery choice made during checkout.

It MAY map to one or more provider services during physical execution.

---

# 12. Carrier Service

A carrier service such as:

```text
Express
Economy
Overnight
Road Freight
```

is an external logistics capability.

It SHALL remain distinct from the customer-facing Shipping Option.

For example:

```text
Customer:
"Standard Delivery"

Physical execution:
Carrier X / Economy Road
```

is valid.

---

# 13. Shipping Price

Shipping price is a Commerce monetary fact.

Medusa SHALL determine the customer-facing shipping charge according to the applicable shipping/pricing policy.

Carrier cost SHALL remain a separate operational/financial fact.

Therefore:

```text
Customer Shipping Charge
!=
Carrier Cost
```

---

# 14. Fulfilment Context

Fulfilment resolution MAY depend upon:

```text
Context
Market
Legal Seller
Destination
Product / Variant
Stock Location
Inventory availability
Shipping Option
Customer type
B2B Organisation
Order quantity
Service level
```

These dimensions SHALL remain explicit.

---

# 15. Legal Seller

The Legal Seller SHALL remain known throughout fulfilment.

A warehouse or 3PL possessing goods does not automatically become the seller.

---

# 16. Stock Ownership

Physical possession SHALL remain distinct from legal ownership.

This supports future:

- consignment;
- third-party warehousing;
- shared warehouses;
- supplier-managed inventory.

---

# 17. Fulfilment Location

A fulfilment location represents the operational source from which goods are satisfied.

It MAY map to:

- Medusa Stock Location;
- iDempiere Warehouse;
- WMS facility;
- 3PL facility.

These identifiers SHALL remain native to their respective systems and be related through canonical mapping where cross-engine identity is required.

---

# 18. No Mandatory One-to-One Warehouse Mapping

Baobab SHALL NOT assume:

```text
1 Medusa Stock Location
=
1 iDempiere Warehouse
=
1 physical building
```

Mappings MAY be more complex.

Examples include:

- one ERP warehouse represented by multiple Commerce locations;
- multiple warehouse zones represented as one Commerce location;
- one 3PL facility serving several Markets.

---

# 19. Source Selection

The fulfilment source MAY be selected according to:

```text
stock availability
destination
Market
Legal Seller
delivery promise
shipping method
warehouse capacity
operational cost
inventory allocation
cross-border restrictions
```

The exact sourcing algorithm SHALL be implementation policy.

---

# 20. Customer Cannot Select Arbitrary Warehouse

A customer MAY choose an eligible Shipping Option.

A customer SHALL NOT gain unrestricted ability to select an internal warehouse merely by submitting a location identifier.

Source selection SHALL be server-authoritative.

---

# 21. Fulfilment Creation

Once the Order reaches the appropriate fulfilment stage, Medusa SHALL create or represent the Commerce Fulfilment.

Physical execution SHALL then be requested through the bound fulfilment adapter/capability.

---

# 22. Fulfilment Request

The preferred distributed flow is:

```text
Commerce Order
      │
      ▼
Medusa Fulfilment
      │
      ▼
commerce.fulfilment.requested
      │
      ▼
Fulfilment Integration
      │
      ▼
iDempiere / WMS / 3PL
      │
      ▼
Physical Fulfilment Record
```

The exact event/command sequence SHALL be defined by the integration contracts.

---

# 23. Idempotent Fulfilment Creation

Repeated delivery of a fulfilment request SHALL NOT create duplicate warehouse shipments.

A stable identifier SHALL correlate the intended fulfilment across systems.

---

# 24. Canonical Fulfilment Identity

Where cross-engine identity is required:

```text
Canonical Fulfilment
      │
      ├── Medusa Fulfilment
      ├── iDempiere Shipment
      └── 3PL Fulfilment
```

MAY be represented through `CanonicalEntity`, `ExternalReference`, and `Mapping`.

The exact canonical entity classification belongs to the canonical mapping specification.

---

# 25. Partial Fulfilment

Baobab SHALL support partial fulfilment.

For example:

```text
Order
├── Line A × 10
└── Line B × 5
```

may become:

```text
Fulfilment 1
├── Line A × 10
└── Line B × 2

Fulfilment 2
└── Line B × 3
```

The architecture SHALL therefore avoid assuming:

```text
1 Order = 1 Fulfilment
```

---

# 26. Split Fulfilment

One Order MAY be fulfilled from multiple locations.

For example:

```text
Order
   │
   ├── Cape Town Warehouse
   └── Johannesburg Warehouse
```

This SHALL remain one Commerce Order unless business policy explicitly requires otherwise.

---

# 27. Multiple Shipments

A Fulfilment MAY result in multiple physical shipments where operational execution requires it.

Commerce and logistics identities SHALL remain distinguishable.

---

# 28. Allocation

Allocation represents assignment of inventory to a fulfilment requirement.

It SHALL remain distinct from:

```text
Reservation
Picking
Shipment
```

---

# 29. Reservation to Allocation

The conceptual progression is:

```text
Inventory Available
      │
      ▼
Reservation
      │
      ▼
Order Commitment
      │
      ▼
Allocation
      │
      ▼
Pick
      │
      ▼
Pack
      │
      ▼
Dispatch
```

Not every underlying engine needs identical state names.

Canonical integration SHALL preserve business meaning rather than force identical internal state machines.

---

# 30. Pick

Picking is a warehouse execution activity.

Medusa SHALL not become authoritative for warehouse pick operations merely because it owns Commerce Fulfilment.

---

# 31. Pack

Packing is likewise a logistics execution activity.

A WMS, iDempiere or 3PL MAY own:

- package composition;
- packaging materials;
- warehouse labels;
- physical packing completion.

---

# 32. Shipment

Shipment represents physical dispatch or transport activity.

The authoritative physical Shipment record MAY reside outside Medusa.

Medusa SHALL maintain the customer-facing projection necessary for Commerce.

---

# 33. Dispatch

A Commerce Fulfilment SHALL only be marked dispatched/shipped based on authoritative execution evidence.

A frontend action SHALL not manufacture this state.

---

# 34. Tracking

Tracking data MAY originate from:

- carrier;
- 3PL;
- WMS;
- ERP.

Medusa SHALL expose an appropriate Commerce tracking projection.

---

# 35. Tracking Reference

Carrier tracking numbers SHALL remain provider-native external references.

They SHALL not become canonical Order identity.

---

# 36. Tracking URL

A tracking URL MAY be exposed to the customer where appropriate.

It SHALL be treated as provider presentation information rather than platform identity.

---

# 37. Delivery

Delivery represents successful completion of the physical delivery obligation according to the applicable service.

Delivery evidence MAY originate from the carrier or logistics authority.

---

# 38. Proof of Delivery

Where required, proof of delivery MAY include:

```text
delivery timestamp
recipient
signature reference
photo reference
location evidence
```

subject to privacy and legal policy.

Large binary evidence SHOULD reside in appropriate object storage rather than canonical event payloads.

---

# 39. Delivery Is Not Payment Settlement

The architecture SHALL preserve:

```text
Delivered != Paid
```

particularly for:

- cash on delivery;
- B2B account terms;
- delayed settlement.

---

# 40. Fulfilment Is Not ERP Posting

Likewise:

```text
Commerce Fulfilment Complete
!=
ERP Financial Posting Complete
```

Operational and financial processes SHALL reconcile independently.

---

# 41. Cancellation Before Fulfilment

If an Order is cancelled before physical execution begins, the system SHOULD attempt to cancel the downstream fulfilment request and release applicable inventory according to ADR-0013 and ADR-0014.

---

# 42. Cancellation During Fulfilment

Once picking, packing or dispatch has begun, cancellation MAY no longer be physically possible.

The system SHALL therefore distinguish:

```text
cancellation requested
```

from:

```text
cancellation physically completed
```

where required.

---

# 43. Cancellation After Dispatch

An Order already dispatched SHOULD generally enter:

```text
interception
return
refusal
```

or another logistics process rather than pretending shipment never occurred.

---

# 44. Fulfilment Compensation

Distributed fulfilment failures SHALL use compensating business processes rather than distributed database rollback.

Examples:

```text
release allocation
cancel pick
cancel shipment
request carrier interception
create return
```

---

# 45. Returns Boundary

Medusa SHALL own the customer-facing Commerce Return lifecycle.

Physical return logistics MAY be executed by:

- carrier;
- 3PL;
- warehouse;
- iDempiere;
- future WMS.

---

# 46. Return Is Not Restock

The rule from ADR-0013 remains:

> A customer initiating or shipping a Return does not make the Product available for resale.

Restocking requires authoritative receipt and disposition.

---

# 47. Return Disposition

Returned goods MAY be classified as:

```text
RESTOCK
DAMAGED
QUARANTINE
REPAIR
DISPOSE
RETURN_TO_VENDOR
```

according to operational capability.

The exact taxonomy belongs to inventory/logistics implementation.

---

# 48. Reverse Logistics

Reverse logistics SHALL remain a first-class process.

Conceptually:

```text
Customer Return
      │
      ▼
Return Authorization
      │
      ▼
Return Transport
      │
      ▼
Warehouse Receipt
      │
      ▼
Inspection
      │
      ▼
Disposition
      │
      ├── Restock
      ├── Quarantine
      ├── Repair
      └── Dispose
```

---

# 49. Refund Is Not Return

Baobab SHALL preserve:

```text
Return != Refund
```

A refund may occur:

- before physical return;
- after receipt;
- after inspection;
- without return;

depending on policy.

ADR-0015 remains authoritative for financial refund execution.

---

# 50. Shipping Eligibility

A Product being sellable does not imply it can use every Shipping Option.

Eligibility MAY depend upon:

```text
weight
dimensions
hazard classification
temperature requirements
destination
value
Product type
carrier restrictions
Market
```

---

# 51. Shipping Restrictions

Restrictions SHALL be server-enforced.

Digital Estate filtering alone is insufficient.

---

# 52. Shipping Profiles

Medusa shipping-profile mechanisms SHOULD be used where they appropriately express Product fulfilment constraints.

Baobab SHALL not duplicate these rules in Digital Estates.

---

# 53. Shipping Price Calculation

Shipping price MAY be:

- fixed;
- table-based;
- provider-calculated;
- weight-based;
- destination-based;
- contract-based;
- promotional.

The Commerce Engine SHALL remain authoritative for the amount offered and committed to the customer.

---

# 54. Carrier Quote

A carrier quotation SHALL not automatically become the customer shipping price.

Commerce policy MAY add:

```text
markup
subsidy
free-shipping promotion
contract adjustment
```

---

# 55. Quote Expiry

Real-time carrier quotes MAY expire.

Checkout SHALL validate them according to the applicable shipping-price policy before Order commitment.

---

# 56. B2B Freight

B2B fulfilment MAY require:

- pallet shipping;
- freight quotation;
- minimum shipment quantities;
- scheduled delivery;
- customer-arranged freight;
- collection;
- export documentation.

These requirements SHALL be expressed through Commerce and logistics capabilities rather than tenant-specific forks.

---

# 57. Customer-Arranged Transport

B2B transactions MAY permit:

```text
EX WORKS / customer collection
```

or customer-appointed carrier arrangements.

Such terms SHALL be explicitly represented.

---

# 58. Incoterms

Where international trade requires Incoterms, the applicable Incoterm SHALL be explicitly associated with the commercial transaction.

Incoterm SHALL not be inferred solely from Shipping Method.

---

# 59. Cross-Border Fulfilment

Cross-border fulfilment MAY require:

```text
export eligibility
import eligibility
customs documentation
commodity classification
country of origin
declared value
Incoterm
duties
tax
restricted-goods checks
```

These concerns SHALL not be reduced to ordinary domestic shipping configuration.

---

# 60. Customs Authority

Medusa SHALL NOT become the universal customs-compliance authority.

A future trade-compliance capability or external provider MAY own relevant determinations.

Commerce SHALL consume the resulting eligibility and documentation requirements.

---

# 61. HS Codes

Harmonized System classifications, where required, SHALL have an explicitly governed authority.

They SHOULD NOT be independently edited in every Digital Estate.

---

# 62. Country of Origin

Country-of-origin data used for trade compliance SHALL likewise have a defined authority and mapping.

Marketing origin content in Payload is not automatically customs origin authority.

---

# 63. Duties

Duties SHALL remain distinct from ordinary shipping charges.

Whether duties are:

```text
prepaid
customer-paid
included
excluded
```

shall follow the applicable Market and Incoterm policy.

---

# 64. Delivery Promise

A customer-facing delivery estimate SHALL be treated as a Commerce promise derived from operational information.

It MAY depend upon:

```text
inventory
warehouse cut-off
processing time
carrier service
destination
calendar
customs
```

---

# 65. Estimated Delivery Is Not Guaranteed Delivery

Unless explicitly sold as a guaranteed service:

```text
Estimated Delivery
!=
Guaranteed Delivery
```

Customer-facing language SHALL preserve this distinction.

---

# 66. Fulfilment SLA

B2B agreements MAY define contractual fulfilment service levels.

These MAY differ from public B2C delivery estimates.

---

# 67. Operational Calendars

Warehouse and carrier calendars MAY affect delivery estimates.

Calendar configuration SHALL not be duplicated independently across Digital Estates.

---

# 68. Time Zones

Fulfilment timestamps SHALL preserve unambiguous time semantics.

Operational cut-offs SHALL be evaluated in the applicable location/time-zone context.

---

# 69. Digital Estate Responsibility

Digital Estates MAY:

- display Shipping Options;
- collect delivery addresses;
- display estimated delivery;
- display tracking;
- initiate authorised cancellation/return requests.

They SHALL NOT:

- create warehouse shipments directly;
- mutate iDempiere shipment tables;
- fabricate tracking state;
- determine physical stock;
- bypass Commerce fulfilment authorization.

---

# 70. ERP Responsibility

Where iDempiere is the physical fulfilment authority, it MAY own:

```text
warehouse
locator
shipment
goods issue
pick/pack operational state
inventory movement
```

according to the deployed iDempiere configuration.

---

# 71. Future WMS

If warehouse complexity exceeds appropriate ERP capabilities, Baobab MAY introduce a WMS.

The architecture SHALL permit:

```text
Medusa
   │
   ▼
Fulfilment Contract
   │
   ▼
WMS
```

without rewriting the Digital Estate or Commerce Order model.

---

# 72. 3PL Integration

A 3PL SHALL be treated as an external logistics authority for the scope delegated to it.

The integration SHOULD use:

- provider API;
- events/webhooks;
- files only where unavoidable and contractually governed.

Direct database coupling is prohibited.

---

# 73. Carrier Integration

Carrier integrations SHALL remain behind provider/adapter boundaries.

Carrier-specific fields SHALL not leak into canonical Commerce APIs unless they have stable business meaning.

---

# 74. External Logistics Identifiers

Identifiers such as:

```text
shipment number
consignment number
tracking number
3PL fulfilment ID
carrier job ID
```

SHALL remain ExternalReferences.

---

# 75. Fulfilment Events

Canonical Commerce events SHOULD include business facts such as:

```text
commerce.fulfilment.requested
commerce.fulfilment.created
commerce.fulfilment.cancelled
commerce.fulfilment.dispatched
commerce.fulfilment.delivered
```

where those facts are authoritative at the Commerce boundary.

---

# 76. Logistics Events

External execution MAY produce facts such as:

```text
logistics.fulfilment.accepted
logistics.pick.completed
logistics.shipment.dispatched
logistics.delivery.completed
logistics.delivery.failed
```

Exact canonical event ownership SHALL be defined by the relevant integration contract.

---

# 77. Event Translation

Provider-specific statuses SHALL be translated into stable business meaning where practical.

For example:

```text
Provider A: "OUT_FOR_DELIVERY"
Provider B: "ON_VEHICLE"
```

MAY map to a canonical logistics state where semantically equivalent.

Raw provider state MAY still be retained for diagnostics.

---

# 78. Delivery Failure

Delivery failure SHALL be represented explicitly.

Possible reasons include:

```text
recipient unavailable
invalid address
refused
damaged
customs hold
carrier exception
```

The next action SHALL depend on policy.

---

# 79. Retry Delivery

A delivery retry SHALL not create a second Commerce Order.

It is another logistics attempt against the existing fulfilment obligation.

---

# 80. Lost Shipment

Lost shipment SHALL be treated as an exception process.

It MAY trigger:

- replacement;
- refund;
- claim;
- insurance;
- ERP adjustment.

These consequences SHALL remain explicit rather than rewriting history.

---

# 81. Damaged Shipment

Damage during logistics SHALL likewise create an exception/claim process.

---

# 82. Fulfilment Reconciliation

Baobab SHALL reconcile material fulfilment state across Commerce and the physical execution authority.

The system SHOULD detect:

```text
Medusa Fulfilment missing downstream
downstream Shipment missing mapping
duplicate Shipment
Commerce says pending but logistics says dispatched
Commerce says dispatched but carrier has no consignment
delivered shipment not reflected in Commerce
cancelled Commerce Fulfilment still active downstream
```

---

# 83. Authority-Aware Reconciliation

Reconciliation SHALL respect authority.

For example:

```text
physical dispatch
→ logistics authority
```

while:

```text
customer-facing Commerce Fulfilment relationship
→ Medusa
```

Timestamp-based last-write-wins SHALL not replace authority rules.

---

# 84. Fulfilment Integration State

Integration state SHALL remain distinct from Commerce fulfilment state.

For example:

```text
Commerce Fulfilment:
CREATED

Logistics Integration:
RETRYABLE_FAILURE
```

is a legitimate temporary state.

---

# 85. ERP/3PL Outage

A logistics authority outage SHALL not invalidate an already committed Commerce Order.

The fulfilment request SHALL remain durable and recoverable.

---

# 86. Customer Promise During Outage

If logistics failure makes an existing delivery promise impossible, the platform SHALL surface an operational exception rather than silently pretending normal execution continues.

---

# 87. Retry

Fulfilment commands SHALL use bounded retries with idempotency.

---

# 88. Infinite Retry

Permanent configuration or business failures SHALL enter reconciliation/operator intervention rather than retry forever.

---

# 89. Duplicate Fulfilment Prevention

Replay of fulfilment events or commands SHALL not produce duplicate physical shipments.

This is a critical production invariant.

---

# 90. Observability

Fulfilment observability SHOULD include:

```text
fulfilment request latency
downstream acceptance latency
dispatch latency
delivery latency
fulfilment failures
delivery failures
integration backlog
provider error rate
reconciliation discrepancies
```

---

# 91. Correlation

A transaction SHOULD be traceable across:

```text
Commerce Order
      │
      ▼
Medusa Fulfilment
      │
      ▼
Canonical Fulfilment
      │
      ▼
ERP/WMS/3PL Shipment
      │
      ▼
Carrier Consignment
```

using canonical mappings and correlation identifiers.

---

# 92. Privacy

Tracking and delivery data may contain personal information.

Access SHALL be restricted according to:

- customer ownership;
- authorised B2B membership;
- operational role;
- applicable privacy requirements.

---

# 93. Delivery Address

A committed delivery address SHALL be treated as historical Order/Fulfilment information.

Changing a customer's saved profile address SHALL not silently rewrite an active shipment.

---

# 94. Address Changes

Post-commitment delivery-address changes SHALL use an explicit authorised workflow.

Whether change is permitted depends upon fulfilment state.

---

# 95. Proof-of-Delivery Privacy

Proof-of-delivery evidence SHALL receive appropriate retention and access controls.

---

# 96. Multi-Tenant Isolation

Shared fulfilment infrastructure SHALL not weaken tenant isolation.

A shared warehouse or carrier does not imply shared business visibility.

---

# 97. Shared Warehouse

Multiple legal sellers MAY use the same physical warehouse.

The system SHALL preserve:

```text
inventory ownership
seller
Order
Market
fulfilment obligation
```

independently.

---

# 98. Shared Carrier

Likewise, multiple tenants/legal sellers MAY use one carrier integration without sharing commercial or customer data beyond what the provider requires.

---

# 99. Multi-Region Fulfilment

Baobab SHALL support regional fulfilment authorities.

For example:

```text
Southern Africa
      │
      └── Regional Logistics Provider

East Africa
      │
      └── Regional ERP/WMS

Europe
      │
      └── 3PL
```

Canonical Product and Order identity SHALL remain stable.

---

# 100. No Global Synchronous Logistics Lock

Baobab SHALL NOT require a global synchronous logistics coordinator for every Order.

Regional execution SHOULD remain locally autonomous where business rules permit.

---

# 101. Configuration

Fulfilment configuration SHALL be externalised from application code where practical.

This includes:

- provider endpoints;
- credentials;
- service mappings;
- warehouse mappings;
- Market eligibility;
- Shipping Options.

---

# 102. Secrets

Carrier, 3PL and WMS credentials SHALL follow Baobab secrets-management standards.

They SHALL not appear in:

- source repositories;
- frontend bundles;
- canonical events;
- logs.

---

# 103. Rejected Alternative: Medusa as Universal WMS

**Rejected.**

Medusa owns Commerce fulfilment, not every physical warehouse process.

---

# 104. Rejected Alternative: iDempiere as Customer-Facing Checkout Shipping Engine

**Rejected.**

The Digital Estate SHALL consume Commerce shipping capabilities through Medusa.

---

# 105. Rejected Alternative: One Order Equals One Shipment

**Rejected.**

Partial and split fulfilment are required.

---

# 106. Rejected Alternative: Shipping Option Equals Carrier Service

**Rejected.**

Customer proposition and provider execution are distinct.

---

# 107. Rejected Alternative: Stock Location Equals Warehouse Globally

**Rejected.**

Mappings may be non-one-to-one.

---

# 108. Rejected Alternative: Carrier Cost Equals Customer Shipping Price

**Rejected.**

Commercial price and operational cost are separate facts.

---

# 109. Rejected Alternative: Return Equals Refund

**Rejected.**

Reverse logistics and financial reimbursement have separate lifecycles.

---

# 110. Rejected Alternative: Return Equals Immediate Restock

**Rejected.**

Physical receipt and disposition must occur first.

---

# 111. Rejected Alternative: Frontend Shipment Authority

**Rejected absolutely.**

Digital Estates cannot create authoritative physical shipment state.

---

# 112. Rejected Alternative: Shared Logistics Database

**Rejected absolutely.**

Medusa, iDempiere, WMS, 3PL and carriers SHALL integrate through contracts.

---

# 113. Rejected Alternative: Provider-Specific Commerce Core

**Rejected.**

Carrier and 3PL behaviour SHALL remain behind adapters.

---

# 114. Rejected Alternative: Fulfilment Failure Cancels Order Automatically

**Rejected as a universal rule.**

A logistics failure may require:

- retry;
- alternate source;
- alternate carrier;
- delay;
- customer intervention;
- cancellation.

The business policy SHALL decide.

---

# 115. Consequences

## Positive

This decision supports:

- independent Commerce and warehouse evolution;
- multiple warehouses;
- multiple carriers;
- multiple 3PLs;
- future WMS;
- split fulfilment;
- partial fulfilment;
- regional logistics;
- B2B freight;
- cross-border commerce;
- reverse logistics.

## Negative

It introduces:

- fulfilment mappings;
- distributed state;
- logistics reconciliation;
- provider adapters;
- exception workflows;
- operational complexity.

These costs are accepted because physical logistics cannot reliably be represented as one synchronous Commerce transaction.

---

# 116. Architectural Invariants

**FUL-COM-001**  
Medusa SHALL own Commerce fulfilment lifecycle.

**FUL-COM-002**  
Physical fulfilment authority SHALL remain explicitly bound.

**FUL-COM-003**  
Medusa SHALL not become the universal WMS.

**FUL-COM-004**  
iDempiere SHALL not become the Digital Estate's shipping API.

**FUL-COM-005**  
Fulfilment SHALL remain distinct from Inventory.

**FUL-COM-006**  
Fulfilment SHALL remain distinct from Shipping.

**FUL-COM-007**  
Shipping Option SHALL remain distinct from Carrier Service.

**FUL-COM-008**  
Customer shipping price SHALL remain distinct from carrier cost.

**FUL-COM-009**  
Stock Location SHALL not automatically equal ERP Warehouse.

**FUL-COM-010**  
Customer input SHALL not authoritatively select protected internal fulfilment locations.

**FUL-COM-011**  
One Order MAY have multiple Fulfilments.

**FUL-COM-012**  
One Fulfilment MAY involve multiple physical logistics records where necessary.

**FUL-COM-013**  
Physical dispatch state SHALL originate from authoritative execution evidence.

**FUL-COM-014**  
Carrier tracking IDs SHALL remain external identifiers.

**FUL-COM-015**  
Fulfilment requests SHALL be idempotent.

**FUL-COM-016**  
Duplicate integration delivery SHALL not create duplicate physical shipments.

**FUL-COM-017**  
Logistics failure SHALL not erase a committed Commerce Order.

**FUL-COM-018**  
Return SHALL remain distinct from Refund.

**FUL-COM-019**  
Return initiation SHALL not automatically restore Available-to-Sell inventory.

**FUL-COM-020**  
Physical return disposition SHALL precede restocking where inspection is required.

**FUL-COM-021**  
Legal Seller SHALL remain explicit throughout fulfilment.

**FUL-COM-022**  
Shared warehouses SHALL not erase inventory ownership/isolation.

**FUL-COM-023**  
Provider-specific logistics behaviour SHALL remain behind adapters.

**FUL-COM-024**  
Fulfilment integration state SHALL remain distinct from Commerce Fulfilment state.

**FUL-COM-025**  
Fulfilment reconciliation SHALL be production-grade and authority-aware.

**FUL-COM-026**  
Cross-border fulfilment SHALL preserve explicit trade context.

**FUL-COM-027**  
Incoterms SHALL not be inferred solely from Shipping Method.

**FUL-COM-028**  
Digital Estates SHALL not mutate physical logistics systems directly.

**FUL-COM-029**  
Cross-engine fulfilment identity SHALL use mappings rather than shared primary keys.

**FUL-COM-030**  
Direct cross-engine logistics database coupling is prohibited.

---

# 117. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. An Order can create a Commerce Fulfilment.

2. A Commerce Fulfilment can propagate to the configured physical fulfilment authority.

3. Duplicate fulfilment commands do not create duplicate physical shipments.

4. One Order can produce multiple Fulfilments.

5. One Order can be sourced from multiple Stock Locations.

6. Partial fulfilment preserves outstanding quantities.

7. Customer cannot select an unauthorised internal warehouse.

8. Legal Seller remains associated with fulfilment.

9. Shared warehouse usage does not leak one seller's inventory/order data to another.

10. Shipping Option remains independent of Carrier Service.

11. Carrier cost cannot silently replace customer shipping price.

12. Tracking information can propagate from carrier/logistics authority to Commerce.

13. A duplicate tracking webhook has one intended effect.

14. Out-of-order logistics events do not incorrectly regress authoritative state.

15. ERP/WMS/3PL outage does not erase the committed Order.

16. Failed downstream fulfilment request enters observable retry state.

17. Permanent downstream rejection enters reconciliation state.

18. Replay of fulfilment events cannot create duplicate shipments.

19. Cancellation before physical execution propagates safely.

20. Cancellation after dispatch does not falsely erase shipment history.

21. Return initiation does not immediately increase available inventory.

22. Returned stock becomes sellable only after authorised disposition.

23. Refund can remain independent of Return completion according to policy.

24. Delivery address cannot be changed through profile mutation after commitment.

25. Unauthorised tracking access is rejected.

26. B2B customer cannot view another organisation's protected fulfilment data.

27. Carrier credentials are unavailable to Digital Estates.

28. Cross-border fulfilment preserves applicable Market, Legal Seller and trade context.

29. Canonical mapping correlates Medusa Fulfilment with downstream shipment.

30. Reconciliation detects a dispatched downstream shipment missing from Commerce.
```

---

# 118. Initial Production Profile

Baobab's initial physical-goods fulfilment profile SHOULD be:

```text
                    COMMERCE ORDER
                          │
                          ▼
                     MEDUSAJS
                          │
                  Commerce Fulfilment
                          │
                          ▼
                 FULFILMENT ADAPTER
                          │
                          ▼
                     IDEMPIERE
                          │
                  Warehouse Execution
                          │
                    ┌─────┴─────┐
                    │           │
                    ▼           ▼
                  Pick         Pack
                    │           │
                    └─────┬─────┘
                          ▼
                       Shipment
                          │
                          ▼
                       Carrier
                          │
                          ▼
                       Delivery
                          │
                          ▼
                Status / Tracking Events
                          │
                          ▼
                       MEDUSA
                          │
                          ▼
                   DIGITAL ESTATE
```

This provides a practical initial architecture without prematurely introducing a separate WMS.

---

# 119. Evolution Profile

If operational scale later requires a WMS:

```text
MEDUSA
   │
   ▼
Fulfilment Contract
   │
   ▼
WMS
   │
   ├── warehouse execution
   ├── pick
   ├── pack
   └── dispatch
   │
   ▼
Carrier / 3PL
```

iDempiere may then consume warehouse/accounting facts without remaining the physical execution authority.

This transition SHALL NOT require changing:

- Commerce Order identity;
- Digital Estate contracts;
- canonical Product identity;
- customer-facing fulfilment semantics.

---

# 120. Decision Outcome

Baobab adopts the following authority model:

```text
                     CUSTOMER
                         │
                         ▼
                  DIGITAL ESTATE
                         │
                         ▼
                     MEDUSA
                Commerce Fulfilment
                     Authority
                         │
             ┌───────────┼───────────┐
             │           │           │
             ▼           ▼           ▼
        Shipping      Tracking    Returns
        Selection     Projection   Lifecycle
             │           │           │
             └───────────┼───────────┘
                         ▼
                FULFILMENT BOUNDARY
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
          IDEMPIERE     WMS        3PL
              │          │          │
              └──────────┼──────────┘
                         ▼
                  PHYSICAL EXECUTION
                         │
                  ┌──────┼──────┐
                  ▼      ▼      ▼
                 Pick   Pack   Ship
                                │
                                ▼
                             CARRIER
                                │
                                ▼
                             DELIVERY
```

The governing rule is:

> **Medusa owns the Commerce fulfilment lifecycle; the explicitly bound logistics authority owns physical execution.**

The integration rule is:

> **Commerce Fulfilment and physical Shipment are correlated business records, not a shared record or shared database row.**

The sourcing rule is:

> **Availability, fulfilment source, Market, Legal Seller and delivery method are separate dimensions and must remain separately governed.**

The logistics rule is:

> **Baobab shall support iDempiere initially without making iDempiere a permanent architectural dependency for physical fulfilment. WMS, 3PL and carrier capabilities must remain replaceable through contracts.**

The reverse-logistics rule is:

> **Return, physical receipt, inventory disposition, restocking and Refund are separate facts with independently controlled lifecycles.**

And the long-term rule is:

> **Baobab's customer-facing Commerce contract shall remain stable even as the physical logistics topology evolves from ERP-managed warehouses to regional WMS, 3PL and carrier networks.**
