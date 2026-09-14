# ADR-0020 — B2B Landed Cost, Margin and Commercial Price Resolution Model

**Status:** Proposed — Normative Commerce Architecture  
**Date:** 2026-09-12  
**Decision Owners:** NABHOLD / Baobab Platform Architecture  
**Repository:** `nabhold/baobab-trade`  
**Commerce Runtime:** MedusaJS  
**Financial Cost Authority:** `nabhold/baobab-erp` / iDempiere  
**Platform Context Authority:** `nabhold/baobab-cp`  
**Canonical Contract Authority:** `nabhold/shared`  
**Intelligence Provider:** `nabhold/baobab-pulse` where applicable  
**Reference Tenant:** ZuriBeans

## Related Trade ADRs

- ADR-0010 — MedusaJS Commerce Market, Region, Currency, Sales Channel and Legal Seller Model
- ADR-0011 — Commerce Product, Variant, Catalogue and Canonical Product Authority Model
- ADR-0012 — MedusaJS Commerce Pricing, Price Lists, Promotions and B2B Commercial Terms
- ADR-0013 — MedusaJS Commerce Inventory, Availability, Reservation and ERP Stock Authority Model
- ADR-0014 — MedusaJS Commerce Checkout, Order Commitment and Distributed Transaction Boundary
- ADR-0018 — MedusaJS Commerce Tax, Jurisdiction and Legal Transaction Context
- ADR-0019 — B2B Procurement, Supplier Commercial Workflow and Trade-to-ERP Boundary Model

## Related Platform ADRs

- ADR-BCP-011 — Market Participation, Trade Lanes and Cross-Market Trading Model
- ADR-BCP-012 — Intercompany and Inter-Branch Trading, Legal-Entity Relationship and Internal Settlement Model
- ADR-BCP-013 — Canonical Inventory Ownership, Custody, Location and In-Transit Model

---

# 1. Executive Decision

Baobab SHALL distinguish between:

```text
Purchase Price
Landed Cost
Inventory Cost
Commercial Cost Basis
Target Margin
Minimum Commercial Price
Quoted Price
Contract Price
Customer-Specific Price
Final Transaction Price
```

These concepts SHALL NOT be collapsed into a single `price`.

The core pricing flow is:

```text
SUPPLIER PRICE
      ↓
ESTIMATED LANDED COST
      ↓
ACTUAL LANDED COST
      ↓
COMMERCIAL COST BASIS
      ↓
MARGIN POLICY
      ↓
MINIMUM COMMERCIAL PRICE
      ↓
COMMERCIAL PRICE RESOLUTION
      ↓
CUSTOMER PRICE
```

The architectural rule is:

> **ERP owns authoritative financial cost. Trade owns commercial price resolution. Pulse may supply intelligence. Control Plane supplies context and provider resolution.**

Baobab Trade SHALL never invent accounting cost when ERP has authoritative cost available.

Baobab ERP SHALL not own customer-facing price-selection logic.

---

# 2. Why This ADR Is Required

Existing B2B pricing addresses:

```text
price lists
customer-specific prices
volume pricing
promotions
commercial terms
```

but ZuriBeans' operating model introduces an additional challenge:

```text
How much does the product truly cost in the destination market?
```

A coffee purchase in Uganda may acquire costs from:

```text
supplier price
processing
packaging
local haulage
export documentation
freight
insurance
brokerage
customs duty
import VAT treatment
port charges
storage
foreign exchange
destination haulage
```

A selling price based only on supplier purchase price would be commercially unsafe.

---

# 3. Core Principle

The following SHALL remain distinct:

```text
Supplier Price
≠
Landed Cost
≠
Inventory Valuation
≠
Commercial Cost Basis
≠
Selling Price
```

---

# 4. Cost vs Price

Cost answers:

> What has or is expected to have been economically consumed to acquire and position the goods?

Price answers:

> What amount will Baobab offer or charge to the customer?

The two are related.

They are not the same domain object.

---

# 5. Pricing Authority Boundary

```text
                    BAOBAB ERP
               Financial Cost Authority
                        │
                        ▼
                Cost Projection / API
                        │
                        ▼
                   BAOBAB TRADE
          Commercial Pricing Resolution
                        │
             ┌──────────┼───────────┐
             ▼          ▼           ▼
          Margin      Contract     Customer
          Policy       Terms        Terms
             │          │           │
             └──────────┼───────────┘
                        ▼
                 Commercial Price
```

---

# 6. ERP Responsibility

ERP SHALL own authoritative financial cost components such as:

```text
purchase cost
inventory valuation
landed-cost allocation
freight capitalization where applicable
duty cost
cost adjustments
FX accounting effects
inventory revaluation
```

Exact accounting treatment remains policy-dependent.

---

