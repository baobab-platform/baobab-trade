# ADR-0012: MedusaJS Commerce Pricing, Price Lists, Promotions and B2B Commercial Terms

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0011-commerce-product-variant-catalogue-and-canonical-product-authority-model.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates
- **Decision Class:** Commerce Pricing / B2B Commercial Terms / Promotions

---

## 1. Context

Baobab must support B2C and B2B commerce across multiple:

- tenants;
- legal sellers;
- markets;
- currencies;
- customer organisations;
- customer segments;
- sales channels;
- product catalogues;
- negotiated contracts;
- quantity tiers;
- promotional campaigns.

This creates a pricing problem more complex than assigning one price to one product.

The effective commercial price for a Product or Variant may depend on:

```text
Product / Variant
+
Market
+
Currency
+
Sales Channel
+
Customer
+
Customer Organisation
+
Commercial Agreement
+
Quantity
+
Effective Date
+
Promotion
+
Tax Context
```

The architecture must also preserve the distinction between:

```text
sales price
cost
accounting value
list price
contract price
discount
promotion
tax
foreign-exchange conversion
```

These concepts serve different business purposes and may have different authorities.

---

# 2. Decision

MedusaJS SHALL be the Baobab authority for **transactional commerce pricing resolution**.

The Commerce Engine SHALL determine the commercial price presented and committed during a commerce transaction, subject to authoritative commercial inputs supplied by other systems where explicitly defined.

Medusa SHALL support a layered pricing model capable of expressing:

```text
base/list pricing
market-specific pricing
currency-specific pricing
sales-channel pricing
B2B price lists
customer-organisation pricing
contract pricing
quantity-tier pricing
time-bound pricing
promotions
discounts
```

The price committed to an Order SHALL be persisted as a historical transaction fact.

iDempiere SHALL remain authoritative for:

```text
cost
inventory valuation
accounting value
financial posting
receivables
credit accounting
```

unless a later ADR assigns a narrower capability differently.

---

# 3. Fundamental Principle

Baobab adopts the following rule:

> **Price is a contextual commercial decision, not a static Product attribute.**

Therefore:

```text
Product != Price
```

and:

```text
Product Variant != Price
```

A Product or Variant may have many valid prices simultaneously under different contexts.

---

# 4. Price Context

Every pricing decision SHALL execute under an explicit `PriceContext`.

Conceptually:

```text
PriceContext {
    context_id
    tenant_id
    market_id
    legal_seller_id
    currency
    sales_channel_id?
    customer_id?
    customer_organisation_id?
    quantity
    effective_at
}
```

Additional dimensions MAY be introduced where required.

The canonical context contract SHALL define precise fields.

---

# 5. Price Resolution

Price resolution SHALL conceptually follow:

```text
Product / Variant
        │
        ▼
Market eligibility
        │
        ▼
Currency
        │
        ▼
Applicable Price Lists
        │
        ▼
Customer / Organisation Terms
        │
        ▼
Quantity Rules
        │
        ▼
Promotion Evaluation
        │
        ▼
Final Commercial Price
```

The exact implementation SHALL use Medusa-supported pricing mechanisms and Baobab extensions rather than a separate parallel pricing engine unless a future ADR establishes one.

---

# 6. Base Price

A base price MAY represent a default commercial price for a Product Variant.

A base price SHALL NOT imply universal applicability.

It MUST remain subject to:

```text
Market
Currency
Eligibility
Sales Channel
Customer Context
```

before being used in a transaction.

---

# 7. Price List

A Price List SHALL represent a governed collection of pricing rules applicable under defined commercial conditions.

Price Lists MAY support:

```text
market pricing
wholesale pricing
customer-segment pricing
organisation pricing
contract pricing
campaign pricing
quantity pricing
```

Price List membership SHALL NOT define tenancy.

---

# 8. Price List Scope

Every Price List SHALL have an explicit scope.

Possible dimensions include:

```text
Tenant
Market
Legal Seller
Currency
Sales Channel
Customer Segment
Customer Organisation
Contract
Effective Period
```

Unscoped global Price Lists SHOULD be exceptional.

---

# 9. Currency-Specific Pricing

Baobab SHALL support explicit prices by currency.

For example:

```text
Variant
  ├── ZAR 150.00
  ├── USD 8.50
  └── EUR 7.90
```

These prices need not be direct FX equivalents.

They may reflect:

- market strategy;
- competition;
- taxes;
- distribution cost;
- psychological pricing;
- commercial negotiation.

---

# 10. Dynamic Currency Conversion

