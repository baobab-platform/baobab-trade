# ADR-0018: MedusaJS Commerce Tax, Jurisdiction and Legal Transaction Context

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0017-medusajs-commerce-customer-b2b-organisation-buyer-identity-and-authorization-model.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Baobab Digital Estates, External Tax Providers, Customs/Trade Services
- **Decision Class:** Tax / Jurisdiction / Legal Seller / Transaction Compliance

---

## 1. Purpose

This ADR defines how Baobab Commerce determines and preserves the legal and tax context of a commercial transaction across:

- multiple Legal Sellers;
- multiple Markets;
- multiple countries;
- multiple currencies;
- B2C and B2B transactions;
- domestic and cross-border transactions;
- different tax registrations;
- different tax regimes.

It specifically answers:

> **Which legal entity is selling, which jurisdiction governs the transaction, what tax treatment applies, who calculates transactional tax, and how is that result preserved and communicated to ERP?**

This ADR does not redefine the architectural decisions established by ADR-0008 through ADR-0017.

---

# 2. Context

Tax is not simply:

```text
Product
+
Tax Rate
```

A tax determination may depend upon:

```text
Legal Seller
Customer
Customer Organisation
Seller Tax Registration
Customer Tax Registration
Ship-From
Ship-To
Bill-To
Product Tax Classification
Transaction Type
Market
Jurisdiction
Currency
Tax-Inclusive/Exclusive Policy
Exemption
Cross-Border Status
Effective Date
```

Accordingly:

```text
Tax != Product Attribute
Tax != Market
Tax != Country
Tax != Currency
```

Tax is a **contextual legal transaction determination**.

---

# 3. Decision

Baobab SHALL adopt a **contextual tax authority model**.

Medusa SHALL be authoritative for the **tax amount committed to the Commerce transaction**.

The tax determination MAY be calculated by:

1. Medusa's tax capabilities;
2. an approved external Tax Provider;
3. another explicitly designated tax authority.

iDempiere SHALL remain authoritative for:

- tax accounting;
- tax ledger consequences;
- financial posting;
- statutory accounting records.

The Commerce transaction SHALL preserve the tax determination that was actually committed to the customer.

---

# 4. Governing Principle

Baobab adopts:

> **Tax is determined from the legal transaction context, not inferred from tenancy, geography or Product alone.**

The minimum conceptual relationship is:

```text
Legal Seller
     +
Customer
     +
Transaction
     +
Jurisdiction
     +
Product Tax Classification
     +
Effective Tax Rules
     │
     ▼
Tax Determination
```

---

# 5. Legal Seller

Every financially committed Commerce Order SHALL resolve exactly one Legal Seller unless a future marketplace architecture explicitly introduces multi-seller Orders.

The Legal Seller SHALL be established before final tax determination.

---

# 6. Legal Seller Is Not Tenant

The architecture SHALL preserve:

```text
LegalSeller != Tenant
```

A Tenant may contain or operate through more than one Legal Seller.

Likewise, a Legal Seller may participate in multiple Markets.

---

# 7. Legal Seller Is Not Market

The architecture SHALL preserve:

```text
LegalSeller != Market
```

One Legal Seller may operate in:

```text
South Africa B2C
South Africa B2B
Uganda
Kenya
European export
```

as distinct Markets.

---

# 8. Legal Seller Is Not Digital Estate

A Digital Estate represents customer experience.

It does not itself become the contractual seller merely because the customer used its domain.

---

# 9. Legal Seller Resolution

Legal Seller SHALL be resolved through trusted Commerce Context.

It SHALL NOT be inferred solely from:

- hostname;
- currency;
- country;
- customer address;
- Medusa Region;
- Sales Channel.

---

# 10. Legal Seller Immutability

Once an Order is committed, its Legal Seller SHALL not be silently changed.

A correction requiring a different seller SHALL use an explicit corrective business process.

---

# 11. Tax Registration

A Legal Seller MAY possess multiple tax registrations.

Conceptually:

```text
Legal Seller
    │
    ├── South Africa VAT Registration
    ├── Uganda Tax Registration
    └── Other Jurisdiction Registration
```

Tax registration SHALL remain distinct from Legal Seller identity.

---

# 12. Registration Scope

A tax registration SHALL identify at minimum where applicable:

```text
legal seller
jurisdiction
registration type
registration identifier
effective period
status
```

Sensitive registration data SHALL receive appropriate protection.

---

# 13. Jurisdiction

A Jurisdiction represents a legal/tax authority context.

Examples MAY include:

```text
country
state/province
municipality
special tax zone
economic union
```

The exact jurisdiction hierarchy SHALL remain extensible.

---

# 14. Jurisdiction Is Not Market

Baobab SHALL preserve:

```text
Jurisdiction != Market
```

One Market may involve several tax jurisdictions.

Several Markets may operate under the same tax jurisdiction.

---

# 15. Country Is Not Tax Determination

Country alone SHALL not be assumed sufficient for tax calculation.

Some tax systems depend upon subnational jurisdiction, registration status, transaction type or customer classification.

---

# 16. Tax Context

A Commerce tax determination SHOULD resolve a `TaxContext` conceptually containing:

```text
context_id
market_id
legal_seller_id
seller_tax_registration?
customer_id?
customer_organisation_id?
customer_tax_registration?
ship_from
ship_to
bill_to
transaction_type
currency
effective_at
```

Exact implementation belongs to the derived contract.

---

# 17. Product Tax Classification

Product tax treatment SHALL use an explicit tax classification where required.

The classification SHALL remain distinct from:

- Product category;
- Payload taxonomy;
- ERP accounting category;
- customs HS classification.

Mappings MAY relate these concepts where appropriate.

---

# 18. Tax Classification Authority

The authority for Product tax classification SHALL be explicitly designated.

Initially, where iDempiere governs enterprise Product/accounting classification, it MAY be the authoritative source.

Medusa SHALL consume the required Commerce projection.

---

# 19. No Tax Classification Guessing

Digital Estates SHALL NOT infer tax classification from Product names, categories or marketing content.

---

# 20. Transaction Type

Tax treatment MAY depend upon transaction type.

Examples include:

```text
GOODS
SERVICES
DIGITAL_GOODS
SHIPPING
DISCOUNT
RETURN
REFUND
```

The tax model SHALL therefore avoid assuming every Order Line follows identical rules.

---

# 21. B2C Tax

B2C tax determination MAY depend upon:

- seller;
- destination;
- Product classification;
- Market;
- applicable tax rules.

The customer SHALL see the legally appropriate tax representation for the Market.

---

# 22. B2B Tax

B2B transactions MAY additionally depend upon:

```text
customer legal identity
customer tax registration
exemption
reverse-charge eligibility
place-of-supply rules
```

where applicable.

B2B tax treatment SHALL not be inferred merely because the customer belongs to a Customer Organisation.

---

# 23. Customer Tax Registration

A Customer Organisation MAY have one or more tax registrations.

These SHALL remain distinct from:

- Customer Organisation ID;
- account number;
- ERP Business Partner ID.

---

# 24. Tax Registration Verification

Where business rules require verification of a customer tax registration, the verification result SHOULD include:

```text
identifier
jurisdiction
verification status
verified_at
source
```

where supported.

---

# 25. Verification Expiry

Verification MAY become stale.

Long-lived B2B accounts SHALL not assume that one historical verification remains valid forever where revalidation is legally required.

---

# 26. Tax Exemption

Tax exemption SHALL be represented explicitly.

It SHALL not be implemented by silently setting a tax rate to zero without retaining the reason.

---

# 27. Zero-Rated vs Exempt

The architecture SHALL preserve the conceptual distinction:

```text
ZERO_RATED != EXEMPT
```

where the applicable tax regime distinguishes them.

Both may result in zero collected tax while having different legal meaning.

---

# 28. Reverse Charge