# 7. Trade Responsibility

Trade SHALL own:

```text
customer-facing price selection
price lists
commercial cost projection
margin rules
minimum price checks
quote calculation
customer-specific terms
volume pricing
contract pricing
sales-channel pricing
market pricing
```

---

# 8. Pulse Responsibility

Pulse MAY provide:

```text
FX intelligence
commodity market prices
market benchmarks
competitor signals
freight intelligence
macro indicators
```

Pulse data SHALL remain advisory unless explicitly bound into a pricing policy.

---

# 9. Control Plane Responsibility

CP SHALL supply:

```text
tenant
legal entity
market
trade lane
seller
buyer
provider resolution
capability grants
currency context
```

CP SHALL not calculate price.

---

# 10. Canonical Cost Components

Baobab SHOULD define canonical cost categories.

Initial categories:

```text
PURCHASE_COST
PROCESSING_COST
PACKAGING_COST
ORIGIN_TRANSPORT
EXPORT_HANDLING
EXPORT_DOCUMENTATION
FREIGHT
INSURANCE
CUSTOMS_DUTY
IMPORT_TAX_COST
BROKERAGE
PORT_CHARGES
WAREHOUSING
DESTINATION_TRANSPORT
QUALITY_COST
FINANCING_COST
OTHER_ALLOCABLE_COST
```

Not every component applies to every trade.

---

# 11. Cost Component Model

Conceptually:

```text
CostComponent
├── type
├── amount
├── currency
├── source
├── estimated_or_actual
├── allocation_basis
├── effective_at
├── provider_reference?
└── evidence_reference?
```

---

# 12. Estimated vs Actual Cost

Baobab SHALL distinguish:

```text
ESTIMATED
```

from:

```text
ACTUAL
```

A quote may need to be issued before final freight, duty or FX cost is known.

Therefore estimated landed cost is legitimate.

It SHALL not masquerade as final accounting cost.

---

# 13. Estimated Landed Cost

Conceptually:

```text
Purchase Price
+
Estimated Freight
+
Estimated Insurance
+
Estimated Customs
+
Estimated Brokerage
+
Estimated Local Costs
=
Estimated Landed Cost
```

---

# 14. Actual Landed Cost

After transaction execution:

```text
Actual Purchase Cost
+
Actual Freight
+
Actual Insurance
+
Actual Customs
+
Actual Brokerage
+
Actual Allocated Charges
=
Actual Landed Cost
```

---

# 15. Variance

The system SHOULD calculate:

```text
Actual Landed Cost
-
Estimated Landed Cost
=
Landed Cost Variance
```

This is commercially significant.

---

# 16. Example

Estimated:

```text
Purchase:       10,000
Freight:         1,500
Duty:              500
Other:             500
-----------------------
Estimated Cost: 12,500
```

Actual:

```text
Purchase:       10,000
Freight:         1,700
Duty:              620
Other:             600
-----------------------
Actual Cost:    12,920
```

Variance:

```text
420
```

---

# 17. Margin Risk

If selling price was calculated from 12,500 but actual cost becomes 12,920, the realised margin declines.

Baobab SHALL surface this.

---

# 18. Commercial Cost Basis

The commercial pricing engine MAY use a cost basis derived from:

```text
actual cost
latest actual cost
estimated landed cost
standard cost
weighted average cost
replacement cost
policy-adjusted cost
```

The selected basis SHALL be explicit.

---

# 19. Cost Basis Is Policy

No single cost basis SHALL be hard-coded globally.

Example:

```text
local stock sale
→ weighted average cost
```

while:

```text
future import quote
→ estimated landed cost
```

may be appropriate.

---

# 20. Cost Basis Model

Conceptually:

```text
CommercialCostBasis
├── product
├── legal_entity
├── market
├── stock_location?
├── trade_lane?
├── cost_basis_type
├── amount
├── currency
├── source
├── version
├── observed_at
└── valid_until?
```

---

# 21. Pricing Formula

A generic commercial pricing formula MAY be:

```text
Commercial Cost Basis
+
Operational Cost Allocation
+
Risk Adjustment
+
Target Margin
=
Commercial Target Price
```

---

# 22. Margin vs Markup

The system SHALL distinguish:

```text
markup
```

from:

```text
gross margin
```

They are mathematically different.

---

# 23. Markup

```text
Selling Price =
Cost × (1 + Markup %)
```

Example:

```text
Cost = 100
Markup = 25%

Price = 125
```

---

# 24. Gross Margin

```text
Margin % =
(Price - Cost) / Price
```

To achieve 25% margin:

```text
Price =
Cost / (1 - 0.25)
```

If cost is 100:

```text
Price = 133.33
```

---

# 25. No Ambiguous Margin Field

This is prohibited:

```text
margin = 25
```

