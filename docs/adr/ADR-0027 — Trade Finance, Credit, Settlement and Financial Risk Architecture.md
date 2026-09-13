# ADR-0027 — Trade Finance, Credit, Settlement and Financial Risk Architecture

**Status:** Proposed — Normative Trade Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Primary Repository:** `nabhold/baobab-trade`  
**Canonical Contracts:** `nabhold/shared`  
**Context / Provider Resolution:** `nabhold/baobab-cp`  
**Financial Authority:** `nabhold/baobab-erp`  
**Identity / Authorization:** `nabhold/baobab-iam`  
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model
- ADR-BCP-014 — Canonical Counterparty Identity, Roles and Relationships Model
- ADR-0012 — Pricing, Price Lists, Promotions and B2B Commercial Terms
- ADR-0014 — Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0015 — Payment Orchestration, Provider Isolation and Financial Reconciliation
- ADR-0019 — B2B Procurement and Supplier Commercial Workflow
- ADR-0020 — B2B Landed Cost, Margin and Commercial Price Resolution
- ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture
- ADR-0023 — Supplier Identity, Qualification and Supplier Master Ownership
- ADR-0025 — Trade Documents, Evidence, Provenance and Document Lifecycle
- ADR-0026 — Incoterms, Delivery Obligations, Risk Transfer and Title Transfer

---

# 1. Context

B2B commerce cannot be modelled adequately as:

```text
Order
  ↓
Card Payment
  ↓
Paid
```

ZuriBeans and future Baobab tenants may transact using:

```text
prepayment
deposit
cash against documents
open account
Net 7
Net 30
Net 60
bank transfer
documentary collection
letter of credit
bank guarantee
standby letter of credit
trade-credit insurance
supplier credit
intercompany settlement
```

A single transaction may involve:

```text
commercial agreement
credit decision
payment terms
credit limit
invoice
partial payment
financial instrument
shipment milestone
documentary condition
settlement
FX exposure
financial reconciliation
```

The architecture therefore requires a formal boundary between:

```text
Trade
ERP
Payment Providers
Banks
Trade-Finance Providers
Credit Providers
Insurers
```

---

# 2. Decision

Baobab SHALL implement a **provider-neutral trade-finance and commercial-credit orchestration architecture**.

The governing principle is:

> **Trade owns commercial credit terms, credit-use orchestration, trade-finance workflow and transaction-level settlement state; ERP owns authoritative receivables, payables, accounting balances and financial posting; regulated financial institutions and payment providers own regulated financial instruments and movement of money.**

Baobab SHALL NOT become:

```text
a bank
a lender
an insurer
a payment institution
```

merely by orchestrating those capabilities.

---

# 3. Fundamental Separation

Baobab SHALL distinguish:

```text
Commercial Terms
≠
Credit Policy
≠
Credit Limit
≠
Credit Exposure
≠
Financial Instrument
≠
Payment
≠
Settlement
≠
Accounts Receivable
≠
Accounts Payable
≠
Cash
≠
Accounting Recognition
```

---

# 4. Core Architecture

```text
B2B COMMERCIAL TRANSACTION
           │
           ▼
     PAYMENT TERMS
           │
     ┌─────┴─────┐
     ▼           ▼
PREPAYMENT     CREDIT
                 │
                 ▼
          CREDIT DECISION
                 │
                 ▼
          CREDIT RESERVATION
                 │
                 ▼
               ORDER
                 │
                 ▼
              INVOICE
                 │
                 ▼
           AR / SETTLEMENT
                 │
          ┌──────┼──────┐
          ▼      ▼      ▼
       Payment   Bank   Finance
       Provider        Provider
                 │
                 ▼
                ERP
```

---

# 5. Commercial Credit Is Not Lending by Default

Baobab SHALL distinguish normal trade credit from regulated lending.

Example:

```text
Seller gives Buyer 30 days to pay
```

may represent ordinary B2B commercial credit.

It SHALL NOT automatically be modelled as:

```text
Loan
```

---

# 6. Payment Terms

Trade SHALL support structured payment terms.

Conceptually:

```text
PaymentTerms
├── type
├── due_period
├── deposit_requirement?
├── milestone_schedule?
├── currency
├── early_payment_discount?
├── late_payment_policy?
└── conditions
```

---

# 7. Initial Payment-Term Types

Baobab SHOULD support:

```text
PREPAYMENT
PAY_ON_ORDER
DEPOSIT_PLUS_BALANCE
PAY_BEFORE_SHIPMENT
PAY_ON_SHIPMENT
PAY_ON_DELIVERY
OPEN_ACCOUNT
NET_DAYS
DOCUMENTARY_COLLECTION
LETTER_OF_CREDIT
CUSTOM
```

---

# 8. Net Terms

For example:

```text
NET_30
```

SHALL be represented as structured terms rather than hard-coded string behaviour.

---

# 9. Due-Date Calculation

Due dates SHALL derive from explicit policy.

Possible anchors:

```text
invoice date
shipment date
delivery date
acceptance date
month end
custom milestone
```

---

# 10. Payment Terms ≠ Settlement Method

This distinction is mandatory.

Example:

```text
Payment Terms = NET_30
Settlement Method = BANK_TRANSFER
```

---

# 11. Payment Terms ≠ Financial Instrument

Likewise:

```text
Payment Terms = PAY_BEFORE_SHIPMENT
Financial Instrument = LETTER_OF_CREDIT
```

MAY coexist.

---

# 12. Customer Credit Profile

