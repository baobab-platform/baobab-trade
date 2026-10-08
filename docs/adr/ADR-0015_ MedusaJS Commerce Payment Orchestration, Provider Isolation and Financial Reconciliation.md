# ADR-0015: MedusaJS Commerce Payment Orchestration, Provider Isolation and Financial Reconciliation

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0014-medusajs-commerce-checkout-order-commitment-and-distributed-transaction-boundary.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Baobab Digital Estates, Payment Service Providers, Banking/Settlement Systems
- **Decision Class:** Payments / Provider Architecture / Financial Integration / Reconciliation

---

## 1. Context

Baobab Commerce must accept and orchestrate payments across independently operating:

- tenants;
- legal sellers;
- Markets;
- countries;
- currencies;
- customer segments;
- B2C customers;
- B2B organisations;
- payment providers;
- merchant accounts;
- settlement accounts;
- payment methods.

A single global payment-provider configuration cannot safely represent this operating model.

A transaction may involve:

```text
Customer
   │
   ▼
Digital Estate
   │
   ▼
Baobab Context
   │
   ├── Tenant
   ├── Legal Seller
   ├── Market
   ├── Currency
   └── Customer / Organisation
   │
   ▼
Medusa Commerce
   │
   ▼
Payment Provider
   │
   ▼
Merchant Account
   │
   ▼
Acquirer / Bank
   │
   ▼
Settlement
```

The architecture must distinguish several concepts that are often incorrectly collapsed:

```text
Payment Intent
Payment Session
Authorization
Capture
Settlement
Refund
Chargeback
Reconciliation
Accounting
```

They are not synonymous.

Furthermore, the system must tolerate uncertain distributed outcomes.

A request may be sent to a payment provider, the provider may successfully process it, and the network connection may fail before Medusa receives the response.

Therefore:

```text
timeout != failure
```

Payment architecture must consequently be designed around:

- provider abstraction;
- idempotency;
- explicit state;
- asynchronous notifications;
- reconciliation;
- auditability;
- isolation;
- security.

---

# 2. Decision

MedusaJS SHALL own **Commerce payment orchestration**.

Payment providers SHALL be integrated through Medusa-supported payment-provider abstractions or Baobab adapters conforming to those abstractions.

Medusa SHALL own the Commerce representation of:

- Payment Collections;
- Payment Sessions;
- authorization state;
- capture state;
- refund orchestration;
- payment-provider references;
- Commerce payment lifecycle.

Payment Service Providers SHALL remain authoritative for provider-side payment execution.

iDempiere SHALL remain authoritative for:

- accounting recognition;
- receivables;
- financial posting;
- settlement accounting;
- ledger consequences.

Baobab SHALL therefore implement:

```text
Commerce
   │
   ▼
Payment Orchestration
   │
   ▼
Payment Provider
   │
   ▼
Provider Transaction
   │
   ▼
Canonical Payment Events
   │
   ▼
ERP Financial Consequence
```

without sharing payment databases between systems.

---

# 3. Governing Principle

Baobab adopts:

> **Medusa orchestrates payment; the payment provider executes payment; iDempiere accounts for payment.**

These are separate responsibilities.

Therefore:

```text
Commerce Payment != Provider Transaction
```

and:

```text
Provider Transaction != ERP Accounting Entry
```

---

# 4. Payment Authority Model

Authority SHALL be explicitly divided.

| Concern                        | Authority                 |
| ------------------------------ | ------------------------- |
| Checkout payment selection     | Medusa                    |
| Payment Session                | Medusa                    |
| Payment orchestration          | Medusa                    |
| Provider transaction execution | Payment Provider          |
| Provider authorization result  | Payment Provider          |
| Provider capture result        | Payment Provider          |
| Provider refund execution      | Payment Provider          |
| Commerce payment state         | Medusa                    |
| Settlement confirmation        | Provider/banking evidence |
| Financial accounting           | iDempiere                 |
| Accounts receivable            | iDempiere                 |
| Canonical identity/mapping     | Control Plane             |

No engine SHALL silently assume authority assigned to another.

---

# 5. Payment Is Not Order

A Payment SHALL remain a distinct business concept from an Order.

Therefore:

```text
Order != Payment
```

An Order may have:

- zero Payments;
- one Payment;
- multiple Payments;
- partial Payments;
- multiple captures;
- refunds.

Future payment models may also include deposits or split settlement.

---

# 6. Payment Collection

Medusa Payment Collections SHOULD be used where supported to group payment activity associated with a Commerce transaction.

Baobab SHALL preserve Medusa's native payment lifecycle rather than introducing a parallel generic payment engine.

---

# 7. Payment Session

A Payment Session SHALL represent an attempt or configuration for paying through a particular Payment Provider.

A Session SHALL NOT itself be interpreted as proof that money was authorized or captured.

---

# 8. Payment Provider

A Payment Provider represents a technical payment-processing capability.

Examples MAY include:

```text
card processor
bank-transfer provider
mobile-money provider
wallet provider
local payment gateway
```

Baobab SHALL not encode provider-specific semantics throughout Commerce business logic.

---

# 9. Provider Adapter

Provider-specific behaviour SHALL be isolated behind an adapter/provider boundary.

Conceptually:

```text
Checkout
   │
   ▼
Medusa Payment Module
   │
   ▼
Payment Provider Interface
   │
   ├── Provider A Adapter
   ├── Provider B Adapter
   └── Provider C Adapter
```

Provider replacement SHALL not require rewriting Order logic.

---

# 10. No Provider Logic in Digital Estates

Digital Estates SHALL NOT contain authoritative payment-provider orchestration.

Frontend provider SDKs MAY be used where necessary for:

- tokenization;
- hosted fields;
- redirects;
- authentication.

The server SHALL remain authoritative for payment lifecycle decisions.

---

# 11. Payment Context

Every Payment SHALL execute within a trusted Commerce Context.

Relevant dimensions include:

```text
tenant_id
legal_seller_id
market_id
currency
customer_id?
customer_organisation_id?
order_id?
```