without defining whether it means:

```text
markup
gross margin
contribution margin
```

---

# 26. Margin Policy

Baobab SHOULD support:

```text
MarginPolicy
├── type
├── target
├── minimum
├── product scope
├── market scope
├── customer scope?
├── legal entity scope
├── trade lane scope?
├── valid_from
├── valid_to
└── approval requirements
```

---

# 27. Minimum Commercial Price

A minimum price MAY be resolved as:

```text
Commercial Cost Basis
+
Minimum Required Margin
=
Minimum Commercial Price
```

using the configured margin method.

---

# 28. Hard Floor vs Soft Floor

Pricing policies SHOULD distinguish:

```text
HARD_FLOOR
```

and:

```text
SOFT_FLOOR
```

Hard floor:

```text
price below floor → BLOCK
```

Soft floor:

```text
price below floor → REQUIRE APPROVAL
```

---

# 29. Override

Price overrides SHALL require:

```text
actor
reason
previous price
new price
margin effect
approval
timestamp
```

---

# 30. Customer Price Resolution

Conceptually:

```text
Base Commercial Price
        ↓
Market Price List
        ↓
Customer Agreement
        ↓
Volume Tier
        ↓
Contract Terms
        ↓
Currency Resolution
        ↓
Tax Treatment
        ↓
Final Commercial Price
```

---

# 31. Existing ADR-0012 Relationship

ADR-0012 remains authoritative for:

```text
price lists
customer groups
commercial terms
promotions
```

ADR-0020 adds the missing foundation beneath those constructs:

```text
cost basis
landed cost
margin floor
commercial price governance
```

---

# 32. Sell Price Shall Not Directly Read Supplier Price

This is prohibited:

```text
selling price =
supplier price × markup
```

as the universal rule.

It ignores:

- freight;
- duty;
- insurance;
- tax treatment;
- currency;
- quality;
- storage;
- financing;
- market-specific costs.

---

# 33. Cross-Border Cost Context

Landed-cost resolution SHALL consider:

```text
origin
destination
seller
buyer
product
trade lane
Incoterm
transport mode
currency
transaction date
```

---

# 34. Trade Lane

The same product may have different cost bases for:

```text
UG → ZA
UG → KE
UG → UAE
```

because cost composition differs.

---

# 35. Market-Specific Cost

Likewise:

```text
Coffee in Kampala
```

and:

```text
same coffee in Johannesburg
```

may have materially different commercial cost.

---

# 36. Inventory and Cost

Inventory positions SHOULD be linkable to cost context.

Conceptually:

```text
Inventory Lot
      │
      ▼
Financial Cost
      │
      ▼
Commercial Cost Projection
```

---

# 37. Lot-Specific Cost

Where practical, cost may be lot-specific.

For commodity trading, this may improve commercial accuracy.

---

# 38. Average Cost

Where ERP uses weighted average valuation, Trade MAY receive:

```text
current weighted average
```

as a commercial cost basis.

---

# 39. Standard Cost

Standard cost MAY be used for planning but SHALL be identifiable as:

```text
STANDARD
```

rather than actual.

---

# 40. Replacement Cost

A product bought cheaply six months ago may now be expensive to replace.

Therefore pricing MAY use:

```text
replacement cost
```

instead of historical accounting cost under policy.

Pulse can assist.

---

# 41. Cost Freshness

Cost projections SHALL include:

```text
observed_at
valid_at
source
```

A stale cost should not silently drive critical quotes indefinitely.

---

# 42. Staleness Policy

Example:

```text
FX older than 24h
→ warning or refresh

freight estimate older than 14 days
→ refresh

commodity benchmark older than policy limit
→ refresh
```

Actual thresholds are configuration.

---

# 43. Foreign Exchange

FX SHALL be explicit.

A cost may originate in:

```text
UGX
USD
ZAR
EUR
```

while customer price may be in another currency.

---

# 44. FX Sources

Potential FX inputs:

```text
ERP accounting rate
contract rate
treasury rate
market reference rate
Pulse projection
```

The selected source SHALL be policy-driven.

---

# 45. Quote FX Lock

A quotation MAY:

```text
lock FX
```

or:

```text
float FX until acceptance
```

depending on commercial terms.

This SHALL be explicit.

---

# 46. FX Risk Premium

Trade MAY apply:

```text
FX risk buffer
```

to price when:

```text
quote validity
+
currency volatility
```

creates exposure.

---

# 47. Tax

Tax SHALL not normally be embedded ambiguously in cost.

The system SHALL distinguish:

```text
recoverable tax
non-recoverable tax
tax charged to customer
```

because accounting consequences differ.

---

# 48. Import VAT

Import VAT may or may not form part of commercial cost depending on recoverability and jurisdiction.

Therefore:

```text
Import VAT
```

SHALL NOT automatically be treated as permanent landed cost.

---

# 49. Customs Duty

Customs duty typically contributes to landed cost where borne by importer.

The applicable customs ADR governs duty-resolution semantics.

---

# 50. Incoterms

Cost responsibility changes with Incoterm.

Example:

```text
EXW
```

places more transport responsibility on buyer than:

```text
DDP
```

Therefore landed-cost estimation SHALL use Incoterm context.

---

# 51. Freight

Freight MAY be:

```text
included in supplier price
separately charged
paid directly by buyer
paid by seller then recovered
```

The cost model SHALL avoid double-counting.

---

# 52. Cost Inclusion Metadata

A cost component SHOULD support:

```text
included_in_base_price = true/false
```

or equivalent semantics where necessary.

---

# 53. Insurance

Insurance SHALL be separately representable when economically material.

---

# 54. Port and Brokerage Charges

Port, clearing and brokerage charges SHALL be extensible cost components rather than hard-coded country-specific fields.

---

# 55. Financing Cost

Long transit periods or extended supplier/customer payment terms may create financing cost.

Pricing MAY incorporate:

```text
cost of capital
```

under policy.

---

# 56. Cost of Carry

Inventory held for long periods may incur:

```text
warehouse cost
insurance
financing
shrinkage risk
```

A commercial cost basis MAY include cost-of-carry adjustments.

---

# 57. Operational Cost

Commercial pricing MAY include configurable allocations for:

```text
handling
quality assurance
administration
sales cost
distribution
```

These SHALL remain distinguishable from accounting inventory cost.

---

# 58. Risk Adjustment

A pricing policy MAY include risk premium for:

```text
FX volatility
customer credit
market volatility
perishability
logistics uncertainty
```

This SHALL be explicit, not hidden in unexplained price padding.

---

# 59. Customer Credit Cost

Net-30 pricing MAY differ from cash pricing.

Conceptually:

```text
Base Commercial Price
+
Credit Cost
=
Credit-Term Price
```

if policy permits.

---

# 60. Volume Pricing

Volume discounts SHALL remain constrained by margin floors.

Example:

```text
100 units → 100
1,000 units → 95
10,000 units → 90
```

but:

```text
90 < minimum permitted commercial price
```

must trigger policy.

---

# 61. Contract Pricing

Contract price MAY override standard price.

However, margin impact SHALL remain visible.

---

# 62. Customer-Specific Pricing

Customer agreement may produce:

```text
customer A = 100
customer B = 95
```

while both consume the same cost projection.

---

# 63. Quote-Specific Pricing

B2B RFQ/quotation workflows may calculate bespoke price.

Conceptually:

```text
Product
+
Quantity
+
Customer
+
Destination
+
Incoterm
+
Delivery Date
+
Currency
+
Cost Basis
+
Margin Policy
=
Quote Price
```

---

# 64. Pricing Snapshot

Once a quotation is issued, the pricing decision SHALL be reproducible.

Therefore Trade SHOULD persist:

```text
cost basis snapshot
FX snapshot
margin rule
price rule
customer terms
tax context
version
```

rather than recalculating historical quotes from current data.

---

# 65. Historical Reproducibility

The system must answer:

```text
Why was this price quoted?
```

months later.

---

# 66. Quote Validity

A quote SHALL have:

```text
valid_from
valid_until
```

where commercial policy requires.

---

# 67. Quote Expiry

Expired quotations SHALL not be silently accepted unless policy explicitly allows extension or revalidation.

---

# 68. Price Revalidation

Before order commitment, Trade MAY verify:

```text
cost change
FX change
availability
tax change
```

against tolerance.

---

# 69. Material Price Drift

Example:

```text
quoted landed cost = 100
current landed cost = 125
```

If tolerance is 5%:

```text
25% drift
→ require reprice
```

---

# 70. Price Commitment

Once the customer accepts a valid quotation and commitment occurs, Trade SHALL preserve the agreed price regardless of later internal cost changes unless the contract permits adjustment.

---

# 71. Actual Margin

After actual cost is known:

```text
Actual Margin =
Final Selling Price
-
Actual Commercial Cost
```

and percentage metrics SHOULD be calculable.

---

# 72. Expected vs Realised Margin

Baobab SHOULD distinguish:

```text
EXPECTED_MARGIN
REALIZED_MARGIN
```

---

# 73. Margin Variance

```text
Realized Margin
-
Expected Margin
=
Margin Variance
```

This is a key management metric.

---

# 74. Example — Uganda Coffee to South Africa

Assume:

```text
Coffee purchase:      USD 4,000
Processing:             USD 300
Origin transport:       USD 200
Freight:                USD 800
Insurance:              USD 100
Duty/charges:           USD 400
Destination haulage:    USD 200
--------------------------------
Estimated landed:     USD 6,000
```