Trade MAY maintain a commercial credit projection.

Conceptually:

```text
CustomerCreditProfile
├── customer_organisation_id
├── tenant_id
├── legal_entity_id
├── credit_policy_id
├── credit_limit
├── currency
├── available_credit
├── exposure
├── risk_class
├── valid_from
├── valid_to?
└── status
```

---

# 13. Credit Profile Is Tenant-Specific

The same canonical customer MAY have:

```text
ZuriBeans Credit Limit = X

Thamani Credit Limit = Y
```

The two SHALL remain independent.

---

# 14. Credit May Be Legal-Entity Scoped

Where necessary:

```text
credit granted by Legal Entity A
```

does not automatically mean:

```text
credit available from Legal Entity B.
```

---

# 15. Credit Limit

Credit limit SHALL represent maximum approved commercial exposure under a policy.

It SHALL NOT be inferred from historical order volume.

---

# 16. Credit Exposure

Conceptually:

```text
Exposure
=
Outstanding Receivables
+
Committed Uninvoiced Exposure
+
Reserved Credit
+
Other Defined Exposure
-
Eligible Security / Adjustments
```

Exact formula SHALL be policy-defined.

---

# 17. Exposure Authority

ERP SHALL remain authoritative for actual financial receivables and posted balances.

Trade MAY maintain near-real-time projections for decisioning.

---

# 18. Trade SHALL NOT Create a Shadow Ledger

Trade SHALL NOT become the authoritative accounting ledger for:

```text
AR
AP
cash
GL
```

---

# 19. Credit Projection

Trade SHALL consume ERP/financial projections such as:

```text
outstanding AR
overdue AR
unapplied payments
credit balance
customer exposure
```

through canonical integration contracts.

---

# 20. Credit Reservation

To avoid race conditions, credit SHALL support reservations.

Conceptually:

```text
CreditReservation
├── customer
├── transaction
├── amount
├── currency
├── status
├── expires_at?
└── idempotency_key
```

---

# 21. Reservation Flow

```text
Quote / Order
     ↓
Credit Check
     ↓
Credit Reservation
     ↓
Order Commitment
     ↓
Invoice / Exposure
     ↓
Reservation Converted / Released
```

---

# 22. Credit Reservation Is Not AR

Reserved credit SHALL NOT be treated as an invoice or receivable.

---

# 23. Reservation Expiry

Stale reservations SHALL expire/release according to policy.

---

# 24. Concurrent Orders

Baobab SHALL prevent:

```text
Order A
+
Order B
```

from independently consuming the same remaining credit.

---

# 25. Credit Decision

A credit decision SHALL be explicit.

Conceptually:

```text
CreditDecision
├── customer
├── requested_exposure
├── currency
├── decision
├── approved_amount?
├── reason_codes[]
├── policy
├── decided_by
├── valid_until?
└── evidence[]
```

---

# 26. Decision States

Suggested:

```text
APPROVED
APPROVED_WITH_CONDITIONS
DECLINED
REVIEW_REQUIRED
EXPIRED
REVOKED
ERROR
```

---

# 27. Credit Decision Sources

Decisioning MAY be provided by:

```text
internal policy
authorised finance reviewer
credit bureau
trade-credit insurer
external scoring provider
bank
other credit provider
```

---

# 28. Automated Scoring

Automated scoring MAY recommend:

```text
limit
risk class
payment terms
```

but SHALL not silently override mandatory approval policy.

---

# 29. Credit Bureau Data

Credit bureau information SHALL be provider-specific and privacy-controlled.

Baobab SHALL not treat raw bureau data as universally shareable canonical data.

---

# 30. Risk Classification

Trade MAY support internal classes such as:

```text
LOW
MODERATE
HIGH
RESTRICTED
```

but SHALL preserve source and policy.

---

# 31. Risk Class ≠ Credit Limit

A risk class MAY inform a limit.

It SHALL not be used as a substitute for explicit approved terms.

---

# 32. Credit Policy

Conceptually:

```text
CreditPolicy
├── tenant
├── legal_entity?
├── market?
├── customer_segment?
├── exposure_rules
├── approval_thresholds
├── overdue_rules
├── security_rules
├── override_rules
└── effective_period
```

---

# 33. Credit Policy Shall Be Effective-Dated

Historical orders SHALL remain explainable under the policy in effect when they were approved.

---

# 34. Credit Override

A credit override SHALL require:

```text
authorised actor
reason
amount
scope
expiry
audit
```

---

# 35. No Silent Limit Override

An order exceeding credit SHALL not simply proceed because:

```text
customer is strategic
```

without governed approval.

---

# 36. Separation of Duties

High-risk overrides SHOULD enforce:

```text
requester
≠
approver
```

---

# 37. Overdue Policy

Credit decisions MAY consume:

```text
days past due
overdue amount
number of overdue invoices
disputed receivables
```

---

# 38. Overdue Account

Policy MAY:

```text
WARN
REQUIRE_APPROVAL
REDUCE_AVAILABLE_CREDIT
BLOCK_NEW_ORDERS
```

---

# 39. Disputed Invoice

A disputed receivable SHOULD be distinguishable from an undisputed overdue receivable.

---

# 40. Credit Exposure Currency

Credit exposure SHALL be currency-aware.

---

# 41. Multi-Currency Credit

Baobab SHALL support:

```text
Credit Limit Currency
Transaction Currency
ERP Functional Currency
Settlement Currency
```

as distinct concepts.

---

# 42. FX Conversion