---

# 12. Payment Provider Eligibility

Payment Providers SHALL be resolved according to Context.

A provider may be valid for:

```text
Market A + ZAR
```

but invalid for:

```text
Market B + EUR
```

Eligibility SHALL be server-enforced.

---

# 13. Legal Seller

The legal seller SHALL be known before provider routing where merchant-account ownership depends on the seller.

Payment configuration SHALL NOT assume:

```text
EngineInstance == Legal Seller
```

---

# 14. Merchant Account

A Merchant Account SHALL be treated as distinct from the Payment Provider itself.

Conceptually:

```text
Provider
   │
   ├── Merchant Account A
   ├── Merchant Account B
   └── Merchant Account C
```

This distinction is mandatory for multi-legal-entity operation.

---

# 15. Merchant Account Isolation

One legal seller SHALL NOT accidentally process transactions through another legal seller's merchant account.

Routing SHALL validate:

```text
Legal Seller
+
Market
+
Currency
+
Provider
+
Merchant Account
```

---

# 16. Merchant Credentials

Merchant-account credentials SHALL be:

- externally secret-managed;
- scoped to the correct runtime;
- unavailable to Digital Estates;
- absent from source control;
- absent from container images;
- absent from logs.

---

# 17. Payment Capability Binding

Payment capability MAY eventually participate in Control Plane capability resolution.

Conceptually:

```text
Context
   │
   ▼
commerce.payment
   │
   ▼
CapabilityBinding
   │
   ▼
Commerce EngineInstance
```

Provider routing remains Commerce configuration within that authorised engine context unless a future dedicated Payment capability is introduced.

---

# 18. Market Payment Configuration

Each Market SHALL define or resolve eligible:

```text
payment providers
payment methods
currencies
capture policy
refund policy
```

where applicable.

---

# 19. Payment Method

Payment Method SHALL remain distinct from Payment Provider.

For example:

```text
Provider: Gateway X
Methods:
  - card
  - bank transfer
  - wallet
```

A Market MAY expose only a subset.

---

# 20. Currency Validation

A provider SHALL only be used for a currency it supports under the configured merchant account.

Currency SHALL be validated before payment execution.

---

# 21. Multi-Currency Merchant Accounts

Where a Merchant Account supports multiple currencies, the configuration SHALL explicitly identify permitted currencies.

Provider capability SHALL not be inferred from one successful transaction.

---

# 22. Payment Amount

The authoritative Payment amount SHALL derive from server-calculated Commerce totals.

Client-supplied monetary amounts SHALL NOT be trusted.

---

# 23. Money Representation

All payment amounts SHALL use the Baobab canonical Money conventions established by the pricing architecture.

A Payment amount SHALL include:

```text
amount
currency
```

with approved numeric representation.

Binary floating-point SHALL NOT be used for canonical financial amounts.

---

# 24. Authorization

Authorization represents provider approval to reserve or permit collection of funds according to provider semantics.

Authorization SHALL remain distinct from Capture.

---

# 25. Capture

Capture represents the provider-side action that initiates or confirms collection of previously authorized funds according to the provider's model.

Therefore:

```text
AUTHORIZED != CAPTURED
```

---

# 26. Settlement

Settlement represents movement or recognition of funds into the merchant's settlement process.

Therefore:

```text
CAPTURED != SETTLED
```

Baobab SHALL preserve this distinction.

---

# 27. Accounting

Accounting recognition in iDempiere is another distinct fact.

Therefore:

```text
SETTLED != ACCOUNTED
```

even though they should eventually reconcile.

---

# 28. Payment Lifecycle

A conceptual payment lifecycle MAY include:

```text
CREATED
   │
   ▼
PENDING
   │
   ▼
AUTHORIZED
   │
   ▼
CAPTURED
   │
   ▼
SETTLED
```

with alternative transitions such as:

```text
FAILED
CANCELLED
VOIDED
PARTIALLY_REFUNDED
REFUNDED
CHARGEBACK
```

Exact Medusa/provider states SHALL remain native where appropriate.

---

# 29. Canonical State Mapping

Baobab MAY define canonical payment business states for cross-engine communication.

Such states SHALL NOT erase provider-specific information required for reconciliation.

---

# 30. Provider State

Raw provider state SHOULD be retained as provider metadata where operationally useful.

Canonical contracts SHALL expose stable business meaning rather than leaking provider implementation everywhere.

---

# 31. Payment Policy

Every checkout SHALL resolve an applicable payment policy.

Examples MAY include:

```text
PREPAID
AUTHORIZE_THEN_CAPTURE
IMMEDIATE_CAPTURE
ACCOUNT_TERMS
MANUAL_SETTLEMENT
```

Exact values SHALL be governed by contract.

---

# 32. Immediate Capture

Some Markets/providers MAY capture payment during checkout.

This SHALL be explicitly configured.

---

# 33. Deferred Capture

Other Markets MAY authorize at checkout and capture later.

Potential capture points include:

```text
Order acceptance
inventory confirmation
fulfilment creation
shipment
manual approval
```

The selected policy SHALL be explicit.

---

# 34. B2B Account Terms

A B2B customer operating under approved credit terms MAY place an Order without an external Payment Provider transaction.

For example:

```text
Net 30
```

Such an Order SHALL use the applicable B2B payment-term authority.

---

# 35. Account Terms Are Not Payment Success

An Order accepted on account SHALL NOT be represented as if a card Payment were captured.

Its financial obligation belongs to accounts receivable.

---

# 36. ERP Receivables

iDempiere SHALL normally remain authoritative for:

```text
customer receivable
payment due date
outstanding balance
credit exposure
settlement accounting
```

for account-based B2B transactions.

---

# 37. Credit Decision

Commerce SHALL NOT infer credit eligibility merely because a customer previously used account terms.

An authorised credit decision or projection SHALL be used where credit control applies.

---

# 38. Idempotency

Every provider operation capable of financial side effects SHALL be idempotent where provider capabilities permit.

Examples:

```text
authorize
capture
refund
void
```

---

# 39. Stable Command Identity

Baobab SHOULD generate or propagate a stable command/idempotency identifier for each intended financial operation.

Retries SHALL reuse that identifier.

---

# 40. Retry Does Not Mean New Payment

A retry caused by:

```text
timeout
network failure
process crash
```

SHALL attempt to resolve the original financial intent.

It SHALL NOT automatically create a new Payment transaction.

---

# 41. Ambiguous Outcome

The following scenario SHALL be explicitly supported:

```text
Medusa
   │
   ├── authorize payment ─────► Provider
   │                             │
   │                             ▼
   │                          SUCCESS
   │                             │
   X◄──── network failure ───────┘
```

Medusa cannot safely conclude:

```text
payment failed
```

---

# 42. Unknown State

The architecture SHALL represent an unknown or reconciliation-required outcome where necessary.

It SHALL not force every timeout into `FAILED`.

---

# 43. Unknown-State Resolution

Resolution MAY use:

```text
provider query API
provider webhook
provider transaction reference
idempotency lookup
reconciliation process
```

depending on provider capabilities.

---

# 44. Blind Financial Retry Prohibited

If the provider does not guarantee idempotency, an ambiguous financial operation SHALL NOT be blindly repeated.

Reconciliation MUST occur first.

---

# 45. Webhooks

Payment Provider webhooks SHALL be treated as first-class integration inputs.

They MAY communicate:

```text
authorization
capture
failure
refund
settlement
chargeback
dispute
```

depending on provider.

---

# 46. Webhook Authentication

Webhook authenticity SHALL be verified using the strongest mechanism supported by the provider.

Examples include:

```text
signature
HMAC
asymmetric signature
mutual TLS
provider-specific verification
```

---

# 47. Webhook Replay

Webhook processing MUST be idempotent.

The same provider event delivered repeatedly SHALL not repeat a financial side effect.

---

# 48. Webhook Ordering

Webhooks MAY arrive out of order.

Consumers SHALL not assume:

```text
network delivery order == business event order
```

---

# 49. Provider Event Identity

Where the provider supplies a stable event identifier, Baobab SHOULD persist it for deduplication.

---

# 50. Webhook Inbox

Provider webhook processing SHOULD use a durable inbox or equivalent processing record for material financial events.

Conceptually:

```text
provider_event_id
provider
received_at
processed_at
status
attempt_count
last_error
```

---

# 51. Webhook Acknowledgement

Provider acknowledgement SHOULD occur according to provider requirements.

Long-running downstream processing SHOULD generally occur outside the immediate webhook request when appropriate.

---

# 52. Provider Availability

Payment Provider availability is an external dependency.

Its failure SHOULD affect only payment methods requiring that provider.

The entire Commerce Engine SHOULD NOT necessarily become unavailable.

---

# 53. Multiple Providers

A Market MAY configure multiple Payment Providers.

This MAY provide:

- local payment methods;
- currency support;
- resilience;
- cost optimisation;
- regional coverage.

---

# 54. Provider Routing

Provider routing SHALL be deterministic and policy-driven.

Inputs MAY include:

```text
Market
Legal Seller
Currency
Payment Method
Customer Type
Transaction Value
```

---

# 55. Provider Failover

Automatic failover between Payment Providers SHALL be treated cautiously.

A failed or timed-out request to Provider A may already have succeeded.

Therefore, Baobab SHALL NOT automatically submit the same payment to Provider B unless the outcome of Provider A is conclusively known or business logic explicitly supports a new payment attempt.

---

# 56. Payment Attempt

A new provider attempt SHALL be represented distinctly from retrying the same provider command.

This distinction is important for financial audit.

---

# 57. Multiple Payment Attempts

A checkout MAY have:

```text
Attempt 1 → declined
Attempt 2 → declined
Attempt 3 → authorized
```

The system SHALL preserve sufficient history without treating all attempts as successful Payments.

---

# 58. Payment Decline

A confirmed provider decline SHALL be treated as a known failure.

It MAY be presented to the customer using safe, provider-appropriate messaging.

---

# 59. Decline Information

Sensitive provider decline details SHALL not be unnecessarily exposed to customers or logs.

---

# 60. Fraud Decision

A provider or future fraud engine MAY decline or review a transaction.

Fraud status SHALL remain distinct from Payment status where separate systems are involved.

---

# 61. Strong Customer Authentication

Markets requiring mechanisms such as additional cardholder authentication SHALL support the provider's appropriate workflow.

The Digital Estate MAY participate in required customer interaction but SHALL not determine final Payment state.

---

# 62. Redirect Payments

Some payment methods require browser redirect.

The architecture SHALL tolerate:

```text
customer leaves Digital Estate
provider interaction
customer returns
```

without relying exclusively on the return redirect as proof of payment.

---

# 63. Redirect Is Not Authority

A successful browser redirect SHALL NOT itself be authoritative proof of payment.

Provider API/webhook state SHALL establish the result.

---

# 64. Customer Abandonment

A customer may never return from a provider redirect.

The system SHALL still be able to resolve Payment state through provider integration.

---

# 65. Capture Idempotency

Repeated capture processing MUST NOT capture the same intended amount multiple times.

---

# 66. Partial Capture

Where supported, partial capture MAY be used.

The system SHALL preserve:

```text
authorized_amount
captured_amount
remaining_authorizable_amount
```

or provider-equivalent state.

---

# 67. Multiple Capture

If a provider permits multiple captures against one authorization, Baobab SHALL explicitly model each capture.

---

# 68. Over-Capture

The Commerce Engine SHALL NOT capture beyond authorised/business-permitted amount.

Provider safeguards SHALL not be the only control.

---

# 69. Void

An uncaptured authorization MAY be voided where provider semantics support it.

Void SHALL remain distinct from Refund.

---

# 70. Refund

Refund represents reversal of previously captured funds.

Therefore:

```text
VOID != REFUND
```

---

# 71. Refund Authority

