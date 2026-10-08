# ADR-0010: MedusaJS Commerce Market, Region, Currency, Sales Channel and Legal Seller Model

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0009-medusajs-commerce-tenancy-and-isolation-model.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates
- **Decision Class:** Commerce Context / Internationalisation / Market Architecture

---

## 1. Context

Baobab is intended to support independently evolving organisations operating across different countries, regions, currencies, customer segments and digital channels.

The Commerce Engine must therefore support situations such as:

```text
Tenant
  │
  ├── South Africa
  │      ├── B2C
  │      └── B2B
  │
  ├── Uganda
  │      ├── B2C
  │      └── B2B
  │
  └── Kenya
         └── B2B
```

while also supporting cases in which one commercial market spans several countries or several digital estates participate in the same market.

The platform must not encode the assumption:

```text
Country = Market
```

nor:

```text
Market = Medusa Region
```

nor:

```text
Market = Currency
```

nor:

```text
Market = Sales Channel
```

nor:

```text
Market = Legal Entity
```

nor:

```text
Market = Tenant
```

These dimensions frequently correlate, but they answer different architectural questions.

The distinction becomes especially important when Baobab expands across African and international markets.

---

# 2. Decision

Baobab SHALL define `Market` as a canonical Control Plane concept representing a **governed commercial operating context**.

A Baobab Market SHALL describe the circumstances under which a product or service is commercially offered.

Medusa-native commerce concepts SHALL implement portions of this Market but SHALL NOT individually replace it.

A Market MAY resolve or bind:

```text
Market
  │
  ├── Tenant / organisational scope
  ├── Legal Seller
  ├── Countries
  ├── Currency policy
  ├── Medusa Region
  ├── Sales Channel
  ├── Pricing Context
  ├── Tax Context
  ├── Payment Context
  ├── Fulfilment Context
  ├── Inventory Context
  ├── Digital Estate eligibility
  └── EngineInstance
```

The canonical relationship SHALL therefore be compositional.

---

# 3. Fundamental Model

The architecture SHALL distinguish:

```text
Tenant
Market
Country
Geographic Region
Medusa Region
Currency
Sales Channel
Legal Seller
Digital Estate
EngineInstance
```

These SHALL remain independently identifiable concepts.

Conceptually:

```text
                        Tenant
                           │
                           ▼
                         Market
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
 Legal Seller          Countries         Sales Channel
       │                   │                   │
       │                   ▼                   │
       │              Tax Context              │
       │                                       │
       ├──────────────┐                        │
       │              │                        │
       ▼              ▼                        ▼
   Currency      Payment Context          Catalogue/
      Policy                              Price Context
       │
       └───────────────────┬───────────────────┘
                           ▼
                     Medusa Projection
```

---

# 4. Definition of Market

A Baobab `Market` answers:

> Under what governed commercial conditions is an offering made available?

A Market therefore represents a commercial boundary rather than merely a geographic boundary.

Examples could conceptually include:

```text
South Africa Retail
South Africa Wholesale
East Africa B2B
Uganda Consumer
European Union Wholesale
Global Export
```

The actual canonical names and identifiers SHALL be data, not hard-coded application constants.

---

# 5. Market Identity

Every Market SHALL possess a stable canonical identifier.

The identifier SHOULD use the UUID strategy established by the Control Plane implementation contract.

For example:

```text
market_id = 019...
```

Human-readable codes MAY additionally exist:

```text
ZA-B2C
ZA-B2B
UG-B2C
EA-B2B
```

but codes SHALL NOT replace canonical identity.

Codes MAY change.

Canonical identifiers SHALL remain stable.

---

# 6. Market Lifecycle

A Market SHALL have an explicit lifecycle.

At minimum, the canonical model SHOULD distinguish states conceptually equivalent to:

```text
DRAFT
   │
   ▼
PROVISIONING
   │
   ▼
ACTIVE
   │
   ▼
SUSPENDED
   │
   ▼
RETIRED
```

Exact lifecycle states SHALL remain owned by the Control Plane specification.

Medusa SHALL consume the resulting state.

---

# 7. Market Activation

A Market MUST NOT become commercially active merely because a Medusa Region or Sales Channel exists.

Activation SHOULD require successful validation of required bindings.

Conceptually:

```text
Market
  │
  ├── Legal Seller ✓
  ├── Currency ✓
  ├── Commerce Engine ✓
  ├── Pricing ✓
  ├── Payment ✓
  ├── Tax ✓
  └── Fulfilment ✓
        │
        ▼
      ACTIVE
```

Required capabilities MAY differ according to business model.

