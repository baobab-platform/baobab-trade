# ADR-0017: MedusaJS Commerce Customer, B2B Organisation, Buyer Identity and Authorization Model

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0016-medusajs-commerce-fulfilment-shipping-delivery-and-external-logistics-boundary.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab Identity Provider, iDempiere ERP, Baobab Digital Estates
- **Decision Class:** Customer Identity / B2B Organisation / Buyer Authorization / Commerce Access Control

---

## 1. Purpose

This ADR defines the identity and authorization model for:

- B2C customers;
- B2B customer organisations;
- buyers;
- buyer roles;
- organisation membership;
- purchasing authority;
- account-specific commercial access;
- customer-to-ERP mappings.

It specifically answers:

> **Who is the Commerce customer, who is the buyer, which organisation is the buyer acting for, and what is that buyer allowed to do?**

This ADR does not redefine:

- Tenant;
- LegalEntity;
- Context;
- Market;
- canonical identity;
- Product authority;
- pricing;
- Order commitment;
- payment;
- fulfilment;
- eventing;
- isolation.

Those remain governed by ADR-0008 through ADR-0016.

---

# 2. Context

B2C identity is comparatively simple.

A natural person may authenticate and purchase for themselves.

B2B commerce is fundamentally different.

A person may:

- belong to several organisations;
- act for one organisation at a time;
- have different roles in each;
- possess different spending authority;
- see different catalogues;
- receive different prices;
- use different payment terms;
- access different delivery addresses;
- require approval for some purchases.

Therefore:

```text
Person
!=
Customer
!=
Customer Organisation
!=
Buyer
!=
Tenant
```

These concepts must remain distinct.

---

# 3. Decision

Baobab SHALL adopt a **separated principal–customer–organisation–buyer model**.

The Commerce Engine SHALL model:

```text
Principal
   │
   ▼
Commerce Customer
   │
   ├── B2C purchasing identity
   │
   └── B2B memberships
             │
             ▼
      Customer Organisation
             │
             ▼
           Buyer
             │
             ▼
        Buyer Role
             │
             ▼
     Purchasing Authority
```

A Customer Organisation SHALL NOT automatically be treated as a Baobab Tenant.

A Buyer SHALL act within an explicit organisation and Commerce Context.

---

# 4. Principal

A Principal is an authenticated actor.

Examples include:

```text
human customer
B2B buyer
commerce administrator
service identity
integration identity
```

Authentication SHALL establish the Principal.

Authorization SHALL determine what the Principal may do.

---

# 5. Principal Is Not Customer

The architecture SHALL preserve:

```text
Principal != Customer
```

A single person may hold more than one commerce relationship over time or across contexts.

Likewise, service Principals may have no Customer identity at all.

---

# 6. Authentication Authority

Authentication SHOULD be provided by the designated Baobab identity capability or trusted identity provider.

Medusa SHALL consume authenticated identity assertions rather than becoming the organisational identity authority.

---

# 7. Commerce Customer

A Commerce Customer is Medusa's representation of a commercial customer relationship.

It MAY represent:

- a B2C individual;
- a person participating in B2B purchasing;
- a commercial account contact.

It SHALL remain a Commerce-domain representation.

---

# 8. Customer Is Not Canonical Person Identity

Medusa Customer ID SHALL remain engine-native.

Where cross-platform person/customer correlation is required:

```text
Canonical Party / Customer
      │
      ├── Medusa Customer
      └── iDempiere Business Partner / Contact
```

SHALL be related through canonical mapping.

---

# 9. B2C Customer

For ordinary B2C commerce, the Customer MAY purchase directly without a Customer Organisation.

Conceptually:

```text
Principal
   │
   ▼
Customer
   │
   ▼
Cart
   │
   ▼
Order
```

---

# 10. Anonymous Customer

Baobab SHALL support anonymous or guest commerce where Market policy allows it.

An anonymous customer SHALL NOT be forced into premature creation of a global canonical identity solely to browse or create a Cart.

---

# 11. Guest Checkout

Guest checkout MAY establish sufficient transaction identity at Order commitment without creating a full persistent account.

The implementation SHALL preserve required historical contact and legal information.

---

# 12. Account Creation

Customer account creation SHALL remain distinct from Order creation.