Medusa SHALL orchestrate Commerce refund requests.

The Payment Provider SHALL remain authoritative for execution of the provider-side refund.

---

# 72. Refund Preconditions

Before initiating a refund, Commerce SHALL validate:

```text
Payment exists
captured amount
already refunded amount
requested amount
currency
Order relationship
actor authority
```

---

# 73. Partial Refund

Baobab SHALL support partial refunds where provider/business policy permits.

---

# 74. Refund Idempotency

Every refund SHALL have a stable financial command identity.

Retrying the same refund SHALL not create a second refund.

---

# 75. Refund Unknown State

A timeout during refund processing SHALL be treated as potentially ambiguous.

The system SHALL reconcile before initiating another financial refund operation.

---

# 76. Refund Event

Successful Commerce recognition of a refund SHOULD produce:

```text
commerce.payment.refunded
```

or the canonical equivalent.

---

# 77. Refund ERP Consequence

The ERP integration SHALL receive sufficient information to record the financial consequence.

ERP SHALL not trigger another provider refund merely because it receives the event.

---

# 78. Chargeback

A Chargeback is not a Refund.

Therefore:

```text
CHARGEBACK != REFUND
```

A Chargeback is typically initiated externally through the payment/banking network.

---

# 79. Chargeback Handling

Where provider capabilities support Chargeback notifications, Baobab SHOULD ingest them as separate business events.

Potential canonical events include:

```text
commerce.payment.chargeback_opened
commerce.payment.chargeback_won
commerce.payment.chargeback_lost
```

Exact taxonomy SHALL be governed later.

---

# 80. Dispute

Payment disputes SHOULD remain explicitly modelled rather than being represented as generic Payment failure.

---

# 81. Settlement

Provider settlement SHALL be reconciled separately from transaction authorization/capture.

A successfully captured Payment may not yet appear in a bank settlement.

---

# 82. Settlement Batch

Where providers produce settlement batches, Baobab MAY ingest:

```text
settlement_id
settlement_date
currency
gross_amount
fees
net_amount
transaction references
```

through governed financial integration.

---

# 83. Provider Fees

Payment Provider fees SHALL NOT be silently deducted from the Commerce Order amount.

The Order represents the customer transaction.

Provider fees represent merchant financial costs.

---

# 84. ERP Provider Fees

Provider fees SHOULD ultimately be represented according to iDempiere accounting policy.

---

# 85. Reconciliation Layers

Baobab SHALL distinguish at least:

```text
Commerce ↔ Provider reconciliation

Commerce ↔ ERP reconciliation

Provider ↔ Bank settlement reconciliation

ERP ↔ Bank reconciliation
```

These are related but separate controls.

---

# 86. Commerce-to-Provider Reconciliation

The system SHOULD detect:

```text
Commerce says authorized, provider does not
Commerce says failed, provider says authorized
Commerce says captured, provider says not captured
provider refund missing locally
local refund missing at provider
duplicate provider transaction
```

---

# 87. Commerce-to-ERP Reconciliation

The system SHOULD detect:

```text
captured Payment missing in ERP
refund missing in ERP
wrong ERP amount
wrong ERP currency
duplicate ERP financial consequence
```

---

# 88. Settlement Reconciliation

Where settlement data is available, the platform SHOULD identify:

```text
captured but unsettled transactions
settled but unknown transactions
fee differences
currency differences
settlement timing differences
```

---

# 89. Reconciliation Is Mandatory

Payment reconciliation SHALL be a production requirement, not an optional reporting feature.

Distributed financial systems inevitably develop temporary or permanent discrepancies.

---

# 90. Reconciliation Record

Baobab SHOULD maintain explicit reconciliation records.

Conceptually:

```text
reconciliation_id
payment_reference
provider_reference
order_reference
expected_state
observed_state
status
detected_at
resolved_at
resolution
```

Exact schema SHALL be defined later.

---

# 91. Reconciliation Resolution

Resolution SHALL be:

- idempotent;
- auditable;
- authority-aware.

The system SHALL not arbitrarily choose Medusa state over provider evidence.

---

# 92. Provider Query

Provider APIs MAY be queried during reconciliation.

Such queries SHALL use:

- bounded concurrency;
- rate-limit awareness;
- retry policy;
- authentication controls.

---

# 93. Scheduled Reconciliation

Scheduled reconciliation SHOULD supplement webhook/event processing.

Webhooks alone SHALL NOT be treated as infallible.

---

# 94. Near-Real-Time Reconciliation

High-value Markets MAY require more frequent reconciliation than low-value Markets.

The frequency SHALL be risk-based.

---

# 95. Financial Finality

Baobab SHALL avoid declaring financial finality too early.

For example:

```text
Order placed
```

does not imply:

```text
funds settled
```

---

# 96. Payment Canonical Identity

Where cross-engine identity is required, a Payment SHOULD participate in the canonical mapping model.

Conceptually:

```text
Canonical Payment
      │
      ├── Medusa Payment
      ├── Provider Transaction
      └── iDempiere Payment/Receipt
```

where each representation exists.

---

# 97. Provider Reference

Provider transaction IDs SHALL be treated as ExternalReferences.

They SHALL NOT replace canonical identity.

---

# 98. External Reference Uniqueness

Provider reference uniqueness SHALL be scoped appropriately by:

```text
provider
merchant account
environment
```

where provider semantics require it.

---

# 99. Environment Isolation

Sandbox/test provider transactions SHALL never be confused with production transactions.

Payment configuration MUST distinguish:

```text
development
test
staging
production
```

---

# 100. Production Credentials

Production merchant credentials SHALL NOT be available to ordinary development or test environments.

---

# 101. Test Providers

Development SHOULD use:

- provider sandbox;
- fake provider;
- deterministic test adapter;

depending on test level.

Production financial side effects SHALL never be required for routine automated tests.

---

# 102. Secrets

Payment secrets SHALL be retrieved through an approved secrets-management mechanism.

They SHALL NOT be:

```text
committed to Git
embedded in Docker images
published in events
written to logs
stored in frontend configuration
```