If target gross margin is 25%:

```text
Price =
6,000 / (1 - 0.25)

= 8,000
```

That is different from applying a 25% markup:

```text
6,000 × 1.25 = 7,500
```

Baobab SHALL know which method is intended.

---

# 75. Example — South African Wine to Uganda

The same pricing engine can consume different cost components:

```text
wine purchase
packaging
excise-related cost where applicable
freight
insurance
export costs
import costs
local distribution
```

No wine-specific core pricing engine is required.

---

# 76. Local Sale

For stock procured and sold within one market:

```text
Local Cost Basis
+
Local Operational Cost
+
Margin Policy
=
Local Commercial Price
```

No artificial cross-border components SHALL be introduced.

---

# 77. Internal Cross-Market Trade

If goods move internally:

```text
UG entity → ZA entity
```

the cost basis may include:

```text
transfer price
freight
customs
destination charges
```

rather than original supplier cost alone.

---

# 78. Intercompany Transfer Price

Transfer price and external selling price SHALL remain separate.

```text
Intercompany Transfer Price
≠
Final Customer Selling Price
```

---

# 79. Inter-Branch Movement

For same legal entity, internal transfer may preserve financial ownership but still add:

```text
freight
customs
handling
landed cost
```

to destination inventory cost.

---

# 80. Procurement Integration

ADR-0019 provides:

```text
Supplier Quote
Purchase Order
Receipt
Supplier Invoice
```

These feed financial cost.

---

# 81. Inventory Integration

ADR-0013 and ADR-BCP-013 provide:

```text
Inventory Position
Legal Owner
Lot
Location
In Transit
```

Cost projections SHALL map to the correct inventory context.

---

# 82. Tax Integration

ADR-0018 supplies:

```text
tax jurisdiction
legal seller
legal buyer
transaction context
```

Pricing SHALL consume tax outputs.

It SHALL not independently determine legal tax obligations.

---

# 83. Pricing Resolver

Baobab Trade SHOULD expose a deterministic pricing resolver.

Conceptually:

```text
resolvePrice(context)
```

where context includes:

```text
tenant
seller legal entity
buyer
market
origin
destination
product
quantity
currency
trade lane
Incoterm
sales channel
contract
date/time
```

---

# 84. Resolver Flow

```text
Pricing Request
      ↓
Resolve Context
      ↓
Resolve Cost Basis
      ↓
Resolve Margin Policy
      ↓
Resolve Price List
      ↓
Resolve Customer Terms
      ↓
Resolve Volume Rule
      ↓
Resolve Currency
      ↓
Resolve Tax
      ↓
Validate Floor
      ↓
Return Commercial Price
```

---

# 85. Determinism

The same pricing request with the same:

```text
context
policy versions
cost snapshot
```

SHOULD yield the same result.

---

# 86. Pricing Explanation

The resolver SHOULD support explainability.

Example:

```text
Base cost:             100
Operational cost:        5
Target margin:          20%
Volume adjustment:      -3
Customer contract:      -2
Final price:           126
```

Exact calculation depends on selected margin method.

---

# 87. Price Provenance

Every resolved commercial price SHOULD record:

```text
cost source
cost version
margin policy
price-list rule
customer terms
FX source
tax reference
approval reference
resolver version
```

---

# 88. No Hidden Price Mutation

Once a quotation/order is committed, external provider refreshes SHALL NOT silently change its price.

---

# 89. Approval

Price below threshold SHOULD route:

```text
Sales User
   ↓
Pricing Policy
   ↓
Approval Required
   ↓
Manager / Commercial Authority
```

---

# 90. Approval Levels

Approval may depend on:

```text
discount
margin erosion
deal value
customer class
market
product
```

---

# 91. Negative Margin

Negative-margin sales SHALL be blocked by default unless explicitly authorised.

---

# 92. Zero Margin

Zero-margin or cost-price sales MAY be permitted for:

```text
strategic transaction
inventory liquidation
internal transfer
promotion
```

only through explicit policy.

---

# 93. Promotion Boundary

B2C-style promotion mechanics MAY reduce price.

For ZuriBeans B2B:

```text
commercial agreement
volume pricing
contract terms
```

SHOULD generally be preferred over uncontrolled promotional discounting.

---

# 94. Currency Rounding

Price calculation SHALL have currency-aware rounding rules.

---

# 95. Unit Pricing

Pricing SHALL preserve:

```text
unit of measure
pack size
price unit
```

Example:

```text
USD / kg
ZAR / case
UGX / bag
```

---

# 96. UOM Conversion

If purchasing in:

```text
50 kg bags
```

and selling in:

```text
kg
```