Where exposure spans currencies, conversion SHALL use an explicit:

```text
FX source
rate type
effective date
rate
```

---

# 43. FX Buffer

Policy MAY apply a risk buffer when reserving cross-currency credit.

---

# 44. FX Exposure

Baobab MAY track commercial FX exposure.

It SHALL NOT become a treasury trading engine in Release 1.

---

# 45. Prepayment

Prepayment SHALL support:

```text
full prepayment
deposit
milestone prepayment
```

---

# 46. Deposit

Conceptually:

```text
DepositRequirement
├── percentage?
├── fixed_amount?
├── currency
├── due_event
└── release_condition
```

---

# 47. Deposit ≠ Revenue

Receipt of a deposit SHALL NOT automatically be interpreted by Trade as revenue.

ERP/accounting policy determines financial treatment.

---

# 48. Deposit Gate

Policy MAY require:

```text
deposit received
```

before:

```text
procurement
allocation
production
shipment
```

---

# 49. Payment Status

Trade MAY project transaction payment state.

Suggested:

```text
NOT_REQUIRED
PENDING
PARTIALLY_PAID
PAID
OVERPAID
FAILED
REFUNDED
PARTIALLY_REFUNDED
DISPUTED
```

---

# 50. Payment State ≠ Settlement Finality

A provider reporting successful initiation does not necessarily mean final settlement.

---

# 51. Settlement

Settlement SHALL represent completion of financial obligation according to authoritative provider/ERP state.

Conceptually:

```text
Settlement
├── transaction
├── amount
├── currency
├── method
├── provider
├── provider_reference
├── settlement_status
├── initiated_at
├── settled_at?
└── reconciliation_status
```

---

# 52. Settlement States

Suggested:

```text
PENDING
PROCESSING
SETTLED
PARTIALLY_SETTLED
FAILED
REVERSED
DISPUTED
UNKNOWN
```

---

# 53. Provider Success ≠ ERP Reconciliation

This invariant is mandatory:

```text
Payment Provider = SETTLED
```

does not mean:

```text
ERP = RECONCILED
```

until matching succeeds.

---

# 54. ADR-0015 Remains Authoritative

ADR-0015 governs payment-provider orchestration and financial reconciliation.

ADR-0027 extends that architecture into B2B:

```text
credit
trade-finance instruments
payment terms
settlement conditions
```

---

# 55. Bank Transfer

Bank transfer SHALL be treated as one settlement method, not special-cased as the financial architecture.

---

# 56. Manual Bank Confirmation

Manual confirmation MAY exist where automated feeds are unavailable.

It SHALL be:

```text
structured
authorised
evidence-backed
audited
```

---

# 57. Cash Against Documents

Baobab SHALL be able to model documentary conditions without pretending to be the bank executing them.

---

# 58. Documentary Collection

Conceptually:

```text
Commercial Transaction
       ↓
Document Package
       ↓
Bank / Finance Provider
       ↓
Documentary Collection
       ↓
Collection Status
       ↓
Settlement
```

---

# 59. Letter of Credit

Baobab SHALL support an external Letter of Credit as a referenced financial instrument.

Conceptually:

```text
TradeFinanceInstrument
├── instrument_type = LETTER_OF_CREDIT
├── issuing_bank
├── advising_bank?
├── beneficiary
├── applicant
├── amount
├── currency
├── expiry
├── terms_reference
├── provider_reference
├── status
└── document_requirements[]
```

---

# 60. Baobab Does Not Issue Letters of Credit

The issuing financial institution remains authoritative.

Baobab orchestrates:

```text
reference
status
conditions
documents
workflow
```

---

# 61. Financial Instrument Types

The model SHOULD support extensibility for:

```text
LETTER_OF_CREDIT
STANDBY_LETTER_OF_CREDIT
BANK_GUARANTEE
DOCUMENTARY_COLLECTION
TRADE_CREDIT_INSURANCE
FACTORING
RECEIVABLE_FINANCE
SUPPLY_CHAIN_FINANCE
OTHER
```

Release 1 need not implement every type.

---

# 62. Instrument Provider

Provider SHALL use capability/provider abstraction.

Potential capabilities:

```text
trade-finance.instrument.issue
trade-finance.instrument.verify
trade-finance.instrument.status
trade-finance.document-present
trade-finance.claim
```

---

# 63. Regulated Provider Boundary

Where a financial service requires regulated authorization, Baobab SHALL delegate the regulated function to an authorised provider.

---

# 64. Bank Identity

Banks and finance institutions SHALL use canonical counterparty identity where appropriate.

---

# 65. Financial Instrument ≠ Payment

An LC, guarantee or insurance policy is not itself equivalent to settled cash.

---

# 66. Instrument Status

Suggested generic states:

```text
DRAFT
REQUESTED
ISSUED
ADVISED
ACTIVE
AMENDMENT_PENDING
AMENDED
DOCUMENTS_PRESENTED
COMPLIANT
DISCREPANT
DRAWN
PARTIALLY_DRAWN
EXPIRED
CANCELLED
CLOSED
CLAIMED
```

Provider-specific states SHALL map into canonical states.

---

# 67. Instrument Terms

Baobab SHALL retain a canonical summary sufficient for orchestration.

It SHALL NOT attempt to reinterpret complex banking terms beyond supported capability.

---

# 68. Instrument Documents

ADR-0025 SHALL own document/evidence handling for:

```text
LC copy
guarantee
bank advice
document presentation
discrepancy notice
insurance certificate
claim evidence
```