---

# 103. PCI Scope

Baobab SHOULD minimise direct handling of sensitive cardholder data.

Hosted/tokenized provider mechanisms SHOULD be preferred where suitable.

---

# 104. PAN

Primary Account Numbers SHALL NOT be included in:

- canonical events;
- application logs;
- analytics;
- traces;
- ordinary Baobab persistence.

---

# 105. CVV

CVV/security-code values SHALL NEVER be persisted by Baobab.

---

# 106. Payment Token

Provider tokens MAY be stored where permitted and necessary.

They SHALL be treated as sensitive credentials and scoped appropriately.

---

# 107. Stored Payment Methods

Future stored-payment-method support SHALL use provider tokenization.

Baobab SHALL not create its own card vault without a separately approved architecture.

---

# 108. Customer Payment Identity

A provider-specific Customer ID SHALL remain an ExternalReference.

It SHALL NOT become the canonical Baobab customer identity.

---

# 109. Webhook Endpoint Isolation

Each provider integration SHOULD have a clearly scoped webhook endpoint.

Routing SHALL identify:

```text
provider
environment
merchant configuration
```

without trusting arbitrary client input.

---

# 110. Signature Failure

Webhook signature verification failure SHALL result in rejection before material state mutation.

---

# 111. Webhook Logging

Webhook logs SHALL avoid persisting sensitive provider payload fields unnecessarily.

---

# 112. Audit

Material payment operations SHALL be auditable.

Relevant actions include:

```text
manual capture
manual refund
void
provider configuration change
merchant-account change
reconciliation override
```

---

# 113. Administrative Authorization

Commerce administrators SHALL NOT automatically receive unrestricted financial-operation authority.

Roles SHOULD distinguish:

```text
commerce administration
payment operations
refund authority
financial reconciliation
```

---

# 114. Refund Approval

High-value refunds MAY require additional approval according to business policy.

---

# 115. Manual Capture

Manual capture SHALL require explicit authorization and audit.

---

# 116. Manual Payment-State Mutation

Administrators SHALL NOT arbitrarily mark a Payment successful merely to clear an operational problem.

Any override mechanism MUST:

- be exceptional;
- record evidence;
- identify actor;
- identify reason;
- remain reconcilable.

---

# 117. Provider Configuration Changes

Changes to:

```text
provider
merchant account
currency
capture policy
```

SHALL be governed configuration changes.

They SHOULD be versioned/audited.

---

# 118. Active Transaction Stability

Changing provider configuration SHALL NOT make existing Payment records uninterpretable.

Existing transactions SHALL retain provider references necessary for lifecycle operations.

---

# 119. Merchant Account Rotation

Merchant-account credential rotation SHALL not alter historical Payment identity.

---

# 120. Provider Migration

Migrating from Provider A to Provider B SHALL distinguish:

```text
new transactions
```

from:

```text
existing transactions still requiring refunds/disputes
```

Provider A integration MAY need to remain operational for historical lifecycle operations after new payments move to Provider B.

---

# 121. Multi-Provider History

An Order may contain payment history across provider configurations.

The system SHALL preserve the actual provider for each transaction.

---

# 122. Regional Payment Providers

Baobab SHALL support region-specific providers without introducing region-specific forks in Commerce core.

For example:

```text
Market configuration
      │
      ▼
Payment eligibility
      │
      ▼
Provider adapter
```

rather than:

```text
if country == X:
    custom checkout implementation
```

---

# 123. Mobile Money

Mobile-money providers MAY be introduced through the same provider abstraction.

Their asynchronous semantics SHALL be respected rather than forced into card-specific assumptions.

---

# 124. Bank Transfer

Bank-transfer methods MAY require asynchronous confirmation.

An Order MAY enter an awaiting-payment state according to Market policy.

---

# 125. Cash on Delivery

Cash-on-delivery MAY be supported where commercially appropriate.

It SHALL not be represented as captured online Payment.

---

# 126. Alternative Payments

Future:

```text
wallet
real-time bank payment
voucher
store credit
gift card
```

SHALL preserve explicit funding-source semantics.

---

# 127. Split Payment

Future split-tender scenarios MAY allow an Order to be funded by more than one Payment.

The architecture SHALL therefore avoid assuming:

```text
one Order == one Payment
```

---

# 128. Marketplace Split Settlement

If Baobab later supports marketplace commerce, split settlement between multiple beneficiaries SHALL require a separate ADR.

The current ADR SHALL NOT silently introduce marketplace payment semantics.

---

# 129. Foreign Exchange

If a Payment Provider performs currency conversion, the provider-side converted amount SHALL remain distinct from the Commerce transaction currency.

---

# 130. Transaction Currency

The Commerce Order's committed currency SHALL remain immutable.

Settlement in another currency SHALL not rewrite the Order currency.

---

# 131. FX Reconciliation

Where settlement currency differs, reconciliation SHOULD preserve:

```text
transaction amount
transaction currency
settlement amount
settlement currency
exchange rate/reference
fees
```

where data is available.

---

# 132. Event Taxonomy

Initial canonical payment events SHOULD include:

```text
commerce.payment.authorized
commerce.payment.authorization_failed
commerce.payment.captured
commerce.payment.capture_failed
commerce.payment.voided
commerce.payment.refunded
commerce.payment.refund_failed
```

Additional events MAY include:

```text
commerce.payment.settled
commerce.payment.disputed
commerce.payment.chargeback_opened
commerce.payment.chargeback_resolved
```

when those capabilities are implemented.

---

# 133. Event Semantics

Events SHALL describe completed business facts.

For example:

```text
commerce.payment.captured
```

means Commerce has accepted authoritative evidence that capture occurred.

It SHALL not merely mean:

```text
capture request sent
```

---

# 134. Command vs Event

Baobab SHALL distinguish:

```text
CapturePayment
```

from:

```text
commerce.payment.captured
```

The former is intent.

The latter is fact.

---

# 135. Payment Event Payload