Where a jurisdiction permits or requires reverse-charge treatment, it SHALL be represented explicitly rather than as an unexplained zero-tax transaction.

---

# 29. Domestic Transaction

A domestic transaction SHALL be identified from the legal transaction context.

It SHALL not be inferred solely from currency.

---

# 30. Cross-Border Transaction

Cross-border status SHALL consider relevant seller, supply and destination facts.

For physical goods, this may include:

```text
ship-from jurisdiction
ship-to jurisdiction
seller jurisdiction
customer jurisdiction
```

---

# 31. Cross-Border Tax

Cross-border transactions MAY involve:

- export tax treatment;
- import VAT;
- customs duties;
- destination tax;
- reverse charge;
- registration thresholds.

Baobab SHALL not hardcode one universal cross-border formula.

---

# 32. Tax Is Not Customs Duty

The architecture SHALL preserve:

```text
Commerce Tax != Customs Duty
```

Customs duty is a separate trade-compliance/landed-cost concern even when both affect the customer.

---

# 33. Tax Is Not Carrier Charge

Likewise:

```text
Tax != Shipping Charge
```

although shipping charges themselves may be taxable.

---

# 34. Taxable Shipping

Whether shipping is taxable SHALL be determined according to the applicable tax policy.

It SHALL not be assumed universally taxable or universally exempt.

---

# 35. Discounts

Tax treatment of discounts SHALL follow the applicable jurisdictional rules.

The tax engine SHALL receive sufficient discount provenance to calculate correctly.

---

# 36. Promotions

Promotional discounts SHALL not bypass tax calculation.

ADR-0012 remains authoritative for commercial promotion calculation.

This ADR governs the tax consequence.

---

# 37. Tax-Inclusive Pricing

A Market MAY display prices inclusive of tax.

Conceptually:

```text
Displayed Price
=
Net Amount
+
Tax
```

where applicable.

---

# 38. Tax-Exclusive Pricing

Another Market or B2B channel MAY display:

```text
Net Price
+
Tax calculated separately
```

The Market policy SHALL explicitly define the presentation and calculation model.

---

# 39. Inclusive vs Exclusive Is Market Policy

Tax-inclusive/exclusive presentation SHALL not be inferred from Currency.

---

# 40. Customer Presentation

Digital Estates SHALL present tax according to the authoritative Commerce result.

They SHALL NOT independently recalculate tax.

---

# 41. Client Tax Calculation Prohibited

JavaScript running in the Digital Estate MAY estimate tax for UX purposes only if clearly non-authoritative.

Final tax SHALL always be server-determined.

---

# 42. Checkout Tax Revalidation

Tax SHALL be revalidated before Order commitment.

A Cart's previous tax calculation SHALL not automatically remain valid after changes to:

```text
address
customer
organisation
Product
quantity
discount
shipping
Market
seller
```

---

# 43. Tax Provider

Medusa MAY use an external Tax Provider where required.

The provider SHALL remain behind an explicit adapter/provider boundary.

---

# 44. Provider Selection

Tax Provider selection MAY depend upon:

```text
Market
Legal Seller
Jurisdiction
Transaction Type
```

One global provider SHALL not be assumed.

---

# 45. Provider Is Not Authority for Seller Identity

An external Tax Provider calculates using the legal context supplied to it.

It SHALL NOT determine which Baobab Legal Seller owns the transaction.

---

# 46. External Provider Failure

Tax-provider failure during checkout SHALL follow explicit Market policy.

For a transaction requiring authoritative real-time tax calculation, checkout MAY need to fail safely.

Baobab SHALL NOT silently invent tax.

---

# 47. Cached Tax Rules

Where legally and technically appropriate, tax rules MAY be locally cached or projected.

Freshness and effective dating SHALL be explicit.

---

# 48. Effective Dating

Tax rules SHALL support effective periods.

A future rate change SHALL not alter historical transactions.

---

# 49. Effective Time

Tax calculation SHALL use the legally applicable transaction/effective time.

The implementation SHALL not blindly use current wall-clock rate when reconstructing historical transactions.