---

# 69. Documentary Conditions

Financial instruments MAY require documents such as:

```text
commercial invoice
bill of lading
certificate of origin
inspection certificate
insurance certificate
```

Baobab SHALL link these to canonical TradeDocuments.

---

# 70. Document Compliance ≠ Regulatory Compliance

A document package satisfying an LC does not necessarily mean:

```text
customs compliant
product legally eligible
```

These remain separate.

---

# 71. Discrepancy

Baobab SHALL support documentary discrepancy.

Conceptually:

```text
TradeFinanceDiscrepancy
├── instrument
├── document
├── discrepancy_type
├── status
├── raised_by
├── resolution
└── timestamps
```

---

# 72. Discrepancy State

Suggested:

```text
OPEN
ACCEPTED
WAIVED
CORRECTED
REJECTED
CLOSED
```

---

# 73. Buyer Waiver

Buyer waiver of a documentary discrepancy SHALL require appropriate authorization and SHALL not override regulatory illegality.

---

# 74. Bank Guarantee

A guarantee MAY secure:

```text
payment
performance
advance payment
other contractual obligation
```

The protected obligation SHALL be explicit.

---

# 75. Guarantee Is Not Credit Limit

A guarantee MAY affect credit policy but SHALL not replace the customer credit profile.

---

# 76. Credit Insurance

Trade-credit insurance MAY influence:

```text
eligible exposure
credit limit
loss protection
```

according to policy.

---

# 77. Insurance Authority

Insurer/provider remains authoritative for:

```text
policy
coverage
claim
limit
```

---

# 78. Insured Limit vs Internal Limit

Baobab SHALL distinguish:

```text
Internal Credit Limit
Insured Credit Limit
```

The lower/effective amount MAY be derived according to policy.

---

# 79. Factoring

Future factoring support SHALL treat transfer/financing of receivables separately from ordinary payment.

---

# 80. Receivable Ownership

If receivables are legally assigned, ERP/accounting and financial-provider integration SHALL remain authoritative.

Trade SHALL only orchestrate required state.

---

# 81. Supplier Finance

Future supply-chain financing MAY involve:

```text
buyer
supplier
finance provider
approved invoice
early payment
```

without changing canonical procurement ownership.

---

# 82. Supplier Payment

ERP owns AP and supplier payment obligations.

Trade MAY display/projection-status where supplier-facing workflows require it.

---

# 83. Customer Receivable

ERP owns AR.

Trade consumes projection for:

```text
credit exposure
payment visibility
commercial workflow
```

---

# 84. Invoice Is Financial Authority

An order alone SHALL NOT be treated as the authoritative receivable.

---

# 85. Committed Uninvoiced Exposure

Trade MAY include committed orders in credit exposure before invoice posting.

That SHALL remain a commercial exposure concept, not AR.

---

# 86. Order Commitment Gate

Before committing an open-account order:

```text
Customer Identity
+
Commercial Terms
+
Credit Decision
+
Available Credit
+
Compliance
+
Product Eligibility
        ↓
ORDER COMMITMENT
```

---

# 87. Insufficient Credit

Expected outcome:

```text
BLOCK
REQUIRE_PREPAYMENT
REQUIRE_ADDITIONAL_SECURITY
REQUIRE_APPROVAL
```

depending on policy.

---

# 88. Dynamic Terms

Baobab MAY allow credit decision to change offered payment terms.

Example:

```text
Low Risk → NET_30

Higher Risk → 50% Deposit + Balance Before Shipment
```

---

# 89. Pricing and Credit

Payment terms MAY affect pricing.

Examples:

```text
early-payment discount
financing cost
credit-risk premium
```

ADR-0020 SHALL consume approved commercial consequences where configured.

---

# 90. No Hidden Finance Charge

Any financing/credit charge SHALL be explicit, lawful and separately represented from product price where required.

---

# 91. Late Payment

Late-payment policy MAY support:

```text
grace period
interest
fee
credit hold
collection escalation
```

subject to legal/policy configuration.

---

# 92. Legal Constraints

Baobab SHALL NOT assume that late fees or interest are universally enforceable.

Jurisdiction-specific policy/provider configuration SHALL govern.

---

# 93. Collections

Collections workflow MAY support:

```text
reminder
dunning
account hold
manual escalation
external collection provider
```

---

# 94. ERP Owns Authoritative Aging

Trade SHALL not independently calculate authoritative financial aging when ERP provides it.

---

# 95. Dunning Projection

Trade MAY expose customer-facing reminders using ERP-derived aging.

---

# 96. Payment Allocation

ERP SHALL remain authoritative for allocation of received money to invoices.

---

# 97. Partial Payment

Baobab SHALL support:

```text
invoice = 100
payment = 60
outstanding = 40
```

without treating the transaction as fully settled.

---

# 98. Overpayment

Overpayment SHALL remain visible as a financial state requiring ERP treatment.

---

# 99. Payment Reversal

A previously paid transaction MAY return to:

```text
PARTIALLY_PAID
UNPAID
DISPUTED
```

after reversal.

---

# 100. Payment Finality

Provider-specific finality SHALL be normalized into canonical settlement semantics.

---

# 101. Reconciliation

Baobab SHALL reconcile:

```text
Trade Order
↕
ERP Invoice

Payment Provider
↕
ERP Payment

Bank Settlement
↕
ERP Cash / Payment

Credit Reservation
↕
Committed Exposure

Financial Instrument
↕
Covered Transaction
```

