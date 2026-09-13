# ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction

**Status:** Accepted — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Repository:** `nabhold/baobab-trade`  
**Trade Runtime:** MedusaJS + Baobab Trade Extensions  
**ERP Authority:** `nabhold/baobab-erp` / iDempiere  
**Platform Context Authority:** `nabhold/baobab-cp`  
**Canonical Contract Authority:** `nabhold/shared`  
**Identity Authority:** `nabhold/baobab-iam`  
**Intelligence Support:** `nabhold/baobab-pulse` where applicable  
**Reference Tenant:** ZuriBeans

## Related Trade ADRs

- ADR-0013 — MedusaJS Commerce Inventory, Availability, Reservation and ERP Stock Authority Model
- ADR-0014 — MedusaJS Commerce Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0016 — MedusaJS Commerce Fulfilment, Shipping, Delivery and External Logistics Boundary
- ADR-0019 — B2B Procurement, Supplier Commercial Workflow and Trade-to-ERP Boundary Model
- ADR-0020 — B2B Landed Cost, Margin and Commercial Price Resolution Model
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture

## Related Platform ADRs

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading, Legal-Entity Relationship and Internal Settlement Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model

---

# 1. Executive Decision

Baobab SHALL implement logistics as a **provider-neutral trade execution capability** rather than binding commerce workflows directly to one carrier, freight forwarder, courier, customs broker, warehouse operator or transport-management platform.

The architecture SHALL distinguish:

```text
Commercial Fulfilment
        ≠
Shipment
        ≠
Transport Movement
        ≠
Freight Booking
        ≠
Carrier
        ≠
Freight Forwarder
        ≠
Customs Broker
        ≠
Warehouse / 3PL
```

A cross-border commercial order may require several logistics actors.

Therefore the core architecture SHALL be:

```text
ORDER / PROCUREMENT / TRANSFER
            │
            ▼
       SHIPMENT INTENT
            │
            ▼
      LOGISTICS PLAN
            │
    ┌───────┼────────┐
    ▼       ▼        ▼
 Carrier  Forwarder  3PL
    │       │        │
    └───────┼────────┘
            ▼
      TRANSPORT EXECUTION
            │
            ▼
       TRACKING EVENTS
            │
            ▼
       DELIVERY / RECEIPT
```

The governing principle is:

> **Baobab owns canonical shipment orchestration and logistics state; external providers execute transport capabilities.**

---

# 2. Why This ADR Is Required

ZuriBeans may ship:

```text
UG → ZA coffee
ZA → UG wine
UG → external market
ZA → external market
local UG deliveries
local ZA deliveries
```

Different lanes may require:

```text
road haulage
air freight
sea freight
rail
courier
multimodal transport
freight forwarding
customs brokerage
warehousing
last-mile delivery
```

No single provider abstraction is sufficient if the architecture assumes:

```text
one shipment = one carrier
```

---

# 3. ADR-0016 Relationship

ADR-0016 remains authoritative for the commerce boundary around:

```text
fulfilment
shipping
delivery
external logistics
```

ADR-0022 adds the deeper cross-border model for:

- shipment planning;
- freight procurement;
- multimodal transport;
- provider composition;
- carrier abstraction;
- freight-forwarder abstraction;
- transport legs;
- shipment milestones;
- proof of delivery;
- cost projection;
- provider failure;
- cross-border logistics orchestration.

---

# 4. Domain Separation

The platform SHALL distinguish:

```text
Fulfilment
Shipment
Consignment
Transport Leg
Freight Booking
Delivery
```

They are related but not interchangeable.

---

# 5. Fulfilment

Fulfilment represents the commercial obligation to dispatch ordered goods.

For example:

```text
Sales Order
   ↓
Fulfilment
```

---

# 6. Shipment

A Shipment represents a logical movement of goods.

Conceptually:

```text
Shipment
├── id
├── tenant
├── legal_entity
├── origin
├── destination
├── trade_lane?
├── shipment_type
├── transport_mode
├── status
├── planned_departure
├── planned_arrival
├── actual_departure?
├── actual_arrival?
├── shipment_lines[]
├── provider_references[]
└── external_references[]
```

---

# 7. Shipment Is Not Order

One order MAY create multiple shipments.

```text
Order
 ├── Shipment A
 └── Shipment B
```

---

# 8. One Shipment May Serve Multiple Commercial References

Where policy permits:

```text
Shipment
 ├── Order 1
 ├── Order 2
 └── Transfer 3
```

Canonical correlation SHALL preserve lineage.

---

# 9. Transport Leg

A shipment MAY contain multiple transport legs.

Example:

```text
Kampala Warehouse
      ↓ road
Mombasa Port
      ↓ sea
Durban Port
      ↓ road
Johannesburg Warehouse
```

This SHALL NOT be represented as one opaque carrier step.

---

# 10. Transport Leg Model

Conceptually:

```text
TransportLeg
├── id
├── shipment_id
├── sequence
├── origin
├── destination
├── mode
├── provider
├── planned_departure
├── planned_arrival
├── actual_departure?
├── actual_arrival?
├── status
└── external_reference?
```

---

# 11. Transport Modes

Canonical transport modes SHOULD initially include:

```text
ROAD
SEA
AIR
RAIL
COURIER
INLAND_WATERWAY
MULTIMODAL
OTHER
```

Provider-specific codes SHALL map into canonical values.

---

# 12. Shipment Types

Suggested shipment types:

```text
CUSTOMER_DELIVERY
SUPPLIER_INBOUND
INTER_BRANCH_TRANSFER
INTERCOMPANY_TRANSFER
RETURN
REPLACEMENT
SAMPLE
```

---

# 13. Logistics Providers

The platform SHALL support provider roles such as:

```text
CARRIER
FREIGHT_FORWARDER
COURIER
CUSTOMS_BROKER
WAREHOUSE_OPERATOR
3PL
PORT_AGENT
LAST_MILE_PROVIDER
```

A provider MAY perform more than one role.

---

# 14. Provider Is Not Role

The same organisation may act as:

```text
Carrier
+
Freight Forwarder
```

The system SHALL model:

```text
Provider
+
Capability
```

rather than one provider type hard-coded forever.

---

# 15. Provider Capability Model

Example:

```text
Provider A
├── ROAD_TRANSPORT
├── INTERNATIONAL_FREIGHT
├── TRACKING
└── PROOF_OF_DELIVERY
```

Provider B:

```text
├── CUSTOMS_BROKERAGE
├── SEA_FREIGHT
└── DOCUMENT_HANDLING
```

---

# 16. Control Plane Provider Resolution

CP SHALL resolve:

```text
Capability
+
Tenant
+
Market
+
Trade Lane
+
Context
       ↓
CapabilityBinding
       ↓
Provider
```

---

# 17. Trade Owns Orchestration

Trade SHALL own:

```text
shipment intent
shipment lifecycle
provider invocation
shipment projection
tracking projection
exception workflow
delivery confirmation
```

---

# 18. Provider Owns Physical Execution

External logistics providers MAY own:

```text
vehicle dispatch
carrier booking
container assignment
flight booking
vessel booking
driver dispatch
route execution
```

Baobab SHALL consume canonical state.

---

# 19. ERP Boundary

ERP SHALL own relevant financial consequences, including:

```text
freight invoice
transport cost
freight accrual
landed-cost allocation
carrier payable
cost accounting
```

Trade SHALL not create a duplicate freight AP ledger.

---

# 20. Freight Quote

Baobab SHOULD support obtaining logistics quotations.

Conceptually:

```text
FreightQuoteRequest
├── origin
├── destination
├── shipment lines
├── weight
├── volume
├── transport mode
├── Incoterm
├── pickup date
├── delivery requirement
└── service level
```

---

# 21. Freight Quote Response

Conceptually:

```text
FreightQuote
├── provider
├── service
├── amount
├── currency
├── validity
├── transit_time
├── exclusions
├── surcharge details
├── transport mode
└── terms
```

---

# 22. Logistics Quote Comparison

Baobab SHOULD be able to compare:

```text
price
transit time
reliability
route
service level
tracking support
insurance
capacity
provider performance
```

Lowest freight cost SHALL not automatically win.

---

# 23. Freight Booking

Once selected:

```text
FreightQuote
    ↓
Booking Request
    ↓
Provider
    ↓
Booking Confirmation
```

---

# 24. Booking Model

Conceptually:

```text
FreightBooking
├── canonical_id
├── shipment_id
├── provider_id
├── quote_reference
├── provider_booking_reference
├── status
├── mode
├── service_level
├── scheduled_pickup
├── scheduled_delivery
└── cost_projection
```

---

# 25. Booking Is Not Shipment

A provider booking is an execution projection of a Baobab shipment.

Therefore:

```text
Shipment
≠
Provider Booking
```

---

# 26. Shipment Lifecycle

Canonical lifecycle SHOULD support:

```text
DRAFT
  ↓
PLANNED
  ↓
BOOKING_PENDING
  ↓
BOOKED
  ↓
READY_FOR_PICKUP
  ↓
PICKED_UP
  ↓
IN_TRANSIT
  ↓
ARRIVED
  ↓
DELIVERED
  ↓
CLOSED
```

---

# 27. Exception States

Also support:

```text
DELAYED
HELD
CUSTOMS_HELD
PARTIALLY_DELIVERED
DAMAGED
LOST
RETURNED
CANCELLED
FAILED
```

---

# 28. Transport Leg Lifecycle

Each leg MAY independently be:

```text
PLANNED
BOOKED
READY
DEPARTED
IN_TRANSIT
ARRIVED
COMPLETED
DELAYED
CANCELLED
```

---

# 29. Shipment State Derivation