A customer MAY create an account before, during or after purchase according to Digital Estate policy.

---

# 13. Customer Organisation

A Customer Organisation represents a business entity or commercial buying organisation participating in B2B commerce.

Examples:

```text
retailer
wholesaler
corporate customer
hospitality business
distributor
institution
```

It SHALL be distinct from the Baobab organisational model unless canonical mapping explicitly relates them.

---

# 14. Customer Organisation Is Not Tenant

The following SHALL remain invalid:

```text
CustomerOrganisation == Tenant
```

A B2B customer organisation is a participant inside a tenant's Commerce capability unless separately onboarded as a Baobab consuming tenant.

---

# 15. Customer Organisation Is Not Legal Seller

Likewise:

```text
CustomerOrganisation != LegalSeller
```

The buyer's organisation and seller's legal entity are opposite sides of a transaction.

---

# 16. Customer Organisation Is Not EngineInstance

Customer organisations SHALL not determine deployment topology.

Thousands of B2B organisations MAY safely operate within the same authorised Commerce EngineInstance where isolation is correctly implemented.

---

# 17. Canonical Organisation Mapping

Where cross-engine identity is required, a B2B Customer Organisation SHOULD map to canonical organisational identity.

Conceptually:

```text
Canonical Organisation
      │
      ├── Medusa Customer Organisation
      └── iDempiere Business Partner
```

The exact canonical classification SHALL follow the Control Plane mapping contract.

---

# 18. Buyer

A Buyer represents a person acting on behalf of a Customer Organisation.

A Buyer SHALL be resolved from:

```text
Principal
+
Organisation Membership
+
Active Organisation Context
```

---

# 19. Buyer Is Contextual

A person MAY be:

```text
Buyer for Organisation A
Approver for Organisation B
No access to Organisation C
```

Therefore, buyer authority SHALL not be stored as one global user role.

---

# 20. Membership

Membership SHALL represent the relationship between:

```text
Customer
and
Customer Organisation
```

It SHOULD carry:

- status;
- roles;
- effective period;
- invitation state;
- organisation-specific metadata.

---

# 21. Membership Lifecycle

A conceptual membership lifecycle MAY include:

```text
INVITED
   │
   ▼
ACTIVE
   │
   ├── SUSPENDED
   └── REVOKED
```

Revoked membership SHALL immediately prevent new protected operations according to policy.

---

# 22. Membership Invitation

B2B membership invitations SHALL be securely bound to:

- organisation;
- intended recipient;
- invitation token;
- expiry;
- intended role.

Invitation tokens SHALL be single-use or appropriately replay-resistant.

---

# 23. Buyer Role

Buyer Roles SHALL represent organisation-specific permissions.

Initial conceptual roles MAY include:

```text
BUYER
APPROVER
PROCUREMENT_ADMIN
ORGANISATION_ADMIN
VIEWER
```

Exact names SHALL be defined in implementation contracts.

---

# 24. Roles Are Not Global

A role assigned in Organisation A SHALL not automatically apply in Organisation B.

The authorization key is conceptually:

```text
Principal
+
Organisation
+
Role
```

not:

```text
Principal
+
Role
```

---

# 25. Purchasing Authority

Buyer authorization SHALL support more than role names.

Purchasing Authority MAY depend upon:

```text
role
Order value
Product category
Market
delivery location
cost centre
project
budget
commercial agreement
```

---

# 26. Spending Limit

A Buyer MAY have an organisation-specific spending limit.

For example:

```text
Buyer A:
may place orders <= ZAR 25,000

Buyer B:
may approve orders <= ZAR 100,000
```

These limits SHALL be server-enforced.

---

# 27. Approval Requirement

B2B policy MAY require approval for purchases exceeding a threshold.

Conceptually:

```text
Purchase Request
      │
      ▼
Approval Required?
      │
  ┌───┴───┐
  │       │
 NO      YES
  │       │
  ▼       ▼
Order   Approval
          │
          ▼
        Order
```

---

# 28. Purchase Request Is Not Order

A pending B2B approval SHALL NOT be represented as a committed Commerce Order unless business semantics explicitly require reservation beforehand.

---

# 29. Approval Is Not Payment Authorization

Baobab SHALL preserve:

```text
Buyer Approval
!=
Payment Authorization
```

These are separate controls.

---