Dynamic FX conversion MAY be supported where business policy requires it.

It SHALL NOT be the universal pricing model.

Where used, the calculation MUST identify:

```text
source amount
source currency
target currency
exchange rate
rate source
effective timestamp
rounding policy
```

The resulting transactional amount SHALL be persisted.

---

# 11. Price Authority

Medusa SHALL be authoritative for the price actually accepted by the Commerce transaction.

This means the Commerce Engine owns the final transactional fact:

```text
what was charged commercially
```

It does not mean Medusa necessarily originates every pricing input.

For example, negotiated B2B terms MAY originate from another governed business process.

Once such terms are projected into the Commerce Engine, Medusa SHALL execute them according to the applicable contract.

---

# 12. ERP Cost Is Not Commerce Price

iDempiere product cost SHALL NOT be used automatically as a customer price.

Therefore:

```text
ERP Cost != Commerce Selling Price
```

Margin calculation MAY compare the two through analytics or authorised business services.

The cost SHALL remain protected financial information.

---

# 13. Accounting Price Is Not Commerce Price

Amounts used for accounting, valuation, transfer pricing or financial reporting SHALL not automatically become storefront prices.

Commerce and accounting representations SHALL remain independently governed.

---

# 14. List Price

A List Price MAY serve as a reference selling price.

It MAY differ from the final price due to:

```text
price lists
customer terms
quantity tiers
promotion
discount
```

The Order SHALL record the commercially relevant values necessary to reconstruct the transaction.

---

# 15. B2C Pricing

B2C pricing SHOULD support:

```text
public price
market-specific price
currency-specific price
promotion
coupon
customer-segment price
```

Anonymous users MAY receive public commercial pricing without becoming Baobab tenants.

---

# 16. B2B Pricing

B2B pricing SHALL support more sophisticated contexts.

Potential forms include:

```text
standard wholesale
customer-tier pricing
organisation-specific pricing
contract pricing
quantity breaks
volume agreements
time-bound agreements
negotiated discounts
```

B2B pricing SHALL be evaluated against authenticated organisation membership where applicable.

---

# 17. Customer Organisation Pricing

A Customer Organisation MAY receive a private Price List.

Conceptually:

```text
Customer Organisation A
        │
        ▼
Private Price List A
```

Organisation B MUST NOT be able to discover or receive those prices unless explicitly authorised.

---

# 18. Customer-Specific Pricing

Where required, pricing MAY apply to an individual customer.

However, customer-specific pricing SHOULD be used sparingly where organisation-level commercial agreements are more appropriate.

The commercial scope SHALL be explicit.

---

# 19. Contract Pricing

A Commercial Contract MAY establish pricing terms.

Conceptually:

```text
Customer Organisation
      │
      ▼
Commercial Agreement
      │
      ├── Products
      ├── Prices
      ├── Currency
      ├── Quantity Rules
      ├── Effective Period
      └── Other Terms
```

The exact contractual data authority SHALL be defined separately if it resides outside Medusa.

---

# 20. Commercial Agreement Identity

Where B2B agreements participate across engines, they SHOULD have canonical identity or an explicit external reference.

A Medusa Price List ID SHALL NOT be assumed to represent the legal contract itself.

---

# 21. Price List Is Not Contract

A Price List is an implementation of pricing policy.

A legal or commercial Contract is a business agreement.

Therefore:

```text
PriceList != Contract
```

A Contract MAY produce one or more Price Lists.

---

# 22. Effective Dating

Prices and commercial terms SHOULD support:

```text
valid_from
valid_to
```

or equivalent temporal validity.

Evaluation SHALL occur using an explicit effective timestamp.

---

# 23. Future Pricing

Future-dated prices MAY be provisioned before activation.

They SHALL NOT affect transactions before their effective date.

---

# 24. Expired Pricing

Expired commercial terms SHALL not be used for new transactions.

Historical Orders SHALL retain the price under which they were originally committed.

---

# 25. Quantity Pricing

The Commerce Engine SHALL support quantity-sensitive pricing where required.

For example:

```text
1–9 units      → 100.00
10–49 units    → 95.00
50–99 units    → 90.00
100+ units     → 85.00
```

Quantity tiers SHALL define unambiguous boundaries.

---

# 26. Quantity Pricing Scope

Quantity pricing MAY vary by:

```text
Product Variant
Market
Customer Organisation
Contract
Currency
```

A quantity tier intended for one B2B organisation MUST NOT become globally visible.

---

# 27. Units and Quantity Pricing

