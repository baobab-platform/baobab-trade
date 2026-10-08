# ADR-0013: MedusaJS Commerce Inventory, Availability, Reservation and ERP Stock Authority Model

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision Owners:** Baobab Platform Architecture
- **Scope:** Baobab Commerce Engine
- **Repository:** `nabhold/baobab-trade`
- **Parent ADR:** `ADR-0008-medusajs-commerce-engine.md`
- **Preceded By:** `ADR-0012-medusajs-commerce-pricing-price-lists-promotions-and-b2b-commercial-terms.md`
- **Related Systems:** `nabhold/baobab-cp`, Baobab ERP Engine (iDempiere), Payload CMS, Baobab Digital Estates
- **Decision Class:** Inventory / Stock Availability / Reservations / Cross-Engine Authority

---

## 1. Context

Baobab requires inventory architecture capable of supporting:

- B2C retail;
- B2B wholesale;
- multiple legal sellers;
- multiple Markets;
- multiple warehouses;
- multiple stock locations;
- multiple sales channels;
- multiple Medusa EngineInstances;
- iDempiere ERP;
- physical goods;
- non-stock Products;
- bundles and kits;
- stock reservations;
- backorders;
- safety stock;
- regional stock pools;
- future warehouse-management systems;
- third-party fulfilment;
- eventual multi-region deployments.

A naïve implementation could treat the quantity stored in Medusa as the universal enterprise stock balance.

That is rejected.

iDempiere and Medusa require inventory data for fundamentally different purposes.

iDempiere requires inventory information for enterprise operations including:

- physical stock;
- warehouse management;
- receipts;
- movements;
- procurement;
- costing;
- valuation;
- accounting;
- adjustments;
- stock reconciliation.

Medusa requires inventory information primarily to answer commerce questions such as:

> Can this customer purchase this Variant through this Market and Sales Channel now?

These are related questions, but they are not identical.

The architecture must therefore distinguish:

```text
Physical Stock
Enterprise Stock
Commerce Stock Projection
Reserved Stock
Available-to-Sell
Incoming Stock
Allocated Stock
Safety Stock
Backorder Capacity
```

without allowing competing systems of record to emerge.

---

# 2. Decision

Baobab SHALL adopt a **federated inventory-authority model**.

iDempiere SHALL normally remain authoritative for enterprise physical inventory and inventory accounting where the Product is ERP-managed.

Medusa SHALL remain authoritative for commerce-specific:

- inventory reservations;
- availability-to-commerce decisions;
- commerce allocation;
- sales-channel availability;
- checkout stock validation;
- commerce reservation lifecycle.

Medusa SHALL maintain an operational inventory projection sufficient to execute commerce reliably.

Therefore:

```text
iDempiere
    │
    │ enterprise stock authority
    ▼
Commerce Stock Projection
    │
    ▼
Medusa
    │
    ├── reservations
    ├── channel allocation
    ├── safety rules
    ├── availability
    └── sellability
```

The Commerce Engine SHALL NOT perform synchronous ERP inventory queries for every storefront Product request.

---

# 3. Fundamental Principle

Baobab adopts the rule:

> **Enterprise stock and commerce availability are related but distinct business facts.**

Therefore:

```text
ERP Stock != Commerce Available-to-Sell
```

and:

```text
Physical Quantity != Available Quantity
```

and:

```text
Inventory != Product
```

and:

```text
Inventory != Sellability
```

---

# 4. Inventory Authority

For ERP-managed physical goods, iDempiere SHALL be authoritative for:

```text
physical quantity
warehouse quantity
inventory movements
receipts
issues
adjustments
transfers
inventory valuation
cost
enterprise warehouse structure
```

where those capabilities are active.

Medusa SHALL NOT become an alternative accounting inventory ledger.

---

# 5. Commerce Inventory Authority

Medusa SHALL be authoritative for commerce-local facts including:

```text
commerce reservation
reservation lifecycle
commerce allocation
available-to-commerce quantity
sales-channel availability
checkout stock decision
commerce oversell policy
```

These facts need not exist identically in ERP.

---

# 6. Medusa Inventory Model

Baobab SHALL use Medusa's supported Inventory and Stock Location capabilities rather than constructing a parallel inventory implementation without justification.

Medusa's inventory representation SHALL remain engine-native.

Baobab canonical identity and mapping SHALL relate Medusa inventory concepts to enterprise concepts where necessary.

---

# 7. Inventory Item

A Medusa Inventory Item SHALL represent a stock-managed commerce unit.

It MAY correspond to a Product Variant.

It SHALL NOT automatically be treated as the canonical enterprise inventory identity.

Conceptually:

```text
Canonical Product Variant
        │
        ├── Medusa Inventory Item
        └── iDempiere Product
```

Mappings SHALL establish correspondence.

---

# 8. Stock Location

A Medusa Stock Location SHALL represent a commerce inventory location.

It may correspond to:

- warehouse;
- fulfilment centre;
- retail location;
- distribution centre;
- third-party fulfilment location.

A Medusa Stock Location SHALL remain engine-native.

---

# 9. Canonical Warehouse Identity

Where cross-engine warehouse identity is required, Baobab SHOULD establish canonical identity or mapping.

Conceptually:

```text
Canonical Warehouse / Location
         │
         ├── iDempiere Warehouse
         └── Medusa Stock Location
```

The exact canonical entity type SHALL be defined by the Control Plane model.