Shipment state may be derived from transport-leg state but SHALL not simply equal the current provider status.

Example:

```text
Leg 1 = COMPLETE
Leg 2 = IN_TRANSIT
Leg 3 = PLANNED

Shipment = IN_TRANSIT
```

---

# 30. Shipment Milestones

Canonical milestones SHOULD support concepts such as:

```text
BOOKED
READY_FOR_PICKUP
PICKED_UP
ORIGIN_DEPARTED
PORT_ARRIVAL
EXPORT_CLEARED
INTERNATIONAL_DEPARTURE
DESTINATION_ARRIVAL
IMPORT_CLEARED
OUT_FOR_DELIVERY
DELIVERED
```

Not every shipment uses every milestone.

---

# 31. Tracking Events

Tracking SHOULD be event-driven.

```text
Provider
   ↓
Provider Event
   ↓
Adapter
   ↓
Canonical Tracking Event
   ↓
Shipment State
```

---

# 32. Tracking Event

Conceptually:

```text
TrackingEvent
├── shipment_id
├── transport_leg_id?
├── provider
├── provider_event_id
├── event_type
├── location?
├── occurred_at
├── received_at
├── description?
└── evidence_reference?
```

---

# 33. Event Ordering

Provider events may arrive:

```text
late
duplicated
out of order
```

Therefore shipment processing SHALL not assume perfect chronological delivery.

---

# 34. Idempotency

Provider event IDs or Baobab idempotency keys SHALL prevent duplicate state mutations.

---

# 35. Tracking Polling

For providers without webhooks, controlled polling MAY be used.

Polling SHALL be:

```text
bounded
observable
rate-limited
retry-aware
```

---

# 36. Proof of Delivery

Delivery SHALL support structured evidence.

Conceptually:

```text
ProofOfDelivery
├── shipment_id
├── delivered_at
├── recipient
├── delivery_location
├── evidence
├── provider_reference
└── exception_notes?
```

---

# 37. Delivery Is Not Always Acceptance

Commercial receipt may still require:

```text
quantity verification
quality inspection
customer acceptance
```

Therefore:

```text
DELIVERED
≠
ACCEPTED
```

---

# 38. Inbound Logistics

Procurement shipments SHALL use the same generic logistics architecture.

```text
Supplier
   ↓
Inbound Shipment
   ↓
Transport
   ↓
Warehouse Receipt
```

---

# 39. Outbound Logistics

```text
Warehouse
   ↓
Customer Shipment
   ↓
Transport
   ↓
Delivery
```

---

# 40. Internal Cross-Market Logistics

```text
ZuriBeans Uganda
        ↓
ZuriBeans South Africa
```

SHALL still use shipment and transport-leg modelling regardless of whether transaction classification is intercompany or inter-branch.

---

# 41. Commercial Transaction Classification Is Separate

ADR-BCP-012 decides:

```text
intercompany
or
inter-branch
```

ADR-0022 decides:

```text
how the goods move.
```

---

# 42. Incoterms

Incoterm context may influence:

```text
who books freight
who pays freight
who bears risk
who handles export
who handles import
```

The logistics architecture SHALL consume Incoterm responsibility outputs.

---

# 43. Incoterm Does Not Replace Shipment Plan

An Incoterm SHALL NOT be treated as logistics execution.

It describes commercial responsibilities.

---

# 44. Responsibility Matrix

Conceptually:

| Responsibility | Party |
|---|---|
| Origin transport | Seller/Buyer |
| Export clearance | Seller/Buyer |
| Main carriage | Seller/Buyer |
| Insurance | Seller/Buyer |
| Import clearance | Seller/Buyer |
| Destination transport | Seller/Buyer |

Exact allocation comes from contract/Incoterm context.

---

# 45. Freight Payer vs Freight Booker

These SHALL be distinct.

A party may:

```text
book freight
```

while another ultimately:

```text
bears cost
```

depending on commercial agreement.

---

# 46. Carrier vs Freight Forwarder

Carrier:

```text
physically transports goods
```

Freight forwarder:

```text
orchestrates transport services
```

The system SHALL not conflate them.

---

# 47. Forwarder Shipment Model

One forwarder booking MAY involve multiple underlying carriers.

```text
Forwarder
  ├── Road Carrier
  ├── Shipping Line
  └── Destination Carrier
```

---

# 48. Provider Composition

Baobab SHOULD support:

```text
Shipment
   ↓
Provider Plan
   ├── Provider A — origin road
   ├── Provider B — sea
   └── Provider C — destination road
```

---

# 49. Multi-Provider Shipment

The Shipment remains canonical across all legs.

Provider-specific booking IDs remain ExternalReferences.

---

# 50. 3PL Integration

A 3PL MAY provide:

```text
storage
pick/pack
transport
fulfilment
returns
```

Each capability SHALL bind explicitly.

---

# 51. Warehouse Provider Is Not Carrier