---

# 50. Order Tax Snapshot

A committed Order SHALL preserve the tax determination used for the transaction.

At minimum, sufficient information SHOULD exist to establish:

```text
taxable basis
tax amount
tax rate or rule reference where appropriate
currency
tax classification
jurisdiction
seller registration context
```

subject to the applicable engine model.

---

# 51. Historical Integrity

If a tax rate changes tomorrow:

```text
Yesterday's Order Tax
```

SHALL NOT change.

---

# 52. Tax Provenance

The committed transaction SHOULD retain tax provenance sufficient for audit and reconciliation.

Examples:

```text
Medusa Tax Module
External Provider X
Rule Version
Calculation Reference
```

---

# 53. Provider Calculation Reference

External Tax Provider transaction/calculation IDs SHALL remain ExternalReferences.

They SHALL not become canonical Order identity.

---

# 54. Tax Rounding

Tax rounding SHALL be deterministic.

The implementation SHALL explicitly define whether rounding occurs at:

- line level;
- tax component level;
- Order level;

according to applicable tax rules.

---

# 55. Monetary Precision

Tax calculation SHALL use exact monetary representations.

Binary floating-point SHALL not determine financial tax amounts.

---

# 56. Multiple Tax Components

A transaction MAY contain multiple tax components.

The architecture SHALL not assume one Order Line has exactly one tax rate.

---

# 57. Compound Tax

Where a jurisdiction applies compound taxes, the tax engine/provider SHALL preserve the correct calculation order.

---

# 58. Tax Breakdown

The Commerce model SHOULD retain sufficient breakdown for customer presentation, ERP posting and audit where required.

---

# 59. Tax Currency

Tax amounts SHALL be expressed in the transaction currency for Commerce commitment unless a legal rule requires additional reporting information.

---

# 60. Reporting Currency

ERP tax reporting MAY use another accounting/reporting currency.

This SHALL not rewrite the Commerce transaction currency.

---

# 61. FX

Where tax reporting requires currency conversion, the applicable FX policy SHALL be explicit.

Commerce SHALL not silently reuse arbitrary current exchange rates.

---

# 62. Order Tax Authority

Once committed, Medusa SHALL be authoritative for the tax amount charged as part of the Commerce Order.

---

# 63. ERP Tax Authority

iDempiere SHALL be authoritative for the accounting treatment of that tax.

This includes appropriate:

- tax accounts;
- tax liability;
- reporting;
- financial posting.

---

# 64. ERP Must Not Silently Reprice Tax

When receiving a committed Commerce Order, iDempiere SHALL not silently substitute materially different customer tax values.

If its accounting validation calculates a discrepancy, the transaction SHALL enter reconciliation.

---

# 65. Tax Reconciliation

Baobab SHALL reconcile material differences between:

```text
Commerce committed tax
and
ERP accounted tax
```

where appropriate.

---

# 66. Reconciliation Is Not Blind Synchronisation

The system SHALL determine why a discrepancy exists.

Potential causes include:

```text
wrong Product tax classification
wrong Legal Seller
wrong tax registration
stale tax rule
rounding difference
incorrect ERP mapping
provider calculation difference
```

---

# 67. Tax Adjustment

A committed Order requiring a tax correction SHALL use an explicit adjustment, credit, cancellation/reissue or other legally appropriate process.

Historical tax SHALL not simply be overwritten.

---

# 68. Cancellation

Order cancellation SHALL produce the applicable tax reversal/accounting consequence.

It SHALL not erase the historical fact that the original transaction existed.

---

# 69. Refund

Refund tax treatment SHALL correspond to the applicable refunded transaction amounts and jurisdictional rules.

ADR-0015 remains authoritative for financial refund execution.

---

# 70. Partial Refund

Partial refunds SHALL support proportional or rule-specific tax adjustment as legally required.

---

# 71. Return

A physical Return does not itself define tax treatment.

The resulting financial adjustment determines the tax consequence according to policy.

---

# 72. Credit Note