cost conversion SHALL use governed UOM mappings.

---

# 97. No Floating-Point Money

Money calculations SHALL use decimal/fixed precision appropriate to currency and domain.

Binary floating-point SHALL not be used for authoritative monetary calculations.

---

# 98. Precision

Intermediate calculations SHOULD retain sufficient precision before final currency rounding.

---

# 99. Cost Allocation

Shared freight or landed cost across multiple products SHALL use explicit allocation basis.

Examples:

```text
quantity
weight
volume
value
custom allocation
```

---

# 100. Allocation Example

Shipment:

```text
Coffee A: 800 kg
Coffee B: 200 kg
Freight: USD 1,000
```

Weight allocation:

```text
A → 800
B → 200
```

---

# 101. Allocation Provenance

The allocation basis SHALL be persisted or reproducible.

---

# 102. Partial Shipment

Costs may require allocation across partial shipments.

The architecture SHALL support:

```text
PO
 ├── Shipment 1
 └── Shipment 2
```

with different freight or customs costs.

---

# 103. Cost Adjustments After Receipt

Late invoices may change actual landed cost.

Example:

```text
freight invoice received after goods receipt
```

ERP may reallocate cost.

Trade SHOULD receive updated actual-cost projection for margin analysis.

---

# 104. Cost Adjustment Shall Not Rewrite Historical Customer Price

It changes realised margin.

It does not automatically rewrite an already committed sales price.

---

# 105. Replacement-Cost Pricing

For commodity volatility, Trade MAY price current stock using market replacement cost rather than historical stock cost.

This SHALL be explicitly configured.

---

# 106. Pulse Integration

Pulse MAY provide:

```text
coffee benchmark
wine-market indicators
FX
freight index
commodity trend
```

These can influence:

```text
replacement cost
risk adjustment
commercial recommendation
```

but should not silently override approved commercial rules.

---

# 107. Recommendation vs Authority

Pulse:

```text
RECOMMENDS
```

Trade pricing policy:

```text
DECIDES
```

unless an explicit automated policy delegates decision authority.

---

# 108. External Price Intelligence

External benchmarks SHALL carry:

```text
source
timestamp
confidence
currency
unit
```

---

# 109. Pricing Security

Pricing operations SHALL be tenant-isolated.

A user authorised for:

```text
ZuriBeans
```

shall not resolve:

```text
Thamani cost basis
```

---

# 110. Cost Sensitivity

Supplier cost and margin data are commercially sensitive.

Buyer-facing APIs SHALL NOT expose:

```text
supplier cost
landed cost
margin
internal markup
```

unless explicitly authorised.

---

# 111. Customer-Facing Output

Customer receives:

```text
price
currency
tax treatment where appropriate
commercial terms
validity
```

not internal cost construction.

---

# 112. Supplier Isolation

Supplier A SHALL NOT view:

```text
Supplier B price
Supplier B cost
ZuriBeans margin
```

---

# 113. Internal Role Separation

Commercial staff MAY see:

```text
sell price
margin
```

while procurement staff MAY see:

```text
supplier cost
```

according to IAM policy.

---

# 114. ERP Projection Contract

ERP SHOULD expose canonical cost information such as:

```text
ProductCostProjection
InventoryCostProjection
LandedCostProjection
```

without forcing Trade to understand iDempiere tables.

---

# 115. Example Cost Projection

Conceptually:

```json
{
  "product_id": "canonical-product-001",
  "legal_entity_id": "zb-za",
  "market_id": "ZA",
  "cost_type": "ACTUAL_LANDED",
  "amount": "120.45",
  "currency": "ZAR",
  "observed_at": "2026-09-12T10:00:00Z"
}
```

---

# 116. No Direct ERP Table Reads

Trade SHALL NOT query iDempiere tables directly for cost.

Use:

```text
API
event projection
canonical integration contract
```

---

# 117. Pricing Events

Trade SHOULD publish events such as:

```text
commercial-price.resolved
commercial-price.overridden
commercial-price.approved
commercial-price.expired
margin-floor.breached
quote-priced
```

---

# 118. Cost Events

ERP/integration SHOULD publish:

```text
product-cost.updated
landed-cost.estimated
landed-cost.finalized
inventory-cost.adjusted
```

where required.

---

# 119. Event Idempotency

Duplicate cost-update events SHALL not produce duplicate pricing records or uncontrolled repricing.

---

# 120. Reconciliation

Pricing reconciliation SHOULD verify:

```text
commercial cost basis
↕
ERP authoritative cost

quote snapshot
↕
resolved pricing policy

final order price
↕
accepted quotation
```

---

# 121. Drift Detection

Detect:

```text
stale cost
missing ERP cost
unknown FX
expired price policy
below-floor quote
```

---

# 122. Failure — ERP Cost Unavailable