Quantity rules SHALL identify the unit to which they apply where ambiguity is possible.

For example:

```text
10 bags
```

is not necessarily equivalent to:

```text
10 kilograms
```

Unit conversion SHALL follow approved domain rules.

---

# 28. Volume Pricing

Where pricing depends upon cumulative volume over time rather than one order quantity, that SHALL be treated as a separate commercial rule.

The architecture SHALL not silently interpret transaction quantity tiers as cumulative volume agreements.

---

# 29. Minimum Order

B2B commercial terms MAY define:

```text
minimum quantity
minimum value
minimum pack size
minimum shipment
```

These SHALL be validated server-side during cart or checkout.

---

# 30. Maximum Order

Market or contract rules MAY also impose maximum quantities or values.

Such limits SHALL be evaluated in commercial Context.

---

# 31. Promotion

A Promotion SHALL represent a temporary or conditional commerce incentive.

Examples include:

```text
percentage discount
fixed discount
buy-X-get-Y
free shipping
bundle discount
coupon
campaign discount
```

Promotions SHALL remain distinct from permanent or contractual Price Lists.

---

# 32. Promotion Scope

Promotions SHALL have explicit scope.

Possible dimensions include:

```text
Market
Currency
Sales Channel
Product
Variant
Catalogue
Customer Segment
Customer Organisation
Date
Quantity
Cart Value
```

An incorrectly scoped promotion is a financial defect.

---

# 33. Promotion Eligibility

Eligibility SHALL be evaluated server-side.

Digital estates MAY display promotional messaging but SHALL NOT determine authoritative discount eligibility.

---

# 34. Promotion Stacking

Baobab SHALL define deterministic rules governing whether multiple promotions may combine.

Possible policies include:

```text
exclusive
stackable
priority-based
best-price-wins
category-specific stacking
```

The chosen policy SHALL be explicit and testable.

---

# 35. Contract Pricing and Promotions

B2B contract pricing SHALL NOT automatically participate in consumer promotions.

The pricing policy SHALL define whether:

```text
contract price
+
promotion
```

is allowed.

The default SHOULD be conservative where contract economics are sensitive.

---

# 36. Discount

A Discount represents a reduction relative to an applicable commercial price.

Discounts SHALL retain sufficient provenance to identify:

```text
promotion
contract
manual adjustment
price list
commercial rule
```

where relevant.

---

# 37. Manual Discounts

Manual commercial adjustments MAY be permitted to authorised principals.

They SHALL require:

```text
authorization
reason
audit trail
```

and SHOULD be subject to thresholds.

---

# 38. Administrative Discount Authority

The ability to administer products SHALL NOT automatically confer authority to issue arbitrary discounts.

Pricing administration and discount approval SHOULD be separately authorised.

---

# 39. Price Override

Price overrides SHALL be explicit exceptional operations.

They MUST NOT be implemented by silently editing Order lines after checkout calculation.

An override SHOULD retain:

```text
original price
override price
actor
reason
timestamp
```

where business policy requires auditability.

---

# 40. Negotiated Price

A negotiated B2B price SHALL be represented as a governed commercial term.

It SHOULD have:

```text
customer organisation
product/variant
currency
price
validity
quantity conditions
agreement reference
```

where applicable.

---

# 41. Quote Pricing

Future quotation capability MAY allow temporary quoted prices.

A Quote SHALL NOT automatically become an Order.

Conversion to Order MUST validate:

```text
quote validity
customer
market
seller
currency
availability
commercial terms
```

before commitment.

---

# 42. Price Locking

The platform SHOULD define when a price becomes locked.

Potential points include:

```text
cart
quote
checkout initiation
payment authorization
order placement
```

For ordinary commerce, cart prices SHOULD generally remain revalidatable until Order commitment.

---

# 43. Cart Price Recalculation

A Cart SHOULD be recalculated when relevant context changes.

Triggers MAY include:

```text
quantity
Market
currency
customer login
customer organisation
sales channel
promotion
shipping destination
effective time
```

The Digital Estate SHALL NOT assume a stale displayed price remains valid indefinitely.

---

# 44. Checkout Price Validation

Immediately before Order commitment, the Commerce Engine MUST validate the current price.

The Order SHALL NOT rely solely on a price supplied by the client.

---

# 45. Client-Supplied Prices

Client-supplied monetary amounts SHALL be treated as untrusted.

A request such as:

```json
{
  "price": 1
}
```

MUST NOT cause the server to sell a Product for that amount unless the endpoint explicitly represents an authorised price-administration operation.

---

