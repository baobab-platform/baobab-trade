# DEV-07 / DEV-11 — CAA-06b native buyer commitment and ERP origin gate

**Status: SOURCE IMPLEMENTATION ONLY — NOT CONNECTED-QUALIFIED — DO NOT MERGE / ACTIVATE**

**Governing**: EA v2.3 / EA-DEV DEV-07, DEV-09, DEV-11 and DEV-14;
ADR-SHARED-039 (seller authority and TA-07 native fence);
ADR-SHARED-042 (CAA-04/05/06/06b, Decisions 5–9);
ADR-SHARED-018 (canonical events); pinned Shared trade/v2 buyer-authority
receipt and valuation and ERP commerce-order-consequence v1.

## Reconciliation before implementation

| Ownership              | Implemented and retained                                                                | Missing qualification                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| IAM / CP               | Principal resolution, estate binding, seller decision and inert authority candidates    | Fresh consequential buyer-operation ALLOW on the exact purchase, approved scope/mandate, revocation readback |
| Trade                  | Native TA-07 seller receipt consumption and order fence                                 | Buyer receipt at the native COMMIT point                                                                     |
| Trade                  | Native CAA-06 spend reservation, holds, ledger                                          | COMMIT in same PostgreSQL XID as native Medusa order                                                         |
| Trade #189             | Shared parity-tested whole-obligation integer valuation                                 | Independent re-read of final native pricing, tax, freight and duty                                           |
| Trade #188             | PostgreSQL outbox, RabbitMQ, event replay, real OTLP                                    | Canonical event originating in the authorised order transaction                                              |
| ERP #125               | RabbitMQ consumer, PostgreSQL inbox, CP authority, native iDempiere document and replay | Exact Trade event ID and native origin, followed by verified downstream business effect                      |
| Infrastructure #69/#72 | IAM/CP/W3C qualification and separated evidence custody                                 | One independently witnessed buyer → Medusa → broker → ERP origin/consequence join                            |

A valid JSON envelope, broker confirmation, synthetic ERP order, green component test
or SHADOW CAA-06 decision is **not** an accepted source-to-business-consequence proof.

## Incremental implementation in this PR

1. **Buyer receipt**: an immutable PostgreSQL record with time-bounded, pinned
   Shared contract validation. Only Trade server authority can issue one;
   browser/customer/Medusa tokens do not establish buyer permission.
2. **Single consumption**: unique, immutable record bound to seller receipt,
   exact operation reference, buyer hold, native order and canonical event.
   Its database trigger refuses missing, changed or stale inputs.
3. **Native transaction origin**: the PostgreSQL guard checks the current
   transaction identity for the native order, seller commitment, spend COMMIT
   ledger row and the outbox INSERT. A later fabricated event cannot pass.
4. **Deferred decision**: the existing Decision 9 deferred classification
   trigger can recognise the B2B consumption when present; it retains exact
   profile/classification/seller/tenant checks and **remains SHADOW**.
5. **Composition seam**: the server-only native commit function obtains a
   fresh operation-specific ALLOW, checks context/seller/receipt/valuation,
   composes with PostgresSpendReservationCommands.commitWithMutation and
   requires the native Medusa owner to write and reread actual order state on
   the SAME PostgreSQL connection before inserting the outbox/consumption.
6. **Source tests**: refuse discovery-only permission, mismatched seller,
   stale buyer, changed final obligation and foreign scope before mutation.

### PostgreSQL 17 independent source-owned refusal drill

The core-module integration CI executes
`src/scripts/regression-native-buyer-guard.ts` against the disposable PostgreSQL
17 database after actual Medusa migrations. It verifies that the installed
buyer-receipt, consumption, immutability and deferred-classification triggers
are enabled, that the Decision 9 mode remains SHADOW, and that missing,
expired and rewritten receipt evidence and a syntactically well-formed but
unattributed consumption all refuse without a durable business effect.
Every synthetic record is rolled back, including on failure.

