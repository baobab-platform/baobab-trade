# ADR-0014: MedusaJS Commerce Checkout, Order Commitment and Distributed Transaction Boundary

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0013-medusajs-commerce-inventory-availability-reservation-and-erp-stock-authority-model.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates, Payment Providers, Fulfilment Providers
- **Decision Class:** Checkout / Order Lifecycle / Distributed Transactions / Reliability

---

## 1. Context

Checkout is the point at which multiple Baobab capabilities converge.

A typical commerce transaction may require:

```text
Customer
   │
   ▼
Digital Estate
   │
   ▼
Commerce Context
   │
   ├── Product
   ├── Price
   ├── Inventory
   ├── Tax
   ├── Fulfilment
   ├── Payment
   ├── Customer
   ├── B2B Organisation
   └── Legal Seller
```

The resulting Order may subsequently need to propagate to:

```text
iDempiere
Payment Provider
Fulfilment Provider
Analytics
Customer Communications
Other Baobab capabilities
```

These systems:

- have independent databases;
- fail independently;
- deploy independently;
- scale independently;
- may live in different regions;
- may be operated by external providers.

A naïve implementation could attempt to make Order placement depend synchronously upon all participating systems succeeding simultaneously.

For example:

```text
Begin transaction
   │
   ├── create Medusa Order
   ├── reserve inventory
   ├── charge payment
   ├── create ERP Order
   ├── create shipment
   ├── send email
   └── commit everything
```

No reliable database transaction exists across these independent systems.

Attempting to simulate one would create a fragile distributed transaction.

Baobab therefore requires an explicit definition of:

1. when Commerce considers an Order committed;
2. which operations belong to the local Commerce transaction;
3. which operations are synchronous prerequisites;
4. which operations occur asynchronously after commitment;
5. how partial failure is recovered;
6. how duplicate requests and events are handled;
7. how iDempiere receives the Order;
8. how Payment and Inventory state remain consistent;
9. how the customer receives an authoritative result.

---

# 2. Decision

Baobab SHALL define the **Medusa Commerce Engine as the authoritative transaction boundary for commerce Order placement**.

An Order SHALL become a committed Commerce Order when the Medusa checkout/order workflow successfully completes the locally authoritative commerce transaction, including all mandatory Commerce-side validations and state transitions.

External systems such as iDempiere SHALL NOT participate in the same database transaction.

The preferred architecture SHALL be:

```text
Validate Commerce Context
        │
        ▼
Validate Checkout
        │
        ▼
Payment Authorization
        │
        ▼
Inventory Reservation
        │
        ▼
Create Commerce Order
        │
        ▼
Record Durable Outbox Event
        │
        ▼
LOCAL COMMIT
        │
        ├──────── Customer receives Order result
        │
        └──────── Async propagation begins
                         │
                         ├── iDempiere
                         ├── fulfilment
                         ├── analytics
                         ├── notifications
                         └── other consumers
```

The exact internal ordering SHALL follow supported Medusa workflow semantics and provider requirements, but the architectural boundary SHALL remain unchanged.

---

# 3. Governing Principle

Baobab adopts:

> **Commerce Order commitment is local; enterprise consequences are distributed.**

This means:

```text
Commerce Commit
!=
ERP Commit
!=
Payment Settlement
!=
Physical Fulfilment
```

These facts may occur at different times.

---

# 4. Cart

A Cart SHALL represent mutable pre-commitment Commerce state.

It MAY contain:

- customer;
- Products/Variants;
- quantities;
- Market;
- Currency;
- shipping information;
- pricing;
- promotions;
- fulfilment selection;
- Payment Session.

A Cart SHALL NOT be treated as a legally or financially committed Order merely because it contains these values.

---

# 5. Cart Mutability

Before Order commitment, a Cart MAY be recalculated due to:

```text
price changes
quantity changes
Market changes
customer authentication
B2B organisation changes
promotion changes
shipping changes
tax changes
inventory changes
```

Therefore, Cart calculations SHALL be considered provisional until checkout validation succeeds.

---

# 6. Cart Ownership

Every protected Cart SHALL resolve to an authorised Commerce Context.

A customer SHALL NOT be permitted to operate another customer's protected Cart through identifier substitution.

Anonymous Cart access SHALL use appropriately protected possession/session semantics.

---

# 7. Checkout

Checkout SHALL be treated as a coordinated Commerce workflow rather than as a single unvalidated API mutation.

Conceptually:

```text
Cart
 │
 ▼
Checkout Validation
 │
 ├── Context
 ├── Customer
 ├── Market
 ├── Legal Seller
 ├── Currency
 ├── Product eligibility
 ├── Pricing
 ├── Inventory
 ├── Tax
 ├── Fulfilment
 ├── Payment
 └── B2B authority
 │
 ▼
Commit
```

---

# 8. Checkout Preconditions

Before Commerce Order commitment, the engine MUST establish all mandatory transaction facts.

At minimum, where applicable:

```text
Context valid
CapabilityBinding valid
Market active
Legal Seller resolved
Customer eligible
B2B Organisation eligible
Buyer authority valid
Products eligible
Variants eligible
Quantities valid
Prices current
Currency valid
Inventory policy satisfied
Shipping valid
Tax calculated
Payment method valid
```

Missing mandatory information SHALL prevent commitment.

---

# 9. Server Authority

Checkout validation SHALL occur server-side.

Digital Estates MAY collect and present:

- address;
- shipping selection;
- payment choice;
- coupon;
- quantity.

They SHALL NOT become authoritative for:

```text
price
tax
inventory
legal seller
payment eligibility
commercial terms
Order total
```

---

# 10. Complete Cart

Where standard Medusa checkout is used, Baobab SHALL preserve the supported `completeCart` / `completeCartWorkflow` lifecycle unless an explicit custom workflow is required.

Custom workflows SHALL maintain equivalent guarantees around:

- payment authorization;
- inventory handling;
- Order creation;
- compensation;
- workflow consistency.

---

# 11. Order Commitment Point

For Baobab purposes, a Commerce Order becomes committed when:

```text
1. mandatory Commerce validation succeeds;
2. required payment authorization state is achieved;
3. required inventory reservation semantics succeed;
4. the Order is durably persisted;
5. the corresponding durable integration event is durably recorded;
6. the local Commerce transaction completes successfully.
```