---

# 10. Warehouse Is Not Tenant

A warehouse SHALL NOT define tenancy.

A tenant may own or use several warehouses.

A warehouse may support several Markets where permitted.

Therefore:

```text
Warehouse != Tenant
```

---

# 11. Warehouse Is Not Market

Likewise:

```text
Warehouse != Market
```

A Market represents a commercial context.

A warehouse represents a physical or operational inventory location.

---

# 12. Inventory Level

A Medusa inventory level SHALL represent stock information for an Inventory Item at a Stock Location.

Baobab SHALL preserve the distinction between:

```text
inventory item
+
location
=
inventory level
```

Location-sensitive stock SHALL NOT be collapsed into one global Product quantity.

---

# 13. Physical Stock

Physical stock represents goods actually present at an operational location.

For ERP-controlled stock, iDempiere SHALL normally remain authoritative.

Physical stock MAY differ temporarily from commerce projections due to:

- event propagation delay;
- receiving;
- adjustment;
- damage;
- cycle count;
- transfer;
- reservation;
- unposted movement.

---

# 14. Stocked Quantity

Medusa's stocked quantity SHALL be treated as an operational commerce projection.

Where iDempiere is authoritative, that quantity SHALL derive from or reconcile with enterprise stock.

It SHALL NOT independently become the enterprise ledger.

---

# 15. Reserved Quantity

Reserved quantity represents stock committed to an unresolved commerce requirement.

Conceptually:

```text
Stocked Quantity
-
Reserved Quantity
=
Basic Available Quantity
```

Baobab MAY apply additional policies before deriving final Available-to-Sell.

---

# 16. Incoming Quantity

Incoming stock SHALL remain separate from available stock.

Goods expected but not physically available SHALL NOT automatically be considered sellable.

A Market MAY support pre-order or future-availability policies, but such behaviour SHALL be explicit.

---

# 17. Available-to-Sell

Baobab SHALL define `AvailableToSell` as a commerce decision rather than a raw database field.

Conceptually:

```text
Enterprise / Commerce Stock Projection
-
Reservations
-
Safety Stock
-
Other Allocations
± Approved Adjustments
=
AvailableToSell
```

The formula MAY differ by Market, Product type or Sales Channel.

---

# 18. Safety Stock

The Commerce Engine SHALL support safety-stock policies where required.

For example:

```text
physical stock = 100
safety stock   = 10
reserved       = 20
```

then:

```text
available-to-sell = 70
```

if the applicable policy uses those inputs.

Safety stock protects against:

- inventory latency;
- shrinkage;
- operational uncertainty;
- high-risk overselling;
- warehouse processing delays.

---

# 19. Safety Stock Authority

Safety-stock policy MAY be commerce-owned even where physical stock is ERP-owned.

The authoritative system for the actual safety-stock parameter SHALL be explicitly defined.

It SHALL NOT be duplicated independently without reconciliation.

---

# 20. Reservation

A Reservation represents a temporary or committed hold against commerce inventory.

Reservations SHALL be managed within Medusa where Medusa performs checkout/order inventory orchestration.

---

# 21. Reservation Scope

Every Reservation SHALL identify sufficient scope, including:

```text
inventory item
stock location
quantity
business subject
```

and where required:

```text
Context
Order
Cart
Customer
Market
```

---

# 22. Reservation Identity

Reservations requiring integration or reconciliation SHOULD have stable identifiers.

A Medusa reservation ID SHALL remain engine-native.

Canonical identity SHALL only be introduced when cross-engine identity is genuinely required.

---

# 23. Reservation Lifecycle

Baobab SHALL explicitly govern reservation lifecycle.

A conceptual lifecycle is:

```text
AVAILABLE
    │
    ▼
RESERVED
    │
    ├── release
    │      ▼
    │   AVAILABLE
    │
    └── fulfil
           ▼
       CONSUMED
```

Additional states MAY be implemented where business workflows require them.

---

# 24. Cart Reservation Policy

Baobab SHALL NOT assume that adding an item to a Cart automatically guarantees inventory indefinitely.

A Market SHALL define its reservation policy.

Possible policies include:

```text
no reservation until order
short checkout reservation
cart reservation with expiry
quote reservation
manual B2B reservation
```

The policy SHALL be explicit.

---

# 25. Reservation Expiry

Temporary reservations SHOULD have an expiry where appropriate.

Expired reservations MUST be released reliably.

The implementation SHALL tolerate worker failures and restart without creating permanently stranded reservations.

---

# 26. Order Reservation

Where Medusa places inventory reservations as part of Order creation, Baobab SHALL preserve that lifecycle rather than replacing it with a parallel custom reservation mechanism without justification.

---

# 27. Custom Order Workflows

Any custom Medusa workflow that creates Orders SHALL ensure inventory reservation semantics remain correct.

A custom Order path MUST NOT bypass required reservations and later fail during fulfilment because no reservation exists.

---

# 28. Fulfilment and Reservation

Fulfilment SHALL appropriately consume or release the Reservation according to the chosen workflow.

Reservation state MUST NOT remain indefinitely after stock is physically consumed.

---

# 29. Cancellation

When an Order or line is cancelled before stock consumption, the corresponding reservation SHALL be released unless another legitimate obligation still requires it.

---

# 30. Returns

Returns SHALL NOT immediately increase Available-to-Sell merely because a customer initiated a return.