A 3PL warehouse may hand goods to another carrier.

Custody changes SHALL be traceable.

---

# 52. Custody

ADR-BCP-013 establishes ownership vs custody.

Logistics SHALL publish custody transitions where relevant.

Example:

```text
ZuriBeans Warehouse
       ↓
Carrier custody
       ↓
Port custody
       ↓
Destination carrier custody
```

---

# 53. Custody Event

Conceptually:

```text
CustodyTransferred
├── shipment
├── from_party
├── to_party
├── location
├── quantity
├── timestamp
└── evidence
```

---

# 54. Custody ≠ Ownership

Carrier custody SHALL NOT imply carrier ownership.

---

# 55. In-Transit Inventory

Dispatch SHALL create or update first-class in-transit inventory.

```text
Source Stock
    ↓
Dispatch
    ↓
In Transit
    ↓
Destination Receipt
```

---

# 56. Shipment and In-Transit Inventory

Shipment describes logistics.

InventoryPosition describes stock.

These SHALL correlate but not collapse.

---

# 57. Partial Shipment

A commercial order may be partially shipped.

Example:

```text
Order:
1,000 kg

Shipment 1:
600 kg

Shipment 2:
400 kg
```

---

# 58. Partial Delivery

Shipment:

```text
1,000 kg dispatched
950 kg delivered
```

shall create an exception for:

```text
50 kg
```

---

# 59. Damage

Damage SHALL support:

```text
quantity
location
event
provider
evidence
claim reference
```

---

# 60. Loss

Lost cargo SHALL remain traceable through:

```text
shipment
inventory
carrier
insurance
claim
ERP adjustment
```

---

# 61. Claims

A future logistics capability MAY support:

```text
Damage Claim
Loss Claim
Delay Claim
```

The provider abstraction SHALL not prevent this.

---

# 62. Insurance

Shipment insurance MAY be:

```text
provider-supplied
third-party
self-insured
contractual
```

Insurance SHALL remain separate from carrier identity.

---

# 63. Service Levels

Logistics services MAY include:

```text
STANDARD
EXPRESS
ECONOMY
TEMPERATURE_CONTROLLED
SECURE
SPECIAL_HANDLING
```

as extensible canonical attributes.

---

# 64. Commodity Handling

Coffee, wine, vanilla and future goods may have different handling requirements.

Examples:

```text
temperature range
humidity
fragility
food-grade handling
hazard restrictions
security
```

These SHALL be product/logistics attributes.

---

# 65. No Product-Specific Logistics Core

Generic Trade code SHALL NOT contain:

```text
if product == coffee:
```

or:

```text
if product == wine:
```

for generic logistics orchestration.

---

# 66. Weight and Volume

Shipment planning SHALL support:

```text
gross weight
net weight
volume
package count
pallet count
container requirements
```

where relevant.

---

# 67. Unit Normalisation

Weight/volume values SHALL use canonical units and governed conversions.

---

# 68. Packaging

The logistics model SHOULD support:

```text
Package
Pallet
Container
```

as execution constructs where required.

---

# 69. Shipment Lineage

Conceptually:

```text
Canonical Product
      ↓
Lot / Batch
      ↓
Shipment Line
      ↓
Package / Container
      ↓
Transport Leg
```

---

# 70. Containerisation

For sea freight, the architecture SHOULD support container references without making container shipping mandatory for all logistics.

---

# 71. Container Model

Conceptually:

```text
TransportUnit
├── type
├── reference
├── provider
├── seal_reference?
├── shipment_lines[]
└── status
```

---

# 72. Seal Evidence

Where required, seal number and evidence MAY be recorded.

---

# 73. Route Planning

Route planning MAY be delegated to providers.

Baobab does not need to become a full route-optimisation engine to support logistics.

---

# 74. Pulse Integration

Pulse MAY later assist with:

```text
freight-market intelligence
port congestion
weather disruption
route risk
estimated delay
freight benchmarks
```

but shall remain advisory unless policy delegates authority.

---

# 75. Freight Cost

Trade MAY maintain:

```text
estimated freight cost
quoted freight cost
```

for commercial pricing.

ERP owns actual financial freight cost.

---

# 76. Cost Flow

```text
Freight Quote
      ↓
Estimated Freight Cost
      ↓
Commercial Landed Cost
      ↓
Provider Invoice
      ↓
ERP Actual Freight Cost
      ↓
Actual Landed Cost
```

---

# 77. Estimated vs Actual Freight

These SHALL remain distinct.

---

# 78. Surcharges

Provider charges MAY include:

```text
fuel surcharge
port surcharge
security surcharge
handling
waiting time
demurrage
detention
storage
```

The cost model SHALL be extensible.

---

# 79. Demurrage and Detention

Where applicable, these SHALL be represented as separate charges rather than hidden inside a generic freight amount.

---

# 80. Currency

Freight may be quoted in one currency while customer pricing or ERP functional currency uses another.