Where the legal/accounting regime requires a credit note, iDempiere or the appropriate financial authority SHALL create the statutory/accounting document.

Commerce SHALL retain the relationship to the original Order/refund.

---

# 73. Invoice

Commerce Order and statutory invoice SHALL remain distinct concepts.

Therefore:

```text
Commerce Order != Tax Invoice
```

---

# 74. Invoice Authority

Where iDempiere produces statutory tax invoices, iDempiere SHALL remain authoritative for those documents.

Medusa MAY expose or link to the resulting document for customer experience.

---

# 75. Invoice Number

A statutory invoice number SHALL NOT become canonical Order identity.

---

# 76. B2C Receipt

A customer-facing receipt MAY be generated through Commerce or ERP according to the Market's legal requirements.

Its authority SHALL be explicitly designated.

---

# 77. B2B Invoice

B2B invoicing SHOULD normally follow ERP financial-document authority where iDempiere manages receivables.

---

# 78. Fiscalization

Some jurisdictions may require fiscal devices, fiscal APIs or government reporting.

Such capabilities SHALL be introduced behind explicit fiscal/tax integration boundaries.

Medusa core SHALL not be forked for jurisdiction-specific fiscal behaviour.

---

# 79. Regulatory Reporting

Regulatory tax reporting SHALL normally belong to ERP or a specialised compliance system.

Commerce SHALL provide the committed transaction facts required by that authority.

---

# 80. Customer Tax Data

Tax identifiers constitute sensitive business/customer data.

Access SHALL be restricted.

Digital Estates SHALL expose only what the customer is entitled to view or edit.

---

# 81. Tax Identifier Logging

Full tax identifiers SHOULD NOT appear unnecessarily in:

- application logs;
- traces;
- analytics labels;
- public events.

---

# 82. Tax Events

Canonical events SHOULD carry committed tax facts where downstream consumers require them.

For example, `commerce.order.placed` may contain the Order's monetary tax summary.

---

# 83. Separate Tax Events

Dedicated events MAY be introduced for material tax-specific changes, but Baobab SHALL not generate a redundant event taxonomy without a consuming business requirement.

---

# 84. Tax Event Privacy

Tax events SHALL contain only information necessary for the receiving capability.

---

# 85. Tax Rule Configuration

Tax configuration SHALL be versioned and governed.

Changes to:

```text
tax rate
tax classification
registration
jurisdiction rule
provider
inclusive/exclusive policy
```

SHOULD be auditable.

---

# 86. Configuration Ownership

Digital Estates SHALL not own tax configuration.

---

# 87. Tax Provider Credentials

External Tax Provider credentials SHALL follow Baobab secret-management standards.

They SHALL not be stored in frontend applications or source repositories.

---

# 88. Tax Provider Replacement

Replacing Tax Provider A with Provider B SHALL not change historical Order tax values.

Historical provider references SHALL remain interpretable.

---

# 89. Multi-Provider Tax

Different Markets MAY use different tax mechanisms.

For example:

```text
Market A → Medusa native tax calculation

Market B → External Tax Provider

Market C → Another approved provider
```

without changing canonical Commerce contracts.

---

# 90. Multi-Jurisdiction Expansion

Adding a new country SHALL require configuration/provisioning of:

```text
Market
Legal Seller eligibility
tax registration
tax rules/provider
Product tax classifications
invoice requirements
```

rather than a country-specific Commerce fork.

---

# 91. No Country-Specific Core Forks

Baobab SHALL reject:

```text
if country == "ZA":
    custom Commerce core
elif country == "UG":
    different Commerce fork
```

Jurisdictional differences SHALL be expressed through configuration, providers and governed extensions.

---

# 92. Market Activation

A Market requiring tax collection SHALL NOT become transactionally active until mandatory tax configuration is valid.

---

# 93. Seller Activation

A Legal Seller SHALL not transact in a jurisdiction requiring registration unless the required registration/compliance configuration is satisfied.

---

# 94. Tax Health

Tax capability health SHOULD distinguish:

```text
healthy
degraded
unavailable
misconfigured
```

where appropriate.

---

# 95. Checkout Behaviour During Tax Outage

The failure policy SHALL be explicit per Market.

Possible policy:

```text
Tax authority unavailable
        │
        ▼
Cannot establish lawful committed amount
        │
        ▼
Checkout temporarily unavailable
```

is preferable to inventing tax.

---

# 96. Tax Observability

Production telemetry SHOULD include:

```text
tax calculation latency
tax calculation failures
provider failures
configuration failures
tax reconciliation discrepancies
tax-rule version
```

without leaking protected identifiers.

---

# 97. Audit

Material tax configuration and override actions SHALL be auditable.

---

# 98. Manual Tax Override

Manual tax override, if permitted, SHALL require:

- authorised role;
- explicit reason;
- audit;
- preserved original calculation;
- reconciliation capability.

---

# 99. Silent Tax Override Prohibited

Administrative users SHALL not silently replace tax values merely to force an Order through checkout.

---

# 100. Testing

Tax architecture SHALL include:

```text
unit tests
jurisdiction tests
provider-contract tests
effective-date tests
rounding tests
B2B tests
cross-border tests
security tests
ERP reconciliation tests
```

---

# 101. Rejected Alternative: Tax Equals Country

**Rejected.**

Country alone does not express the full legal transaction context.

---

# 102. Rejected Alternative: Tax Equals Market

**Rejected.**

Market is a commercial operating context, not a tax determination.

---

# 103. Rejected Alternative: Tax Equals Product Category

**Rejected.**

Product classification is only one input.

---

# 104. Rejected Alternative: Currency Determines Tax

**Rejected absolutely.**

Currency does not establish jurisdiction.

---

# 105. Rejected Alternative: Tenant Determines Tax

**Rejected.**

Tenant identity does not determine the Legal Seller or applicable tax jurisdiction.

---

# 106. Rejected Alternative: Digital Estate Determines Seller

**Rejected.**

A domain/presentation layer cannot establish legal seller authority by itself.

---

# 107. Rejected Alternative: Payload Owns Tax

**Rejected.**

Editorial content is not transactional tax authority.

---

# 108. Rejected Alternative: Digital Estate Calculates Final Tax

**Rejected absolutely.**

Final tax is server-authoritative.

---

# 109. Rejected Alternative: iDempiere Recalculates and Replaces Commerce Tax

**Rejected.**

ERP accounting validation may detect discrepancies but SHALL not silently rewrite the committed Commerce transaction.

---

# 110. Rejected Alternative: One Tax Provider Globally

**Rejected as a platform invariant.**

Different jurisdictions and Markets may require different capabilities.

---

# 111. Rejected Alternative: Zero Tax Means Exempt

**Rejected.**

Zero-rated, exempt, reverse-charge and other treatments may have different legal meanings.

---

# 112. Rejected Alternative: Current Tax Rate Reconstructs History

**Rejected absolutely.**

Historical transactions preserve the tax actually committed under the applicable effective rules.

---

# 113. Rejected Alternative: Commerce Order Equals Tax Invoice

**Rejected.**

Commerce and statutory financial documents remain distinct.

---

# 114. Consequences

## Positive

This decision supports:

- multiple Legal Sellers;
- multiple jurisdictions;
- B2C and B2B tax;
- domestic and international commerce;
- external Tax Providers;
- effective-dated tax rules;
- ERP statutory accounting;
- tax reconciliation;
- jurisdictional expansion without Commerce forks.

## Negative

It requires:

- explicit Legal Seller resolution;
- tax-registration governance;
- Product tax classification;
- tax-provider adapters;
- historical tax snapshots;
- reconciliation;
- jurisdiction-specific configuration.

These costs are unavoidable for production-grade multi-jurisdiction Commerce.

---

# 115. Architectural Invariants

**TAX-COM-001**  
Every committed taxable transaction SHALL resolve a Legal Seller.

**TAX-COM-002**  
Legal Seller SHALL remain distinct from Tenant.