The exact Medusa internal workflow MAY involve multiple workflow steps.

---

# 12. ERP Creation Is Not a Checkout Prerequisite

The successful creation of an iDempiere Order SHALL NOT normally be a prerequisite for Commerce Order commitment.

Therefore:

```text
Medusa Order committed
+
iDempiere unavailable
```

is a valid temporary distributed state.

The Order SHALL enter integration processing rather than disappearing or being reported as unplaced.

---

# 13. Why ERP Is Asynchronous

Making iDempiere creation a synchronous hard prerequisite would couple checkout availability to:

- ERP uptime;
- ERP latency;
- ERP maintenance;
- ERP regional connectivity;
- ERP deployment.

This would make customer checkout unnecessarily fragile.

Accordingly, Order-to-ERP propagation SHALL normally be asynchronous.

---

# 14. Exceptions to Async ERP Propagation

A future Market MAY require synchronous external validation before Commerce commitment for a specific legal or risk reason.

Such a requirement MUST:

- be explicitly modelled;
- identify the external authority;
- use bounded timeout;
- define failure behaviour;
- receive architectural approval.

It SHALL NOT become the universal Commerce pattern.

---

# 15. Local Transaction

Commerce-local atomicity SHOULD cover the minimum state required to avoid:

```text
Order exists but integration event was never recorded
```

where technically possible.

The preferred pattern is:

```text
BEGIN LOCAL TRANSACTION

create/update Commerce Order
record required Commerce state
insert durable outbox record

COMMIT
```

---

# 16. Transactional Outbox

Every material committed Commerce Order SHALL produce a durable outbox record or equivalent transactional event record.

The architecture MUST prevent the classic dual-write failure:

```text
Order committed
        │
        ▼
process crashes
        │
        ▼
event never published
```

---

# 17. Order Event

The primary integration fact SHALL be:

```text
commerce.order.placed
```

or the versioned canonical equivalent.

This event means:

> The Commerce Engine has accepted and durably committed the Order.

It SHALL NOT mean:

> The ERP has posted the transaction.

It SHALL NOT mean:

> Payment has settled.

It SHALL NOT mean:

> Goods have shipped.

---

# 18. Event Semantics

Each event SHALL represent one specific business fact.

For example:

```text
commerce.order.placed
commerce.payment.authorized
commerce.payment.captured
commerce.fulfilment.created
commerce.fulfilment.shipped
```

These facts SHALL not be compressed into an ambiguous generic `order.updated` integration contract.

---

# 19. Order State vs Integration State

Commerce Order lifecycle SHALL remain distinct from ERP-integration lifecycle.

Conceptually:

```text
Order Status
   confirmed
```

may coexist with:

```text
ERP Integration Status
   pending
```

or:

```text
ERP Integration Status
   failed_retryable
```

A single Order status field SHALL NOT be overloaded to represent both.

---

# 20. Integration State

Baobab SHALL maintain observable integration state for material downstream propagation.

Conceptual states MAY include:

```text
PENDING
PROCESSING
SUCCEEDED
RETRYABLE_FAILURE
PERMANENT_FAILURE
RECONCILIATION_REQUIRED
```

Exact persistence shall be specified later.

---

# 21. Order Identity

Medusa Order ID SHALL remain the Commerce-native identifier.

Cross-engine correlation SHALL use:

```text
CanonicalEntity
ExternalReference
Mapping
```

where required.

---

# 22. Canonical Order

A Commerce Order requiring enterprise integration SHOULD receive or resolve a canonical Order identity.

Conceptually:

```text
Canonical Order
      │
      ├── Medusa Order
      └── iDempiere Order
```

The canonical entity relates the records.

It does not replace either engine's native Order.

---

# 23. ERP Order

The iDempiere Order is an ERP representation of the Commerce transaction.

It is not the same database record.

Therefore:

```text
Medusa Order ID != iDempiere Order ID
```

and:

```text
Medusa Order != iDempiere Order
```

even when both represent the same commercial transaction.

---

# 24. ERP Mapping

After ERP creation:

```text
Canonical Order
      │
      ├── ExternalReference → Medusa Order
      └── ExternalReference → iDempiere Order
```

SHALL allow deterministic cross-engine resolution.

---

# 25. Idempotent ERP Creation

The iDempiere integration MUST ensure repeated delivery of:

```text
commerce.order.placed
```

does not create duplicate ERP Orders.

The stable idempotency basis SHOULD include:

```text
event_id
```

and/or:

```text
canonical_order_id
```

according to the final integration contract.

---

# 26. Idempotency

All retryable financially or operationally significant commands SHALL have idempotency semantics.

Examples include:

```text
place Order
authorize Payment
capture Payment
create ERP Order
refund Payment
create Fulfilment
```

where supported.

---

# 27. Client Order Submission Idempotency

Checkout APIs SHOULD support a stable idempotency key or equivalent mechanism.

If a customer's network fails after successful Order creation and the client retries, the system MUST avoid unintentionally creating two Orders.

---

# 28. Retry Scenario

The following is normal:

```text
Client
  │
  ├── POST checkout
  │
  ▼
Order committed
  │
response lost
  X
Client retries
```

The retry SHOULD resolve the original committed result rather than create a duplicate transaction.

---

# 29. Idempotency Scope

Idempotency keys SHALL be scoped appropriately.

They SHOULD include sufficient principal/context information to prevent one caller's key colliding with another caller's legitimate request.

---

# 30. Idempotency Retention

The retention period for checkout idempotency records SHALL be long enough to cover realistic client retries and provider ambiguity.

It SHOULD NOT be arbitrarily short.

---

# 31. Payment Collection

Payment SHALL use Medusa's supported Payment Module concepts, including Payment Collections and Payment Sessions where applicable.

Payment-provider integration SHALL remain behind provider abstractions.

---

# 32. Payment Authorization

The standard online checkout profile SHOULD require successful Payment authorization before committing a prepaid Order.

Authorization means the provider has accepted the payment authorization according to its semantics.

Authorization SHALL remain distinct from capture.

---

# 33. Authorization vs Capture

Baobab SHALL preserve:

```text
Authorization != Capture
```

A payment may be:

```text
authorized
```

without yet being:

```text
captured
```

The Market/payment policy SHALL determine capture timing.

---

# 34. Automatic Capture

A provider or Market MAY be configured for automatic capture.

Such behaviour SHALL be explicitly understood in refund and failure handling.

---

# 35. B2B Deferred Payment

B2B Orders using approved account terms MAY not require an online payment authorization.

For example:

```text
Net 30
```

checkout may instead require:

```text
authorised customer organisation
+
credit/payment-term validation
```

before Order commitment.

---

# 36. Payment Policy

Checkout SHALL therefore resolve a `PaymentPolicy` appropriate to the Context.

Conceptually:

```text
PREPAID
AUTHORIZED_ACCOUNT_TERMS
MANUAL_PAYMENT
OTHER_APPROVED_POLICY
```

Exact canonical values SHALL be defined later.

---

# 37. Payment Provider Is External

A third-party Payment Provider SHALL be treated as an independent distributed system.

Its transaction cannot participate in Medusa's PostgreSQL transaction.

Payment workflows therefore require:

```text
idempotency
compensation
webhooks
reconciliation
```

---

# 38. Ambiguous Payment Result

A payment call may timeout after the provider has already accepted the request.

Therefore:

```text
timeout != payment failed
```

The Commerce Engine SHALL distinguish:

```text
confirmed failure
```

from:

```text
unknown outcome
```

---

# 39. Unknown Payment State

Where provider outcome is unknown, the system MUST reconcile before blindly retrying a non-idempotent financial operation.

Provider idempotency keys SHALL be used where available.

---

# 40. Payment Webhooks

Payment-provider webhooks MAY deliver authoritative later state changes.

Webhook processing SHALL be:

- authenticated or cryptographically verified where supported;
- idempotent;
- replay-safe;
- correlation-aware.

---

# 41. Payment Event Ordering

Webhook events MAY arrive:

- late;
- duplicated;
- out of order.

Consumers SHALL not assume perfect ordering.

---

# 42. Inventory Reservation

For stock-managed Products, checkout SHALL preserve the applicable Medusa inventory reservation semantics.

The standard `completeCartWorkflow` reservation behaviour SHOULD be reused where appropriate.

---

# 43. Alternative Order Workflows

If Baobab uses a Medusa Order workflow that does not automatically establish reservations, the implementation MUST explicitly create the required reservations before fulfilment.

A custom workflow SHALL not accidentally create unfulfillable Orders.

---

# 44. Reservation Failure

If required inventory cannot be reserved, Order commitment SHALL fail or follow an explicitly configured oversell/backorder policy.

---

# 45. Payment/Inventory Race

The workflow SHALL account for scenarios such as:

```text
Payment authorized
      │
      ▼
Inventory reservation fails
```

A compensating action MAY be required, such as:

```text
void authorization
```

according to provider semantics.

---

# 46. Inventory/Payment Race

Likewise:

```text
Inventory reserved
      │
      ▼
Payment authorization fails
```

SHALL result in reservation release according to policy.

---

# 47. Compensation

Where a workflow crosses an external side-effect boundary, rollback may require compensation rather than database rollback.

Examples:

```text
payment authorization → void
inventory reservation → release
fulfilment request → cancel
```

Compensation SHALL itself be idempotent where possible.

---

# 48. Workflow Rollback

Medusa workflow rollback mechanisms SHOULD be used for local workflow steps where supported.

However:

> Workflow rollback does not magically provide ACID transactions across external providers.

External side effects still require explicit compensation and reconciliation.

---

# 49. Distributed Saga

The overall post-commit Commerce transaction SHALL be treated conceptually as a saga.

For example:

```text
Commerce Order committed
        │
        ├── ERP creation
        ├── payment capture
        ├── fulfilment
        └── notification
```

Each operation has:

```text
forward action
failure policy
retry policy
compensation where possible
reconciliation
```

Baobab need not introduce a separate generic saga platform initially if Medusa workflows, durable events and integration workers satisfy the requirement.

---

# 50. No Distributed ACID

Baobab SHALL NOT implement XA/two-phase commit across:

```text
Medusa
iDempiere
Payment Provider
Fulfilment Provider
```

This is an architectural prohibition unless a future ADR explicitly overturns it.

---

# 51. Order-to-ERP Flow

The preferred flow SHALL be:

```text
Medusa checkout
      │
      ▼
Commerce Order committed
      │
      ▼
commerce.order.placed
      │
      ▼
Durable Event Infrastructure
      │
      ▼
ERP Integration Consumer
      │
      ▼
Resolve Context
      │
      ▼
Resolve Canonical Mappings
      │
      ▼
Idempotent iDempiere Command
      │
      ▼
iDempiere Order
      │
      ▼
Register ExternalReference
      │
      ▼
Integration Success
```

---

# 52. ERP Payload

The ERP integration SHALL receive committed transaction facts rather than instructions to independently reconstruct checkout.

The payload SHOULD make available, as applicable:

```text
canonical order
Commerce Order reference
customer/business partner reference
legal seller
Market
currency
line items
quantities
committed prices
discounts
taxes
shipping charges
payment terms
delivery information
commercial references
```

---

# 53. ERP Repricing Prohibited

iDempiere SHALL NOT independently recalculate the customer-facing Commerce selling price and silently replace the Order value.

It may perform:

- accounting validation;
- tax/accounting transformations;
- posting;
- valuation.

Unexpected financial differences SHALL trigger reconciliation.

---

# 54. ERP Rejection

iDempiere may reject an otherwise committed Commerce Order due to:

```text
missing mapping
invalid ERP configuration
business partner failure
organisation configuration
accounting configuration
ERP validation
```

This SHALL NOT cause the Commerce Order to vanish.

It SHALL create an observable integration failure.

---

# 55. Retryable ERP Failure

Transient failures such as:

```text
timeout
connection failure
temporary service unavailable
```

SHOULD enter retry processing.

Retries SHALL use:

```text
bounded retry
backoff
jitter
idempotency
```

---

# 56. Permanent ERP Failure

Non-transient failures SHOULD stop automated retry after policy is exhausted and enter:

```text
RECONCILIATION_REQUIRED
```

or equivalent.

Operations SHALL have tools to inspect and repair the failure.

---

# 57. Infinite Retry Prohibited

The system SHALL NOT retry an impossible ERP integration forever without visibility.

---

# 58. Customer Semantics

A customer whose Commerce Order has been committed SHALL receive an Order confirmation even if asynchronous ERP integration remains pending, unless a specific Market policy states otherwise.

Internal ERP state SHOULD NOT unnecessarily leak into ordinary B2C UX.

---

# 59. Operational Semantics

Administrative users MAY need visibility such as:

```text
Commerce Order: confirmed
ERP Export: pending
Payment: authorized
Fulfilment: not started
```

These SHALL remain separate statuses.

---

# 60. Order State Machine

The Commerce Order lifecycle SHALL use Medusa-supported order state and workflows.

Baobab SHALL NOT replace Medusa's lifecycle with a parallel generic Order state machine unless required.

Baobab-specific integration state SHALL be additive.

---

# 61. Order Confirmation

Order confirmation means Commerce has accepted the Order.

It does not imply:

```text
ERP posted
payment settled
goods dispatched
```

Customer-facing language SHALL avoid misleading equivalence.

---

# 62. Order Completion

A Commerce Order may eventually be considered completed according to Medusa/business policy.

Completion SHALL not be conflated with every downstream accounting or analytical process being complete.

---

# 63. Cancellation

Cancellation SHALL be treated as a distributed business process.

Potential consequences include:

```text
Commerce Order cancellation
inventory release
payment void/refund
ERP cancellation
fulfilment cancellation
customer notification
```

These consequences need not occur atomically.

---

# 64. Cancellation Eligibility

Cancellation SHALL be evaluated against current lifecycle state.

For example, a fully shipped Order may require a Return rather than cancellation.

---

# 65. Cancellation Event

A committed cancellation SHOULD publish:

```text
commerce.order.cancelled
```

or the canonical equivalent.

Consumers SHALL independently perform their required consequences.

---

# 66. ERP Cancellation

ERP cancellation SHALL use an idempotent business command appropriate to iDempiere.

Direct manipulation of ERP Order tables is prohibited.

---

# 67. Cancellation Failure

If Commerce cancels an Order but ERP cancellation temporarily fails:

```text
Commerce = cancelled
ERP = active
```

is a temporary distributed inconsistency requiring retry/reconciliation.

---

# 68. Order Editing

Order editing after commitment SHALL use Medusa-supported order-change mechanisms where applicable.

The platform SHALL NOT permit arbitrary mutation of committed Orders as though they were Carts.

---

# 69. Order Versioning

Where Medusa uses version-aware Order operations, Baobab SHOULD preserve these concurrency controls.

Concurrent updates SHALL not silently overwrite one another.

---

# 70. Material Order Change

A material committed Order change SHOULD generate an appropriate business fact/event.

Consumers such as ERP MUST receive enough information to reconcile the change.

---

# 71. Order Replacement vs Amendment

The integration contract SHALL distinguish:

```text
new Order
amended Order
cancelled Order
replacement Order
```

These business meanings SHALL not be inferred only from generic record updates.

---

# 72. Returns

Returns SHALL be downstream Order lifecycle processes.

Creating a Return MAY affect:

```text
inventory
refund
ERP
tax
customer balance
```

but SHALL not rewrite the original Order as though it never existed.

---

# 73. Exchanges

Exchange flows SHALL preserve original transaction history and represent resulting commercial consequences explicitly.

---

# 74. Claims

Claims or similar post-order operations SHALL follow Medusa-supported semantics where applicable.

---

# 75. Refund

A refund SHALL be treated as a distributed financial process.

Conceptually:

```text
Refund Requested
      │
      ▼
Validate Eligibility
      │
      ▼
Payment Provider Refund
      │
      ▼
Commerce Refund State
      │
      ▼
Canonical Event
      │
      ▼
ERP Accounting Consequence
```

---

# 76. Refund Idempotency

Repeated refund requests MUST NOT refund the same amount twice.

The provider's idempotency mechanism SHOULD be used where supported.

---

# 77. Partial Refund

Partial refunds SHALL be supported where business policy permits.

The Order SHALL retain:

```text
original amount
captured amount
refunded amount
remaining amount
```

or equivalent authoritative payment state.

---

# 78. Refund Failure

If Payment Provider refund succeeds but Commerce persistence fails, reconciliation MUST be capable of discovering the provider-side transaction.

This is another reason provider references and webhooks are required.

---

# 79. Payment Capture

Capture timing SHALL be defined by Market/provider policy.

Potential timings include:

```text
immediate during checkout
after Order acceptance
at fulfilment
manual administrative capture
```

No one timing shall be assumed universally.

---

# 80. Capture Failure

If an Order exists but payment capture later fails, the system SHALL enter an explicit recoverable state.

The Order MUST NOT silently appear fully paid.

---

# 81. B2B Account Orders

Orders using deferred B2B payment terms MAY propagate to ERP before any payment-provider transaction exists.

Their financial lifecycle SHALL be governed by ERP receivables and commercial terms.

---

# 82. Purchase Approval

B2B checkout MAY require organisational approval before final Order commitment.

Conceptually:

```text
Cart / Purchase Request
       │
       ▼
Approval
       │
       ▼
Commerce Order
```

A purchase request SHALL NOT be treated as a committed Order before required approval.

---

# 83. Approval Authority

Buyer approval policy SHALL be distinct from tenant administration.

Possible controls include:

```text
buyer spending limit
order value threshold
product restriction
required approver
```

---

# 84. Quote-to-Order

Future B2B quotation workflows SHALL validate the Quote again at conversion.

A Quote conversion MUST ensure:

```text
quote valid
customer valid
Market valid
price terms valid
inventory policy valid
seller valid
payment terms valid
```

---

# 85. Checkout Context Immutability

Certain Context dimensions SHALL become fixed when the Order is committed.

At minimum:

```text
Market
Legal Seller
Transaction Currency
```

SHALL not be silently changed after commitment.

---

# 86. Order Context Snapshot

The Order SHALL preserve sufficient Context to remain interpretable after platform configuration changes.