---

# 102. Reconciliation States

Suggested:

```text
MATCHED
PENDING
PARTIAL
MISMATCH
MISSING
DUPLICATE
DISPUTED
UNRESOLVED
```

---

# 103. No Distributed Transaction

Order, payment, credit and ERP SHALL NOT require a distributed database transaction.

Use:

```text
idempotency
outbox
inbox
saga/orchestration
reconciliation
```

---

# 104. Credit Saga

Conceptually:

```text
Order Requested
      ↓
Credit Reserved
      ↓
Order Commit Requested
      ↓
ERP Commit Succeeds
      ↓
Credit Reservation Converted
```

Failure:

```text
ERP Commit Fails
      ↓
Credit Reservation Released
```

---

# 105. Payment Saga

Conceptually:

```text
Payment Initiated
      ↓
Provider Status
      ↓
Settlement
      ↓
ERP Payment Posting
      ↓
Reconciliation
```

---

# 106. Shipment Gate

Commercial policy MAY require:

```text
payment received
deposit received
credit valid
LC active
documents accepted
```

before shipment.

---

# 107. Shipment Gate ≠ Logistics State

A shipment physically prepared does not mean finance clearance has passed.

---

# 108. Financial Clearance

Trade MAY expose:

```text
FinancialClearance
├── transaction
├── payment_terms_satisfied
├── credit_satisfied
├── instrument_satisfied
├── overdue_policy_satisfied
└── status
```

---

# 109. Clearance States

Suggested:

```text
NOT_REQUIRED
PENDING
CLEARED
CLEARED_WITH_CONDITIONS
BLOCKED
REVIEW_REQUIRED
```

---

# 110. Financial Clearance Is a Projection

It is derived from authoritative underlying states.

---

# 111. Incoterms Independence

ADR-0026 remains authoritative for:

```text
delivery
cost allocation
risk transfer
```

Incoterm SHALL NOT determine payment terms or credit.

---

# 112. Title vs Finance

Title MAY be contractually tied to payment.

If so:

```text
Payment Event
       ↓
Title Policy
       ↓
Title Transfer
```

ADR-0026 remains the title authority.

---

# 113. Retention of Title

If contract includes retention-of-title provisions, they SHALL be modelled as title policy and evidence—not assumed from unpaid status.

---

# 114. Unpaid Does Not Always Mean Seller Owns Goods

Explicit invariant.

---

# 115. Paid Does Not Always Mean Title Has Transferred

Also explicit.

---

# 116. Trade Documents Integration

ADR-0025 SHALL store/reference:

```text
credit approvals
financial instrument documents
bank advices
guarantees
insurance evidence
settlement evidence
discrepancy notices
```

---

# 117. Compliance

Financial providers/counterparties MAY require screening.

ADR-0021 remains authoritative for relevant compliance provider architecture.

---

# 118. AML/KYC Boundary

Where AML/KYC obligations are imposed by a regulated financial provider:

```text
provider owns regulated determination
Baobab orchestrates status/reference
```

unless Baobab itself becomes legally responsible in a particular regulated activity.

---

# 119. PCI / Sensitive Payment Data

Baobab SHALL minimize storage of sensitive payment credentials and delegate them to approved providers where applicable.

---

# 120. Bank Account Changes

Supplier/customer settlement bank changes SHALL follow the controlled master-data principles established in ADR-0023.

---

# 121. Fraud Controls

Financial workflows SHOULD support:

```text
maker-checker
MFA
transaction limits
approval thresholds
anomaly detection
bank-detail verification
```

---

# 122. Manual Financial Actions

Manual actions SHALL require:

```text
authorised role
reason
evidence
audit
```

---

# 123. IAM Roles

Potential internal roles:

```text
CREDIT_ANALYST
CREDIT_APPROVER
FINANCE_OPERATOR
FINANCE_APPROVER
TREASURY_VIEWER
COLLECTIONS_OPERATOR
TRADE_FINANCE_OPERATOR
TRADE_FINANCE_APPROVER
```

---

# 124. Supplier / Buyer IAM

External users SHALL not gain internal credit-decision privileges.

---

# 125. Approval Thresholds

Approval authority MAY vary by:

```text
amount
currency
market
legal entity
risk class
instrument type
```

---

# 126. Audit

Audit SHALL include:

```text
credit-limit creation/change
credit decision
credit override
credit reservation
payment-term change
financial-instrument lifecycle
documentary discrepancy
manual settlement confirmation
payment reversal
financial clearance
```

---

# 127. Financial Data Classification

Credit and settlement data SHOULD generally be:

```text
CONFIDENTIAL
or
RESTRICTED
```

under the platform classification taxonomy.

---

# 128. Tenant Isolation

ZuriBeans financial exposure SHALL NEVER be visible to Thamani merely because they share Baobab infrastructure.

---

# 129. Buyer Isolation

Buyer A SHALL NOT see:

```text
Buyer B credit limit
Buyer B overdue balance
Buyer B payment history
```

---

# 130. Legal-Entity Isolation

Where financially required, accounts SHALL be restricted by legal-entity authority.

---

# 131. Intercompany Trade

Intercompany trading MAY use:

```text
internal credit
intercompany terms
due-to / due-from
netting
settlement
```

ADR-BCP-012 remains authoritative for relationship classification.

---

# 132. Intercompany Credit Is Explicit

Related-party status SHALL NOT imply:

```text
unlimited credit
```

---

# 133. Intercompany Settlement

ERP owns:

```text
intercompany receivable
intercompany payable
due-to
due-from
GL
```

---

# 134. Netting

Future intercompany netting MAY be supported.

Release 1 SHOULD NOT require a full treasury netting engine.

---

# 135. Inter-Branch Movement

Same-entity internal stock transfer SHALL NOT manufacture external AR/AP merely to fit a trade-finance workflow.

---

# 136. Transaction Classification

Financial treatment SHALL follow:

```text
LOCAL_EXTERNAL
CROSS_BORDER_EXTERNAL
INTERCOMPANY
INTER_BRANCH
```

or corresponding canonical transaction classification.

---

# 137. Credit Provider Abstraction

Potential capabilities:

```text
credit.score
credit.limit-recommend
credit.verify
credit.monitor
credit.insure
```

---

# 138. Payment Provider Abstraction

ADR-0015 remains authoritative.

---

# 139. Trade-Finance Provider Abstraction

Potential capabilities:

```text
trade-finance.instrument-request
trade-finance.instrument-status
trade-finance.document-present
trade-finance.discrepancy
trade-finance.draw
trade-finance.claim
```

---

# 140. Multiple Providers

A tenant MAY use:

```text
Bank A for Uganda
Bank B for South Africa
Insurer C for credit insurance
Payment Provider D for collections
```

without changing core Trade logic.

---

# 141. Provider Resolution

CP SHALL resolve providers by:

```text
tenant
legal entity
market
capability
currency
transaction context
```

where appropriate.

---

# 142. No Provider

If a mandatory financial capability has no configured provider:

```text
NOT_READY
```

Baobab SHALL not fake support.

---

# 143. Provider Failure

Provider outage SHALL produce:

```text
PENDING
ERROR
REVIEW_REQUIRED
```

as policy dictates.

It SHALL NOT result in false financial clearance.

---

# 144. Manual Provider

A structured manual workflow MAY satisfy some capabilities during early rollout.

It SHALL remain:

```text
explicit
audited
evidence-backed
role-controlled
```

---

# 145. Events

Canonical events SHOULD include:

```text
credit-profile.created
credit-limit.changed
credit-decision.completed
credit-reservation.created
credit-reservation.released
credit-reservation.converted

payment-terms.committed

financial-clearance.updated

trade-finance.instrument-created
trade-finance.instrument-issued
trade-finance.instrument-amended
trade-finance.instrument-expired
trade-finance.instrument-drawn
trade-finance.discrepancy-raised
trade-finance.discrepancy-resolved

settlement.pending
settlement.completed
settlement.failed
settlement.reversed

financial-reconciliation.mismatch
```

---

# 146. Event Envelope

Events SHALL include:

```text
tenant_id
legal_entity_id
counterparty_id
transaction_id
invoice_id?
instrument_id?
amount?
currency?
correlation_id
causation_id
schema_version
occurred_at
```

---

# 147. Idempotency

Repeated financial events SHALL NOT:

```text
reserve credit twice
post payment twice
release exposure twice
draw instrument twice
```

---

# 148. Out-of-Order Events

Consumers SHALL tolerate:

```text
late settlement callbacks
ERP posting after provider settlement
reversal after reconciliation
```

without corrupting final state.

---

# 149. Observability

Recommended metrics:

```text
credit_check_total
credit_declined_total
credit_review_required_total

credit_reserved_amount
credit_exposure_amount
overdue_exposure_amount

financial_clearance_blocked_total

settlement_pending_total
settlement_failed_total
settlement_reconciliation_mismatch_total

trade_finance_instrument_active_total
trade_finance_discrepancy_total

provider_error_total
provider_latency
```

---

# 150. Alerts

Alert on:

- credit exposure above approved limit;
- stale credit reservations;
- large overdue exposure;
- failed settlement;
- unmatched payment;
- payment reversal;
- expiring LC/guarantee;
- unresolved documentary discrepancy;
- shipment approaching without financial clearance;
- provider outage;
- cross-system financial mismatch.

---

# 151. Scenario — ZuriBeans Local B2B Open Account

```text
Buyer
  ↓
NET_30 Requested
  ↓
Credit Check
  ↓
Credit Reservation
  ↓
Order
  ↓
ERP Invoice
  ↓
AR
  ↓
Bank Payment
  ↓
ERP Allocation
  ↓
Settlement Reconciliation
```

---

# 152. Scenario — Prepayment

```text
Order
  ↓
Prepayment Required
  ↓
Payment Provider / Bank
  ↓
Settlement
  ↓
ERP Posting
  ↓
Financial Clearance
  ↓
Shipment Released
```

---

# 153. Scenario — Deposit Plus Balance

Example:

```text
30% deposit
70% before shipment
```

Each milestone SHALL be independently tracked.

---

# 154. Scenario — Letter of Credit

```text
Commercial Contract
      ↓
LC Required
      ↓
Bank Issues LC
      ↓
Instrument ACTIVE
      ↓
Shipment
      ↓
Trade Documents
      ↓
Document Presentation
      ↓
Compliant / Discrepant
      ↓
Draw / Settlement
      ↓
ERP Reconciliation
```

---

# 155. Scenario — Documentary Discrepancy

Incorrect/missing document:

```text
Documents Presented
      ↓
DISCREPANT
      ↓
Correction / Waiver / Rejection
```

The order SHALL not be falsely marked financially complete.

---

# 156. Scenario — Bank Guarantee

Customer credit policy requires guarantee.

Guarantee expires before order commitment.

Expected:

```text
Financial Clearance = BLOCKED
```

unless alternate approved security exists.

---

# 157. Scenario — Trade Credit Insurance

Buyer has:

```text
internal limit = 1,000,000
insured limit = 600,000
```

effective exposure policy SHALL be explicitly resolved.

---

# 158. Scenario — Credit Overrun

Available credit:

```text
100,000
```

New order:

```text
125,000
```

Expected:

```text
DECLINE
PARTIAL APPROVAL
PREPAYMENT REQUIREMENT
or APPROVAL WORKFLOW
```

according to policy.

---

# 159. Scenario — Concurrent Orders

Two simultaneous orders try to consume remaining credit.

Credit reservation SHALL prevent double allocation.

---

# 160. Scenario — Overdue Buyer

Buyer exceeds overdue threshold.

Expected:

```text
New Order → BLOCK / REVIEW
```

according to credit policy.

---

# 161. Scenario — Partial Payment

Invoice:

```text
100,000
```

Payment:

```text
60,000
```

State:

```text
PARTIALLY_SETTLED
Outstanding = 40,000
```

---

# 162. Scenario — Payment Reversal

Previously settled bank/payment transaction reverses.

Trade and ERP SHALL re-open appropriate financial state through canonical events/reconciliation.

---

# 163. Scenario — Uganda → South Africa

Cross-border sale MAY combine:

```text
currency conversion
open account
trade-credit insurance
Incoterm obligations
shipment
ERP AR
bank settlement
```

without hard-coded country-specific Trade logic.

---

# 164. Scenario — South Africa → Uganda

Same architecture SHALL work in reverse.

---

# 165. Scenario — Third Market

Future transaction:

```text
Uganda → Kenya
South Africa → Namibia
Uganda → UAE
```

SHALL require provider/configuration changes rather than core Trade rewrites.

---

# 166. Scenario — Intercompany

Related entities MAY transact using:

```text
NET_30
intercompany account
FX
due-to/due-from
```

while ERP maintains authoritative balances.

---

# 167. Scenario — Inter-Branch

Same legal entity movement SHALL NOT create external customer-credit exposure simply because goods cross markets.

---

# 168. Rejected Alternative — Trade Owns AR/AP

Rejected.

ERP owns financial receivables and payables.

---

# 169. Rejected Alternative — ERP Owns All Credit Workflow

Rejected because:

```text
quote-stage credit
customer experience
credit reservation
commercial approval
trade-finance orchestration
```

belong in the commercial workflow.

---

# 170. Rejected Alternative — Payment Success Means Financial Completion

Rejected.

Settlement and reconciliation are separate.

---

# 171. Rejected Alternative — One Payment Model for B2C and B2B

Rejected.

B2B requires:

```text
credit
invoices
terms
partial settlement
documentary finance
bank instruments
```

beyond typical immediate-payment checkout.

---

# 172. Rejected Alternative — Credit Limit Stored Only in Trade

Rejected because exposure requires authoritative ERP balances.

---

# 173. Rejected Alternative — ERP Balance Queried Directly on Every Request

Rejected.

Use canonical integration/projections with freshness controls rather than database coupling.

---

# 174. Rejected Alternative — Financial Instrument Stored as Free Text

Rejected.

LCs, guarantees and similar instruments require structured lifecycle/status/reference.

---

# 175. Rejected Alternative — Baobab Becomes Financial Institution

Rejected.

Baobab orchestrates regulated services through providers.

---

# 176. Rejected Alternative — Unlimited Related-Party Credit

Rejected.

Intercompany terms SHALL remain explicit.

---

# 177. Rejected Alternative — Incoterm Determines Payment

Rejected.

ADR-0026 explicitly separates those concerns.

---

# 178. Rejected Alternative — Unpaid Means Seller Retains Title

Rejected.

Title follows explicit title policy.

---

# 179. Positive Consequences

This architecture provides:

- true B2B credit support;
- open-account commerce;
- multi-currency exposure;
- safe credit reservations;
- partial payment handling;
- documentary trade-finance readiness;
- provider-neutral banking integration;
- ERP financial authority;
- secure settlement;
- intercompany support;
- strong financial reconciliation;
- future trade-finance extensibility.

---

# 180. Costs

Implementation requires:

- credit profiles;
- exposure projections;
- reservations;
- approval workflows;
- financial clearance;
- ERP integration;
- payment reconciliation;
- instrument state machines;
- provider adapters;
- strong security and audit.

These are necessary costs for serious B2B cross-border trade.

---

# 181. Repository Responsibilities

| Repository | Responsibility |
|---|---|
| `nabhold/shared` | Canonical credit, finance, settlement contracts/events |
| `nabhold/baobab-cp` | Context, capability and financial-provider resolution |
| `nabhold/baobab-trade` | Commercial credit, reservation, terms, finance workflow, financial clearance |
| `nabhold/baobab-erp` | AR, AP, invoices, payments, cash, GL, authoritative exposure |
| `nabhold/baobab-iam` | Finance/credit authorization |
| `nabhold/baobab-cms` | Financial/trade-document representations where applicable |
| `nabhold/infrastructure` | Secrets, messaging, observability, secure connectivity |
| Banks / Payment Providers / Finance Providers | Regulated financial execution |

---

# 182. Implementation Sequence

```text
Payment Terms
      ↓
Credit Policy
      ↓
Credit Profile
      ↓
ERP Exposure Projection
      ↓
Credit Reservation
      ↓
Order Commitment Gate
      ↓
Invoice / AR
      ↓
Settlement
      ↓
Financial Clearance
      ↓
Trade-Finance Instruments
      ↓
Reconciliation
      ↓
Golden-Tenant Validation
```