# 30. Organisation Administrator

An Organisation Administrator MAY manage:

- memberships;
- buyer invitations;
- buyer roles;
- organisational addresses;
- purchasing settings.

This authority SHALL be limited to the organisation.

---

# 31. Commerce Administrator

A Commerce platform administrator SHALL remain distinct from a customer Organisation Administrator.

Infrastructure administration SHALL not automatically grant unrestricted customer purchasing authority.

---

# 32. Customer Context

A B2B transaction SHALL explicitly identify the Customer Organisation under which the buyer is acting.

It SHALL NOT infer the organisation merely from:

- email domain;
- saved address;
- previous Order;
- browser hostname.

---

# 33. Organisation Selection

A buyer belonging to multiple organisations MAY select an active organisation.

The server SHALL validate membership before accepting that selection.

---

# 34. Context Switching

Switching B2B organisations SHALL trigger revalidation of all organisation-sensitive state, including:

```text
catalogue
prices
commercial terms
payment terms
credit
delivery addresses
Cart
```

---

# 35. Cart Organisation

A B2B Cart SHALL belong to one Customer Organisation context.

A Cart SHALL NOT silently change organisations.

---

# 36. Organisation Change with Existing Cart

If a buyer switches organisations, the existing Cart SHALL either:

- remain attached to the original organisation;
- be replaced;
- be explicitly reconstructed.

It SHALL NOT simply inherit the new organisation without revalidation.

---

# 37. Order Organisation

A committed B2B Order SHALL permanently retain the Customer Organisation under which it was placed.

Later membership changes SHALL not alter historical Order identity.

---

# 38. Buyer Snapshot

A committed B2B Order SHOULD retain sufficient buyer identity information to establish who initiated and, where applicable, who approved the transaction.

---

# 39. Buyer Departure

If a buyer later leaves an organisation, historical Orders SHALL remain attributed correctly.

Removing membership SHALL not rewrite Order history.

---

# 40. Customer Catalogue Access

Catalogue visibility MAY depend upon Customer Organisation.

Examples:

```text
Organisation A
→ Full wholesale catalogue

Organisation B
→ Restricted catalogue

Organisation C
→ Contract-specific products
```

The server SHALL enforce catalogue entitlements.

---

# 41. Product Enumeration Security

A buyer SHALL NOT retrieve unauthorised Products merely by guessing Product or Variant IDs.

Catalogue access restrictions apply to:

- listing;
- search;
- direct Product lookup;
- pricing;
- Cart addition.

---

# 42. B2B Pricing Isolation

Organisation-specific prices SHALL be visible only to authorised members of the relevant Customer Organisation.

ADR-0012 remains authoritative for pricing semantics.

---

# 43. Search Isolation

Search results SHALL respect organisation-specific catalogue and pricing visibility.

A public search index SHALL not expose private B2B commercial information.

---

# 44. Cache Isolation

Any cache containing organisation-sensitive Commerce information SHALL include sufficient scope to prevent cross-organisation leakage.

---

# 45. Delivery Addresses

A Customer Organisation MAY maintain approved delivery addresses.

A Buyer MAY only use addresses authorised for the organisation unless policy permits ad hoc addresses.

---

# 46. Billing Address

Billing-address authority MAY differ from shipping-address authority.

Organisation-specific controls MAY restrict modifications.

---

# 47. Address Is Not Organisation Identity

An address SHALL not be used as canonical identity for a Customer Organisation.

---

# 48. Contact

A B2B organisation MAY have multiple contacts.

Contacts SHALL remain distinct from Buyers.

For example, an accounts-payable contact may receive invoices but have no purchasing authority.

---

# 49. ERP Business Partner

Where iDempiere participates, the B2B Customer Organisation SHOULD map to the appropriate ERP Business Partner representation.

---

# 50. ERP Contact

Buyer/contact mappings MAY correspond to iDempiere user/contact records where needed.

These mappings SHALL not replace Medusa-native Commerce identity.

---

# 51. ERP Credit Authority

Where iDempiere owns credit control, Commerce SHALL consume an authorised projection or decision.

It SHALL not independently reconstruct:

```text
credit limit
open receivables
past due balance
```

from Order history.

---

# 52. Credit Limit

Credit Limit SHALL remain distinct from spending authority.