Relevant references SHOULD include:

```text
tenant
Market
legal seller
currency
sales channel
customer organisation
```

where applicable.

---

# 87. Product Snapshot

Order lines SHALL preserve sufficient Product/Variant information for historical interpretation.

---

# 88. Price Snapshot

Order lines SHALL preserve committed monetary facts according to ADR-0012.

---

# 89. Address Snapshot

Shipping and billing addresses used for the committed transaction SHALL be retained according to privacy and legal policy.

Later customer-profile changes SHALL not silently rewrite the historical Order.

---

# 90. Tax Snapshot

The Order SHALL retain committed tax facts.

Later tax configuration changes SHALL not rewrite historical Orders.

---

# 91. Fulfilment Snapshot

Selected shipping/fulfilment terms necessary to interpret the Order SHALL be retained.

---

# 92. Event Envelope

Order events SHALL use the standard Baobab event envelope.

At minimum, where applicable:

```text
event_id
event_type
event_version
occurred_at
producer
engine_instance_id
context_id
tenant_id
market_id
canonical_order_id
Commerce Order reference
correlation_id
causation_id
trace_id
data
metadata
```

---

# 93. Correlation

The same `correlation_id` SHOULD permit operators to trace:

```text
Digital Estate
      │
      ▼
Checkout
      │
      ▼
Medusa Order
      │
      ▼
Outbox
      │
      ▼
Canonical Event
      │
      ▼
ERP Integration
      │
      ▼
iDempiere Order
```

---

# 94. Causation

Follow-on events SHOULD record causal relationships.

For example:

```text
commerce.order.placed
      │
      causes
      ▼
erp.sales_order.created
```

where the event architecture defines such a fact.

---

# 95. Event Ordering

Global event ordering SHALL NOT be assumed.

Consumers SHALL reason using:

```text
aggregate identity
event version
causation
source sequence
```

where provided.

---

# 96. Duplicate Events

Canonical event delivery SHALL be treated as at-least-once.

Consumers MUST tolerate duplicate:

```text
commerce.order.placed
```

events.

---

# 97. Event Replay

Replaying Order events MUST NOT:

- duplicate ERP Orders;
- duplicate payment captures;
- duplicate fulfilments;
- duplicate refunds.

Replay safety SHALL be explicitly tested.

---

# 98. Inbox/Deduplication

Consumers performing material side effects SHOULD persist processed event identity or an equivalent idempotency record.

---

# 99. Poison Messages

An event that repeatedly fails due to malformed or unrecoverable business state SHALL move to an inspectable failure path.

It SHALL NOT block the entire Order integration stream indefinitely.

---

# 100. Dead Letter

Dead-letter handling SHALL preserve:

```text
event
failure reason
attempts
timestamps
correlation
```

and support authorised replay after repair.

---

# 101. Reconciliation

Order reconciliation SHALL be first-class.

The system SHOULD detect:

```text
Commerce Order missing ERP Order
ERP Order missing mapping
duplicate ERP Order
payment status mismatch
capture mismatch
refund mismatch
fulfilment mismatch
cancelled Commerce Order active in ERP
ERP rejection
integration event never completed
```

---

# 102. Reconciliation Direction

Reconciliation SHALL respect authority.

Examples:

```text
Commerce Order price
→ Commerce authority
```

```text
ERP accounting posting
→ ERP authority
```

```text
Payment Provider settlement
→ provider/payment authority
```

Repair SHALL not simply copy whichever timestamp is newest.

---

# 103. Reconciliation Frequency

Critical transaction reconciliation SHOULD run frequently enough to detect material financial or fulfilment discrepancies within defined operational objectives.

---

# 104. Human Intervention

Operations tooling SHOULD allow authorised operators to:

```text
inspect
retry
repair mapping
re-submit ERP command
mark investigated
resolve discrepancy
```

without directly editing engine databases.

---

# 105. Manual Database Repair

Direct SQL repair of Commerce or ERP Orders SHALL be exceptional emergency procedure.

It SHOULD require:

- documented runbook;
- authorised operator;
- audit;
- subsequent reconciliation.

---

# 106. Notification

Customer notification SHALL occur from committed business facts.

A confirmation email SHOULD not be sent merely because a frontend submitted a checkout request.

It SHOULD follow successful Order commitment.

---

# 107. Notification Failure

Email or messaging failure SHALL NOT roll back a valid Order.

Notification is a downstream side effect.

---

# 108. Analytics

Analytics failure SHALL NOT block checkout.

Analytics SHALL consume committed events asynchronously.

---

# 109. Payload CMS

Payload availability SHALL NOT be required during Order commitment.

Editorial content is not a transaction dependency.

---

# 110. Control Plane Dependency

Control Plane dependencies required to establish trusted Context MAY be satisfied through:

```text
live resolution
validated cache
pre-resolved trusted Context
```

according to the Context contract.

Checkout SHALL fail safely if authoritative Context cannot be established to the required confidence.

---

# 111. Context Cache

A cached Control Plane binding MAY be used during checkout only if:

```text
fresh enough
not revoked
valid for requested capability
```

according to policy.

---

# 112. Capability Revocation

If a Commerce capability has been revoked for a Context, new checkout SHALL not proceed merely because an old frontend session remains active.

---

# 113. Checkout Security

Checkout authorization SHALL evaluate:

```text
principal
Context
Market
Cart ownership
B2B membership
buyer authority
resource
action
```

where applicable.

---

# 114. Order Enumeration

Knowing another Order ID SHALL not grant access.

Order retrieval SHALL enforce server-side ownership/administrative authorization.

---

# 115. Price Tampering

Client-modified price or total values SHALL not determine committed Order values.

---

# 116. Currency Tampering

Client substitution of currency SHALL require full server-side Context validation and repricing.

---

# 117. Seller Tampering

Client substitution of Legal Seller SHALL fail unless the requested seller is valid for the active Context.

---

# 118. Inventory Tampering

Client-provided availability claims SHALL be ignored.

---

# 119. Payment Provider Tampering

The selected Payment Provider SHALL be validated as eligible for:

```text
Market
Legal Seller
Currency
customer
```

before use.

---

# 120. Webhook Security

Provider webhook endpoints SHALL enforce the strongest practical authenticity mechanisms supported by the provider.