# 46. Order Price Snapshot

The Order SHALL persist sufficient pricing facts to remain valid after Price Lists and Promotions change.

The historical record SHOULD include, where applicable:

```text
unit price
quantity
currency
line subtotal
discount
tax
line total
promotion references
price-list/contract provenance
```

---

# 47. Historical Integrity

Changing a Price List SHALL NOT rewrite historical Orders.

Changing a Promotion SHALL NOT rewrite historical Orders.

Deleting an expired pricing rule SHALL NOT make historical Orders uninterpretable.

---

# 48. Rounding

Rounding SHALL be deterministic.

The platform SHALL define:

```text
rounding precision
rounding mode
calculation stage
currency rules
```

for commercial calculations.

Different engines SHALL NOT independently invent incompatible rounding for the same transaction.

---

# 49. Line-Level and Order-Level Rounding

The Commerce Engine SHALL explicitly define whether rounding occurs:

```text
per unit
per line
per tax component
per order total
```

where relevant.

The ERP integration SHALL receive the actual committed values rather than independently reconstructing them differently.

---

# 50. Tax-Inclusive Pricing

Markets MAY use tax-inclusive pricing.

For example:

```text
display price = final consumer price including VAT
```

This policy SHALL be Market-specific.

---

# 51. Tax-Exclusive Pricing

B2B Markets MAY use tax-exclusive pricing.

For example:

```text
display price
+
tax
=
invoice total
```

The distinction SHALL be explicit in Price Context.

---

# 52. Tax Is Not Discount

Tax SHALL remain separate from:

```text
price
discount
promotion
```

Order representations MUST preserve the distinction.

---

# 53. Shipping Price

Shipping or delivery pricing SHALL be treated as a commerce charge rather than Product price.

It MAY depend on:

```text
Market
destination
weight
dimensions
service level
customer agreement
cart value
promotion
```

---

# 54. Free Shipping

Free shipping SHALL be represented as an explicit rule or Promotion.

It SHALL NOT require mutating unrelated Product prices.

---

# 55. Surcharges and Fees

Commerce MAY support additional fees such as:

```text
handling
service
packaging
special delivery
```

where legally permissible.

Such charges SHALL be explicit line or adjustment components.

Hidden fee calculations are prohibited.

---

# 56. B2B Payment Terms

B2B commercial terms MAY include:

```text
prepayment
cash on delivery
Net 7
Net 15
Net 30
Net 60
letter of credit
other approved terms
```

Payment Terms SHALL remain distinct from price.

---

# 57. Payment-Term Authority

Where credit/payment terms are governed by ERP financial processes, iDempiere SHALL remain authoritative.

Medusa MAY maintain the operational projection required for checkout.

The authoritative source MUST be documented in the capability contract.

---

# 58. Credit Limit

Credit Limit SHALL NOT be treated as a price.

Where credit control is introduced, the Commerce Engine SHALL consume an authorised credit decision or projection.

iDempiere or a future credit capability MAY remain authoritative.

---

# 59. Credit Availability

Commerce MUST NOT infer available credit simply from historical order totals if financial authority resides elsewhere.

A separate contract SHALL define credit availability.

---

# 60. Payment Terms and Checkout

When B2B payment terms apply, checkout SHALL validate:

```text
customer organisation
authorised payment terms
credit status where applicable
order value
currency
legal seller
```

before accepting the Order.

---

# 61. Commercial Terms Model

Baobab SHALL treat B2B Commercial Terms as a composite business concept.

Conceptually:

```text
CommercialTerms
   │
   ├── pricing
   ├── currency
   ├── quantity rules
   ├── payment terms
   ├── fulfilment terms
   ├── credit policy
   ├── delivery conditions
   └── effective dates
```

Not every element must reside in Medusa.

The owning capability for each term SHALL be explicit.

---

# 62. Commercial Terms Are Not Tenant Configuration

Customer-specific commercial terms SHALL NOT be implemented as tenant configuration.

A tenant may have thousands of B2B customers with independent agreements.

Tenant configuration and customer commercial terms are different scopes.

---

# 63. Incoterms

Where international B2B trade requires Incoterms, the selected Incoterm SHALL be an explicit Commercial Term.

It MAY influence:

```text
price
freight allocation
insurance
delivery responsibility
risk transfer
```

The legal/commercial semantics SHALL not be reduced to an arbitrary discount field.

---

# 64. Currency and Contract Terms

A contract SHOULD explicitly define its permitted currency or currencies.

An organisation-specific ZAR Price List SHALL NOT be silently reused in USD.