FX context SHALL be explicit.

---

# 81. Provider Invoice

Provider invoice SHALL ultimately flow to ERP/AP.

Trade MAY correlate it to:

```text
shipment
booking
trade lane
```

---

# 82. Commercial Freight Recovery

Customer may be charged:

```text
actual freight
fixed freight
included freight
freight markup
free delivery
```

Commercial freight recovery SHALL remain separate from actual provider cost.

---

# 83. Freight Recovery ≠ Freight Cost

Explicit invariant:

```text
Customer Freight Charge
≠
Carrier Cost
```

---

# 84. Logistics Capability Family

Suggested capabilities:

```text
logistics.quote.request
logistics.quote.compare
logistics.booking.create
logistics.booking.cancel

logistics.shipment.create
logistics.shipment.dispatch
logistics.shipment.track
logistics.shipment.receive

logistics.transport-leg.manage
logistics.custody.transfer
logistics.proof-of-delivery.record

logistics.provider.resolve
logistics.exception.manage
```

---

# 85. Provider-Specific Extensions

A provider MAY expose optional features:

```text
live GPS
label generation
container tracking
electronic POD
temperature telemetry
```

These SHOULD sit behind optional capabilities.

---

# 86. Capability Degradation

If live GPS is unavailable but shipment execution still works:

```text
shipment capability = READY
live_tracking = DEGRADED
```

not necessarily total logistics failure.

---

# 87. Mandatory Capability Failure

If no provider can execute required main carriage:

```text
NO PROVIDER
     ↓
SHIPMENT NOT READY
```

---

# 88. Manual Provider

Early deployment MAY support structured manual logistics execution.

Example:

```text
Shipment
   ↓
Manual Logistics Operator
   ↓
Provider booking entered
   ↓
Canonical tracking updated
```

Manual operation is valid if explicit and auditable.

---

# 89. Manual Does Not Mean Unstructured

A spreadsheet outside Baobab SHALL not be the production source of truth for shipment state.

---

# 90. Provider Adapters

External provider integration SHALL follow:

```text
Canonical Logistics API
        ↓
Provider Adapter
        ↓
Provider API
```

---

# 91. Provider Lock-In

Trade workflow SHALL not depend directly on:

```text
DHL-specific fields
Maersk-specific fields
FedEx-specific states
```

outside provider adapters/projections.

---

# 92. External References

Provider-specific references SHALL be stored as:

```text
ExternalReference
```

and mapped to canonical Shipment or TransportLeg.

---

# 93. Webhooks

Provider webhooks SHALL:

```text
authenticate
validate signatures
deduplicate
map provider state
audit
```

before changing canonical shipment projection.

---

# 94. Untrusted Provider Input

External provider events SHALL be treated as untrusted input until validated.

---

# 95. Security

Provider credentials SHALL be stored in approved secrets infrastructure.

No credentials in:

```text
source code
frontend
repository config
```

---

# 96. Tenant Isolation

Every logistics transaction SHALL remain tenant-scoped.

This SHALL fail:

```text
Thamani user
   ↓
ZuriBeans shipment
```

unless explicitly authorised by a legitimate inter-tenant workflow.

---

# 97. Legal-Entity Isolation

Users MAY require legal-entity scope in addition to tenant scope.

---

# 98. Provider Tenant Context

Shared providers SHALL receive only the context needed for the specific transaction.

---

# 99. Data Minimisation

A carrier SHALL not automatically receive:

```text
customer financial data
internal margin
supplier pricing
unrelated tenant information
```

---

# 100. Shipment Documents

Logistics may require:

```text
packing list
commercial invoice reference
transport document
delivery note
customs reference
certificate
insurance document
```

Documents SHALL use governed evidence architecture.

---

# 101. Document Provenance

A document associated with shipment SHALL retain:

```text
type
version
issuer
transaction
created_at
verified status
```

where appropriate.

---

# 102. Trade Document Architecture Relationship

The later canonical trade-document ADR SHALL own the full document model.

ADR-0022 only defines logistics consumption.

---

# 103. Customs Integration

Customs states SHALL be reflected in shipment workflow.

Example:

```text
ARRIVED
   ↓
CUSTOMS_HELD
   ↓
CUSTOMS_RELEASED
   ↓
DELIVERY
```

---

# 104. Carrier Does Not Determine Customs Authority

A carrier status:

```text
ARRIVED
```

SHALL not imply:

```text
CUSTOMS_RELEASED
```

---

# 105. Customs Broker

A customs broker may be bound to a shipment independently from carrier.

---

# 106. Customs and Logistics Providers May Differ

Example:

```text
Carrier → Provider A
Forwarder → Provider B
Customs Broker → Provider C
Warehouse → Provider D
```

This SHALL be supported.

---

# 107. SLA

Logistics providers SHOULD have measurable service levels:

```text
pickup SLA
transit SLA
delivery SLA
tracking SLA
exception response SLA
```