---

# 8. Country Is Not Market

A country represents a jurisdiction/geographic concept.

A Market represents a commercial concept.

Therefore:

```text
Country 1:N Market
```

is valid.

For example:

```text
South Africa
    │
    ├── Consumer Retail Market
    ├── Wholesale Market
    └── Institutional Market
```

Likewise:

```text
Market N:M Country
```

MAY be valid where a commercial market spans multiple countries.

---

# 9. Geographic Region Is Not Medusa Region

Baobab SHALL distinguish geographic terminology from Medusa's native commerce concept of Region.

For clarity:

```text
Geographic Region
```

may mean:

```text
Southern Africa
East Africa
European Union
```

while:

```text
Medusa Region
```

is an engine-native commerce configuration.

These SHALL NOT share identity merely because both use the word "region."

---

# 10. Medusa Region

A Medusa Region SHALL be treated as an **engine-native commerce projection** used to implement aspects of a Baobab Market.

A mapping SHALL conceptually resemble:

```text
Baobab Market
     │
     ▼
ExternalReference / Mapping
     │
     ▼
Medusa Region
```

The Medusa Region ID SHALL remain engine-native.

---

# 11. Market-to-Region Cardinality

Baobab SHALL NOT permanently enforce:

```text
1 Market = 1 Medusa Region
```

even if that is the preferred initial mapping.

The canonical mapping model SHALL permit evolution where necessary.

Possible relationships include:

```text
Market
  │
  └── Medusa Region
```

or, where future implementation requires:

```text
Market
  │
  ├── Medusa Region A
  └── Medusa Region B
```

Such complexity SHALL only be introduced when justified.

---

# 12. Currency Is Not Market

Currency answers:

> In what monetary denomination is this amount expressed?

It does not answer:

> Under what complete commercial conditions is this offering available?

Therefore:

```text
Market != Currency
```

Multiple Markets MAY use the same currency.

A Market MAY support one or more currencies where its commercial model permits.

---

# 13. Currency Standard

Canonical currency identifiers SHALL use ISO 4217 currency codes.

Examples:

```text
ZAR
UGX
KES
USD
EUR
GBP
```

Application code MUST NOT invent proprietary currency identifiers where an ISO currency exists.

---

# 14. Monetary Representation

Money crossing a platform boundary SHALL be represented using a canonical money structure.

Conceptually:

```text
Money {
    amount
    currency
}
```

`amount` SHALL use an exact monetary representation.

Binary floating-point arithmetic SHALL NOT be used for canonical monetary calculations.

---

# 15. Minor Units

Where integer minor-unit representation is used:

```text
R 125.50
```

may be represented conceptually as:

```text
amount = 12550
currency = ZAR
```

Currency-specific decimal rules SHALL be respected.

Code SHALL NOT assume that every currency has exactly two decimal places.

---

# 16. Transaction Currency

Every Commerce order SHALL have an unambiguous transaction currency.

Once financially committed, the transaction currency SHALL NOT be silently changed.

Currency conversion requires an explicit business process.

---

# 17. Reporting Currency

Transaction currency and enterprise reporting currency SHALL remain separate.

For example:

```text
Commerce Order
    transaction_currency = USD

ERP Legal Entity
    accounting_currency = ZAR
```

is valid.

iDempiere SHALL remain authoritative for accounting treatment and financial reporting.

---

# 18. Foreign Exchange

Medusa SHALL NOT become the enterprise foreign-exchange authority merely because it supports multi-currency commerce.

Where FX conversion is required, the architecture SHALL identify:

```text
source currency
target currency
exchange rate
rate source
effective timestamp/date
conversion policy
```

The authoritative exchange-rate source SHALL be separately governed.

---

# 19. Explicit Prices Preferred

Where practical, commercial prices SHOULD be explicitly governed per currency rather than dynamically converting a single base price during checkout.

For example:

```text
Product
   │
   ├── ZAR 150.00
   ├── USD 8.50
   └── EUR 7.90
```

may represent intentional commercial pricing rather than mathematical FX equivalents.

This allows market-specific pricing strategy.

---

# 20. Sales Channel

A Sales Channel represents a route or channel through which commerce is conducted.

Examples MAY include:

```text
B2C Web
B2B Portal
Mobile
Marketplace
Wholesale API
Sales-assisted ordering
```

A Sales Channel SHALL NOT define tenancy.

---

# 21. Sales Channel and Market

A Market MAY expose multiple Sales Channels.

For example:

```text
South Africa Retail Market
      │
      ├── Web
      ├── Mobile
      └── Marketplace
```