Payload validation SHALL occur before state mutation.

---

# 121. Personally Identifiable Information

Order events SHALL minimise unnecessary PII.

Consumers needing sensitive customer data SHOULD retrieve it through authorised APIs where appropriate rather than receiving full customer profiles in every event.

---

# 122. Payment Data

Canonical Order events SHALL NOT contain:

- card numbers;
- CVV;
- sensitive payment credentials.

Only approved references/status metadata SHALL cross boundaries.

---

# 123. Observability

Checkout observability SHALL capture:

```text
checkout attempts
checkout success
checkout failure
payment authorization latency
payment failures
reservation failures
Order creation latency
outbox publication latency
ERP integration latency
ERP failures
```

---

# 124. Structured Logging

Relevant logs SHOULD include:

```text
engine_instance_id
context_id
tenant_id
market_id
Commerce Order ID
canonical_order_id
correlation_id
trace_id
```

subject to privacy policy.

---

# 125. Error Taxonomy

Checkout failures SHALL use stable error classes.

Examples MAY include:

```text
CONTEXT_INVALID
MARKET_INACTIVE
PRODUCT_INELIGIBLE
PRICE_CHANGED
INVENTORY_UNAVAILABLE
PAYMENT_DECLINED
PAYMENT_UNKNOWN
BUYER_NOT_AUTHORISED
FULFILMENT_UNAVAILABLE
ORDER_COMMIT_FAILED
```

Exact codes SHALL be defined by API contracts.

---

# 126. Retryability

Errors SHOULD indicate whether an operation is:

```text
retryable
non-retryable
requires customer action
requires operator action
```

where useful.

---

# 127. Customer Error Messages

Customer-facing responses SHALL not reveal:

- stack traces;
- SQL;
- provider secrets;
- internal topology;
- tenant metadata beyond authorised context.

---

# 128. Timeout Policy

Every synchronous external call during checkout SHALL use finite timeouts.

Infinite waiting is prohibited.

---

# 129. Retry Policy During Checkout

Retries inside the interactive checkout path SHALL be tightly bounded.

Extended recovery belongs to asynchronous processing.

---

# 130. Circuit Breakers

Where a synchronous external provider repeatedly fails, circuit-breaker behaviour SHOULD be considered to prevent resource exhaustion and cascading failure.

---

# 131. Backpressure

Event consumers SHALL apply backpressure rather than exhausting downstream ERP or provider capacity during large recovery bursts.

---

# 132. Outbox Backlog

A growing Order outbox backlog SHALL be observable and alertable.

---

# 133. Order Acceptance During Event-Broker Failure

If the architecture can durably store the outbox locally while the broker is unavailable, Commerce MAY continue accepting Orders according to operational policy.

The publisher SHALL deliver them after recovery.

---

# 134. Outbox Storage Failure

If Commerce cannot durably record the integration event required for a committed Order, the Order SHOULD NOT be considered successfully committed where the outbox is part of the local transactional invariant.

---

# 135. Database Failure

If Medusa persistence cannot durably commit the Order, checkout SHALL fail.

An external payment authorization already performed may require compensation or later reconciliation.

---

# 136. Crash Recovery

The system SHALL be tested for crashes at critical boundaries:

```text
before payment authorization
after payment authorization
after inventory reservation
after Order insert
after outbox insert
after DB commit
before event publication
after event publication before publish acknowledgement
```

---

# 137. Failure Matrix

At minimum, implementation design SHALL document behaviour for:

| Failure                               | Required Behaviour                        |
| ------------------------------------- | ----------------------------------------- |
| Price validation fails                | reject/reprice before commit              |
| Inventory unavailable                 | reject or explicit backorder              |
| Payment declined                      | reject Order commitment                   |
| Payment result unknown                | reconcile safely                          |
| Reservation fails after authorization | compensate payment                        |
| Local DB commit fails                 | no committed Order                        |
| Broker unavailable after local commit | retain outbox and retry                   |
| ERP unavailable                       | retain committed Commerce Order and retry |
| ERP rejects Order                     | surface reconciliation state              |
| Notification fails                    | Order remains committed                   |
| Analytics unavailable                 | Order remains committed                   |

---

# 138. Order Processing SLOs

Production profiles SHOULD define service objectives for:

```text
checkout latency
Order commit latency
outbox publication latency
ERP propagation delay
payment reconciliation delay
integration recovery time
```

---

# 139. Operational Runbooks

Runbooks SHALL exist for:

```text
payment provider outage
payment unknown-state incident
ERP outage
outbox backlog
event broker outage
duplicate Order suspicion
duplicate ERP Order
inventory reservation mismatch
failed Order export
stuck refund
stuck cancellation
```

---

# 140. Testing Taxonomy

The checkout boundary SHALL receive:

```text
unit tests
workflow tests
integration tests
contract tests
idempotency tests
failure-injection tests
resilience tests
security tests
end-to-end tests
reconciliation tests
```

---

# 141. Duplicate Checkout Test

The same idempotent checkout request submitted repeatedly SHALL produce no more than one intended Commerce Order.

---

# 142. Lost Response Test

The system SHALL prove:

```text
Order committed
response lost
client retries
```

does not duplicate the transaction.

---

# 143. Duplicate ERP Event Test

Delivering `commerce.order.placed` twice SHALL produce no more than one intended ERP Order.

---

# 144. ERP Response-Lost Test

The system SHALL test:

```text
ERP creates Order
      │
      ▼
response lost
      │
      ▼
integration retries
```

The retry MUST resolve the original ERP transaction rather than create another.

---

# 145. Payment Response-Lost Test

The same principle SHALL be tested for Payment Provider ambiguity.

---

# 146. Crash-After-Commit Test

A Commerce process crashing immediately after Order commit but before event publication SHALL still result in eventual publication from the outbox.

---

# 147. Duplicate Event Publication Test

If the publisher sends an event and crashes before marking it published, re-publication MUST be safe.

---

# 148. ERP Extended-Outage Test

Commerce SHALL demonstrate expected behaviour during prolonged ERP outage according to policy.

The outbox/integration queue SHALL remain recoverable.

---

# 149. Recovery Surge Test