A buyer may be authorised to order ZAR 100,000 while the organisation has only ZAR 50,000 credit available.

Both controls may need to pass.

---

# 53. Payment Terms

Organisation-specific payment terms MAY originate from ERP or another contract authority.

Medusa SHALL consume them as Commerce operational policy where required.

---

# 54. Payment Terms Are Not Role

Payment terms belong to the commercial relationship, not the buyer role.

---

# 55. Commercial Agreement

A Customer Organisation MAY have one or more commercial agreements.

Such agreements MAY affect:

- prices;
- catalogue;
- quantities;
- payment terms;
- delivery terms;
- Incoterms.

Agreement identity SHALL remain distinct from organisation identity.

---

# 56. Organisation-Specific Currency

A commercial agreement MAY constrain permitted currencies.

Currency eligibility SHALL still be validated against Market and transaction policy.

---

# 57. Multiple Markets

One B2B Customer Organisation MAY purchase in multiple Markets if authorised.

Therefore:

```text
CustomerOrganisation != Market
```

---

# 58. Multiple Legal Sellers

A B2B Customer Organisation MAY transact with multiple Baobab Legal Sellers.

The relationship SHALL be explicit per transaction.

---

# 59. Organisation Relationship

Where needed, Baobab SHOULD model the commercial relationship between:

```text
Legal Seller
and
Customer Organisation
```

as distinct from either entity.

This relationship may hold:

- account number;
- payment terms;
- price agreement;
- tax treatment;
- credit status.

---

# 60. Customer Account Number

Seller-specific customer account numbers SHALL remain external/business references.

They SHALL not become canonical organisation identity.

---

# 61. Buyer Email

Email SHALL not be treated as immutable canonical identity.

Email addresses may change.

Identity correlation SHALL use stable identifiers.

---

# 62. Email Domain

Email-domain matching MAY assist onboarding workflows but SHALL NOT authoritatively establish organisation membership.

---

# 63. Identity Linking

A logged-in Principal MAY be linked to an existing Commerce Customer only through a trusted identity-linking process.

Guessing by email alone SHALL not override verified ownership.

---

# 64. Duplicate Customers

The system SHALL tolerate and reconcile duplicate Commerce Customer representations where historical migration or integration creates them.

It SHALL not merge identities automatically without governance.

---

# 65. Customer Merge

Customer merge SHALL be a governed identity operation.

It MUST preserve:

- historical Orders;
- membership;
- provider references;
- audit history.

---

# 66. Organisation Merge

Organisation merge is even more sensitive.

It MAY affect:

- contracts;
- prices;
- credit;
- ERP mappings;
- tax;
- outstanding Orders.

It SHALL require explicit administrative governance.

---

# 67. Organisation Split

Corporate restructuring MAY require one customer organisation to split into multiple commercial entities.

Canonical identity SHALL not be casually rewritten.

---

# 68. Suspension

An organisation MAY be suspended from new purchasing without deleting:

- historical Orders;
- invoices;
- payments;
- membership history.

---

# 69. Buyer Suspension

A specific Buyer MAY be suspended while the Customer Organisation remains active.

---

# 70. Deletion

Hard deletion of B2B identity data SHALL be constrained by:

- transaction history;
- accounting requirements;
- audit requirements;
- privacy law.

Deactivation/anonymisation MAY be more appropriate.

---

# 71. Data Minimisation

Commerce SHALL store only customer information required for legitimate business purposes.

Canonical events SHOULD avoid unnecessary personal information.

---

# 72. Customer Event Model

Potential Commerce customer events include:

```text
commerce.customer.created
commerce.customer.updated
commerce.customer.deactivated
```

where cross-system propagation is required.

---

# 73. Organisation Events

Potential B2B events include:

```text
commerce.customer_organisation.created
commerce.customer_organisation.updated
commerce.customer_organisation.suspended
```

---

# 74. Membership Events

Potential membership facts include:

```text
commerce.organisation_member.invited
commerce.organisation_member.activated
commerce.organisation_member.role_changed
commerce.organisation_member.revoked
```

Sensitive personal information SHALL be minimised.

---

# 75. Authorization Events

Material authorization changes SHOULD be auditable.

This includes:

- buyer role change;
- spending-limit change;
- approver assignment;
- membership suspension.

---

# 76. Authorization Model