A canonical Payment event MAY contain:

```text
canonical_payment_id
canonical_order_id
provider_reference
amount
currency
payment_method_type
status
occurred_at
```

subject to minimisation requirements.

---

# 136. Sensitive Event Data

Payment events SHALL NOT contain:

```text
PAN
CVV
secret key
access token
raw authentication credential
```

---

# 137. ERP Payment Flow

The preferred accounting flow is:

```text
Provider Payment Fact
       │
       ▼
Medusa Payment State
       │
       ▼
Canonical Payment Event
       │
       ▼
ERP Integration
       │
       ▼
iDempiere Financial Record
```

---

# 138. ERP Idempotency

Duplicate Payment events SHALL not produce duplicate receipts/accounting consequences in iDempiere.

---

# 139. ERP Failure

An ERP outage SHALL not alter the provider's financial truth.

Commerce SHALL retain the Payment event and retry ERP propagation.

---

# 140. ERP Rejection

An ERP accounting rejection SHALL enter reconciliation.

It SHALL not cause Commerce to attempt a second customer charge.

---

# 141. No Reverse Financial Side Effect

An accounting integration failure SHALL NEVER automatically cause another provider authorization/capture.

---

# 142. Observability

Payment telemetry SHALL include, as appropriate:

```text
authorization attempts
authorization success rate
authorization latency
capture attempts
capture failures
refund failures
unknown-state count
webhook lag
webhook failures
reconciliation discrepancies
provider availability
```

---

# 143. Metric Labels

Metrics SHALL NOT include:

- PAN;
- customer PII;
- raw provider payload;
- high-cardinality transaction IDs as routine labels.

---

# 144. Correlation

Payment operations SHALL preserve correlation across:

```text
Checkout
   │
   ▼
Medusa Payment
   │
   ▼
Provider
   │
   ▼
Webhook
   │
   ▼
Canonical Event
   │
   ▼
iDempiere
```

---

# 145. Trace Boundary

Distributed tracing SHOULD record provider calls without exposing sensitive payment details.

---

# 146. Health

Payment-provider failure SHOULD be represented as dependency health/degradation rather than necessarily making the entire Commerce Engine unready.

---

# 147. Provider Circuit Breaker

Repeated provider failures SHOULD trigger controlled protection where appropriate.

---

# 148. Timeout

All provider calls SHALL use finite timeouts.

---

# 149. Retry

Retry policy SHALL distinguish:

```text
safe technical retry
idempotent financial retry
ambiguous financial operation
confirmed business decline
```

These SHALL not use one generic retry rule.

---

# 150. Rate Limits

Provider rate limits SHALL be respected.

Reconciliation and retry workers SHALL use bounded concurrency.

---

# 151. Backpressure

Recovery after provider outage SHALL not generate an uncontrolled request surge.

---

# 152. Reconciliation SLO

Production payment profiles SHALL define acceptable time to resolve:

```text
unknown authorization
unknown capture
unknown refund
ERP propagation discrepancy
settlement discrepancy
```

according to financial risk.

---

# 153. Runbooks

Operational runbooks SHALL cover at minimum:

```text
provider outage
unknown payment
duplicate charge suspicion
capture failure
refund failure
webhook outage
webhook signature failure
ERP payment integration failure
settlement mismatch
merchant credential rotation
provider migration
```

---

# 154. Testing

Payment architecture SHALL include:

```text
unit tests
provider-contract tests
integration tests
webhook tests
idempotency tests
security tests
failure-injection tests
reconciliation tests
end-to-end tests
```

---

# 155. Provider Contract Tests

Every Payment Provider adapter SHALL prove:

```text
session creation
authorization
capture
void
refund
status retrieval
webhook handling
error classification
```

where the provider supports those capabilities.

---

# 156. Unknown-Authorization Test

The implementation SHALL simulate:

```text
provider succeeds
response lost
```

and prove no duplicate charge occurs.

---

# 157. Unknown-Capture Test

The implementation SHALL prove ambiguous Capture results are reconciled safely.

---

# 158. Unknown-Refund Test

The implementation SHALL prove ambiguous Refund results do not result in duplicate refunds.

---

# 159. Duplicate Webhook Test

The same provider webhook delivered repeatedly SHALL have one intended business effect.

---

# 160. Out-of-Order Webhook Test

Later provider state SHALL not be incorrectly regressed by an older webhook.

---

# 161. Merchant Isolation Test

A transaction for Legal Seller A SHALL never use Legal Seller B's merchant credentials.

---

# 162. Currency Eligibility Test

Unsupported provider/currency combinations SHALL fail before financial execution.

---

# 163. Amount Tampering Test

Client manipulation of Payment amount SHALL not alter the server-authoritative amount.

---

# 164. Webhook Spoofing Test

Invalid webhook signatures SHALL be rejected.

---

# 165. Provider Outage Test

Failure of Provider A SHALL not unnecessarily disable unrelated Provider B where the Market supports both.

---

# 166. ERP Outage Test

Payment capture SHALL remain durably recorded when iDempiere is unavailable, and ERP propagation SHALL recover without duplicate accounting entries.

---

# 167. Rejected Alternative: Payment Logic in Digital Estates

**Rejected absolutely.**

Digital Estates may participate in provider UI/tokenization but cannot own financial state.

---

# 168. Rejected Alternative: iDempiere as Online Payment Orchestrator

**Rejected for Commerce checkout.**

iDempiere remains financial/accounting authority but SHALL not become a synchronous storefront payment gateway.

---

# 169. Rejected Alternative: One Global Merchant Account

**Rejected as a platform invariant.**

Independent legal sellers and Markets may require independent merchant relationships.

---

# 170. Rejected Alternative: Merchant Account Equals Tenant

**Rejected.**

A tenant may operate several merchant accounts.

A legal seller may use different providers by Market.

These are independent dimensions.

---

# 171. Rejected Alternative: Timeout Means Failure

**Rejected absolutely.**

Distributed financial operations can produce ambiguous outcomes.

---