**TAX-COM-003**  
Legal Seller SHALL remain distinct from Market.

**TAX-COM-004**  
Legal Seller SHALL remain distinct from Digital Estate.

**TAX-COM-005**  
Jurisdiction SHALL remain distinct from Market.

**TAX-COM-006**  
Currency SHALL not determine tax jurisdiction.

**TAX-COM-007**  
Product category SHALL not independently determine tax.

**TAX-COM-008**  
Product tax classification SHALL be explicit where required.

**TAX-COM-009**  
B2B organisation membership SHALL not independently establish tax treatment.

**TAX-COM-010**  
Customer tax registration SHALL remain distinct from Customer Organisation identity.

**TAX-COM-011**  
Tax exemption SHALL preserve its legal reason.

**TAX-COM-012**  
Zero-rated and exempt treatment SHALL remain distinguishable where legally relevant.

**TAX-COM-013**  
Tax SHALL be revalidated before Order commitment.

**TAX-COM-014**  
Final tax SHALL be server-authoritative.

**TAX-COM-015**  
Committed Order tax SHALL be historically stable.

**TAX-COM-016**  
Tax rules SHALL support effective dating.

**TAX-COM-017**  
Tax calculations SHALL use exact monetary arithmetic.

**TAX-COM-018**  
Tax rounding SHALL be deterministic.

**TAX-COM-019**  
Medusa SHALL own the Commerce tax amount committed to the customer.

**TAX-COM-020**  
iDempiere SHALL own tax accounting consequences.

**TAX-COM-021**  
ERP SHALL not silently replace committed Commerce tax.

**TAX-COM-022**  
Material Commerce/ERP tax discrepancies SHALL be reconcilable.

**TAX-COM-023**  
Commerce Order SHALL remain distinct from statutory Tax Invoice.

**TAX-COM-024**  
External Tax Provider IDs SHALL remain external references.

**TAX-COM-025**  
Provider replacement SHALL not rewrite historical tax.

**TAX-COM-026**  
Digital Estates SHALL not own tax configuration.

**TAX-COM-027**  
Manual tax overrides SHALL be authorised and auditable.

**TAX-COM-028**  
Tax Provider credentials SHALL remain secret-managed.

**TAX-COM-029**  
New jurisdictions SHALL be introduced through governed configuration/extensions rather than Commerce core forks.

**TAX-COM-030**  
A transaction SHALL not proceed where legally required tax cannot be determined with sufficient authority.

---

# 116. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. A committed Order resolves exactly one Legal Seller.

2. Tenant identity alone cannot determine Legal Seller.

3. Digital Estate hostname alone cannot determine Legal Seller.

4. Currency alone cannot determine tax jurisdiction.

5. Market alone cannot determine tax treatment.

6. Product category alone cannot determine final tax.

7. Product tax classification participates in tax determination where required.

8. Seller tax registration is validated where required.

9. Customer tax registration is organisation-scoped.

10. Invalid customer tax registration cannot obtain protected B2B tax treatment.

11. Zero-rated treatment remains distinguishable from exemption.

12. Exemption retains reason/provenance.

13. Reverse-charge treatment remains explicit where supported.

14. Address change triggers tax revalidation.

15. Customer Organisation change triggers tax revalidation.

16. Legal Seller change before commitment triggers tax revalidation.

17. Shipping-method change triggers tax revalidation where shipping tax is affected.

18. Promotion/discount changes trigger appropriate tax recalculation.

19. Client-supplied tax amount cannot override server calculation.

20. Historical Order tax does not change after a tax-rate update.

21. Future-dated tax rate becomes effective only at the appropriate time.

22. Tax rounding is deterministic.

23. Multi-component tax is preserved where applicable.

24. External Tax Provider timeout cannot silently produce invented tax.

25. Invalid Tax Provider response cannot silently commit an unverified tax amount.

26. Provider calculation reference is retained where required.

27. Tax Provider replacement does not alter historical Orders.

28. Commerce tax propagates to iDempiere.