Returned stock MAY require:

```text
receipt
inspection
quality validation
restocking
```

before becoming sellable.

---

# 31. Damaged Returns

Returned goods classified as damaged SHALL NOT re-enter available inventory unless an explicit inventory process permits it.

---

# 32. Inventory Adjustment

Enterprise stock adjustments SHOULD originate in the authoritative inventory system.

Where Medusa must perform an operational adjustment, the transaction SHALL either:

- be authoritative for its designated scope; or
- be communicated to the enterprise authority.

Silent independent adjustment in both engines is prohibited.

---

# 33. Inventory Projection

When iDempiere owns enterprise stock, Medusa SHALL maintain a projected inventory state.

Conceptually:

```text
iDempiere
    │
    │ inventory fact/event
    ▼
Integration Boundary
    │
    ▼
Medusa Inventory Projection
```

This projection SHALL be designed for eventual consistency.

---

# 34. Projection Metadata

A projected inventory state SHOULD retain metadata sufficient to establish provenance.

Possible fields include:

```text
source_system
source_reference
source_version
effective_at
synchronised_at
```

where the integration contract supports them.

---

# 35. Sequence

Where the authoritative source provides a monotonically ordered sequence or version, Medusa SHALL use it to prevent an older inventory update overwriting a newer one.

---

# 36. Out-of-Order Events

The system MUST tolerate:

```text
Stock = 100   version 10
Stock = 80    version 11
```

arriving as:

```text
version 11
then
version 10
```

The resulting projection SHALL remain version 11 where ordering information is available.

---

# 37. Duplicate Inventory Events

Repeated delivery of the same inventory event MUST NOT apply the same adjustment twice.

Inventory consumers SHALL be idempotent.

---

# 38. Absolute vs Delta Events

Inventory integration SHALL explicitly distinguish between:

```text
absolute balance
```

and:

```text
quantity delta
```

These MUST NOT share ambiguous event schemas.

For example:

```text
stock.changed
quantity = 5
```

is prohibited if consumers cannot know whether `5` means:

```text
new balance = 5
```

or:

```text
increase by 5
```

---

# 39. Preferred Projection Events

Where practical, authoritative inventory events SHOULD contain sufficient information to reconstruct the intended state.

Examples MAY include:

```text
inventory.stock_level.changed
inventory.stock_adjusted
inventory.stock_received
inventory.stock_transferred
```

Exact event ownership and naming SHALL be established by the ERP integration contract.

---

# 40. Inventory Event Context

Inventory events SHOULD identify:

```text
canonical_variant_id
location reference
quantity semantics
effective timestamp
source
```

and where applicable:

```text
tenant_id
context_id
legal_entity_id
```

---

# 41. Inventory Event Granularity

Events SHOULD describe business-relevant inventory facts rather than raw database changes.

Database triggers producing opaque row-change events SHALL NOT define the canonical integration contract.

---

# 42. Eventual Consistency

Baobab accepts eventual consistency between iDempiere enterprise stock and Medusa commerce stock projection.

This is a deliberate architectural decision.

The alternative—synchronous ERP access on every commerce request—would introduce excessive coupling and availability risk.

---

# 43. Bounded Staleness

Eventual consistency SHALL NOT mean uncontrolled staleness.

The platform SHOULD establish measurable expectations for:

```text
normal propagation latency
maximum tolerated projection age
reconciliation frequency
alerting threshold
```

based on business risk.

---

# 44. Projection Age

Where useful, the Commerce Engine SHOULD know the timestamp of its latest authoritative inventory update.

This allows detection of dangerously stale inventory.

---

# 45. Stale Inventory Policy

If the inventory projection becomes too stale, the Market SHALL have an explicit degraded-mode policy.

Possible policies include:

```text
continue selling with safety stock
disable checkout
allow enquiry only
allow backorder
require manual confirmation
```

The policy SHALL NOT be accidental.

---

# 46. ERP Outage

An iDempiere outage SHOULD NOT automatically prevent:

- catalogue browsing;
- Product detail;
- customer login;
- existing Cart viewing.

Whether it prevents:

```text
cart mutation
checkout
order placement
```

shall depend on inventory risk policy.

---

# 47. Commerce Availability

A customer-facing availability decision SHALL use Medusa's locally available commerce state rather than performing an obligatory synchronous iDempiere read for every request.

---

# 48. Overselling

Baobab SHALL define explicit overselling policy.

Possible policies include:

```text
STRICT
CONTROLLED
BACKORDER
PREORDER
```

The exact canonical terms MAY differ.

---

# 49. Strict Policy

Under strict policy:

```text
requested quantity > available-to-sell
```

SHALL cause the purchase attempt to fail.

---

# 50. Controlled Oversell

Controlled oversell MAY permit an explicitly bounded negative availability where business policy accepts it.

It SHALL NOT arise accidentally from race conditions.

---

# 51. Backorder

Backorder SHALL be an explicit Product/Market capability.

A Product Variant supporting backorder MAY accept orders when current physical availability is insufficient.

The Order SHALL clearly represent that fulfilment is pending future stock.

---

# 52. Preorder

Preorder SHALL remain distinct from backorder.

Preorder typically represents sale before a planned release or availability date.

The architecture SHALL preserve this semantic distinction where both are introduced.

---

# 53. Inventory Race Conditions

Concurrent checkout attempts SHALL not rely solely on a stale read followed by independent writes.