Conversely, a logical channel type such as B2B MAY exist in multiple Markets.

---

# 22. Sales Channel and Digital Estate

Sales Channel and Digital Estate SHALL remain distinct.

A Digital Estate answers:

> Which independently governed digital property is presenting or consuming capabilities?

A Sales Channel answers:

> Through which commercial route is the transaction being conducted?

A digital estate MAY participate in multiple sales channels.

A sales channel MAY potentially be consumed by multiple authorised digital estates.

---

# 23. Legal Seller

Every financially meaningful Commerce transaction SHALL resolve a legal seller.

The Legal Seller represents the legal entity entering the sale.

It is essential for:

- contracts;
- invoicing;
- tax;
- payments;
- refunds;
- accounting;
- consumer protection;
- fulfilment obligations.

---

# 24. Legal Seller Is Not Tenant

The default tenant boundary may correspond to the legal seller in simple deployments.

The architecture SHALL nevertheless preserve:

```text
LegalSeller != Tenant
```

because the concepts answer different questions.

A tenant represents a governed platform boundary.

A Legal Seller represents a legal participant in a transaction.

---

# 25. Legal Seller Is Not EngineInstance

A Medusa EngineInstance MAY support more than one legal seller where its IsolationProfile permits.

Therefore:

```text
EngineInstance != LegalSeller
```

The seller MUST be resolved from trusted Context.

---

# 26. Legal Seller Is Not Market

A Market SHALL reference or resolve its permitted legal seller or sellers.

The simple case may be:

```text
Market 1:1 LegalSeller
```

but this SHALL NOT become an irreversible platform assumption.

Where multiple sellers are legally possible, the transaction MUST resolve exactly one seller before financial commitment.

---

# 27. Seller Resolution

Seller resolution SHALL occur before checkout becomes financially binding.

Conceptually:

```text
Context
   │
   ▼
Market
   │
   ▼
Seller Binding
   │
   ▼
Legal Seller
   │
   ▼
Checkout
```

An unresolved seller SHALL cause checkout to fail safely.

---

# 28. Seller Immutability on Order

Once an order is placed, its legal seller SHALL be immutable except through an explicit corrective business process.

Changing the seller after transaction commitment could alter:

- tax;
- payment ownership;
- invoice identity;
- contractual obligations;
- accounting.

Silent reassignment is prohibited.

---

# 29. Tax Context

Tax SHALL be resolved from more than Market alone where necessary.

Relevant inputs MAY include:

```text
Legal Seller
Customer
Customer Type
Product Tax Classification
Ship-to Jurisdiction
Bill-to Jurisdiction
Market
Transaction Type
```

Tax logic SHALL NOT be embedded in digital-estate frontend code.

---

# 30. Payment Context

Payment capability SHALL be bound to commercial Context.

Conceptually:

```text
Market
   │
   ├── Legal Seller
   ├── Currency
   └── Payment Policy
          │
          ▼
     Payment Provider
```

Different Markets MAY use different providers.

---

# 31. Merchant Account Isolation

Where a payment provider supports multiple merchant accounts, the correct merchant account SHALL be resolved from trusted server-side Context.

A frontend SHALL NOT be allowed to choose arbitrary merchant credentials or merchant-account identity.

---

# 32. Fulfilment Context

Fulfilment SHALL likewise be context-aware.

A Market MAY define:

```text
warehouse eligibility
delivery regions
shipping providers
pickup options
service levels
```

These MAY differ independently from currency or sales channel.

---

# 33. Inventory Context

Inventory availability may vary by:

```text
Market
Sales Channel
Stock Location
Warehouse
Allocation
Tenant
Legal Seller
```

The platform SHALL NOT equate enterprise physical stock with universally available commerce stock.

---

# 34. Stock Location

Medusa stock locations SHALL remain engine-native operational concepts.

Where a stock location corresponds to an enterprise warehouse or ERP location, the relationship SHALL use canonical mapping.

Example:

```text
Canonical Warehouse
      │
      ├── iDempiere Locator/Warehouse
      └── Medusa Stock Location
```

---

# 35. Product Market Eligibility

A canonical product MAY exist globally while being sellable only in selected Markets.

For example:

```text
Canonical Product
       │
       ├── ZA-B2C ✓
       ├── ZA-B2B ✓
       ├── UG-B2C ✗
       └── EU-B2B ✓
```

Product existence and market eligibility SHALL therefore remain distinct.

---

# 36. Variant Market Eligibility

Eligibility MAY be variant-specific.

A product being available in a Market SHALL NOT automatically imply every variant is available there.

---