When ERP recovers after a long outage, Order replay SHALL not overwhelm it.

---

# 150. Security Tests

Tests SHALL include:

```text
Cart hijacking
Order ID substitution
B2B organisation substitution
seller substitution
currency manipulation
price manipulation
payment-provider manipulation
duplicate checkout replay
webhook spoofing
```

---

# 151. Rejected Alternative: Synchronous Medusa-to-iDempiere Checkout Transaction

**Rejected.**

It would make ERP:

- a checkout availability dependency;
- a latency dependency;
- a distributed transaction participant.

---

# 152. Rejected Alternative: Shared Order Database

**Rejected absolutely.**

Medusa and iDempiere SHALL not share Order tables.

---

# 153. Rejected Alternative: Two-Phase Commit

**Rejected.**

No common transaction coordinator shall attempt atomic commit across Medusa, iDempiere and external providers.

---

# 154. Rejected Alternative: Order Exists Only After ERP Creation

**Rejected.**

This improperly makes ERP the Commerce transaction authority.

---

# 155. Rejected Alternative: Fire-and-Forget ERP Export

**Rejected.**

Order propagation MUST be:

```text
durable
observable
retryable
reconcilable
```

---

# 156. Rejected Alternative: Publish Event After Commit Without Outbox

**Rejected for material Order facts.**

The crash window between database commit and event publication creates unacceptable lost-event risk.

---

# 157. Rejected Alternative: Exactly-Once Messaging Claim

**Rejected unless independently proven end-to-end.**

Baobab SHALL design for:

```text
at-least-once delivery
+
idempotent consumption
```

---

# 158. Rejected Alternative: Notification Inside Order Transaction

**Rejected.**

Email or messaging outages SHALL not determine whether a Commerce transaction commits.

---

# 159. Rejected Alternative: Analytics Inside Checkout Transaction

**Rejected.**

Analytics is downstream.

---

# 160. Rejected Alternative: Payload Dependency During Checkout

**Rejected.**

CMS availability is irrelevant to authoritative Commerce transaction commitment.

---

# 161. Rejected Alternative: Frontend Order Authority

**Rejected absolutely.**

The Digital Estate submits intent.

The Commerce Engine commits the transaction.

---

# 162. Consequences

## Positive

The decision provides:

- resilient checkout;
- independently deployable ERP;
- durable Order integration;
- clear transaction ownership;
- payment recovery;
- inventory compensation;
- idempotent retries;
- reliable event propagation;
- traceable distributed processing;
- future regional operation.

## Negative

The platform must accept temporary distributed states such as:

```text
Commerce Order committed
ERP pending
Payment authorized
Fulfilment pending
```

It consequently requires:

- outbox;
- inbox/deduplication;
- reconciliation;
- integration state;
- operational tooling;
- compensation logic;
- sophisticated testing.

These are accepted as necessary characteristics of reliable distributed commerce.

---

# 163. Architectural Invariants

**ORD-COM-001**  
Medusa SHALL be authoritative for Commerce Order commitment.

**ORD-COM-002**  
iDempiere Order creation SHALL normally occur after Commerce Order commitment.

**ORD-COM-003**  
Medusa and iDempiere SHALL not share an Order database.

**ORD-COM-004**  
Distributed ACID transactions across engines are prohibited.

**ORD-COM-005**  
Material committed Orders SHALL have durable integration events.

**ORD-COM-006**  
Order persistence and durable outbox recording SHOULD be locally atomic.

**ORD-COM-007**  
Canonical Order events SHALL use at-least-once delivery assumptions.

**ORD-COM-008**  
Material event consumers SHALL be idempotent.

**ORD-COM-009**  
Duplicate `commerce.order.placed` delivery SHALL not duplicate ERP Orders.

**ORD-COM-010**  
Checkout requests SHALL support replay-safe/idempotent behaviour.

**ORD-COM-011**  
Payment authorization SHALL remain distinct from capture.

**ORD-COM-012**  
Unknown payment result SHALL remain distinct from confirmed failure.

**ORD-COM-013**  
Provider idempotency SHALL be used where available.

**ORD-COM-014**  
Required inventory reservation semantics SHALL be preserved.

**ORD-COM-015**  
Failed checkout side effects SHALL be compensated where possible.

**ORD-COM-016**  
ERP failure SHALL not silently destroy a committed Commerce Order.

**ORD-COM-017**  
ERP integration state SHALL remain distinct from Commerce Order status.

**ORD-COM-018**  
Notification failure SHALL not roll back a committed Order.

**ORD-COM-019**  
Analytics failure SHALL not roll back a committed Order.

**ORD-COM-020**  
Payload failure SHALL not prevent Order commitment.

**ORD-COM-021**  
Historical Orders SHALL preserve their committed commercial facts.

**ORD-COM-022**  
Market, Legal Seller and Currency SHALL not be silently changed after commitment.

**ORD-COM-023**  
ERP SHALL receive committed Commerce monetary facts rather than independently repricing the Order.

**ORD-COM-024**  
Cancellation SHALL be a distributed compensating process.

**ORD-COM-025**  
Refund operations SHALL be idempotent and reconcilable.

**ORD-COM-026**  
Payment webhooks SHALL be authenticated and idempotent where supported.

**ORD-COM-027**  
Infinite automated retry is prohibited.

**ORD-COM-028**  
Permanent integration failure SHALL become operationally visible.

**ORD-COM-029**  
Cross-engine Order identity SHALL use canonical mappings rather than shared native IDs.

**ORD-COM-030**  
Direct cross-engine database mutations are prohibited.

**ORD-COM-031**  
Checkout shall use finite external-call timeouts.

**ORD-COM-032**  
Critical distributed processes SHALL have reconciliation mechanisms.

**ORD-COM-033**  
Event replay SHALL not repeat financial or physical side effects.

**ORD-COM-034**  
Order creation SHALL be server-authoritative.

**ORD-COM-035**  
Client-submitted totals SHALL not determine the authoritative transaction.

---

# 164. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. Standard checkout produces one committed Commerce Order.

2. Duplicate checkout submission does not produce duplicate Orders.

3. Lost checkout response followed by retry resolves the original Order.

4. Price is revalidated before commitment.