---

# 108. Provider Performance

Baobab MAY calculate:

```text
on-time pickup rate
on-time delivery rate
damage rate
loss rate
average delay
cost variance
tracking completeness
```

---

# 109. Provider Selection

Future provider selection MAY use:

```text
cost
performance
lane eligibility
capacity
service level
risk
```

---

# 110. Automated Provider Selection

Automatic provider selection MAY be introduced later.

It SHALL remain policy-driven and auditable.

---

# 111. No Invisible Provider Switching

If an automated workflow changes provider, the decision SHALL be auditable.

---

# 112. Shipment Cancellation

Cancellation SHALL account for:

```text
booking status
carrier penalties
inventory reservation
customs state
financial commitments
```

---

# 113. Rebooking

A failed provider booking MAY trigger:

```text
REBOOK_REQUIRED
```

and alternative provider resolution.

---

# 114. Provider Failure

Example:

```text
Booking requested
      ↓
Provider unavailable
      ↓
Retry policy
      ↓
Alternative provider?
      ↓
Escalation
```

---

# 115. Retry

Retries SHALL distinguish:

```text
transient error
permanent rejection
business validation failure
```

---

# 116. Circuit Breaking

Provider adapters SHOULD support circuit-breaking where repeated failures would otherwise overwhelm external dependencies.

---

# 117. Timeout

Provider calls SHALL have bounded timeouts.

No shipment workflow may hang indefinitely on an external API.

---

# 118. Asynchronous Execution

Long-running logistics operations SHOULD be asynchronous.

Example:

```text
Booking Requested
      ↓
PENDING
      ↓
Provider Confirmation Event
      ↓
BOOKED
```

---

# 119. Saga Model

Cross-border execution SHALL use saga/workflow principles.

```text
Shipment Plan
   ↓
Booking
   ↓
Pickup
   ↓
Export
   ↓
Transit
   ↓
Import
   ↓
Delivery
```

Failures SHALL create compensating/exception actions where possible.

---

# 120. No Distributed Transaction

No ACID transaction SHALL span:

```text
Trade DB
ERP DB
Carrier API
Customs API
Warehouse API
```

---

# 121. Event Model

Canonical events SHOULD include:

```text
shipment.created
shipment.planned
shipment.booked
shipment.picked-up
shipment.dispatched
shipment.in-transit
shipment.arrived
shipment.delivered
shipment.delayed
shipment.damaged
shipment.lost
shipment.cancelled

transport-leg.started
transport-leg.completed

custody.transferred

proof-of-delivery.recorded
```

---

# 122. Event Envelope

Every logistics event SHALL carry:

```text
tenant
legal_entity
shipment
trade_lane where relevant
correlation_id
causation_id
event_time
schema_version
```

---

# 123. Inventory Events

Logistics events may cause inventory transitions.

Example:

```text
shipment.dispatched
       ↓
inventory.in-transit
```

---

# 124. ERP Events

Delivery or receipt MAY trigger:

```text
goods receipt
goods issue
freight accrual
```

depending on transaction type.

---

# 125. Event Idempotency

Duplicate shipment events SHALL not:

```text
decrease stock twice
receive stock twice
invoice freight twice
```

---

# 126. Tracking Lag

Provider state may be delayed relative to physical reality.

Baobab SHOULD track:

```text
provider_observed_at
received_at
```

---

# 127. State Confidence

Optional future enhancement:

```text
Shipment State
+
Source
+
Confidence
```

may help reconcile multiple providers.

---

# 128. Conflicting Provider Events

If:

```text
Provider A → DELIVERED
Provider B → IN_TRANSIT
```

policy SHALL determine reconciliation rather than choosing arbitrarily.

---

# 129. Reconciliation

Logistics reconciliation SHALL compare:

```text
Trade shipment
↕
Provider booking

Shipment quantity
↕
Inventory movement

Delivery
↕
Goods receipt / fulfilment

Freight estimate
↕
ERP actual cost
```

---

# 130. Reconciliation States

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

# 131. ZuriBeans Scenario — Uganda Coffee to South Africa

```text
Kampala Warehouse
      ↓
Shipment Plan
      ↓
Origin Road Carrier
      ↓
Export Processing
      ↓
Port
      ↓
Sea / Air Main Carriage
      ↓
South Africa Arrival
      ↓
Customs
      ↓
Destination Carrier
      ↓
Johannesburg Warehouse
```

One canonical Shipment may span several providers.

---

# 132. ZuriBeans Scenario — South African Wine to Uganda

```text
ZA Warehouse
    ↓
Origin Carrier
    ↓
Export
    ↓
Main Carriage
    ↓
UG Import
    ↓
Destination Logistics
    ↓
UG Warehouse
```

Same architecture.

---

# 133. Local UG Delivery

```text
UG Warehouse
    ↓
Local Carrier
    ↓
UG B2B Buyer
```