Reservation creation MUST use concurrency-safe Medusa/database mechanisms.

---

# 54. Negative Availability

Negative inventory values SHALL only occur where explicitly permitted by configured policy.

An unexpected negative balance SHALL be observable as an anomaly.

---

# 55. Inventory Allocation

Commerce stock MAY be allocated by:

```text
Market
Sales Channel
Customer Segment
B2B Customer
Campaign
```

where business requirements justify it.

Allocation SHALL remain distinct from physical inventory ownership.

---

# 56. Sales Channel Allocation

A warehouse with 1,000 physical units MAY expose:

```text
600 to B2C
300 to B2B
100 protected reserve
```

without implying three physically separate stock pools.

Allocation is a commercial availability policy.

---

# 57. Market Allocation

Likewise, inventory MAY be reserved for particular Markets.

A Product being physically present does not mean every Market may sell it.

---

# 58. B2B Allocation

B2B contracts MAY include guaranteed inventory allocations.

Such allocation SHALL be explicitly modelled if required.

A customer-specific allocation SHALL not become tenancy.

---

# 59. Product Sellability

Inventory is one input into Product sellability.

Final sellability MAY require:

```text
Product active
Variant active
Market eligible
Sales Channel eligible
Customer authorised
Price resolved
Inventory policy satisfied
```

Inventory alone SHALL NOT determine sellability.

---

# 60. Non-Stock Products

Products such as:

- services;
- digital products;
- subscriptions;
- licences;

MAY bypass physical inventory management.

The absence of inventory SHALL NOT automatically make such Products unsellable.

---

# 61. Manage-Inventory Policy

Whether a Variant is inventory-managed SHALL be explicit.

Turning inventory management off SHALL be a governed decision because doing so changes reservation and availability semantics.

---

# 62. Bundles

Commerce bundles MAY consume multiple underlying Inventory Items.

For example:

```text
Gift Box
   │
   ├── Product A × 1
   ├── Product B × 2
   └── Packaging × 1
```

Bundle availability SHALL be derived from component availability where the bundle is virtual.

---

# 63. Bundle Availability

The available quantity of a virtual bundle SHOULD be determined by its limiting component.

This calculation SHALL account for applicable reservation/allocation rules.

---

# 64. ERP BOM Is Not Automatically Commerce Bundle

An iDempiere BOM and Medusa commerce bundle MAY describe different business concepts.

They SHALL only be mapped when explicitly equivalent.

---

# 65. Lot-Controlled Inventory

Future inventory architecture MAY require lot, batch or serial tracking.

Where iDempiere owns such tracking, Medusa SHOULD receive only the level of detail required for commerce unless customer-facing lot selection is required.

---

# 66. Coffee and Commodity Lots

For commodity commerce, commercially relevant attributes MAY include:

```text
origin
crop year
grade
process
lot
warehouse
quality characteristics
```

These SHOULD be modelled according to Product/lot authority rather than forcing all warehouse detail into generic Variant fields.

---

# 67. Serial Numbers

Serial-number tracking SHOULD remain with ERP/WMS where it is operationally authoritative unless commerce genuinely requires serial selection before sale.

---

# 68. Expiry-Dated Inventory

Products with expiration dates MAY require:

```text
FEFO
lot eligibility
minimum remaining shelf life
```

Such fulfilment logic MAY reside in ERP/WMS while Medusa consumes aggregate commerce availability.

---

# 69. Warehouse Selection

Warehouse or Stock Location selection SHALL be server-driven.

A client MAY express delivery preferences but SHALL NOT arbitrarily select protected inventory locations without validation.

---

# 70. Sales Channel and Location

Medusa Sales Channels MAY participate in Stock Location availability.

Baobab SHALL preserve Medusa-native relationships where useful while ensuring canonical Market and Context remain distinct.

---

# 71. Fulfilment Location

The location chosen for fulfilment MAY depend on:

```text
stock
customer destination
Market
shipping method
cost
capacity
seller
service level
```

The Inventory ADR does not make Medusa the universal warehouse-routing authority.

A future fulfilment or OMS capability MAY refine this decision.

---

# 72. Legal Seller and Inventory

Inventory availability SHALL respect legal ownership or permitted seller use where relevant.

A Medusa instance serving multiple legal sellers MUST NOT expose Seller A's stock as Seller B's available inventory unless an explicit business relationship permits it.

---

# 73. Consignment Stock

Future consignment scenarios SHALL represent stock ownership separately from physical location.

Physical possession does not necessarily imply legal ownership.

---

# 74. Third-Party Inventory

Third-party logistics or supplier-managed inventory MAY be projected into commerce through adapters.

Provider-specific identifiers SHALL remain external references.

---

# 75. Inventory APIs

Digital Estates SHALL consume commerce availability through published Medusa/Baobab APIs.

They SHALL NOT access:

- Medusa inventory tables;
- iDempiere stock tables;
- warehouse databases.

---

# 76. Customer-Facing Quantity

The Digital Estate SHOULD receive only the quantity detail required by the experience.

Possible representations include:

```text
in_stock
low_stock
out_of_stock
available_quantity
backorder
preorder
```

Exact disclosure MAY vary by Market.

---

# 77. B2B Quantity Visibility

B2B customers MAY legitimately require exact inventory quantities.

Where supported, such disclosure SHALL be governed by commercial policy.