29. Duplicate Order event does not duplicate ERP tax accounting.

30. ERP tax discrepancy enters reconciliation rather than silently rewriting Commerce Order.

31. Partial Refund produces the appropriate tax adjustment.

32. Cancellation preserves original tax history and creates the required reversal consequence.

33. Commerce Order remains distinct from ERP statutory invoice.

34. Statutory invoice number does not replace canonical Order identity.

35. Unauthorised user cannot modify seller tax registration.

36. Manual tax override is audited.

37. Tax Provider credentials are absent from Digital Estate configuration.

38. Tax identifiers are not unnecessarily exposed in logs/events.

39. Market activation fails when mandatory tax configuration is absent.

40. A new jurisdiction can be configured without a jurisdiction-specific Commerce fork.
```

---

# 117. Initial Production Tax Profile

The initial Baobab tax architecture SHOULD be:

```text
                     BAOBAB CONTEXT
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
        Legal Seller      Market        Customer
             │                             │
             ▼                             ▼
     Seller Registration          Customer Tax Status
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
                      TAX CONTEXT
                            │
                 ┌──────────┼──────────┐
                 │          │          │
                 ▼          ▼          ▼
              Product     Ship-To   Transaction
           Classification            Type
                 │          │          │
                 └──────────┼──────────┘
                            ▼
                    TAX DETERMINATION
                            │
                            ▼
                         MEDUSA
                  Committed Tax Amount
                            │
                            ▼
                    COMMERCE ORDER
                            │
                            ▼
                   Canonical Order Event
                            │
                            ▼
                        IDEMPIERE
                            │
                            ▼
                  Tax Accounting / Invoice
                            │
                            ▼
                     RECONCILIATION
```

---

# 118. Expansion Model

For a new Market or jurisdiction, Baobab SHOULD provision:

```text
Market
   │
   ├── Legal Seller
   │      │
   │      └── Tax Registration
   │
   ├── Jurisdiction Rules
   │
   ├── Tax Provider / Tax Module
   │
   ├── Product Tax Classification Mapping
   │
   ├── Customer Tax Rules
   │
   ├── Tax-Inclusive/Exclusive Policy
   │
   └── ERP Tax Mapping
```

rather than creating a new Commerce codebase.

---

# 119. Decision Outcome

Baobab adopts the following legal transaction model:

```text
                    TENANT / CONTEXT
                           │
                           ▼
                        MARKET
                           │
                           ▼
                     LEGAL SELLER
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
          Seller Registration     Customer
                                     │
                                     ▼
                              Customer Tax Status
                 │                   │
                 └─────────┬─────────┘
                           ▼
                      JURISDICTION
                           │
                           +
                  Product Classification
                           │
                           +
                    Transaction Facts
                           │
                           ▼
                    TAX DETERMINATION
                           │
                           ▼
                        MEDUSA
                 Customer Transaction
                           │
                           ▼
                       IDEMPIERE
                  Accounting / Reporting
```

The governing rule is:

> **Tax is a property of the legal transaction context, not of the Product, Tenant, Market, country or currency in isolation.**

The seller rule is:

> **Every committed Commerce transaction must know which Legal Seller is making the sale before its legal and tax consequences can be determined.**

The Commerce rule is:

> **Medusa owns the tax amount committed as part of the Commerce transaction, regardless of whether that amount is calculated natively or by an approved external Tax Provider.**

The ERP rule is:

> **iDempiere accounts for the committed tax and produces the applicable statutory financial consequences; it does not silently rewrite the customer transaction.**

The historical rule is:

> **A tax-rule change changes future transactions, not history.**

The internationalisation rule is:

> **Jurisdictional expansion shall be accomplished through Legal Seller registrations, Market configuration, tax rules/providers and mappings—not country-specific forks of the Commerce Engine.**

And the final architectural rule is:

> **Baobab shall always be able to explain who sold, to whom, where the transaction was legally situated, which tax rule was applied, what tax was charged, and how that amount was subsequently accounted for.**