No unnecessary international logistics workflow.

---

# 134. External Market Delivery

```text
ZuriBeans ZA
      ↓
Kenyan Customer
```

resolves providers for:

```text
ZA origin
+
ZA→KE trade lane
+
KE destination
```

without Kenya-specific Trade code.

---

# 135. Supplier Inbound Scenario

```text
Supplier
   ↓
Freight Booking
   ↓
Inbound Shipment
   ↓
Warehouse Receipt
```

The architecture is symmetric enough to support buy-side logistics.

---

# 136. Intercompany Scenario

```text
ZuriBeans UG
      ↓
ZuriBeans ZA
```

Commercial classification may be intercompany.

Logistics execution remains provider-neutral shipment orchestration.

---

# 137. Inter-Branch Scenario

Same legal entity:

```text
UG Branch
  ↓
ZA Branch
```

still requires transport, custody, customs and inventory movement.

---

# 138. Partial Shipment Test

Prove:

```text
Order = 1,000 kg

Shipment A = 600
Shipment B = 400
```

with correct inventory and fulfilment state.

---

# 139. Partial Delivery Test

Prove:

```text
Dispatched = 1,000
Delivered = 970
Damaged = 20
Missing = 10
```

with no silent reconciliation.

---

# 140. Provider Failure Test

Prove:

```text
Provider A unavailable
       ↓
fallback/retry
       ↓
Provider B or escalation
```

according to policy.

---

# 141. Duplicate Event Test

Repeated:

```text
shipment.delivered
```

shall not duplicate goods receipt or inventory mutation.

---

# 142. Out-of-Order Event Test

Example:

```text
DELIVERED event received
before
ARRIVED event
```

shall not corrupt the shipment state machine.

---

# 143. Customs Hold Test

Prove:

```text
ARRIVED
  ↓
CUSTOMS_HELD
```

prevents inappropriate destination availability.

---

# 144. Security Tests

At minimum:

```text
cross-tenant shipment access blocked

supplier cannot alter unrelated shipment

buyer sees permitted tracking only

carrier cannot mutate commercial order

provider webhook with invalid signature rejected
```

---

# 145. Performance Tests

The architecture SHALL test:

```text
high-volume tracking events
large shipment-line counts
webhook bursts
polling backlog
provider latency
```

---

# 146. Observability

Recommended metrics:

```text
shipment_total
shipment_in_transit
shipment_delayed_total
shipment_exception_total

freight_booking_total
freight_booking_failure_total

provider_request_total
provider_error_total
provider_latency

tracking_event_total
tracking_event_lag

delivery_duration
on_time_delivery_rate

logistics_reconciliation_mismatch_total
```

---

# 147. Alerting

Alerts SHOULD cover:

- provider outage;
- excessive booking failures;
- delayed critical shipment;
- tracking-event backlog;
- stuck customs hold;
- unreceived in-transit stock;
- reconciliation mismatch.

---

# 148. Audit

The platform SHALL audit:

```text
provider selection
booking
provider switch
manual override
shipment dispatch
custody transfer
delivery
exception resolution
```

---

# 149. Manual Intervention

Operations staff MAY intervene when:

```text
provider failure
shipment delay
customs hold
damage
loss
routing exception
```

Every intervention SHALL be auditable.

---

# 150. Rejected Alternative — One Carrier Integration in Trade Core

Rejected because it creates provider lock-in and cannot support multi-market logistics.

---

# 151. Rejected Alternative — Shipment Equals Fulfilment

Rejected because procurement, internal transfer and multimodal movement require a broader model.

---

# 152. Rejected Alternative — One Shipment Equals One Transport Leg

Rejected because cross-border trade is frequently multimodal.

---

# 153. Rejected Alternative — One Shipment Equals One Provider

Rejected because carriers, forwarders, brokers and 3PLs may all participate.

---

# 154. Rejected Alternative — Logistics Entirely in ERP

Rejected.

ERP owns financial and material-accounting consequences.

Trade requires operational shipment orchestration.

---

# 155. Rejected Alternative — Control Plane as Logistics Engine

Rejected.

CP resolves:

```text
who can provide logistics
```

Trade orchestrates:

```text
the shipment
```

---

# 156. Rejected Alternative — Build Full TMS Immediately

Rejected.

Baobab SHOULD provide the orchestration needed for ZuriBeans and integrate specialised TMS providers if advanced transport planning becomes necessary.

---

# 157. Rejected Alternative — Hard-Code UG→ZA Route

Rejected.

The architecture SHALL support N-to-N lanes.

---

# 158. Positive Consequences

This architecture enables:

- multiple carriers;
- freight forwarders;
- multimodal transport;
- inbound and outbound logistics;
- intercompany movements;
- inter-branch movements;
- third-country trade;
- provider substitution;
- tracking;
- custody lineage;
- freight cost integration;
- operational resilience.

---

# 159. Complexity Consequences