Not every customer needs access to warehouse stock detail.

---

# 78. Inventory Security

Inventory can represent commercially sensitive data.

Exact inventory quantities MAY reveal:

- sales velocity;
- procurement volumes;
- operational capacity;
- supply constraints.

APIs SHALL expose only authorised levels of detail.

---

# 79. Cart Validation

Adding a Product to Cart MAY perform an availability check.

However, an availability check SHALL NOT necessarily constitute a reservation.

The two concepts SHALL remain distinct.

---

# 80. Checkout Validation

Immediately before Order commitment, the Commerce Engine MUST validate applicable inventory policy.

This validation SHALL use authoritative commerce availability at that point in time.

---

# 81. Client Quantity

Client-supplied quantity is untrusted.

The Commerce Engine SHALL validate:

```text
quantity > 0
quantity conforms to unit rules
quantity satisfies minimum/maximum
quantity satisfies inventory policy
```

before commitment.

---

# 82. Reservation and Payment Ordering

The relative ordering of:

```text
inventory reservation
payment authorization
order creation
```

SHALL be defined explicitly by checkout workflow.

Failure compensation SHALL be documented.

---

# 83. Reservation Failure

If stock reservation fails:

- Order creation SHALL not falsely indicate guaranteed stock;
- payment SHALL be reversed/voided if already authorised where required;
- failure SHALL be visible to the customer and operations.

---

# 84. Payment Failure

If inventory is reserved but payment fails, the reservation SHALL be released according to policy.

The system SHALL avoid indefinite inventory leakage.

---

# 85. Order Failure

If the Order transaction fails after a reservation action, compensation SHALL ensure inventory is not stranded.

Workflow boundaries SHALL be transactionally safe where local operations permit.

---

# 86. Distributed Transactions

Baobab SHALL NOT use a distributed database transaction between Medusa and iDempiere to reserve stock.

The architecture SHALL use:

```text
local transactions
events
idempotency
reconciliation
compensation
```

---

# 87. ERP Reservation

Where enterprise operations require ERP-visible reservation or allocation, the relationship to Medusa reservation SHALL be explicitly defined.

The platform SHALL NOT assume every Medusa reservation must be synchronously duplicated into iDempiere.

---

# 88. Reservation Authority

For normal online commerce:

```text
Medusa reservation
```

SHALL be authoritative for the commerce checkout reservation.

If iDempiere requires an enterprise commitment record, it SHALL be created through an integration process.

---

# 89. Reservation Duplication Risk

Two independent reservation ledgers controlling the same stock pool can over-reserve or under-utilise inventory.

Therefore, Baobab SHALL define one decision authority for each reservation scope.

---

# 90. ERP Inventory Event Flow

The preferred enterprise-to-commerce flow is:

```text
iDempiere Stock Change
        │
        ▼
Transactional Outbox / Integration Event
        │
        ▼
Canonical Inventory Event
        │
        ▼
Medusa Consumer
        │
        ▼
Inventory Projection Update
```

where iDempiere provides the authoritative stock update.

---

# 91. Commerce Reservation Event Flow

Commerce reservation events MAY flow separately:

```text
Medusa Reservation
       │
       ▼
commerce.inventory.reserved
       │
       ▼
interested downstream systems
```

Only systems that require this fact SHALL consume it.

---

# 92. Event Vocabulary

Potential commerce inventory events include:

```text
commerce.inventory.reserved
commerce.inventory.reservation_released
commerce.inventory.availability_changed
commerce.inventory.backorder_created
commerce.inventory.projection_updated
commerce.inventory.projection_stale
```

Exact schemas SHALL be governed through `nabhold/shared`.

---

# 93. Reconciliation

Inventory reconciliation SHALL be a first-class operational capability.

The platform SHOULD detect:

```text
ERP stock differs materially from Medusa projection
projection stale
mapping missing
warehouse mapping missing
reservation stranded
negative unexpected availability
duplicate inventory event
out-of-order projection
```

---

# 94. Reconciliation Is Not Blind Overwrite

Reconciliation SHALL determine the authority of each field before applying a repair.

For example:

```text
physical stock mismatch
→ ERP authority may overwrite projection
```

but:

```text
commerce reservation mismatch
→ Medusa reservation authority must be considered
```

A complete Medusa inventory reset from ERP quantities could destroy legitimate commerce reservations.

---

# 95. Reconciliation Formula

Where ERP provides physical stock and Medusa owns reservations, reconciliation MAY conceptually calculate:

```text
ERP physical quantity
-
Medusa reservations
-
commerce safety stock
-
commerce allocations
=
commerce available-to-sell
```

subject to the actual Medusa model and business rules.

---

# 96. Inventory Drift

A tolerance threshold MAY be defined for inventory drift.

For high-risk Products, any mismatch MAY require intervention.

For lower-risk Products, small temporary differences MAY be acceptable.

---

# 97. Inventory Snapshot Rebuild

The Commerce Engine SHOULD support rebuilding inventory projections from authoritative sources without losing valid commerce reservations.

The rebuild procedure SHALL be documented and tested.

---

# 98. Initial Synchronisation

When onboarding a Market or EngineInstance, initial inventory synchronisation SHALL occur before commerce activation for stock-managed Products.

Conceptually:

```text
Products mapped
      │
      ▼
Locations mapped
      │
      ▼
Initial Stock Snapshot
      │
      ▼
Projection Verified
      │
      ▼
Commerce Activated
```