Authorization SHALL evaluate the complete protected context.

Conceptually:

```text
Authorize(
    Principal,
    Tenant,
    Commerce Context,
    Customer Organisation?,
    Membership?,
    Role?,
    Resource,
    Action
)
```

---

# 77. Authentication Is Insufficient

A valid login SHALL NOT imply authority to:

- view all Orders;
- use every organisation;
- access private pricing;
- invite members;
- approve purchases;
- issue refunds.

---

# 78. Resource Ownership

Commerce authorization SHALL enforce ownership or organisational entitlement for protected resources including:

```text
Cart
Order
Quote
Address
Payment
Return
```

---

# 79. Object-Level Authorization

Knowing a resource identifier SHALL never be sufficient for access.

---

# 80. B2B Cross-Organisation Isolation

Organisation A MUST NOT access:

- Organisation B Orders;
- Organisation B prices;
- Organisation B quotes;
- Organisation B payment terms;
- Organisation B addresses;
- Organisation B membership.

This is a production security invariant.

---

# 81. Service Accounts

Machine-to-machine Commerce integrations SHALL use Service Principals rather than impersonating human buyers.

---

# 82. Integration Identity

Integration Principals SHALL have narrowly scoped capabilities.

An ERP integration identity SHALL not automatically receive customer administrative permissions.

---

# 83. Delegated Access

Future delegated procurement agents MAY act for multiple Customer Organisations.

Such access SHALL use explicit delegation rather than pretending the agent itself owns those organisations.

---

# 84. Impersonation

Administrative customer impersonation, if introduced, SHALL:

- require elevated authorization;
- display clear operator state;
- produce audit records;
- prohibit silent impersonation.

---

# 85. Support Access

Support personnel SHOULD use scoped support capabilities rather than unrestricted customer passwords.

---

# 86. Session Scope

Session/authentication tokens SHOULD preserve sufficient identity to support trusted authorization resolution.

Organisation context MAY be selected separately rather than permanently embedded if frequent switching is required.

---

# 87. Stale Authorization

Long-lived sessions SHALL not indefinitely preserve revoked membership.

Protected actions MUST revalidate authorization according to defined freshness policy.

---

# 88. Role Revocation

Revocation SHOULD take effect promptly for new protected actions.

Cached permissions SHALL have bounded lifetime or invalidation.

---

# 89. B2B Approval Race

If buyer authority is revoked after Purchase Request creation but before approval/commitment, the final Order workflow SHALL revalidate required permissions.

---

# 90. Approval Idempotency

Repeated approval requests SHALL not produce duplicate Orders.

---

# 91. Approval Audit

Approval SHALL record:

```text
approver
organisation
request
decision
timestamp
reason?
```

where appropriate.

---

# 92. Four-Eyes Control

High-value transactions MAY require separation between:

```text
requester
and
approver
```

The platform SHALL support this without requiring tenant-specific code.

---

# 93. Self-Approval

Whether a Buyer may approve their own Purchase Request SHALL be explicit policy.

---

# 94. Approval Chain

Future approval chains MAY support multiple stages.

This SHALL remain a Commerce/B2B policy concern, not a global tenancy mechanism.

---

# 95. Budgeting

Future budget or cost-centre controls MAY be incorporated into Purchasing Authority.

Such features MAY be ERP-backed.

They SHALL not require redefining Customer Organisation.

---

# 96. Procurement Reference

B2B Orders MAY carry customer procurement references such as:

```text
purchase order number
cost centre
project code
department reference
```

These SHALL remain transaction metadata, not identity.

---

# 97. Customer PO Number

Customer Purchase Order number uniqueness SHALL be scoped according to business policy.

It SHALL not replace canonical Order identity.

---

# 98. Duplicate Customer PO Prevention

Where required, Commerce MAY enforce duplicate customer-PO-number detection within:

```text
Customer Organisation
+
Legal Seller
+
defined period
```

---

# 99. Buyer Visibility

Order visibility MAY be configured as:

```text
own Orders only
team Orders
organisation Orders
```

depending on role.

---

# 100. Organisation Admin Visibility

Organisation Administrators MAY view all organisation Orders if policy permits.

This SHALL remain organisation-scoped.

---

# 101. B2C Privacy

A B2C Customer SHALL only access their own protected Orders unless explicit delegated access exists.

