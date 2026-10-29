# DEV-07 Trade commercial lifecycle

Authority: Accepted EA v2.3/EA-DEV, ADR-SHARED-042 Decisions 5–9 and Trade
ADR-0014/0017/0019/0033–0036. This increment implements Trade's
`trade/v1` RFQ/quotation resources. Standalone `rfq/v1` and supplier sourcing
resources remain distinct; no resource identity or provider claim is relabelled.

`commercial-lifecycle.ts` validates closed command fields, nonzero decimal
quantities, exact decimal money/currency, real dates and allowed transitions.
The quotation total is the sum of its offered lines; it is not a final gross
buyer-commitment valuation and cannot establish tax, freight or duty authority.
Inputs cannot set IDs, lifecycle state, versions or server timestamps.

`PostgresCommercialLifecycle` performs each command in one transaction with
bounded lock/statement timeouts. It scopes access by Tenant, buyer Organisation,
Digital Estate, canonical Market and seller LegalEntity. A separate current
actor may read their company's resources only after independent authorization.
An exact idempotent retry returns its original response only after authorization
is repeated; conflicting payloads fail. RFQ review uses an optimistic version;
quote issuance locks the parent first and commits the quote, RFQ progression,
history and command receipt together. One current offer exists per RFQ.

RFQs start DRAFT, then SUBMITTED and UNDER_REVIEW. A seller may decline or issue
an offer. Withdrawal/expiry closes an outstanding offer in the same transaction.
To reprice, the seller withdraws the prior offer and returns the QUOTED RFQ to
UNDER_REVIEW; issuing a new offer creates a new immutable quotation identity.
The prior offer/history is retained. Terminal RFQs cannot reopen. An expired
offer cannot be treated as a current rejection/withdrawal; it must expire.

The mandatory `CommercialAuthorityPort` is a trusted runtime owner dependency,
never request data. It must implement current IAM/CP, action-specific Trade
policy and independent seller/capability authority. Buyer roles cannot supply
seller issuance or system reconciliation authority. The service independently
checks scope, bounded decision lifetime and native Organisation/membership
revisions under shared locks, and rechecks before commit. No default ALLOW port
or public HTTP endpoint is installed by this increment. The source fixture in
the PostgreSQL regression is explicitly synthetic, never a runtime provider.

Binding quote acceptance and conversion are refused by both the kernel and SQL.
Their implementation must join final gross valuation, current buyer/seller
receipts, approved scope and the spend reservation in the native transaction.
Neither an ISSUED quote nor success of this component activates a commitment.
The universal native order fence remains SHADOW. ERP posting, documentary
issuance/disclosure, external provider and complete INT-05 qualification remain
independent work.

Validation commands:

```sh
npm run test:commercial-kernel
NODE_ENV=test BAOBAB_DEV07_TEST_DB=baobab_trade_test npm run regression:commercial-lifecycle
```

The second command requires the actual migrated disposable PostgreSQL database.
It tests exact/conflicting replay, concurrent submission, scope isolation,
atomic quote/parent history, current-authority refusal, immutable history,
SQL acceptance denial, parent withdrawal and native active-absence readback.
The completed report/hash pair labels synthetic authority and leaves all
IAM/CP/provider/commitment/INT-05/production qualification flags false. Failed
runs remove prior report files first and produce no passing receipt. CI owns
database disposal; the native owner report does not certify host teardown.

The migration never deletes history on rollback. Disable the affected consumer
and return to reviewed owner pins if it fails; preserve append-only receipts
for diagnosis. No event here is emitted under an unregistered Shared event type.