---

# 99. New Product Provisioning

A newly created stock-managed Product SHALL not become sellable until required inventory mappings and policy are valid.

---

# 100. New Warehouse Provisioning

Provisioning a new Stock Location SHALL include:

```text
canonical location mapping
ERP location mapping
Market eligibility
Sales Channel relationship
fulfilment configuration
inventory synchronisation
```

as applicable.

---

# 101. Location Retirement

Retiring a Stock Location SHALL preserve historical references.

Active inventory, reservations and fulfilments MUST be resolved before destructive removal.

---

# 102. Inventory Migration

Moving stock between EngineInstances or regions SHALL require controlled migration.

It SHALL address:

- Products;
- Inventory Items;
- locations;
- stock;
- reservations;
- mappings;
- events;
- active Orders;
- fulfilment.

---

# 103. Split-Brain Prevention

During inventory migration, both old and new Commerce EngineInstances MUST NOT independently sell against the same supposedly exclusive stock projection without an explicit shared-authority design.

---

# 104. Regional Inventory

A global tenant MAY operate:

```text
Africa Stock Pool
European Stock Pool
North American Stock Pool
```

without changing canonical Product identity.

Location and EngineInstance mappings SHALL establish the projection topology.

---

# 105. Cross-Region Inventory

Stock MAY potentially be visible across regions, but cross-region selling SHALL be explicit.

Availability SHALL consider:

- export restrictions;
- fulfilment capability;
- delivery time;
- legal seller;
- taxes;
- customs;
- currency;
- inventory latency.

---

# 106. Inventory and Market Migration

Moving a Market between EngineInstances SHALL include an inventory cutover plan.

The Market MUST NOT become active on the new EngineInstance with an unverified or stale inventory projection.

---

# 107. Cache

Inventory caches MUST use appropriately scoped keys.

Unsafe:

```text
stock:variant-123
```

where the same Variant may differ by location, Market or EngineInstance.

Cache scope SHALL reflect the requested availability semantics.

---

# 108. Cache Invalidation

Inventory cache invalidation SHOULD be event-driven or bounded by short, explicit TTLs appropriate to stock volatility.

Long-lived uncontrolled inventory caches are prohibited for transaction validation.

---

# 109. Search

Search indexes MAY carry coarse availability such as:

```text
in_stock
```

for browse optimisation.

Checkout MUST NOT treat search-index availability as authoritative.

---

# 110. CDN

Customer-facing stock badges MAY be edge-cached only according to risk-appropriate policy.

Exact checkout inventory SHALL be validated server-side.

---

# 111. Analytics

Analytical inventory data SHALL be sourced through governed exports/events/projections.

Analytics systems SHALL NOT become inventory authorities.

---

# 112. Observability

Inventory telemetry SHOULD expose:

```text
projection age
reservation count
reservation age
available-to-sell
stock update latency
inventory consumer failures
reconciliation discrepancies
negative inventory anomalies
```

where appropriate.

---

# 113. Metrics

Important metrics MAY include:

```text
inventory_event_lag
inventory_projection_age
reservation_failures
reservation_expirations
oversell_count
stockout_rate
reconciliation_mismatch_count
```

High-cardinality Product IDs SHALL not be used carelessly as metric labels.

---

# 114. Alerts

Production alerts SHOULD cover:

```text
inventory feed stopped
projection exceeds stale threshold
reservation backlog
unexpected negative availability
reconciliation failure
mapping failure
```

---

# 115. Audit

Manual inventory operations SHOULD record:

```text
actor
operation
inventory item
location
quantity
reason
context
timestamp
correlation ID
```

as required.

---

# 116. Manual Stock Edit

Manual Medusa stock edits SHALL be restricted where iDempiere is authoritative.

If emergency Commerce-level override is allowed, it MUST be:

- authorised;
- auditable;
- temporary where appropriate;
- reconcilable.

---

# 117. Security

Inventory administration SHALL require explicit authorization.

Knowledge of:

```text
inventory_item_id
stock_location_id
```

shall not confer access.

---

# 118. Cross-Tenant Isolation

In a shared EngineInstance:

```text
Tenant A
```

MUST NOT access or mutate protected inventory belonging exclusively to:

```text
Tenant B
```

Context enforcement SHALL apply to inventory administration and APIs.

---

# 119. B2B Isolation

Customer Organisation A MUST NOT access inventory allocations reserved exclusively for Customer Organisation B unless business policy explicitly permits visibility.

---

# 120. API Idempotency

Inventory mutation commands exposed through Baobab APIs SHOULD support idempotency.

Repeated command delivery MUST NOT unintentionally double-adjust stock.

---

# 121. Inventory Import

Bulk inventory imports SHALL distinguish between:

```text
absolute snapshot
adjustment
receipt
allocation
```

Import semantics MUST be explicit.

---

# 122. Inventory Export

Inventory exports SHALL identify whether values represent:

```text
physical stock
commerce stock projection
reserved quantity
available-to-sell
incoming stock
```

A generic `quantity` column without semantics SHOULD be avoided.

---

# 123. Backup and Restore

Database recovery SHALL account for inventory reservations.

Restoring an older Medusa database may resurrect reservations that had already been released or lose reservations created later.

Recovery SHALL therefore include reconciliation with:

```text
Orders
fulfilments
ERP stock
event history
```

---

# 124. Event Replay