---

# 65. Cross-Currency Contracts

Where a commercial agreement permits multiple currencies, each currency-specific price SHOULD be explicit unless an approved FX rule applies.

---

# 66. Commercial Term Effective Dating

B2B terms SHALL support temporal validity where required.

For example:

```text
agreement starts: 2027-01-01
agreement ends:   2027-12-31
```

Transactions outside the valid period MUST NOT automatically receive the contracted terms.

---

# 67. Price Precedence

Baobab SHALL define deterministic precedence when multiple pricing candidates apply.

A conceptual precedence MAY resemble:

```text
customer-specific contract
        ↓
organisation-specific contract
        ↓
B2B price list
        ↓
market price list
        ↓
base price
```

Promotions SHALL then apply according to promotion policy.

The exact precedence SHALL be codified and contract-tested.

---

# 68. No Accidental Best Price

The system SHALL NOT blindly choose the lowest available price unless business policy explicitly defines a best-price rule.

A lower price may belong to an unauthorised organisation or Market.

Eligibility precedes optimisation.

---

# 69. Price Candidate Filtering

Price resolution SHALL first filter by authorised Context.

Conceptually:

```text
All Prices
    │
    ▼
Context Eligibility
    │
    ▼
Commercial Precedence
    │
    ▼
Promotion Rules
    │
    ▼
Final Price
```

---

# 70. Price Provenance

The final calculated price SHOULD retain provenance sufficient for audit and support.

For example:

```text
base_price
price_list_id
contract_reference
promotion_ids
manual_adjustment
```

where applicable.

Customer-facing APIs need not expose all internal provenance.

---

# 71. Confidential Pricing

B2B negotiated prices SHALL be treated as confidential commercial data.

They MUST NOT leak through:

```text
public APIs
search indexes
CDN cache
logs
analytics exports
other customer sessions
```

unless explicitly authorised.

---

# 72. Cache Isolation

Price cache keys MUST include every dimension that materially affects price.

Depending on use case, that MAY include:

```text
product_variant
market
currency
sales_channel
customer_organisation
quantity tier
effective period
```

A public-price cache MUST NOT serve private contract prices.

---

# 73. CDN Safety

Private or customer-specific pricing SHOULD NOT be publicly cacheable.

Where edge caching is used, cache policy MUST distinguish:

```text
public pricing
```

from:

```text
authenticated/private pricing
```

---

# 74. Search Index Pricing

Search indexes SHOULD avoid embedding sensitive negotiated pricing unless strict access controls are technically proven.

Public search MAY carry public Market prices.

Private B2B prices SHOULD usually be resolved at request time or in appropriately isolated projections.

---

# 75. Promotion Abuse Prevention

Promotion codes and discount mechanisms SHOULD include controls against:

```text
replay
unauthorised reuse
brute-force enumeration
scope bypass
quantity manipulation
customer-switching abuse
```

where applicable.

---

# 76. Coupon Scope

Coupons MAY be constrained by:

```text
customer
organisation
Market
usage count
date
cart value
Product
Sales Channel
```

Coupon possession alone SHALL NOT override eligibility restrictions.

---

# 77. Usage Limits

Promotion usage limits SHALL be enforced atomically enough to prevent unacceptable over-redemption.

The exact consistency strategy SHALL be proportionate to business risk.

---

# 78. Promotion Concurrency

Where a promotion has limited global usage, concurrent checkout attempts MUST be handled deterministically.

The implementation SHALL NOT rely only on frontend counters.

---

# 79. Price Events

Material pricing changes SHOULD produce canonical or commerce-domain events where downstream consumers require them.

Potential events include:

```text
commerce.price.created
commerce.price.updated
commerce.price.retired

commerce.price_list.created
commerce.price_list.updated
commerce.price_list.activated
commerce.price_list.expired
```

---

# 80. Promotion Events

Potential Promotion events include:

```text
commerce.promotion.created
commerce.promotion.activated
commerce.promotion.updated
commerce.promotion.expired
commerce.promotion.disabled
```

Only business-significant lifecycle facts SHOULD become canonical events.

---

# 81. Commercial Terms Events

Where B2B commercial agreements are platform-integrated, events MAY include:

```text
commerce.commercial_terms.activated
commerce.commercial_terms.updated
commerce.commercial_terms.expired
```

The authoritative producer SHALL be the system owning the underlying agreement.

---

# 82. Price Event Payloads

Pricing events SHALL NOT publish every customer's confidential commercial terms indiscriminately.