# 37. Catalogue

A Market MAY expose a catalogue derived from:

```text
Product eligibility
+
Variant eligibility
+
Sales Channel
+
Customer/B2B permissions
+
Availability
```

Catalogue membership SHALL therefore not be treated as a single universal product flag.

---

# 38. B2B Catalogue

B2B catalogues MAY be restricted by customer organisation.

Example:

```text
Market
   │
   ├── General Catalogue
   │
   ├── Distributor Catalogue
   │
   └── Customer Contract Catalogue
```

Such restrictions are commerce authorization rules, not tenant definitions.

---

# 39. Pricing Context

The final price presented to a customer MAY depend on:

```text
Market
Currency
Sales Channel
Customer
Customer Organisation
Quantity
Price List
Promotion
Contract
Effective Date
```

Price resolution SHALL occur server-side.

---

# 40. Price Authority

Medusa SHALL remain authoritative for the transactional commerce price accepted during checkout unless a specific capability contract establishes an external pricing authority.

The price actually committed to an order SHALL be persisted with the transaction.

---

# 41. Price Lists

Price lists MAY implement:

- market pricing;
- B2B pricing;
- contract pricing;
- campaign pricing;
- volume pricing;
- customer-specific pricing.

Price lists SHALL NOT become tenant identifiers.

---

# 42. Promotion Scope

Promotions SHALL be explicitly scoped.

Possible dimensions include:

```text
Market
Sales Channel
Currency
Customer Segment
Product
Product Category
Date
Quantity
```

A promotion created for one Market MUST NOT accidentally apply globally.

---

# 43. Digital Estate Market Binding

A Digital Estate SHALL explicitly declare which Markets it is permitted to expose.

Example:

```text
Digital Estate
   thamani.example
        │
        ├── Market ZA-B2C
        └── Market UG-B2C
```

A client-supplied Market identifier SHALL be validated against this binding.

---

# 44. Multi-Market Digital Estate

A single Digital Estate MAY expose several Markets.

For example:

```text
Storefront
   │
   ├── South Africa
   │      └── ZAR
   │
   ├── Uganda
   │      └── UGX
   │
   └── Kenya
          └── KES
```

Switching Markets SHALL establish a new valid commerce Context.

---

# 45. Cart and Market

A cart SHALL belong to an explicit Market or equivalent resolved commercial context.

A cart MUST NOT contain commercially incompatible lines from unrelated Market contexts unless a future explicit multi-market-cart capability is introduced.

---

# 46. Cart Market Change

Changing Market MAY alter:

- currency;
- prices;
- promotions;
- inventory;
- payment methods;
- fulfilment;
- tax;
- legal seller.

Therefore a Market switch MUST trigger validation or cart reconstruction.

The frontend SHALL NOT merely replace a currency symbol.

---

# 47. Order Market

An Order SHALL persist the Market under which it was created.

The Market identity SHALL remain part of historical transaction context even if that Market is later retired or reconfigured.

---

# 48. Historical Commercial Snapshot

Orders SHALL preserve sufficient historical commercial facts to remain interpretable after configuration changes.

This SHOULD include applicable:

```text
currency
prices
taxes
discounts
seller
addresses
line descriptions
```

The order MUST NOT depend solely on mutable current Market configuration to reconstruct its legal meaning.

---

# 49. Market Configuration Changes

Changing Market configuration SHALL affect future commerce according to effective-date policy.

It MUST NOT silently rewrite historical orders.

---

# 50. Effective Dating

Commercial configuration SHOULD support temporal validity where required.

Conceptually:

```text
valid_from
valid_to
```

MAY apply to:

- prices;
- seller bindings;
- tax policies;
- fulfilment policies;
- provider bindings.

The canonical Control Plane's temporal model SHOULD be used where the relationship belongs to platform governance.

---

# 51. Market Provisioning

Creating a Market SHOULD initiate an idempotent provisioning process.

```text
Market Created
      │
      ▼
Validate Governance
      │
      ▼
Resolve EngineInstance
      │
      ▼
Provision Medusa Projection
      │
      ├── Region
      ├── Sales Channel
      ├── Currency
      ├── Payment
      └── Fulfilment
      │
      ▼
Register Mappings
      │
      ▼
Validate
      │
      ▼
Activate Market
```

Partial provisioning MUST be detectable.

---

# 52. Provisioning Idempotency

Repeating a Market provisioning command MUST NOT create duplicate:

- Medusa Regions;
- Sales Channels;
- provider bindings;
- mappings.

Provisioning SHALL use stable canonical identity and idempotency controls.

---

# 53. Market Suspension