Inventory events SHALL be safely replayable.

Absolute stock projection events are often easier to reconcile than non-idempotent blind deltas.

Where deltas are used, durable deduplication is mandatory.

---

# 125. Dead-Letter Handling

An inventory event that cannot be applied SHALL NOT be silently discarded.

The failure SHALL enter a recoverable operational state.

---

# 126. Inventory SLOs

Production environments SHOULD define inventory service objectives, including:

```text
projection freshness
checkout availability latency
reservation success rate
reconciliation interval
```

according to Market risk.

---

# 127. Degraded Mode

The Commerce Engine SHALL define intentional behaviour during:

```text
ERP unavailable
event infrastructure unavailable
projection stale
warehouse unavailable
```

No critical behaviour SHALL depend on arbitrary timeout outcomes.

---

# 128. Rejected Alternative: Medusa as Universal Enterprise Inventory Master

**Rejected.**

Medusa's inventory capabilities are well suited to commerce execution, but enterprise inventory accounting, valuation and warehouse operations belong to ERP or specialised warehouse capabilities where those systems are authoritative.

---

# 129. Rejected Alternative: iDempiere Synchronous Check on Every Commerce Request

**Rejected.**

It would:

- tightly couple storefront availability to ERP;
- increase latency;
- reduce resilience;
- increase ERP load;
- make regional commerce difficult.

---

# 130. Rejected Alternative: No Commerce Inventory Projection

**Rejected.**

Medusa requires inventory state and reservations to perform reliable commerce.

---

# 131. Rejected Alternative: ERP Quantity Equals Available-to-Sell

**Rejected.**

ERP stock may include quantities:

- reserved;
- safety-protected;
- unavailable to a channel;
- unavailable to a Market;
- otherwise commercially restricted.

---

# 132. Rejected Alternative: Two Independent Reservation Authorities

**Rejected.**

Independent reservation systems controlling the same stock without coordination create double-booking and underutilisation risks.

---

# 133. Rejected Alternative: Frontend Stock Authority

**Rejected absolutely.**

Digital Estates may display availability but cannot determine transactional stock authority.

---

# 134. Rejected Alternative: Search Index as Stock Authority

**Rejected.**

Search is eventually consistent and designed for retrieval, not transactional reservation.

---

# 135. Rejected Alternative: Shared Database Between Medusa and iDempiere

**Rejected absolutely.**

Inventory integration SHALL remain contract-based.

---

# 136. Consequences

## Positive

This decision enables:

- resilient commerce;
- ERP independence during browsing;
- multi-warehouse commerce;
- reservations;
- B2B allocations;
- safety stock;
- backorders;
- multiple Markets;
- future 3PL/WMS integration;
- regional inventory projections;
- independently scalable Commerce and ERP engines.

## Negative

The decision introduces:

- eventual consistency;
- inventory projection;
- reconciliation;
- reservation management;
- stale-data policy;
- more complex operational monitoring.

These costs are accepted because they preserve correct bounded contexts and improve platform resilience.

---

# 137. Architectural Invariants

**INV-COM-001**  
Enterprise physical inventory SHALL remain distinct from commerce availability.

**INV-COM-002**  
For ERP-managed stock, iDempiere SHALL remain authoritative for enterprise physical inventory.

**INV-COM-003**  
Medusa SHALL remain authoritative for commerce reservation lifecycle.

**INV-COM-004**  
Medusa SHALL maintain a commerce inventory projection where enterprise stock resides elsewhere.

**INV-COM-005**  
The storefront SHALL NOT require synchronous ERP stock reads for ordinary browse operations.

**INV-COM-006**  
Available-to-Sell SHALL not be assumed equal to physical stock.

**INV-COM-007**  
Reservations SHALL remain distinct from physical stock.

**INV-COM-008**  
Incoming stock SHALL not automatically be sellable.

**INV-COM-009**  
Safety stock SHALL remain explicit where used.

**INV-COM-010**  
Inventory event consumers SHALL be idempotent.

**INV-COM-011**  
Out-of-order stock events SHALL not regress newer state where ordering information exists.

**INV-COM-012**  
Absolute and delta inventory events SHALL have unambiguous semantics.

**INV-COM-013**  
Search indexes SHALL not become transactional inventory authority.

**INV-COM-014**  
Digital Estates SHALL not calculate authoritative availability.

**INV-COM-015**  
Checkout SHALL validate current commerce availability.

**INV-COM-016**  
Oversell and backorder policies SHALL be explicit.

**INV-COM-017**  
Market-specific allocations SHALL not redefine Product identity.

**INV-COM-018**  
Stock Location SHALL remain distinct from Market and Tenant.

**INV-COM-019**  
Engine-native inventory identifiers SHALL remain external/native identifiers.

**INV-COM-020**  
Inventory mappings SHALL be reconcilable.

**INV-COM-021**  
Inventory projection age SHALL be observable.

**INV-COM-022**  
Stale-projection behaviour SHALL be explicit.

**INV-COM-023**  
ERP outages SHALL degrade commerce according to policy rather than accidental coupling.

**INV-COM-024**  
Inventory reservations SHALL not be stranded after failed workflows.

**INV-COM-025**  
Returns SHALL not automatically become sellable stock.

**INV-COM-026**  
Historical inventory-related Order facts SHALL remain interpretable.

**INV-COM-027**  
Inventory migration SHALL prevent split-brain selling.