# 172. Rejected Alternative: Blind Payment Retry

**Rejected.**

A retry without idempotency or reconciliation can double-charge customers.

---

# 173. Rejected Alternative: Browser Redirect as Payment Proof

**Rejected.**

Server-side provider evidence is required.

---

# 174. Rejected Alternative: Webhooks Only

**Rejected.**

Webhooks may be delayed or lost.

Scheduled/API reconciliation SHALL remain possible.

---

# 175. Rejected Alternative: Provider State as ERP Ledger

**Rejected.**

Provider transaction records are not enterprise accounting records.

---

# 176. Rejected Alternative: ERP Failure Recharges Customer

**Rejected absolutely.**

Accounting failure is not evidence that provider payment failed.

---

# 177. Rejected Alternative: Shared Payment Database

**Rejected absolutely.**

Medusa, provider integrations and iDempiere SHALL communicate through contracts.

---

# 178. Rejected Alternative: Provider-Specific Commerce Core

**Rejected.**

Provider behaviour SHALL remain isolated behind adapters/modules.

---

# 179. Consequences

## Positive

This decision provides:

- multiple Payment Providers;
- multiple merchant accounts;
- multi-Market payment routing;
- multi-currency capability;
- legal-seller isolation;
- safe retries;
- payment reconciliation;
- B2B account terms;
- regional provider support;
- provider replacement;
- independent ERP accounting.

## Negative

The architecture must handle:

- ambiguous provider outcomes;
- webhook processing;
- idempotency;
- settlement reconciliation;
- provider-specific edge cases;
- credential governance;
- operational financial discrepancies.

These costs are inherent in production payment processing and are accepted.

---

# 180. Architectural Invariants

**PAY-COM-001**  
Medusa SHALL own Commerce payment orchestration.

**PAY-COM-002**  
Payment Providers SHALL own provider-side execution truth.

**PAY-COM-003**  
iDempiere SHALL own accounting consequences.

**PAY-COM-004**  
Payment SHALL remain distinct from Order.

**PAY-COM-005**  
Authorization SHALL remain distinct from Capture.

**PAY-COM-006**  
Capture SHALL remain distinct from Settlement.

**PAY-COM-007**  
Settlement SHALL remain distinct from Accounting.

**PAY-COM-008**  
Payment Provider SHALL remain distinct from Merchant Account.

**PAY-COM-009**  
Merchant-account selection SHALL respect Legal Seller.

**PAY-COM-010**  
Provider selection SHALL respect Market and Currency.

**PAY-COM-011**  
Client-provided Payment amounts SHALL be untrusted.

**PAY-COM-012**  
Financial operations SHALL use idempotency where available.

**PAY-COM-013**  
Timeout SHALL not automatically mean financial failure.

**PAY-COM-014**  
Ambiguous financial outcomes SHALL be reconciled.

**PAY-COM-015**  
Blind retry of ambiguous non-idempotent financial operations is prohibited.

**PAY-COM-016**  
Provider webhooks SHALL be authenticated where supported.

**PAY-COM-017**  
Webhook consumers SHALL be idempotent.

**PAY-COM-018**  
Webhook delivery order SHALL not be assumed.

**PAY-COM-019**  
Browser redirects SHALL not be authoritative payment proof.

**PAY-COM-020**  
Provider credentials SHALL remain outside source code and frontend applications.

**PAY-COM-021**  
PAN SHALL not be published in canonical events.

**PAY-COM-022**  
CVV SHALL never be persisted.

**PAY-COM-023**  
Refund SHALL remain distinct from Void.

**PAY-COM-024**  
Chargeback SHALL remain distinct from Refund.

**PAY-COM-025**  
Refund processing SHALL be idempotent.

**PAY-COM-026**  
Payment reconciliation SHALL be a production requirement.

**PAY-COM-027**  
ERP accounting failure SHALL never trigger a duplicate customer charge.

**PAY-COM-028**  
Duplicate Payment events SHALL not duplicate ERP financial records.

**PAY-COM-029**  
Provider transaction IDs SHALL remain ExternalReferences.

**PAY-COM-030**  
Provider-specific behaviour SHALL remain behind adapters.

**PAY-COM-031**  
Production and sandbox merchant environments SHALL remain isolated.

**PAY-COM-032**  
Payment events SHALL contain no payment credentials.

**PAY-COM-033**  
Financial administrative operations SHALL be auditable.

**PAY-COM-034**  
One global Merchant Account SHALL not be assumed.

**PAY-COM-035**  
Provider migration SHALL preserve historical lifecycle operations.

**PAY-COM-036**  
B2B account terms SHALL not be represented as captured online Payments.

**PAY-COM-037**  
Payment Provider outages SHALL degrade only applicable capabilities where feasible.

**PAY-COM-038**  
Payment retries SHALL use bounded policies.

**PAY-COM-039**  
All synchronous provider calls SHALL use finite timeouts.

**PAY-COM-040**  
Financial side effects SHALL be reconcilable end-to-end.

---

# 181. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. Legal Seller A uses its authorised merchant account.

2. Legal Seller B cannot use Seller A's merchant credentials.

3. Unsupported Market/provider combination is rejected.

4. Unsupported currency/provider combination is rejected.

5. Client Payment amount manipulation fails.

6. Successful authorization is represented distinctly from Capture.

7. Successful Capture is represented distinctly from Settlement.

8. Provider timeout after successful authorization does not create a duplicate charge.

9. Provider timeout after Capture is safely reconciled.

10. Provider timeout after Refund does not duplicate the Refund.

11. Stable idempotency key is reused during financial retry.

12. Confirmed decline is distinguished from unknown outcome.

13. Duplicate webhook delivery has one intended effect.

14. Out-of-order webhooks do not regress authoritative state.

15. Invalid webhook signature is rejected.

16. Browser success redirect cannot independently mark Payment successful.

17. Customer abandonment after redirect does not prevent provider reconciliation.

18. Payment Provider A outage does not unnecessarily disable Provider B.