The original owner artifact
`dev07-native-buyer-origin-negatives/receipt.json` deliberately declares
`native_order_created=false`, `buyer_IAM_CP_authorized=false` and
`l4_ops_01=BLOCKED`. These are **actual PostgreSQL security negatives**, not
a successful Medusa order, a CP-issued buyer receipt, an exported trace or
a broker-to-ERP consequence. They provide an explicit regression guard
while the real native Medusa transaction adapter is still unqualified.

### Pinned ERP business-fact contract at the native commit boundary

Trade now consumes the exact existing Shared pin's
`contracts/erp/v1/commerce-order-consequence.schema.json` and its
`domain.schema.json` dependency via the maintained `contracts:sync`
closure and AJV Draft 2020-12, not a locally invented business payload.
`commitAuthorizedNativeBuyerOrder` refuses a non-conforming
`readErpConsequence` result **inside** the spend transaction, before the
canonical outbox insert. Source negatives cover an unreviewed ERP field and
assert no event or buyer-consumption insert occurs. This is additional
contract defence, not proof that the still-missing Medusa transaction-owner
adapter read authentic final native prices, lines or consequences. A second
fail-closed invariant compares ERP `grand_total` against the FULL authorised
buyer obligation using exact BigInt decimal scaling and the native owner's
persisted currency exponent. Unknown precision, nonzero fractional excess,
foreign currency or mismatched total must abort the same spend transaction;
currency precision is never guessed or supplied by a browser.

## Explicitly incomplete / not qualified

This PR **does not include a real Medusa 2.21 NativeMedusaTransactionOwner**,
and does not activate a checkout route. A Medusa workflow that opens another
database transaction cannot be used to satisfy the interface: that would
invalidate the native-XID proof even if the broker subsequently succeeds.
No hand-written synthetic order is an acceptable substitute.

The authoritative buyer order-operation decision must be issued after the
current IAM/CP and Trade policy readback. A buyer-context.resolve ALLOW is
a discovery result, **never** authority to commit. At native commit, the owner
must independently reconcile final merchandise, discounts, shipping, handling,
taxes, duty, shipping Site, currency and Incoterm. Changed facts invalidate
the receipt, approval and spend reservation.

The canonical outbox payload must be independently verified against the pinned
ERP commerce-order-consequence schema and actual Medusa order/line records.
The #188 dispatcher and #125 ERP consumer must receive the exact persisted
event ID and verify the native iDempiere order and genuine accounting/inventory
consequences, not merely inbox admission.

### Mandatory connected acceptance

- Qualify the current approved IAM human Principal, confidential BFF, Market
  and estate binding, current seller mandate, buyer role/Site, bound approval
  and spend reservation with genuine issuer and CP readback.
- In disposable PostgreSQL 17 and actual Medusa 2.21, exercise the protected
  native order owner with enforcement enabled under a governed development
  acceptance protocol. Confirm all fences enabled and runtime role fenced.
- Inspect independent source PostgreSQL readback: one Medusa order,
  one seller consumption, one buyer consumption, required spend ledger entries
  and one canonical outbox event with the same transaction XID and exact value.
- Deliver the same committed event through real RabbitMQ into the #125 ERP
  inbox; read back the real iDempiere business document and its business effect.
  Verify correlation and event identity, duplicate suppression and replay.
- Preserve negatives for revoked principal/mandate, stale hold or policy,
  changed valuation, wrong tenant/Market/Site/company, self-approval,
  concurrent double-spend, broker timeout, ERP unknown outcome, delayed
  replay and prohibited posting. No test may manufacture external success.
- Publish independently held evidence and secure teardown manifest in
  Infrastructure. Source tests alone cannot qualify L4-OPS-01.

## Merge and production gate

Infrastructure #69/#72, ERP #125, Trade #188/#189 and relevant CP/IAM/Shared
companions remain HELD until the final implementation head passes mandatory
CI, outstanding review findings are resolved and the true connected
eight-owner source-to-ERP consequence has independent evidence. A green
source-only suite or locally toggled SHADOW mode never activates B2B checkout.