---

# 102. Guest Order Access

Guest Order lookup SHALL require a secure mechanism.

Order number alone SHALL not be sufficient.

---

# 103. Customer Search

Administrative Customer search SHALL respect tenant/context authorization.

---

# 104. Organisation Search

Customer Organisation search SHALL not expose organisations belonging to unrelated tenants or seller contexts unless explicitly permitted.

---

# 105. Control Plane Role

The Control Plane MAY maintain canonical organisational identity and Context bindings.

It SHALL NOT become the runtime store for every buyer permission or customer Cart.

---

# 106. Medusa Role

Medusa SHALL own Commerce customer relationships and runtime purchasing authorization needed to safely execute Commerce.

---

# 107. ERP Role

iDempiere SHALL own ERP customer/accounting relationships such as Business Partner and receivables state where applicable.

---

# 108. No Shared Customer Database

Medusa and iDempiere SHALL NOT share Customer/Business Partner tables.

---

# 109. Customer Synchronisation

Cross-engine customer integration SHALL exchange authoritative attributes rather than overwrite entire records.

---

# 110. Attribute Authority

Attribute authority SHALL be explicit.

For example:

| Attribute                   | Typical Authority     |
| --------------------------- | --------------------- |
| Commerce account state      | Medusa                |
| Buyer membership            | Medusa/B2B capability |
| ERP Business Partner number | iDempiere             |
| Credit balance              | iDempiere             |
| Receivables                 | iDempiere             |
| Canonical organisation ID   | Control Plane         |
| Authentication credential   | Identity Provider     |

---

# 111. Conflict Resolution

Conflict resolution SHALL follow authority.

Last-write-wins across engines SHALL not be the default.

---

# 112. Organisation Provisioning

B2B organisation onboarding SHOULD be idempotent.

Conceptually:

```text
Approve Organisation
      │
      ▼
Canonical identity
      │
      ▼
Medusa Customer Organisation
      │
      ▼
ERP Business Partner if required
      │
      ▼
Mappings
      │
      ▼
Commercial Terms
      │
      ▼
Initial Organisation Admin
      │
      ▼
ACTIVE
```

---

# 113. Provisioning Failure

Partial onboarding SHALL remain observable and recoverable.

A failure creating an ERP Business Partner SHALL not result in unknown duplicate organisations on retry.

---

# 114. Customer Self-Registration

B2B self-registration MAY create an application rather than immediately active organisation membership.

Approval policy SHALL determine activation.

---

# 115. Organisation Verification

B2B onboarding MAY require:

```text
company registration
tax registration
trade references
credit checks
seller approval
```

Such verification SHALL be distinct from ordinary user authentication.

---

# 116. Verification Status

Organisation verification SHALL be represented separately from membership.

A verified organisation may still have suspended Buyers.

---

# 117. Tax Identity

Customer tax identifiers SHALL be protected and validated according to applicable jurisdiction policy.

ADR-0018 will govern tax-context semantics.

---

# 118. Audit

Material B2B identity operations SHALL be audited.

At minimum:

```text
organisation creation
membership invitation
membership activation
role change
spending-limit change
approval
membership revocation
organisation suspension
```

---

# 119. Observability

Operational metrics SHOULD include:

```text
active B2B organisations
membership invitation failures
authorization denials
approval backlog
organisation provisioning failures
cross-organisation access attempts
```

without exposing sensitive customer information in metric labels.

---

# 120. Security Testing

The B2B model SHALL receive adversarial testing for:

```text
organisation ID substitution
membership spoofing
role escalation
Cart reassignment
Order enumeration
price leakage
address leakage
approval bypass
stale-role use
```

---

# 121. Rejected Alternative: Customer Organisation Equals Tenant

**Rejected.**

Customer organisations are Commerce participants, not automatically platform tenants.

---

# 122. Rejected Alternative: Buyer Role Is Global User Role

**Rejected.**

Buyer authority is organisation-specific.

---

# 123. Rejected Alternative: Email Domain Proves Membership

**Rejected.**

Domain ownership does not prove purchasing authority.

---

# 124. Rejected Alternative: Medusa Customer ID as Global Person ID

**Rejected.**

Medusa IDs remain engine-native.

---

# 125. Rejected Alternative: ERP Business Partner as Commerce Login Identity