Suspending a Market SHOULD prevent prohibited new transactions.

Existing orders MUST remain accessible to authorised operational processes.

Suspension SHALL NOT erase historical transactions.

---

# 54. Market Retirement

Retiring a Market SHALL prevent new commerce while preserving:

- historical orders;
- mappings;
- financial references;
- audit information;
- required customer-service access.

Market identifiers MUST NOT be recycled.

---

# 55. Market Migration

A Market MAY move between EngineInstances.

Conceptually:

```text
Market A
   │
   │ before
   ▼
EngineInstance 1
```

then:

```text
Market A
   │
   │ after
   ▼
EngineInstance 2
```

The Market's canonical identity SHALL remain unchanged.

---

# 56. Market Migration Safety

Migration MUST account for:

- products;
- variants;
- customers where scoped;
- carts;
- active orders;
- prices;
- promotions;
- inventory projections;
- mappings;
- provider configuration;
- event offsets;
- payment state;
- fulfilment state.

Active transaction migration requires explicit cutover semantics.

---

# 57. Engine-Native Mapping

Every material Medusa projection of canonical Market configuration SHOULD be discoverable through `ExternalReference` and/or `Mapping`.

Example:

```text
Canonical Market
      │
      ├── Medusa Region
      ├── Medusa Sales Channel
      └── relevant provider configuration
```

The Control Plane remains mapping authority.

---

# 58. Mapping Scope

Mappings SHALL use appropriate `MappingScope`.

A Medusa Region reference valid for one EngineInstance SHALL NOT automatically be assumed valid in another.

Example:

```text
Market A
   │
   ├── EngineInstance Africa → Region X
   └── EngineInstance Europe → Region Y
```

---

# 59. Events

Material Market lifecycle changes SHOULD produce canonical events.

Potential event vocabulary includes:

```text
market.created
market.provisioning_started
market.provisioned
market.activated
market.suspended
market.retired
market.binding_changed
```

Whether these originate from the Control Plane rather than Commerce Engine SHALL follow domain ownership.

Commerce SHALL consume authoritative Control Plane events where appropriate.

---

# 60. Commerce Market Events

Commerce-specific projection events MAY include:

```text
commerce.market.projection.created
commerce.market.projection.updated
commerce.market.projection.failed
```

These describe Commerce Engine state rather than canonical Market authority.

---

# 61. Event Context

Commerce transaction events SHALL carry Market identity where Market is relevant.

For example:

```text
commerce.order.placed
```

SHOULD identify:

```text
tenant_id
context_id
market_id
engine_instance_id
```

plus the canonical transaction subject.

---

# 62. API Context

Store and B2B requests SHALL operate under a resolved Market.

An endpoint requiring Market Context MUST reject an unresolved or unauthorised Market.

The client SHALL NOT be permitted to select arbitrary Market configuration outside its authorised Digital Estate and tenant Context.

---

# 63. Market Discovery

Digital estates MAY expose customer-facing Market selection.

The available list SHALL derive from authorised Market bindings.

For example:

```text
Digital Estate
      │
      ▼
Allowed Markets
      │
      ├── South Africa
      ├── Uganda
      └── Kenya
```

rather than returning every Market known to the platform.

---

# 64. Market Selection

Customer-facing Market selection MAY use:

- explicit user selection;
- domain;
- subdomain;
- locale;
- account preference;
- shipping destination;
- geolocation hints.

These are resolution inputs.

They SHALL NOT independently constitute trusted canonical Market authority.

---

# 65. Geolocation

IP geolocation MAY suggest a Market.

It MUST NOT silently determine legally significant commercial Context where explicit confirmation is required.

For example, a customer physically located in South Africa may legitimately purchase within another permitted Market.

---

# 66. Locale

Locale SHALL remain separate from Market and Currency.

For example:

```text
Market = South Africa
Currency = ZAR
Locale = en-ZA
```

or:

```text
Market = South Africa
Currency = ZAR
Locale = zu-ZA
```

may both be valid.

---

# 67. Language

Language preferences SHALL NOT determine tenant or legal seller.

Payload CMS and Digital Estates may provide translated content independently of Commerce Market identity.

---

# 68. Time Zone

Market configuration SHOULD define an IANA time zone where business-time interpretation is necessary.

Canonical timestamps crossing system boundaries SHALL use unambiguous timestamp representations.

Business rules such as:

```text
promotion ends at midnight
```

MUST specify the applicable time zone.

---

# 69. Measurement Units

Measurement systems MAY differ by Market.

The architecture SHOULD allow localisation of:

- weight;
- distance;
- dimensions;
- volume.

Canonical cross-engine quantities MUST identify units where ambiguity is possible.

---

# 70. Addresses

Address validation SHALL be Market/jurisdiction aware.

The platform SHALL NOT assume every country uses the same:

- province/state structure;
- postal code;
- street format;
- telephone format.

Country-specific validation SHOULD be configurable.

---

# 71. B2B Export Markets

B2B export commerce may differ significantly from domestic B2C commerce.

A Market MAY therefore incorporate commercial policies such as:

```text
minimum order
incoterm eligibility
payment terms
shipping mode
contract pricing
export documentation
```

These SHALL be represented through appropriate capabilities/configuration rather than hard-coded country branches.

---

# 72. Incoterms

Where international B2B commerce requires Incoterms, they SHALL be represented explicitly.

An Incoterm SHALL NOT be inferred solely from destination country.

The agreed term SHOULD become part of the historical commercial transaction where legally relevant.

---

# 73. Customer Market Eligibility

Not every customer need be eligible for every Market.

B2B customers in particular MAY have contractual Market restrictions.

Authorization SHALL therefore validate both:

```text
Digital Estate → Market
```

and where applicable:

```text
Customer/Organisation → Market
```

---

# 74. Payment Currency Validation

A payment attempt MUST use a currency supported by:

```text
Market
+
Legal Seller
+
Payment Provider
```

A provider merely supporting a currency globally is insufficient if the configured merchant account does not.

---

# 75. Refund Currency

Refunds SHOULD normally occur in the original transaction currency.

Any deviation requires explicit financial policy.

ERP consequences SHALL be communicated to iDempiere using the original transaction and accounting references.

---

# 76. ERP Market Mapping

iDempiere MAY require representations corresponding to:

```text
Legal Entity
Organisation
Warehouse
Price List
Currency
Tax
Business Partner
Sales Transaction
```

Baobab SHALL map these independently.

A single opaque `market_id` SHALL NOT be expected to replace all ERP concepts.

---

# 77. ERP Seller Mapping

The Legal Seller SHALL map to the appropriate iDempiere organisational/legal accounting context.

Conceptually:

```text
Canonical Legal Entity
       │
       ├── Commerce seller reference
       └── iDempiere organisation reference
```

The exact iDempiere mapping SHALL be governed by the ERP integration ADR.

---

# 78. ERP Currency Mapping

Canonical ISO currency codes MAY be used for interoperability.

iDempiere-native currency identifiers SHALL nevertheless remain engine-native external references where required.

---

# 79. ERP Price Mapping

Commerce price and ERP accounting price representations SHALL not be assumed structurally identical.

The Commerce order SHALL transmit the actual committed commercial values required by the ERP integration contract.

---

# 80. Payload Market Content

Payload MAY maintain Market-specific editorial content.

For example:

```text
Canonical Product
      │
      ├── ZA editorial content
      ├── UG editorial content
      └── KE editorial content
```

Payload SHALL remain authoritative for that editorial content.

Medusa SHALL remain authoritative for transactional commerce values.

---

# 81. SEO and Market

Digital estates and Payload MAY produce Market-specific:

- URLs;
- metadata;
- translations;
- landing pages.

SEO URL structure SHALL NOT become the canonical Market identifier.

---

# 82. Caching

Market-sensitive caches SHALL include sufficient context.

Unsafe:

```text
price:product-123
```

Safer:

```text
market:<market-id>:currency:<currency>:product:<product-id>:price
```

Additional dimensions SHALL be included where price depends upon customer or organisation.

---

# 83. CDN Caching

Public commerce responses MAY use CDN caching only when cache keys preserve Market-dependent differences.

A ZAR price MUST NOT be served from a cached response intended for a USD Market.

---

# 84. Search Indexing

Search documents SHALL contain sufficient Market eligibility metadata.

Search queries MUST enforce Market visibility.

Search indexing SHALL NOT create a universal catalogue if commercial visibility is restricted.

---

# 85. Analytics

Commerce analytics SHOULD retain:

```text
market_id
currency
legal_seller_id
sales_channel
```

where relevant.

Historical analytics MUST NOT reinterpret old orders using today's Market configuration.

---

# 86. Observability

Logs and traces SHOULD include:

```text
market_id
context_id
tenant_id
engine_instance_id
correlation_id
```

where applicable.

This allows operational diagnosis of Market-specific failures.

---

# 87. Metrics

Metrics SHOULD support Market-level aggregation where cardinality and privacy policies permit.

Useful dimensions MAY include:

```text
market
currency
sales channel
payment provider
fulfilment provider
```