---

# 183. Release 1 P0 Scope

ZuriBeans Release 1 SHALL support:

- structured B2B payment terms;
- prepayment;
- deposits;
- NET terms;
- customer credit profiles;
- credit limits;
- ERP-derived exposure;
- multi-currency exposure;
- credit reservations;
- credit decisions;
- approval/override workflow;
- overdue policy;
- financial-clearance state;
- bank-transfer settlement;
- partial payments;
- payment reversals;
- ERP reconciliation;
- external financial-provider abstraction;
- structured financial-instrument model;
- basic LC/guarantee references;
- document linking;
- events;
- audit;
- observability;
- tenant/legal-entity isolation.

---

# 184. Release 1.1 Candidates

Future capabilities MAY include:

- automated credit bureau integrations;
- trade-credit insurance automation;
- documentary collection automation;
- full LC workflow;
- receivables finance;
- factoring;
- supply-chain finance;
- dynamic credit scoring;
- predictive default risk;
- treasury netting;
- FX hedging integrations;
- automated collections;
- bank-statement reconciliation;
- open-banking integrations.

These SHALL remain provider-driven and legally governed.

---

# 185. Definition of Done

ADR-0027 is implemented when:

- [ ] payment terms are structured;
- [ ] payment terms and payment methods are separate;
- [ ] credit profiles are tenant/legal-entity scoped;
- [ ] credit limits are explicit;
- [ ] ERP provides authoritative exposure;
- [ ] Trade does not become AR/AP ledger;
- [ ] credit reservations prevent concurrent overspend;
- [ ] reservations expire/release safely;
- [ ] credit decisions are audited;
- [ ] overrides require authority;
- [ ] overdue policy works;
- [ ] multi-currency credit works;
- [ ] prepayment works;
- [ ] deposits/milestones work;
- [ ] partial settlement works;
- [ ] reversal works;
- [ ] financial clearance works;
- [ ] provider settlement and ERP reconciliation remain distinct;
- [ ] financial instruments are structured;
- [ ] LC reference lifecycle works;
- [ ] guarantee reference lifecycle works;
- [ ] instrument documents use ADR-0025;
- [ ] finance/provider capabilities resolve through CP;
- [ ] mandatory provider absence returns NOT_READY;
- [ ] idempotency exists;
- [ ] out-of-order events are handled;
- [ ] reconciliation exists;
- [ ] financial audit exists;
- [ ] buyer isolation passes;
- [ ] cross-tenant isolation passes;
- [ ] local open-account scenario passes;
- [ ] prepayment scenario passes;
- [ ] partial-payment scenario passes;
- [ ] LC scenario passes;
- [ ] overdue-buyer scenario passes;
- [ ] Uganda→South Africa scenario passes;
- [ ] South Africa→Uganda scenario passes;
- [ ] intercompany scenario passes;
- [ ] inter-branch scenario does not create false AR/AP.

---

# 186. Final Architecture

```text
                         B2B TRANSACTION
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
         PAYMENT TERMS     CREDIT POLICY   FINANCE TERMS
                │              │              │
                │              ▼              ▼
                │        CREDIT DECISION   INSTRUMENT
                │              │              │
                │              ▼              │
                │        CREDIT RESERVE       │
                │              │              │
                └──────────────┼──────────────┘
                               ▼
                          ORDER COMMIT
                               │
                               ▼
                              ERP
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
                 INVOICE       AR      PAYMENT
                    │          │          │
                    └──────────┼──────────┘
                               ▼
                          SETTLEMENT
                               │
                               ▼
                        RECONCILIATION
```

Authority boundary:

```text
Trade
│
├── What commercial payment terms apply?
├── May the customer buy on credit?
├── Is sufficient credit reserved?
├── Is financial clearance satisfied?
└── What trade-finance workflow applies?

ERP
│
├── What is actually receivable?
├── What is actually payable?
├── What has been posted?
├── What has been paid?
└── What is the authoritative financial balance?

Financial Providers
│
├── Did money move?
├── Was an instrument issued?
├── Is a guarantee valid?
├── Was a draw honoured?
└── Has external settlement occurred?
```

The central invariant is:

> **Commercial credit is a controlled permission to incur exposure; it is not itself a receivable, payment or loan. Trade may orchestrate that permission, but ERP remains authoritative for financial balances and regulated providers remain authoritative for regulated financial instruments and movement of funds.**

A second invariant closes the B2B lifecycle:

> **An order SHALL never be considered financially safe merely because it exists, a payment was initiated, a credit limit was configured, or a trade-finance instrument was referenced. Financial readiness must be derived from current credit, settlement, instrument, ERP and reconciliation state.**

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0027
    ↓
Canonical Finance Contracts
    ↓
Payment Terms
    ↓
Credit Policy + Profile
    ↓
ERP Exposure Projection
    ↓
Credit Reservation
    ↓
Financial Clearance
    ↓
Settlement + Reconciliation
    ↓
Trade-Finance Instruments
    ↓
Provider Integration
    ↓
ZuriBeans Golden-Tenant Validation
```

No Baobab implementation SHALL create a competing accounting ledger, treat payment-provider status as authoritative ERP settlement, infer unlimited credit from an existing commercial relationship, or implement regulated banking/finance activity inside Trade when that function belongs to an authorised external provider.