19. Provider failover cannot double-charge after an ambiguous Provider A result.

20. Partial Capture preserves correct remaining amount.

21. Duplicate Capture request cannot exceed intended Capture.

22. Void is not represented as Refund.

23. Partial Refund preserves correct remaining captured balance.

24. Duplicate Refund request cannot refund twice.

25. Chargeback is represented independently of Refund.

26. B2B Net-30 Order does not falsely appear as captured card Payment.

27. Captured Payment propagates idempotently to iDempiere.

28. Duplicate Payment event does not duplicate ERP accounting consequence.

29. ERP outage does not lose captured Payment state.

30. ERP rejection does not cause another customer charge.

31. Provider transaction ID is retained as ExternalReference.

32. Production merchant credentials are inaccessible in test environments.

33. PAN is absent from canonical events.

34. CVV is never persisted.

35. Sensitive provider credentials are absent from logs.

36. Manual Refund requires authorised role.

37. Manual Capture is audited.

38. Merchant-account configuration change is auditable.

39. Existing Payments remain operable after provider configuration changes.

40. Historical Provider A Refund remains possible after new transactions migrate to Provider B.

41. Reconciliation detects provider-authorized/local-failed discrepancy.

42. Reconciliation detects local-captured/provider-not-captured discrepancy.

43. Reconciliation detects provider Refund missing locally.

44. Reconciliation detects captured Payment missing in ERP.

45. Settlement reconciliation detects an unmatched provider transaction.
```

---

# 182. Initial Production Profile

The initial Baobab payment architecture SHOULD be:

```text
                       BAOBAB CONTEXT
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
          Legal Seller      Market       Currency
                │             │             │
                └─────────────┼─────────────┘
                              ▼
                       PAYMENT POLICY
                              │
                              ▼
                   MEDUSA PAYMENT MODULE
                              │
                              ▼
                     PROVIDER RESOLUTION
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
              Provider A           Provider B
                    │                   │
                    ▼                   ▼
             Merchant Account     Merchant Account
                    │                   │
                    └─────────┬─────────┘
                              ▼
                      PAYMENT EXECUTION
                              │
                              ▼
                    MEDUSA PAYMENT STATE
                              │
                              ▼
                    CANONICAL PAYMENT EVENT
                              │
                              ▼
                         IDEMPIERE
                    Accounting Consequence
```

---

# 183. Financial Reconciliation Model

Production operation SHALL eventually provide:

```text
                     COMMERCE ORDER
                           │
                           ▼
                     MEDUSA PAYMENT
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
         PAYMENT PROVIDER         IDEMPIERE
                │                     │
                ▼                     ▼
        Provider Transaction     Accounting Record
                │                     │
                └──────────┬──────────┘
                           ▼
                    RECONCILIATION
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
            MATCH       DISCREPANCY    UNKNOWN
                           │
                           ▼
                       RESOLUTION
```

The system SHALL be capable of explaining:

> What did the customer intend to pay?

> What did Commerce believe occurred?

> What did the Payment Provider actually execute?

> What did the provider settle?

> What did iDempiere account for?

Those questions SHALL be answerable independently.

---

# 184. Evolution Path

The architecture SHALL accommodate future:

```text
additional African payment gateways
mobile money
real-time bank payments
wallets
stored payment methods
gift cards
store credit
multiple captures
split tender
multi-currency settlement
fraud services
marketplace payments
```

without replacing the fundamental authority model.

Marketplace payment and split-beneficiary settlement SHALL require a dedicated ADR because they materially change legal and financial boundaries.

---

# 185. Implementation Implications

This ADR requires subsequent specifications for:

```text
Payment Provider port
Medusa provider adapters
PaymentPolicy
provider routing
merchant-account configuration
secret resolution
financial command idempotency
webhook inbox
webhook verification
payment event schemas
refund workflow
capture workflow
unknown-state handling
provider reconciliation
ERP payment integration
settlement reconciliation
payment observability
payment operational runbooks
```

The later TypeScript package/interface specification SHALL define these as explicit ports, adapters and services rather than embedding provider dependencies throughout Commerce domain logic.

---

# 186. Decision Outcome

Baobab adopts:

```text
CUSTOMER
   │
   ▼
DIGITAL ESTATE
   │
   ▼
MEDUSA COMMERCE
   │
   ▼
PAYMENT ORCHESTRATION
   │
   ├──────── Context
   ├──────── Legal Seller
   ├──────── Market
   ├──────── Currency
   └──────── Payment Policy
   │
   ▼
PROVIDER ADAPTER
   │
   ▼
MERCHANT ACCOUNT
   │
   ▼
PAYMENT PROVIDER
   │
   ├── Authorization
   ├── Capture
   ├── Refund
   ├── Webhook
   └── Settlement Evidence
   │
   ▼
COMMERCE PAYMENT STATE
   │
   ▼
CANONICAL PAYMENT EVENTS
   │
   ▼
IDEMPIERE
   │
   ▼
ACCOUNTING
```

The governing rule is:

> **Medusa orchestrates the customer-facing payment lifecycle; the provider executes financial operations; iDempiere records their enterprise financial consequences.**

The isolation rule is:

> **Merchant accounts, credentials and payment capabilities are resolved according to Legal Seller, Market and Currency rather than assumed globally.**

The distributed-systems rule is:

> **A timeout is not proof of failure. Every ambiguous financial outcome must be resolved through idempotency, provider evidence and reconciliation before another irreversible financial action is attempted.**

The security rule is:

> **Baobab shall minimise possession of sensitive payment data and shall never turn Digital Estates, events, logs or analytics systems into payment credential stores.**

The accounting rule is:

> **Accounting failure cannot reverse financial reality. Once a provider-side transaction exists, downstream systems must reconcile to that fact rather than attempting another customer charge.**

And the long-term rule is:

> **Payment providers are replaceable infrastructure dependencies. Provider-specific behaviour shall remain behind explicit adapters so that Baobab's Commerce, Order, Market and canonical identity models remain stable as payment ecosystems evolve across regions.**