Possible policy:

```text
use last valid cost within freshness threshold
```

or:

```text
block quote
```

The response SHALL be explicit.

Trade SHALL not silently assume zero cost.

---

# 123. Failure — Missing Freight Estimate

Cross-border pricing requiring freight SHALL either:

```text
BLOCK
```

or:

```text
use approved fallback estimate
```

according to policy.

---

# 124. Failure — Missing FX

Cross-currency price SHALL fail closed unless an authorised fallback exists.

---

# 125. Failure — Margin Below Floor

```text
resolved price
<
minimum commercial price
```

shall:

```text
BLOCK
```

or:

```text
REQUIRE APPROVAL
```

based on policy.

---

# 126. Failure — Cost Changes After Quote

If quote remains within validity:

```text
price remains committed
```

unless contract says otherwise.

Margin variance is recorded.

---

# 127. Failure — Quote Expired

The quote SHALL require:

```text
revalidation
or
repricing
```

before commitment.

---

# 128. Observability

Recommended metrics:

```text
pricing_resolution_total
pricing_resolution_failure_total

landed_cost_estimate_variance
landed_cost_finalization_duration

commercial_margin_expected
commercial_margin_realized
commercial_margin_variance

margin_floor_breach_total
price_override_total
price_approval_total

stale_cost_projection_total
```

---

# 129. Audit

The system SHALL audit:

```text
cost basis selected
margin policy applied
price rules applied
override
approval
FX source
price snapshot
quote version
```

---

# 130. B2B Quote Simulation — UG Coffee to ZA

The staging simulation SHALL prove:

```text
Supplier Quote
   ↓
Estimated Procurement Cost
   ↓
Freight Estimate
   ↓
Customs Estimate
   ↓
Landed Cost
   ↓
Margin Policy
   ↓
Customer Quote
   ↓
Acceptance
   ↓
Order
   ↓
Actual Costs
   ↓
Realized Margin
```

---

# 131. B2B Quote Simulation — ZA Wine to UG

The same architecture SHALL prove:

```text
ZA supplier cost
+
ZA origin charges
+
freight
+
UG import charges
+
commercial margin
=
UG B2B offer
```

No country-specific pricing code.

---

# 132. Local Sale Simulation

Prove:

```text
local procurement cost
+
local handling
+
margin
=
local B2B price
```

without cross-border cost components.

---

# 133. Intercompany Simulation

Prove:

```text
transfer price
+
cross-market landed costs
+
destination margin
=
external customer price
```

where separate related entities are used.

---

# 134. Test Matrix

At minimum:

| Scenario                | Expected                              |
| ----------------------- | ------------------------------------- |
| Actual cost available   | Use authorised cost basis             |
| Estimated landed cost   | Mark estimate                         |
| Missing cost            | Block/fallback by policy              |
| Margin below hard floor | Block                                 |
| Margin below soft floor | Approval                              |
| Contract price          | Apply contract                        |
| Volume pricing          | Apply eligible tier                   |
| Expired quote           | Revalidate                            |
| FX unavailable          | Block/fallback                        |
| Cross-border cost       | Include lane costs                    |
| Local trade             | Exclude irrelevant cross-border costs |
| Actual cost drift       | Record margin variance                |
| Duplicate cost event    | Idempotent                            |

---

# 135. Rejected Alternative — ERP Owns All Selling Price

Rejected because ERP is the financial authority, not the B2B customer-experience and commercial decision engine.

---

# 136. Rejected Alternative — Trade Owns Authoritative Cost

Rejected because it would create a duplicate financial-cost ledger.

---

# 137. Rejected Alternative — Supplier Price Is Cost Basis

Rejected because it ignores landed and operational economics.

---

# 138. Rejected Alternative — One Global Margin

Rejected because margin may vary by:

```text
product
market
customer
volume
trade lane
risk
contract
```

---

# 139. Rejected Alternative — Hard-Code Uganda/South Africa Cost Rules

Rejected.

Rules must derive from:

```text
context
trade lane
tax
customs
provider configuration
```

---

# 140. Rejected Alternative — Recalculate Historical Quote With Current Inputs

Rejected because it destroys auditability.

Historical quote pricing SHALL use snapshots/versioned references.

---

# 141. Positive Consequences

This decision provides:

- defensible B2B pricing;
- real landed-cost awareness;
- protection against margin erosion;
- explicit margin governance;
- cross-border price accuracy;
- quote reproducibility;
- ERP/Trade separation;
- FX-aware pricing;
- commercial intelligence integration;
- realised-margin analysis.

---

# 142. Complexity Consequences

It introduces:

- cost projections;
- additional pricing metadata;
- policy versioning;
- cost freshness;
- margin governance;
- FX integration;
- reconciliation;
- quote snapshots.