Payloads SHOULD include only the data needed by authorised consumers.

Sensitive pricing details MAY require restricted channels or reference-based retrieval.

---

# 83. ERP Integration

The Commerce Engine SHALL transmit actual committed transaction values to iDempiere.

The ERP integration SHALL NOT re-resolve the customer's commerce price from current price lists.

Conceptually:

```text
Commerce Order
     │
     ├── unit price
     ├── discount
     ├── tax
     ├── quantity
     ├── currency
     └── totals
           │
           ▼
        iDempiere
```

ERP SHALL then apply accounting treatment according to its authority.

---

# 84. ERP Reconciliation

Pricing reconciliation SHOULD detect material differences between:

```text
Commerce committed amount
```

and:

```text
ERP transaction amount
```

after allowing for documented accounting transformations.

Unexpected differences SHALL be observable.

---

# 85. ERP Cost Feedback

If profitability analysis requires ERP cost information, the cost SHOULD flow through a governed analytics or authorised integration path.

It SHALL NOT become an unrestricted Store API field.

---

# 86. Payload Integration

Payload MAY display marketing representations such as:

```text
"From R150"
"Save 20%"
"Wholesale pricing available"
```

but authoritative current price SHALL come from Commerce data or an approved commerce projection.

Payload editorial content SHALL NOT independently determine checkout price.

---

# 87. Digital Estate Display

Digital Estates SHALL display prices returned from the authorised Commerce context.

They MUST NOT implement duplicate pricing engines in frontend code.

---

# 88. Price Presentation

Digital Estates MAY localise price display formatting.

For example:

```text
R 1 250,00
$1,250.00
€1.250,00
```

Formatting does not alter the underlying canonical Money value.

---

# 89. Stale Frontend Prices

A Digital Estate MAY display a cached price for browsing.

Checkout SHALL revalidate authoritative pricing.

Where a displayed price differs materially from the committed price, the user SHOULD be informed before Order placement.

---

# 90. Price API

Pricing APIs SHOULD return sufficient metadata to make the amount unambiguous.

Conceptually:

```json
{
  "amount": 12500,
  "currency": "ZAR",
  "price_type": "contract",
  "effective_at": "...",
  "tax_inclusive": true
}
```

Exact schemas SHALL be defined in OpenAPI contracts.

---

# 91. Money Schema

Baobab SHOULD standardise a reusable canonical Money schema in `nabhold/shared`.

This SHALL be consumed consistently by:

- Commerce;
- ERP integrations;
- events;
- APIs;
- analytics contracts.

---

# 92. Price Calculation Determinism

Given identical:

```text
pricing data
PriceContext
effective timestamp
```

the pricing engine SHOULD return the same result.

Non-deterministic pricing rules SHALL be explicitly justified.

---

# 93. Time Dependency

Because pricing may be time-sensitive, evaluation SHALL use an explicit effective time rather than uncontrolled calls to the local system clock throughout business logic.

This improves:

- testing;
- replay;
- audit;
- reproducibility.

---

# 94. Pricing Replay

The system SHOULD be capable of explaining historical price decisions without rerunning today's rules.

Historical Order snapshots and pricing provenance SHALL support this.

---

# 95. Reconciliation

Pricing reconciliation SHOULD detect:

```text
missing Price List
orphan Price List
expired terms still active
wrong Market scope
wrong currency
missing organisation binding
stale projected commercial agreement
promotion active outside validity
```

---

# 96. Provisioning

B2B pricing provisioning SHALL be idempotent.

For example:

```text
Commercial Agreement
       │
       ▼
Provision Commerce Terms
       │
       ▼
Check Existing Projection
       │
       ├── exists → reconcile/update
       └── missing → create
```

Duplicate events MUST NOT create duplicate commercial terms.

---

# 97. Contract Revision

When a commercial agreement is revised, the system SHOULD create a traceable new version or temporal change rather than silently destroying prior terms where historical audit matters.

---

# 98. Contract Termination

Contract termination SHALL prevent future use after the effective termination point while preserving historical Orders.

---

# 99. Manual Emergency Controls

Operations MAY require the ability to disable:

```text
Price List
Promotion
Contract Terms
```

during an incident.

Emergency controls SHALL be authorised and audited.

---

# 100. Observability

Pricing telemetry SHOULD allow operators to diagnose:

```text
price resolution failures
missing price
wrong currency
promotion failures
contract projection failures
pricing latency
```

without logging sensitive customer-specific values unnecessarily.

---

# 101. Metrics

Useful metrics MAY include:

```text
pricing requests
pricing failures
missing price rate
promotion evaluations
discount application rate
contract-price usage
```

Customer IDs SHALL NOT be used as high-cardinality metric labels.

---

# 102. Audit

Material administrative pricing changes SHOULD record:

```text
actor
change
scope
effective date
reason
correlation ID
```

where appropriate.

---

# 103. Security

Pricing APIs SHALL enforce authorization according to:

```text
principal
context
Market
customer organisation
resource
action
```

An authenticated B2B user SHALL only receive prices permitted for their organisation.

---

# 104. Cross-Organisation Isolation

The following attack SHALL fail:

```text
Buyer A
  obtains Organisation B ID
        │
        ▼
requests Organisation B price
```

The server SHALL validate membership and entitlement independently of supplied IDs.

---

# 105. Price Enumeration

Sequential or discoverable Price List identifiers SHALL NOT be relied upon as security controls.

Authorization SHALL protect the underlying commercial data.

---

# 106. Rejected Alternative: One Price Per Product

**Rejected.**

It cannot represent:

- multiple currencies;
- Markets;
- B2B contracts;
- quantity tiers;
- promotions.

---

# 107. Rejected Alternative: Price Owned by ERP

**Rejected as the universal model.**

ERP cost and accounting authority do not imply authority over customer-facing transactional commerce pricing.

---

# 108. Rejected Alternative: Price Owned by Payload

**Rejected.**

CMS content is not transactional commerce authority.

---

# 109. Rejected Alternative: Price Calculated by Digital Estate

**Rejected absolutely.**

Frontend code is untrusted and independently deployable.

It SHALL NOT determine authoritative transaction price.

---

# 110. Rejected Alternative: Automatic FX for All Markets

**Rejected.**

It cannot represent intentional local and negotiated pricing.

---

# 111. Rejected Alternative: Lowest Matching Price Always Wins

**Rejected.**

Eligibility and contractual precedence must be evaluated before price selection.

---

# 112. Rejected Alternative: Customer Organisation as Tenant for Pricing

**Rejected.**

B2B customer organisations are commercial actors, not automatically platform tenants.

Organisation-specific pricing SHALL be scoped independently.

---

# 113. Rejected Alternative: Shared Public Cache for All Pricing

**Rejected.**

It risks leaking private B2B prices and incorrect Market pricing.

---

# 114. Consequences

### Positive

This decision enables:

- B2C retail pricing;
- B2B wholesale pricing;
- organisation-specific pricing;
- contract pricing;
- quantity tiers;
- multiple currencies;
- Market pricing;
- promotions;
- future quotations;
- auditable commercial terms;
- independent ERP accounting.

### Negative

It introduces:

- pricing precedence;
- temporal validity;
- private-price isolation;
- more complex caching;
- contract projection;
- pricing reconciliation;
- additional conformance testing.

This complexity reflects actual commercial requirements and is accepted.

---

# 115. Architectural Invariants

**PRC-COM-001**  
Price SHALL remain distinct from Product identity.

**PRC-COM-002**  
Price SHALL remain distinct from ERP cost.

**PRC-COM-003**  
Medusa SHALL own final transactional commerce price resolution.

**PRC-COM-004**  
Every price SHALL resolve within explicit commercial Context.

**PRC-COM-005**  
Every monetary amount SHALL carry currency semantics.

**PRC-COM-006**  
Binary floating-point SHALL NOT be used for canonical money.

**PRC-COM-007**  
Private B2B prices SHALL be organisation-isolated.

**PRC-COM-008**  
Digital Estates SHALL NOT calculate authoritative transaction prices.

**PRC-COM-009**  
Payload SHALL NOT determine authoritative transaction prices.

**PRC-COM-010**  
ERP cost SHALL NOT automatically determine sales price.

**PRC-COM-011**  
Client-supplied price SHALL be untrusted.

**PRC-COM-012**  
Checkout SHALL revalidate price before Order commitment.

**PRC-COM-013**  
Orders SHALL snapshot committed pricing facts.

**PRC-COM-014**  
Historical Orders SHALL not be rewritten after pricing changes.

**PRC-COM-015**  
Price precedence SHALL be deterministic.

**PRC-COM-016**  
Price eligibility SHALL be evaluated before price optimisation.

**PRC-COM-017**  
Promotion scope SHALL be explicit.

**PRC-COM-018**  
Promotion stacking policy SHALL be explicit.

**PRC-COM-019**  
Customer-specific prices SHALL not leak through shared caches.