High-cardinality customer identifiers SHALL NOT become metric labels.

---

# 88. Configuration Governance

Market configuration SHALL be managed through governed APIs, configuration workflows or provisioning automation.

Direct manual production modification of Medusa configuration SHOULD be exceptional.

---

# 89. Drift Detection

The platform SHOULD detect differences between:

```text
desired Market configuration
```

and:

```text
actual Medusa projection
```

This MAY be implemented through reconciliation.

---

# 90. Reconciliation

Market reconciliation SHOULD verify:

```text
Market exists
EngineInstance binding valid
Medusa Region exists
Sales Channel exists
currency configuration correct
payment bindings valid
fulfilment bindings valid
canonical mappings valid
```

Detected drift SHALL be observable.

---

# 91. Security

Market identifiers SHALL NOT themselves grant authorization.

Knowing:

```text
market_id
```

does not permit access.

Authorization MUST validate the requesting principal and Context.

---

# 92. Client Input

The following client-supplied values SHALL be treated as untrusted:

```text
market_id
currency
sales_channel_id
seller_id
region_id
payment_provider_id
fulfilment_provider_id
```

They MUST be validated against resolved Context.

---

# 93. Server Authority

The server SHALL derive or validate the final:

```text
Market
Legal Seller
Currency
Pricing Context
Payment Context
Fulfilment Context
```

before committing an order.

---

# 94. Historical Integrity

A later Market reconfiguration MUST NOT alter the legal interpretation of historical orders.

Historical orders SHALL retain sufficient immutable snapshots/references to establish:

- seller;
- currency;
- amount;
- tax;
- discounts;
- customer;
- products;
- fulfilment;
- payment obligations.

---

# 95. Rejected Alternative: Country Equals Market

**Rejected.**

A country may contain several commercial markets.

A commercial market may span multiple countries.

---

# 96. Rejected Alternative: Medusa Region Equals Baobab Market

**Rejected.**

This would make Baobab's canonical business model dependent upon a particular commerce engine's internal abstraction.

---

# 97. Rejected Alternative: Currency Equals Market

**Rejected.**

Many Markets may use the same currency, and currency alone does not establish commercial policy.

---

# 98. Rejected Alternative: Sales Channel Equals Market

**Rejected.**

Channels may operate across multiple Markets and Markets may contain multiple channels.

---

# 99. Rejected Alternative: Digital Estate Equals Market

**Rejected.**

One estate may serve multiple Markets and a Market may be exposed through multiple estates.

---

# 100. Rejected Alternative: Legal Seller Equals Market

**Rejected.**

The seller is a legal participant.

The Market is a commercial context.

Their cardinality must remain evolvable.

---

# 101. Rejected Alternative: EngineInstance Equals Market

**Rejected.**

Infrastructure topology must be replaceable and migratable independently from canonical Market identity.

---

# 102. Rejected Alternative: Dynamic FX for Every Price

**Rejected as the universal model.**

Pure FX conversion cannot represent intentional local pricing, market positioning, contractual pricing or psychological price points.

Explicit currency-specific prices SHALL remain supported.

---

# 103. Consequences

### Positive

This model enables Baobab to support:

- domestic commerce;
- cross-border commerce;
- B2B;
- B2C;
- multiple currencies;
- multiple legal sellers;
- multiple payment providers;
- multiple digital estates;
- multiple sales channels;
- regional infrastructure;
- market migration;
- jurisdiction-specific tax;
- localised fulfilment.

It also prevents Medusa-specific concepts from becoming permanent Baobab platform concepts.

### Negative

The model requires explicit:

- Market provisioning;
- mapping;
- configuration;
- context resolution;
- seller resolution;
- currency handling;
- reconciliation;
- lifecycle management.

This complexity is accepted because it represents genuine business complexity rather than accidental technical complexity.

---

# 104. Architectural Invariants

**MKT-COM-001**  
Baobab Market SHALL remain distinct from Medusa Region.

**MKT-COM-002**  
Market SHALL remain distinct from Tenant.

**MKT-COM-003**  
Market SHALL remain distinct from Country.

**MKT-COM-004**  
Market SHALL remain distinct from Currency.

**MKT-COM-005**  
Market SHALL remain distinct from Sales Channel.

**MKT-COM-006**  
Market SHALL remain distinct from Digital Estate.

**MKT-COM-007**  
Market SHALL remain distinct from EngineInstance.

**MKT-COM-008**  
Legal Seller SHALL remain distinct from Tenant.

**MKT-COM-009**  
Legal Seller SHALL remain distinct from EngineInstance.