It introduces:

- provider adapters;
- shipment orchestration;
- transport legs;
- tracking state;
- event reconciliation;
- provider health;
- exception management.

This complexity reflects real cross-border logistics.

---

# 160. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical logistics contracts/events |
| `nabhold/baobab-trade` | Shipment and logistics orchestration |
| `nabhold/baobab-cp` | Capability/provider resolution |
| `nabhold/baobab-erp` | Freight financial consequences |
| `nabhold/baobab-iam` | Logistics roles/permissions |
| `nabhold/baobab-pulse` | Optional route/freight intelligence |
| `nabhold/infrastructure` | Connectivity, broker, secrets, observability |
| External providers | Physical logistics execution |

---

# 161. Implementation Sequence

```text
Canonical Logistics Contracts
          ↓
Shipment Model
          ↓
Transport Leg Model
          ↓
Provider Capability Model
          ↓
Provider Resolution
          ↓
Freight Quote
          ↓
Freight Booking
          ↓
Tracking
          ↓
Custody
          ↓
Delivery / Receipt
          ↓
ERP Freight Cost
          ↓
Reconciliation
          ↓
Golden-Tenant Validation
```

---

# 162. Release 1 P0 Scope

ZuriBeans Release 1 SHALL include:

- canonical Shipment;
- shipment lines;
- transport mode;
- multi-leg support;
- provider abstraction;
- freight quotation;
- booking;
- tracking;
- canonical milestone mapping;
- proof of delivery;
- partial shipment;
- partial delivery;
- delay/hold/damage/loss exceptions;
- in-transit inventory integration;
- customs-state integration;
- ERP freight-cost projection;
- event idempotency;
- reconciliation;
- audit;
- observability.

---

# 163. Release 1.1 Candidates

May follow:

- automated carrier tendering;
- route optimisation;
- GPS map tracking;
- IoT telemetry;
- temperature monitoring;
- container optimisation;
- predictive ETA;
- predictive delay;
- automated provider scoring;
- transport marketplace integration.

---

# 164. Definition of Done

ADR-0022 is implemented when:

- [ ] Shipment is separate from Order and Fulfilment;
- [ ] multi-leg transport exists;
- [ ] provider roles/capabilities exist;
- [ ] provider resolution is context-aware;
- [ ] freight quote flow exists;
- [ ] booking flow exists;
- [ ] provider references map canonically;
- [ ] tracking events are canonical;
- [ ] events are idempotent;
- [ ] out-of-order events are safe;
- [ ] custody changes are representable;
- [ ] in-transit inventory integrates;
- [ ] customs states integrate;
- [ ] proof of delivery exists;
- [ ] partial shipment works;
- [ ] partial delivery works;
- [ ] damaged/lost states work;
- [ ] estimated vs actual freight differs explicitly;
- [ ] ERP owns freight accounting;
- [ ] reconciliation exists;
- [ ] provider outage handling exists;
- [ ] cross-tenant isolation passes;
- [ ] UG→ZA test passes;
- [ ] ZA→UG test passes;
- [ ] local delivery test passes;
- [ ] external-market test passes;
- [ ] no provider-specific logic exists in generic Trade orchestration.

---

# 165. Final Architecture

```text
                     COMMERCIAL TRANSACTION
                              │
                              ▼
                         FULFILMENT
                              │
                              ▼
                           SHIPMENT
                              │
                              ▼
                      LOGISTICS PLANNING
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       Carrier          Freight Forwarder        3PL
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                        TRANSPORT LEGS
                              │
                              ▼
                         TRACKING EVENTS
                              │
                              ▼
                         IN-TRANSIT STOCK
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
             Customs       Custody       Exceptions
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                          DELIVERY
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
             Inventory                    ERP
             Receipt                  Freight Cost
```

Provider resolution:

```text
Shipment Context
      │
      ▼
Baobab Control Plane
      │
      ▼
Capability Bindings
      │
 ┌────┼─────┬────────┐
 ▼    ▼     ▼        ▼
Road Sea   Air     Broker
 │    │     │        │
 └────┴─────┴────────┘
           │
           ▼
      Baobab Trade
```

The governing principle is:

> **Baobab owns the shipment and its canonical operational state; logistics providers own physical execution; ERP owns the financial consequences.**

The architecture SHALL support local delivery, supplier inbound freight, customer outbound freight, internal cross-market movement and multi-provider international transport using the same canonical model.

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0022
   ↓
Shared Logistics Contracts
   ↓
Shipment / Transport-Leg Models
   ↓
Provider Capability Resolution
   ↓
Freight Quotes / Booking
   ↓
Tracking / Custody
   ↓
Inventory / Customs Integration
   ↓
ERP Freight Integration
   ↓
Reconciliation
   ↓
ZuriBeans Golden-Tenant Validation
```

No production implementation SHALL assume that one order, one shipment, one carrier and one transport leg are equivalent concepts.