**PRC-COM-020**  
B2B Commercial Terms SHALL remain distinct from tenant configuration.

**PRC-COM-021**  
Payment Terms SHALL remain distinct from Price.

**PRC-COM-022**  
Credit Limit SHALL remain distinct from Price.

**PRC-COM-023**  
Committed Commerce amounts SHALL be transmitted to ERP.

**PRC-COM-024**  
ERP SHALL not independently re-price committed Commerce Orders.

**PRC-COM-025**  
Pricing provisioning SHALL be idempotent.

**PRC-COM-026**  
Pricing configuration SHALL be reconcilable.

**PRC-COM-027**  
Price changes SHALL have explicit effective-date semantics where temporal terms apply.

**PRC-COM-028**  
Pricing rules SHALL be enforced server-side.

**PRC-COM-029**  
Pricing administration SHALL be auditable.

**PRC-COM-030**  
Commercial agreement identity SHALL not be collapsed into Medusa Price List identity.

---

# 116. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. The same Product can have different prices in two Markets.

2. The same Product can have different prices in two currencies.

3. Explicit USD pricing need not equal converted ZAR pricing.

4. Organisation A receives its negotiated price.

5. Organisation B cannot retrieve Organisation A's negotiated price.

6. Anonymous B2C users receive only eligible public pricing.

7. Quantity tiers resolve correctly at boundaries.

8. Expired Price Lists do not apply.

9. Future Price Lists do not apply early.

10. Market-ineligible prices do not participate.

11. Wrong-currency prices do not participate.

12. Client-supplied price values cannot override server pricing.

13. Checkout revalidates stale cart pricing.

14. Customer login can trigger appropriate cart repricing.

15. Market switching triggers repricing.

16. Quantity change triggers tier recalculation.

17. Promotion eligibility is enforced server-side.

18. Promotion stacking follows configured precedence.

19. Contract price plus promotion follows explicit policy.

20. Coupon possession cannot bypass customer eligibility.

21. Private pricing does not leak through caches.

22. Private pricing does not leak through search.

23. Orders retain historical unit prices after a Price List changes.

24. Orders retain historical discounts after a Promotion expires.

25. ERP receives the committed Commerce amount.

26. ERP cost is never exposed through the Store API.

27. Duplicate contract-price provisioning is idempotent.

28. Price reconciliation detects an expired rule that remains active.

29. Rounding produces deterministic totals.

30. An unauthorised administrator cannot issue a price override.
```

---

# 117. Implementation Implications

This ADR requires subsequent specifications for:

```text
PriceContext
Price List scope
pricing precedence
Money schema
currency handling
quantity tiers
promotion evaluation
B2B Commercial Terms
contract-price projection
private-price authorization
pricing cache isolation
price event schemas
pricing reconciliation
ERP price handoff
historical Order pricing snapshots
```

These concerns SHALL be implemented through Medusa-supported extension mechanisms and Baobab contracts rather than through a parallel undocumented pricing subsystem.

---

# 118. Decision Outcome

Baobab adopts a context-driven pricing model:

```text
                         PRODUCT / VARIANT
                                │
                                ▼
                           PRICE CONTEXT
                                │
           ┌────────────────────┼────────────────────┐
           │                    │                    │
           ▼                    ▼                    ▼
         Market             Customer              Currency
           │              Organisation                │
           │                    │                     │
           ▼                    ▼                     ▼
      Market Price      Commercial Terms        Currency Price
           │                    │                     │
           └─────────────┬──────┴─────────────┬───────┘
                         │                    │
                         ▼                    ▼
                   Quantity Rules       Promotions
                         │                    │
                         └──────────┬─────────┘
                                    ▼
                              FINAL PRICE
                                    │
                                    ▼
                                  ORDER
                                    │
                                    ▼
                        HISTORICAL PRICE SNAPSHOT
                                    │
                                    ▼
                                IDEMPIERE
                         Accounting Consequence
```

The governing rule is:

> **A price is valid only within the commercial context under which it was resolved.**

The B2B rule is:

> **Negotiated commercial terms belong to the authorised customer relationship, not to the tenant or Product globally.**

The transaction rule is:

> **The Commerce Engine determines and persists the price actually committed by the customer; downstream systems account for that committed transaction rather than independently reconstructing it.**

The privacy rule is:

> **Private pricing is confidential business data and must be isolated with the same seriousness as orders and customer records.**

And the long-term architecture rule is:

> **Pricing complexity shall be expressed through explicit context, contracts, precedence and policy—not through tenant-specific forks or duplicated pricing logic across digital estates.**