**Rejected.**

ERP customer/accounting identity and authentication identity are separate concerns.

---

# 126. Rejected Alternative: Authentication Equals Authorization

**Rejected absolutely.**

A logged-in user may still lack authority for a particular organisation or action.

---

# 127. Rejected Alternative: One Customer Has One Organisation

**Rejected.**

A person may act for multiple organisations.

---

# 128. Rejected Alternative: One Organisation Has One Buyer

**Rejected.**

B2B organisations commonly require many Buyers and roles.

---

# 129. Rejected Alternative: Frontend-Only Organisation Isolation

**Rejected absolutely.**

All organisation-sensitive access SHALL be enforced server-side.

---

# 130. Rejected Alternative: Shared Customer Database

**Rejected absolutely.**

Cross-engine customer correlation SHALL use contracts and mappings.

---

# 131. Consequences

## Positive

This model supports:

- B2C and B2B in one Commerce Engine;
- multiple Buyers per organisation;
- one Buyer across multiple organisations;
- organisation-specific pricing;
- purchasing approval;
- spending limits;
- ERP customer integration;
- future credit control;
- tenant-safe B2B isolation.

## Negative

It introduces additional concepts:

```text
Principal
Customer
Customer Organisation
Membership
Buyer
Role
Purchasing Authority
Commercial Relationship
```

This complexity is accepted because collapsing these concepts creates serious security and commercial errors.

---

# 132. Architectural Invariants

**CUS-COM-001**  
Principal SHALL remain distinct from Customer.

**CUS-COM-002**  
Customer Organisation SHALL remain distinct from Tenant.

**CUS-COM-003**  
Customer Organisation SHALL remain distinct from Legal Seller.

**CUS-COM-004**  
Buyer authority SHALL be organisation-specific.

**CUS-COM-005**  
One Customer MAY belong to multiple Customer Organisations.

**CUS-COM-006**  
One Customer Organisation MAY contain multiple Buyers.

**CUS-COM-007**  
Authentication SHALL not imply purchasing authorization.

**CUS-COM-008**  
Organisation membership SHALL be server-validated.

**CUS-COM-009**  
Buyer Roles SHALL not be treated as global user roles.

**CUS-COM-010**  
B2B Cart SHALL belong to one active organisation context.

**CUS-COM-011**  
Organisation switching SHALL trigger revalidation of organisation-sensitive Commerce state.

**CUS-COM-012**  
Committed Order organisation SHALL be immutable historically.

**CUS-COM-013**  
Buyer departure SHALL not rewrite historical Orders.

**CUS-COM-014**  
Organisation-specific pricing SHALL remain confidential.

**CUS-COM-015**  
Organisation-specific catalogue restrictions SHALL apply to direct resource lookup as well as listings.

**CUS-COM-016**  
Knowing an Order/Product/Cart identifier SHALL not grant access.

**CUS-COM-017**  
Credit Limit SHALL remain distinct from Buyer spending authority.

**CUS-COM-018**  
Payment Terms SHALL remain distinct from Buyer Role.

**CUS-COM-019**  
Customer account numbers SHALL not become canonical identity.

**CUS-COM-020**  
Email addresses SHALL not become immutable canonical identity.

**CUS-COM-021**  
Medusa Customer IDs SHALL remain engine-native.

**CUS-COM-022**  
ERP Business Partner IDs SHALL remain ERP-native.

**CUS-COM-023**  
Cross-engine customer identity SHALL use canonical mappings.

**CUS-COM-024**  
Customer/Business Partner databases SHALL not be shared.

**CUS-COM-025**  
B2B authorization changes SHALL be auditable.

**CUS-COM-026**  
Revoked membership SHALL not retain indefinite protected access.

**CUS-COM-027**  
B2B approval SHALL be revalidated before Order commitment.

**CUS-COM-028**  
Customer Organisation state SHALL not define EngineInstance topology.

**CUS-COM-029**  
Service Principals SHALL not impersonate human Buyers as the normal integration pattern.

**CUS-COM-030**  
Cross-organisation data leakage is a production-blocking security defect.

---

# 133. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. B2C Customer can purchase without Customer Organisation.

2. Guest customer can purchase where Market policy allows.

3. One Customer can belong to multiple B2B organisations.