**INV-COM-028**  
Inventory administration SHALL be tenant/context isolated.

**INV-COM-029**  
Shared databases between Medusa and iDempiere are prohibited.

**INV-COM-030**  
Inventory reconciliation SHALL preserve each system's designated authority.

---

# 138. Required Conformance Tests

A conforming implementation SHALL prove at minimum:

```text
1. ERP stock can project into Medusa inventory.

2. Duplicate inventory events do not double-adjust stock.

3. Out-of-order inventory updates do not regress newer state.

4. Product browsing works during temporary ERP outage where policy permits.

5. Checkout uses local Commerce availability.

6. Checkout fails under strict policy when quantity exceeds Available-to-Sell.

7. Safety stock is excluded from customer availability.

8. Reservation reduces Available-to-Sell.

9. Reservation release restores availability.

10. Fulfilment consumes reservation correctly.

11. Cancelled Orders release reservations where applicable.

12. Failed payment does not strand reservation indefinitely.

13. Failed Order workflow does not strand reservation.

14. Incoming stock does not become available prematurely.

15. Backorder-enabled Product may transact according to policy.

16. Non-backorder Product cannot oversell under strict policy.

17. One Stock Location can map to an ERP warehouse without sharing IDs.

18. Medusa Stock Location IDs remain native.

19. One canonical Variant can map to inventory representations in multiple EngineInstances.

20. Tenant A cannot mutate Tenant B inventory.

21. B2B Organisation A cannot consume Organisation B's protected allocation.

22. Search availability cannot override checkout availability.

23. A stale projection triggers the configured degraded-mode behaviour.

24. Reconciliation detects ERP/Commerce stock divergence.

25. Reconciliation does not erase valid Commerce reservations.

26. Manual emergency adjustments are audited.

27. Inventory migration prevents simultaneous conflicting writers.

28. An orphan warehouse mapping becomes observable.

29. Event replay does not double-apply stock movement.

30. Restore procedures reconcile reservations and stock before normal commerce resumes.
```

---

# 139. Initial Implementation Profile

For Baobab's first production deployment, the preferred profile SHALL be:

```text
iDempiere
   │
   │ enterprise stock authority
   ▼
Canonical Inventory Integration
   │
   ▼
Medusa Inventory Module
   │
   ├── Inventory Items
   ├── Inventory Levels
   ├── Stock Locations
   └── Reservations
   │
   ▼
Commerce Available-to-Sell
```

This is deliberately simpler than introducing a separate inventory microservice or WMS at the outset.

---

# 140. Evolution Path

The architecture SHALL allow later introduction of:

```text
Warehouse Management System
3PL Inventory Provider
Supplier Inventory
Distributed Order Management
Advanced Allocation Engine
```

without redefining canonical Product identity or forcing digital estates to change their commerce contract.

Conceptually:

```text
                    Inventory Authorities
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
        iDempiere          WMS             3PL
            │               │               │
            └───────────────┼───────────────┘
                            ▼
                  Inventory Integration
                            │
                            ▼
                   Commerce Projection
                            │
                            ▼
                         Medusa
```

Authority for each stock pool SHALL remain explicit.

---

# 141. Implementation Implications

This ADR requires subsequent implementation specifications covering:

```text
canonical inventory event schemas
Inventory Item mapping
Stock Location mapping
ERP warehouse mapping
inventory projection consumer
reservation lifecycle
Available-to-Sell calculation
safety-stock policy
oversell/backorder policy
inventory reconciliation
projection freshness
inventory observability
inventory migration
initial inventory synchronisation
```

These SHALL be implemented using Medusa-supported Inventory and Stock Location capabilities wherever they satisfy the requirement.

---

# 142. Decision Outcome

Baobab adopts the following inventory architecture:

```text
                         IDEMPIERE ERP
                     Enterprise Inventory
                            Authority
                               │
                               │
                    Canonical Inventory Events
                               │
                               ▼
                   ┌──────────────────────┐
                   │ MEDUSAJS COMMERCE   │
                   │ Inventory Projection│
                   └──────────┬───────────┘
                              │
                   ┌──────────┼───────────┐
                   │          │           │
                   ▼          ▼           ▼
               Stocked    Reserved      Safety/
               Quantity   Quantity     Allocation
                   │          │           │
                   └──────────┼───────────┘
                              ▼
                      AVAILABLE-TO-SELL
                              │
                              ▼
                         CHECKOUT
                              │
                              ▼
                           ORDER
                              │
                              ▼
                       FULFILMENT
```

The governing rule is:

> **iDempiere tells Baobab what enterprise stock exists; Medusa determines what commerce can safely sell from the inventory projected into its context.**

The reservation rule is:

> **A reservation is a commerce commitment against inventory, not an alternative physical stock ledger.**

The resilience rule is:

> **Commerce availability shall be locally executable and event-fed rather than requiring synchronous ERP availability for every customer interaction.**

The consistency rule is:

> **Eventual consistency is accepted, but unbounded staleness is not. Inventory freshness, reconciliation and degraded-mode behaviour must be explicit and observable.**

The integration rule is:

> **Inventory crosses engine boundaries through mappings, APIs and canonical events—not shared tables.**

And the long-term rule is:

> **Baobab shall be able to introduce WMS, 3PL, regional stock pools and advanced allocation later without replacing the canonical Product model or coupling Digital Estates to inventory infrastructure.**