**MKT-COM-010**  
Every financially committed order SHALL resolve exactly one legal seller.

**MKT-COM-011**  
Every financially committed order SHALL resolve exactly one transaction currency.

**MKT-COM-012**  
Currency SHALL use recognised canonical codes.

**MKT-COM-013**  
Canonical money SHALL use exact monetary representation.

**MKT-COM-014**  
Binary floating-point SHALL NOT be used for canonical monetary calculations.

**MKT-COM-015**  
Market-specific prices SHALL be resolved server-side.

**MKT-COM-016**  
Market-specific payment configuration SHALL be resolved server-side.

**MKT-COM-017**  
Market-specific fulfilment configuration SHALL be resolved server-side.

**MKT-COM-018**  
Client-supplied Market identifiers SHALL be validated.

**MKT-COM-019**  
A Market MAY migrate between EngineInstances without changing canonical identity.

**MKT-COM-020**  
Medusa-native IDs SHALL remain external references.

**MKT-COM-021**  
Historical orders SHALL not be rewritten by later Market configuration.

**MKT-COM-022**  
Digital Estate market access SHALL be explicitly governed.

**MKT-COM-023**  
B2B customer Market eligibility SHALL be independently enforceable.

**MKT-COM-024**  
Search and caching SHALL preserve Market visibility.

**MKT-COM-025**  
Market provisioning SHALL be idempotent.

---

# 105. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. One tenant can operate multiple Markets.

2. Two Markets can use the same currency.

3. One Market can expose multiple Sales Channels.

4. One Digital Estate can expose multiple authorised Markets.

5. An unauthorised Digital Estate cannot select another Market.

6. A Market cannot activate without mandatory bindings.

7. Market suspension prevents prohibited new transactions.

8. Historical orders survive Market retirement.

9. A Market switch revalidates cart pricing.

10. A Market switch revalidates currency.

11. A Market switch revalidates payment methods.

12. A Market switch revalidates fulfilment methods.

13. An order records its transaction currency.

14. An order records its legal seller.

15. Client manipulation cannot substitute another seller.

16. Client manipulation cannot substitute an unauthorised currency.

17. Client manipulation cannot substitute an unauthorised payment provider.

18. A B2B customer cannot access an unauthorised Market.

19. Product search respects Market eligibility.

20. Price caches cannot leak Market-specific pricing.

21. Market provisioning is idempotent.

22. Duplicate provisioning does not create duplicate Medusa Regions.

23. Medusa Region IDs remain engine-native.

24. Market migration does not change canonical Market ID.

25. ERP integration receives sufficient seller and currency context.
```

---

# 106. Implementation Implications

This ADR requires subsequent specifications for:

```text
Market projection
Medusa Region mapping
Sales Channel mapping
currency policy
legal seller resolution
price context
payment provider binding
fulfilment provider binding
inventory allocation
tax context
Digital Estate market binding
B2B market eligibility
Market provisioning
Market reconciliation
Market migration
```

These SHALL be implemented through explicit contracts rather than tenant-specific branching.

---

# 107. Decision Outcome

The canonical hierarchy is therefore not:

```text
Tenant
   └── Medusa Region
         └── Currency
```

and not:

```text
Country
   └── Store
         └── Tenant
```

Instead, Baobab adopts a compositional model:

```text
                         BAOBAB CONTEXT
                               │
                               ▼
                             MARKET
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
     Legal Seller          Geography          Sales Channel
          │                    │                    │
          ▼                    ▼                    ▼
       Currency            Tax Context          Catalogue
          │                                         │
          ├───────────────────┬─────────────────────┤
          │                   │                     │
          ▼                   ▼                     ▼
       Pricing             Payment             Fulfilment
          │                   │                     │
          └───────────────────┼─────────────────────┘
                              ▼
                       Medusa Projection
                              │
                              ▼
                       EngineInstance
```

The central decision is:

> **A Baobab Market is a governed commercial context, not a synonym for geography or any Medusa-native object.**

Medusa Region, Sales Channel, currency, payment configuration, fulfilment configuration and pricing are mechanisms through which that Market is implemented.

The second governing rule is:

> **Every transaction must know who is selling, where and under which commercial context the sale occurs, in what currency it is committed, and which policies govern its execution.**

And the long-term architectural rule is:

> **International expansion shall be achieved by provisioning new Market contexts and capability bindings—not by cloning or forking the Commerce Engine for every country.**

This preserves Baobab's ability to expand across regions, currencies, jurisdictions and business models while keeping the Commerce Engine coherent, independently deployable and replaceable.