5. Inventory policy is revalidated before commitment.

6. Invalid Legal Seller prevents commitment.

7. Invalid Market prevents commitment.

8. Payment decline prevents prepaid Order commitment.

9. Unknown payment result enters reconciliation rather than blind failure.

10. Payment authorization followed by reservation failure triggers required compensation.

11. Reservation followed by payment failure is released according to policy.

12. Local DB failure does not expose a committed Order.

13. Order commit and outbox creation satisfy the local atomicity contract.

14. Process crash after Order commit does not lose `commerce.order.placed`.

15. Duplicate event publication is safe.

16. Duplicate `commerce.order.placed` delivery does not create duplicate ERP Orders.

17. ERP creation followed by lost response does not create duplicate ERP Orders on retry.

18. ERP outage does not erase committed Commerce Orders.

19. ERP outage creates observable pending/retry state.

20. ERP permanent rejection enters reconciliation-required state.

21. Notification outage does not fail Order commitment.

22. Analytics outage does not fail Order commitment.

23. Payload outage does not fail Order commitment.

24. Payment Provider webhook replay is idempotent.

25. Payment Provider webhook spoofing is rejected.

26. Order ID substitution cannot expose another customer's Order.

27. B2B buyer cannot place an Order outside authorised organisation authority.

28. Currency manipulation is rejected or fully revalidated.

29. Price manipulation cannot alter server-computed totals.

30. Seller substitution is rejected.

31. Custom Order workflow preserves required inventory reservation semantics.

32. Event replay cannot duplicate payment capture.

33. Event replay cannot duplicate fulfilment creation.

34. Event replay cannot duplicate refund.

35. Cancellation propagates idempotently to required downstream systems.

36. Historical Order totals remain stable after Price List changes.

37. Historical Order seller remains stable after Market configuration changes.

38. Historical Order tax facts remain stable after tax-policy changes.

39. Correlation ID traces the transaction through Commerce and ERP.

40. Recovery after extended ERP outage drains backlog without duplicate ERP transactions.
```

---

# 165. Initial Production Transaction Profile

The first production profile SHOULD use:

```text
DIGITAL ESTATE
      │
      ▼
MEDUSA CHECKOUT
      │
      ├── Context validation
      ├── Pricing
      ├── Inventory
      ├── Tax
      ├── Fulfilment selection
      └── Payment authorization
      │
      ▼
completeCartWorkflow
      │
      ▼
COMMERCE ORDER
      │
      +
      ▼
TRANSACTIONAL OUTBOX
      │
      ▼
LOCAL COMMIT
      │
      ├────────► Customer Confirmation
      │
      ▼
commerce.order.placed
      │
      ▼
ERP INTEGRATION CONSUMER
      │
      ▼
Canonical Mapping
      │
      ▼
IDEMPOTENT IDEMPIERE COMMAND
      │
      ▼
ERP ORDER
      │
      ▼
ExternalReference / Mapping
      │
      ▼
RECONCILIATION
```

This SHALL be preferred over synchronous ERP participation in checkout.

---

# 166. Evolution Path

The architecture SHALL accommodate future additions such as:

```text
B2B purchase approval
quotations
subscriptions
marketplaces
distributed order management
advanced fraud checking
external tax engines
warehouse-management systems
credit decision engines
```

Each new capability SHALL be classified as either:

```text
pre-commitment authority
```

or:

```text
post-commitment consequence
```

before it is inserted into checkout.

---

# 167. Pre-Commitment Dependency Test

A new synchronous checkout dependency SHALL only be accepted when the answer to all of the following is satisfactory:

```text
1. Must this fact legally or commercially be known before accepting the Order?

2. Can it be cached or projected locally instead?

3. What happens when the dependency is unavailable?

4. What timeout applies?

5. Is the request idempotent?

6. Can the result become ambiguous?

7. How is it reconciled?

8. What is the impact on checkout latency?

9. What is the impact on regional independence?

10. Does this dependency violate an existing bounded context?
```

If a capability can safely occur after Order commitment, asynchronous integration SHALL be preferred.

---

# 168. Implementation Implications

This ADR requires subsequent specifications covering:

```text
checkout workflow
Order commitment transaction
transactional outbox
idempotency records
Payment integration
Payment webhook handling
ERP Order command
Order canonical mapping
integration status
inbox/deduplication
retry policy
dead-letter handling
Order reconciliation
cancellation saga
refund saga
failure injection tests
```

The package/interface specification SHALL derive explicit ports and adapters from these boundaries.

---

# 169. Decision Outcome

Baobab adopts the following transaction boundary:

```text
                    CUSTOMER / BUYER
                           │
                           ▼
                     DIGITAL ESTATE
                           │
                           ▼
                  ┌─────────────────┐
                  │ MEDUSA CHECKOUT │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
       PRICING         INVENTORY         PAYMENT
          │            RESERVATION      AUTHORISATION
          └────────────────┼────────────────┘
                           ▼
                    COMMERCE ORDER
                           +
                     DURABLE OUTBOX
                           │
                           ▼
                      LOCAL COMMIT
                           │
              ═════════════╪═════════════
               DISTRIBUTED BOUNDARY
                           │
             ┌─────────────┼──────────────┐
             │             │              │
             ▼             ▼              ▼
         IDEMPIERE     FULFILMENT     NOTIFICATION
             │
             ▼
       ERP TRANSACTION
```

The central rule is:

> **The Commerce Engine accepts the commercial transaction; downstream engines record and execute the consequences belonging to their own bounded contexts.**

The reliability rule is:

> **A committed Order and its integration intent must survive independently of broker, ERP, notification or analytics availability.**

The transaction rule is:

> **Baobab shall use local atomicity, durable events, idempotency, compensation and reconciliation instead of pretending that independent engines share one transaction.**

The payment rule is:

> **External payment success, failure and uncertainty must be represented explicitly; timeout is not proof of failure.**

The ERP rule is:

> **iDempiere receives a committed Commerce transaction through an idempotent integration contract—it does not participate in the customer-facing Commerce database transaction.**

And the long-term architectural rule is:

> **Every future capability proposed for synchronous checkout must prove that it is genuinely required before Order commitment. Otherwise, it belongs beyond the distributed transaction boundary.**