This is necessary for serious B2B trading.

---

# 143. Repository Responsibilities

| Repository             | Responsibility                            |
| ---------------------- | ----------------------------------------- |
| `nabhold/shared`       | Canonical cost/pricing contracts          |
| `nabhold/baobab-trade` | Commercial pricing, margin, quote pricing |
| `nabhold/baobab-erp`   | Financial/landed/inventory cost           |
| `nabhold/baobab-cp`    | Context and provider resolution           |
| `nabhold/baobab-pulse` | Optional market/FX intelligence           |
| `nabhold/zuribeans`    | Commercial price/quotation UI             |
| `nabhold/baobab-iam`   | Pricing role/approval authority           |

---

# 144. Implementation Sequence

```text
Canonical Cost Contracts
       ↓
ERP Cost Projection
       ↓
Trade Cost-Basis Resolver
       ↓
Margin Policy
       ↓
Commercial Price Resolver
       ↓
Quote Snapshot
       ↓
Approval / Override
       ↓
Order Commitment
       ↓
Actual Cost Update
       ↓
Realized Margin
       ↓
Reconciliation
```

---

# 145. Release 1 P0

ZuriBeans Release 1 SHALL include:

- purchase-price projection;
- estimated landed cost;
- actual landed-cost projection;
- commercial cost-basis selection;
- gross-margin and markup distinction;
- target margin;
- minimum price floor;
- price approval;
- customer-specific price resolution;
- quote pricing;
- FX-aware pricing;
- price snapshot;
- expected margin;
- realised margin;
- cost/margin reconciliation.

---

# 146. Release 1.1 Candidates

May follow:

- replacement-cost automation;
- dynamic commodity-based pricing;
- automated freight intelligence;
- AI pricing recommendations;
- advanced risk premium;
- customer profitability;
- forward FX pricing;
- market elasticity models.

---

# 147. Definition of Done

ADR-0020 is implemented when:

- [ ] canonical cost components exist;
- [ ] ERP exposes authorised cost projection;
- [ ] Trade consumes cost without direct DB coupling;
- [ ] estimated and actual landed cost differ explicitly;
- [ ] commercial cost-basis policy exists;
- [ ] markup and gross margin are separate;
- [ ] minimum price floor exists;
- [ ] below-floor approval works;
- [ ] customer-specific pricing composes with cost/margin;
- [ ] volume pricing respects floor policy;
- [ ] quote snapshots are reproducible;
- [ ] FX source is explicit;
- [ ] stale-cost policy exists;
- [ ] cost events are idempotent;
- [ ] actual-cost changes create margin variance, not historical price mutation;
- [ ] realised margin exists;
- [ ] cross-tenant cost isolation passes;
- [ ] UG→ZA pricing simulation passes;
- [ ] ZA→UG pricing simulation passes;
- [ ] local-market pricing simulation passes;
- [ ] no shadow accounting cost ledger exists in Trade.

---

# 148. Final Architecture

```text
                    PROCUREMENT
                        │
                        ▼
                   BAOBAB ERP
             Financial Cost Authority
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    Purchase Cost   Landed Cost   Inventory Cost
          │             │             │
          └─────────────┼─────────────┘
                        ▼
               Canonical Cost Projection
                        │
                        ▼
                  BAOBAB TRADE
                        │
              Commercial Cost Basis
                        │
                        ▼
                    Margin Policy
                        │
                        ▼
             Minimum Commercial Price
                        │
            ┌───────────┼────────────┐
            ▼           ▼            ▼
        Price List   Contract     Customer
                      Terms        Terms
            │           │            │
            └───────────┼────────────┘
                        ▼
                    Quote Price
                        │
                        ▼
                  Customer Order
                        │
                        ▼
               Actual Cost Reconcile
                        │
                        ▼
                  Realized Margin
```

The governing principle is:

> **Financial cost comes from the financial authority. Commercial price is resolved by the commerce authority. Margin policy governs the relationship between the two.**

Baobab therefore SHALL know not only **what price was charged**, but also:

```text
why that price was selected,
what cost basis supported it,
what margin was expected,
and what margin was ultimately realised.
```

---

# Decision Outcome

**ACCEPTED WHEN APPROVED**

Implementation SHALL proceed:

```text
ADR-0020
   ↓
Shared Cost Contracts
   ↓
ERP Cost Projection
   ↓
Trade Cost Resolver
   ↓
Margin Policy
   ↓
Price Resolver
   ↓
Quotation
   ↓
Order
   ↓
Actual Cost
   ↓
Margin Reconciliation
   ↓
ZuriBeans Golden-Tenant Validation
```

No production pricing implementation SHALL equate supplier purchase price with true commercial cost or allow a B2B quotation to bypass explicit margin governance.