4. Organisation A role does not grant authority in Organisation B.

5. Organisation A Buyer cannot access Organisation B Orders.

6. Organisation A Buyer cannot access Organisation B private prices.

7. Organisation A Buyer cannot access Organisation B addresses.

8. Direct Product ID lookup respects private catalogue eligibility.

9. Search respects B2B catalogue isolation.

10. Cache cannot leak organisation-specific pricing.

11. Invalid membership prevents organisation selection.

12. Revoked membership prevents new protected operations.

13. Expired invitation cannot activate membership.

14. Invitation cannot be reused where single-use policy applies.

15. Buyer spending limit is enforced server-side.

16. Approval-required Order cannot bypass approval.

17. Duplicate approval does not create duplicate Orders.

18. Buyer whose authority is revoked before final commitment cannot complete protected purchase.

19. Organisation switching does not silently reuse an incompatible Cart.

20. B2B Cart remains attached to its original organisation.

21. Committed Order retains original organisation after membership changes.

22. Historical Buyer attribution survives Buyer removal.

23. Customer profile address change does not rewrite historical Order address.

24. Email-domain similarity alone cannot establish membership.

25. Medusa Customer ID remains independent of ERP Business Partner ID.

26. Canonical mapping correlates Medusa Organisation to ERP Business Partner.

27. Duplicate organisation provisioning does not create duplicate ERP customer accounts.

28. ERP credit projection cannot be overwritten by Commerce Order-history calculation.

29. B2B Net-terms eligibility is limited to authorised organisation.

30. Organisation Admin cannot administer another organisation.

31. Commerce infrastructure admin does not automatically become Buyer.

32. Service integration identity cannot place customer Orders unless explicitly authorised.

33. Object identifier substitution cannot bypass authorization.

34. Guest Order lookup requires secure proof beyond Order number.

35. Suspended organisation cannot place new Orders.

36. Existing historical Orders remain accessible according to policy after organisation suspension.

37. Customer merge preserves historical Orders and memberships.

38. B2B authorization changes generate audit evidence.

39. Stale authorization cache does not preserve access indefinitely after revocation.

40. Cross-organisation access attempts are observable for security operations.
```

---

# 134. Initial B2B Production Model

The initial Baobab B2B identity architecture SHOULD be:

```text
                    IDENTITY PROVIDER
                           │
                           ▼
                       PRINCIPAL
                           │
                           ▼
                    MEDUSA CUSTOMER
                           │
                           ▼
                 ORGANISATION MEMBERSHIP
                           │
                           ▼
               CUSTOMER ORGANISATION
                           │
                  ┌────────┼─────────┐
                  │        │         │
                  ▼        ▼         ▼
                ROLE    SPEND     APPROVAL
                        LIMIT      POLICY
                  │        │         │
                  └────────┼─────────┘
                           ▼
                    BUYER AUTHORITY
                           │
                           ▼
                     B2B COMMERCE
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Catalogue      Pricing       Order
                           │
                           ▼
                   Commercial Terms
                           │
                           ▼
                       IDEMPIERE
                   Business Partner
```

---

# 135. Decision Outcome

Baobab adopts:

> **A person authenticates as a Principal, participates in Commerce as a Customer, and becomes a Buyer only when acting through a valid membership in a specific Customer Organisation.**

The tenancy rule is:

> **A B2B Customer Organisation is not automatically a Baobab Tenant.**

The authorization rule is:

> **B2B purchasing authority is derived from Principal + Organisation Membership + Role + applicable commercial policy—not from login alone.**

The identity rule is:

> **Medusa Customer and Customer Organisation identifiers remain Commerce-native; iDempiere Business Partner identifiers remain ERP-native; canonical mappings correlate them where cross-engine identity is required.**

The security rule is:

> **Every organisation-sensitive resource must be protected server-side against cross-organisation access, including direct identifier lookup, search, pricing, Cart, Order and address access.**

The commercial rule is:

> **Catalogue, pricing, payment terms, credit, spending authority and approval are separate dimensions of the B2B relationship and must not be collapsed into one role or one customer record.**

And the long-term rule is:

> **Baobab's B2B model shall support increasingly sophisticated procurement relationships without turning customer organisations into tenants, duplicating ERP authority, or introducing tenant-specific Commerce forks.**
