# DEV-07 / DEV-11 — CAA-06b native buyer commitment and ERP origin gate

**Status: NATIVE OWNER ADAPTER + DISPOSABLE TESTS IMPLEMENTED — CONNECTED ACCEPTANCE NOT QUALIFIED — DO NOT MERGE / ACTIVATE**

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
   composes through PostgresSpendReservationCommands.commitWithOwnerTransaction and
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
contract defence, not proof that the native owner's still-missing governed
cart reader read authentic final native prices, lines or consequences. A second
fail-closed invariant compares ERP `grand_total` against the FULL authorised
buyer obligation using exact BigInt decimal scaling and the native owner's
persisted currency exponent. Unknown precision, nonzero fractional excess,
foreign currency or mismatched total must abort the same spend transaction;
currency precision is never guessed or supplied by a browser.

### Implemented transaction ownership and remaining source adapters

The protected same-XID check deliberately requires one PostgreSQL transaction
for the native Medusa order and seller receipt, the Trade spend COMMIT and
the canonical outbox. The ordinary spend command owns an independent `pg`
transaction; the new `commitWithOwnerTransaction` entry instead joins the
Order Module's `sharedContext.transactionManager` through the pinned native
owner adapter. A standalone workflow/module write that opens a second
transaction still **must not** be counted as native ownership. The real
Order Module draft-order proof establishes manager compatibility, native
rollback and readback; it does not yet establish a governed non-draft buyer
commitment. The remaining source adapters must derive the governed cart's
complete final obligation and obtain live consequential IAM/CP readback.
The gate remains SHADOW pending their connected qualification.

## Explicitly incomplete / not qualified

### 5 November: consequential current-authority composition

`CurrentNativeBuyerAuthority` now composes the existing BFF/human token
verifiers, online CP Principal resolution (including current-token
introspection), estate/Organisation participation, canonical Market read,
Trade role/Site/spend/budget sources and existing seller PEP. It does not
introduce another IAM client, messaging abstraction or authority registry.

The shared identity evaluator returns an internal **RESOLVED identity** for
commitment assurance, with no ALLOW decision. Only a successful consequential
policy and seller PEP can produce the full Shared buyer execution context:
resource/version/digest, whole final obligation, currency, valuation and seller
binding are mandatory and schema-checked. The native commit boundary repeats
that check and reconciles every purchase/seller field with the buyer receipt.
The discovery route continues to resolve only `trade.buyer-context.resolve`.

Under the spend lock, the provider re-reads identity, policy, canonical Market,
native seller configuration and the CP seller decision. It checks the original
mandate and binding without inserting a second seller receipt, which would make
TA-07's receipt selection ambiguous. The native reservation read binds the exact
tenant, purchase, hold revision, amount and expiry, in addition to the existing
membership/version/digest/budget checks. Earlier leases are never extended.

This increment does not implement the governed cart pricing/purchase reader:
`readPurchase` must obtain actual, complete final native obligations, shipping
Sites and commercial terms. It cannot accept browser prices, cart metadata
assertions, placeholder shipping prices or absent tax/duty facts as final.
Purchases that require an approval remain refused until live independent
approver re-evaluation is connected. This provider is server-only and is not
wired into an application checkout or an ENFORCED deployment.

Unit tests exercise real policy loading/evaluation, contract validation,
independent identity refusal, Market/key/country separation, revocation
readback, hold changes, source failure and incomplete-context rejection.
Their authority/native ports are synthetic and are **not connected evidence**.

The repaired ERP #125 source `115e9a0d22ed6516a649bc6d36bdfc0b658880c2`
passes full CI, Foundation/security and real same-event runtime run
`41946627517`. Original artifact `13379825989`, independently downloaded and
validated, has ZIP SHA-256
`9a49bd788e3159ec313a8e88cfb5d28d0082ff433fc72a9bf18bd6ab2fcab90b`.
It proves the same persisted event at the real JVM effect, unknown-result
adoption and an independently exported 10-span/9-parent-edge component graph.
That run executes the historical composed Trade source `f2c88d4a`; it does not
execute this new authority increment. Its originating order is synthetic and
its unchanged buyer-origin refusal remains `NATIVE_ORDER_ABSENT`.

The pattern to qualify for DEV-07/08/09/11/12/14 therefore remains the existing
native owner → atomic spend/outbox → confirmed dispatcher → RabbitMQ → durable
inbox → current engine authority → native consequence/recovery → independent
database/exported-trace observation. Reuse these components and their failure
semantics. Do not promote this to accepted canonical buyer execution until the
genuine non-draft origin and exact downstream event are independently proved.

The read-only native-origin observer now independently requires the native
order, item rows, line rows, buyer receipt, buyer consumption, seller commitment,
spend conversion and original outbox event to share the original transaction.
It joins the exact buyer hold, purchase/version/digest, amount/currency and
correlation; a later plausible buyer receipt or native order cannot borrow an
otherwise valid seller/event pair. Its 13 unit cases include complete
SQL-shaped input and deliberately broken joins; these are not database or
buyer-authority evidence. The existing synthetic receipt format and its strict
`NATIVE_ORDER_ABSENT` negative are unchanged. Canonical commit context/receipt
correlation and bounded evaluation times are also checked before spending.

Connected activation still needs an actual approved commitment assurance policy
and issuer session (the existing DEV-07 fixture configures only `aal1` discovery),
and a CP-authorised `market:read` caller for the canonical Market read. The
current development buyer validator's accepted scopes are exactly
`context:resolve`, `identity:principal:resolve` and
`estate:client-binding:resolve`; this implementation does not silently add a
scope or promote an IAM/CP identity. The dedicated token provider for Market
reads must be admitted through the existing owner/governance path. Real IAM
normalises password/TOTP evidence as `pwd`, `otp`, `mfa`; a policy must use the
issuer's actual canonical evidence, not an invented `totp` claim or a string
copied from a fixture. These are genuine connected dependencies alongside the
native pricing reader, not permission conferred by unit-test success.

Local verification of this follow-through passes 1,074 Node tests across 124
files, all 19 Python dispatcher/origin unit tests, strict TypeScript,
zero-warning lint, repository formatting, the full Medusa build and standalone
schema asset checks. Final-head native CI remains independently required.

This PR now contains a pinned Medusa 2.21.2 `Order Module`
transaction-owner adapter (`medusa-native-transaction-owner.ts`) and a
disposable Medusa runtime qualification, but **the positive same-XID native
buyer commitment is not yet independently qualified**. The adapter requires
two qualified source-owned providers: `NativeMedusaOrderSource` must build
`createOrders` input from a governed cart and re-read **all final obligations**
from one native snapshot, and `recheckAuthorityNow` must actually perform
current IAM/CP/Trade buyer and seller readback inside the spend transaction.
The current-authority composition above implements the second provider's
existing authority joins, but still needs the real purchase source and
connected qualification. Neither can be substituted with unit fixtures.

The pinned `OrderModuleService.baseRepository_.transaction` and
`createOrders(..., {transactionManager})` compatibility seam was inspected
against the actual Medusa v2.21.2 source. It fails closed if absent; actual
runtime use still requires the named CI receipt. The native writer refuses a
separately committed Medusa order through its PostgreSQL MVCC XID guard.
No hand-written synthetic order is an acceptable substitute. A separate
checkout route was **not** activated.

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

### 4 November implementation follow-through — Medusa-owned transaction

The Decision 5 spend ledger can now execute in an **already active native
transaction** via `commitWithOwnerTransaction`. It never opens, commits,
releases or rolls back the Order Module's connection. A source-failure or
revocation exception propagates through the native transaction callback so
the owner must rollback all local effects. Replays are read-only and do not
re-invoke the writer. The PostgreSQL 17 regression adds native-connection
visibility, same-XID ledger/command/probe, rollback, idempotent replay and
**two-owner concurrent double-spend refusal** cases.

The new `regression:medusa-native-owner` runs `medusa exec` against the
**real pinned Order Module and disposable PostgreSQL 17**. It requires a
native draft order and its line records to share the manager XID, a vetoed
native order to roll back, an independent readback after commit, and native
cleanup. It emits an original `dev07-native-medusa-owner` artifact that
explicitly records `iam_cp_operation_authority_proven=false` and
`buyer_spend_and_native_order_same_xid_proven=false`. A passing test cannot
be reinterpreted as an ENFORCED B2B order or native outbox qualification.

`requireCurrentNativeCommitAuthority` additionally checks a fresh,
bounded, operation-specific IAM/CP/Trade readback under the spend lock and
refuses changed Principal/membership, seller mandate/binding, Market,
version, valuation, reservation, expiry or non-source-backed evidence.
Its source tests are **negative policy regressions only**; the actual
issuer/CP-backed readback is still a required connected dependency.
The final native snapshot is evaluated once per owning transaction and
shared by the valuation and ERP payload checks.

### CI and application-boundary reconciliation

The full repository suite also inventories direct native order writers.
Its exact allowlist now identifies this single CAA-06b transaction owner,
while an independent importer check requires it to remain unreachable from
application routes, loaders, subscribers and jobs. Only the disposable
native-owner regression currently imports it. Adding a writer or wiring the
owner into an application path fails that inventory and requires a new
review; passing it does not grant connected acceptance.

The authority readback's evidence references are read-only inputs. Their
TypeScript type accepts immutable negative-test vectors without casting
away immutability or changing any runtime authority predicate. Three native
owner/regression files were formatted with the repository's pinned formatter.
The initial full-suite run exposed the inventory mismatch after formatting
and type checking passed. After correction, the full local suite passes
1,012 tests across 123 files, strict type checking, zero-warning lint, the
repository formatting check and the complete Medusa build including the
standalone authority/schema asset check. These Node 24 source/build checks
do not replace the final-head PostgreSQL 17 CI or connected acceptance.

### Lease expiry across native source reads

The composition now revalidates the original context, consequential-operation,
buyer and seller receipt leases after acquiring the spend/policy locks and
again after asynchronous final native valuation/payload/currency readback.
An expired proof throws before outbox persistence, even if a different receipt
has a later expiry. The native owner also rechecks the fresh IAM/CP readback
lease after all ledger/idempotency work and its final transaction-XID read,
immediately before returning control to the Order Module for commit. It does
not extend a lease or turn a stale observation into a new authority decision;
an earlier original lease still takes precedence over a newer readback.

Owner-boundary unit negatives cover expiry during source reads, final ledger
work and the last XID query, expiry while waiting for the spend lock, and each
original lease expiring before outbox publication. They assert refusal and
exception propagation through the owner. Their native/ledger ports are mocks:
the existing PostgreSQL 17 runtime proofs establish real owner rollback, while
live IAM/CP readback and a genuine non-draft buyer transaction remain pending.
This bounds acceptance of an observed lease; it does not establish synchronous
distributed revocation or a transaction across IAM, CP and Medusa.

The follow-up local source validation passes 1,026 tests across 123 files,
strict type checking, zero-warning lint and repository formatting. A shared
explicitly synthetic fixture keeps the composition and owner-boundary unit
facts consistent without introducing a second authority or native provider.
The complete Medusa build and standalone authority/schema asset verification
also pass; final-head native runtime CI remains required.

Pending acceptance therefore includes a concrete governed native cart
reader, connected qualification of the current IAM/CP readback provider,
a first genuine **non-draft**
buyer-commit Medusa order under its seller and Decision 9 fences, complete
source-row MVCC joins, deliberate crash and revocation windows, the same
canonical event through RabbitMQ and iDempiere, exported lineage, original
evidence custody and independent teardown. **Do not activate ENFORCED
without the real connected permission and complete operator review.**

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

## Trade #188 composition and exact-source JVM handoff

The integration source contains both Trade #189 `2b4c7c9` and Trade #188
`5565940` as actual Git parents. The existing confirmed RabbitMQ publisher,
Medusa source exporter, canonical event contracts and native buyer composition
now share one source tree. No parallel messaging framework is introduced.
The broker component workflow consumes ERP mapping candidate `1db56a2` and
Infrastructure `65931ab`, replacing its historical companion pins.

`prepare-dev11-jvm-handoff.ts` is a clearly synthetic component source that
uses the actual Medusa outbox, #189 integer valuation kernel and OTLP exporter.
A private fixture-owner packet supplies only synthetic tenant/legal/product
coordinates. It returns only IDs of already-persisted immutable events. The
ERP integration must read those original rows and dispatch each same ID with
#188's publisher; it must never reconstruct an event with a new ID.
The optional publisher `--event-id` restricts selection to that existing row;
it does not create a business fact or grant native authority.

This source permits a real same-event outbox/broker/JVM qualification while
retaining the separate `NATIVE_ORDER_ABSENT` refusal for its synthetic origin.
It does not implement the missing governed native cart reader or qualify the
live buyer operation provider, and cannot qualify the non-draft CAA-06b buyer positive or
L4-OPS-01. The future genuine buyer event uses the same immutable handoff and
publisher/consumer path without another transport implementation.

## 5 November 2026 — final native cart pricing and change-detection boundary

**SOURCE IMPLEMENTED; CONNECTED COMMITMENT AND L4 HELD.** The Order Module
owner now requires a priced native cart read before createOrders and re-reads
it after its order/spend/outbox mutation, still within the same owner transaction.
An absent or changed price, scope, version, determination, line, shipping
method or source fingerprint throws out of that transaction. No partial order,
buyer consumption, spend conversion or canonical event may commit.

The concrete Medusa Cart Module reader is in
src/baobab/b2b/medusa-final-cart-pricing.ts. Native cart rows do not contain
calculated totals: this reader locks actual native cart/item/shipping and
linked tax/adjustment records, then explicitly requests computed native
item, shipping, tax, discount and grand totals through the Cart Module with
the owning transactionManager. It checks complete item and shipping ID
sets, exact money conversion and all subtotal arithmetic. Credit lines and
gift-card tender cannot silently reduce the buyer obligation.

Migration20261105043000 creates immutable, scope/version-specific,
time-bounded determinations for TAX, FREIGHT, DUTY, HANDLING, INSURANCE,
SERVICE_CHARGE and REFUNDABLE_DEPOSIT. All seven records are required.
Missing tax, freight or duty is a refusal, never an implicit zero.
A zero must have an explicit source reference and an applicable
ZERO_RATED, EXEMPT or NOT_APPLICABLE determination. Positive charges must
be CHARGED. Tax and freight must agree with Medusa's native computed totals.
The full cart including product variants, quantities, shipping IDs, raw
PostgreSQL cart revision timestamp, source references, charge reasons and
expiration is cryptographically bound into the price transaction digest.
The resource version is the native cart updated_at epoch-millisecond value;
the exact timestamp remains in the hash to detect submillisecond changes.
At commit, both the valuation digest and source fingerprint must match the
buyer-authorised version/amount and the original in-transaction read.

Regression tests cover missing fee determinations, unjustified zero,
nonzero exemption, missing computed totals, stale/foreign provenance,
same-total variant/source substitution, changed shipping, prewrite refusal
and precommit rollback. The native PostgreSQL 17 guard drill checks actual
immutability and charge constraints. These do not certify the real Medusa
Cart Module provider or legal source of a quote.

**Remaining non-waivable owner tasks:** connect an IAM/CP-governed issuer
that writes the determination rows from genuine tax, freight and regulatory
sources; qualify the source adapter against pinned Medusa 2.21.2 native
amounts and relations in real runtime; issue the buyer authority/valuation
from exactly this source fingerprint; then qualify genuine non-draft
same-XID buyer/seller/spend/order/outbox COMMIT, the same event in ERP and
independently exported lineage. An unprivileged row insert is not authority.
Decision 9 remains SHADOW, checkout stays disabled and L4-OPS-01 is BLOCKED.

The PostgreSQL spend reservation and buyer consumption guard use a 64-bit
cart version so the native epoch-millisecond value survives the full spend
conversion. The migration preserves existing versions and the guard's equality
check. The disposable spend regression submits, reads back and commits a
reservation with a native-sized version.

The buyer route receives its canonical Market reader and workload token from
the engine runtime registration. The seller PEP uses its existing credential.
The buyer route refuses when the Market authority is unavailable.

The route binds the governed purchase read to the requested cart before the
seller PEP runs. It forwards the resolved development environment to that
existing PEP, including conflicting environment markers so they can be
refused. The charge writer uses the issuer's registered Ed25519 public key
and retains the CP adapter's receiver when verifying the mandate.

The native cart reader checks the signed issuer, attestation, policy and
timestamps against the persisted evidence. Each cart read carries the earlier
of the signed-price expiry and live issuer authority expiry. The native owner
uses the earliest expiry across its two reads at the final transaction fence.
A subsequent CP read cannot extend the lease under which the order began.

The confidential route still requires a registered engine runtime providing
the actual cart purchase, native order input and result readback, current
authority, and authorised replay. The source and rollback checks do not
supply those runtime dependencies or demonstrate a genuine buyer commit.

The pinned Cart Module receives a fresh manager with Cart metadata and the
existing Order Module transaction context. Each price read uses a fresh
identity map so the second read can see changes in the same transaction.
Only the Order Module owns commit and rollback. The reader requests Medusa's
computed total through the pinned Cart Module API and checks the returned
discount, tax, shipping and credit totals. Native credit records cause a
refusal while the commitment model excludes tender. PostgreSQL Date values
retain their milliseconds and the exact cart timestamp remains separately
bound to the signed package.

The disposable PostgreSQL 17 native owner drill updates a real Cart Module
record inside the Order Module transaction. A separate connection must see
the previous revision. The Cart Module reader must compute valid totals on
the uncommitted revision before refusing the absent governed charge package.
The drill then rolls back the revision and removes the disposable cart. This
qualifies the transaction boundary independently of an issuer or buyer.

## 5 November — authenticated BFF to current native buyer source

**Implementation status: source code integrated, protected activation blocked.**
ZuriBeans #156 exposes a separately opted-in, CSRF-checked confidential
`/api/buyer/commit` route. The browser supplies only cart, selected buyer
Organisation, country and retry key; the BFF obtains independent current
human and workload IAM credentials. It forwards neither total, tax, duty,
seller mandate nor authority receipt. A lost result retries using the same key.

Trade #189 exposes the consequential `/store/b2b/buyer-commit` route in
development/integration only, with workload/human JWT checks, exact BFF azp
binding, server-generated native order ID, current Principal/estate/Market
and CP seller readback, plus the existing same-XID Medusa Order Module owner.
**No custom checkout state machine or duplicate messaging path** was added.

The route no longer accepts injectable `policies`, `readPurchase` or
`readFinalCart` sources. Its policy source is the actual B2B module;
its purchase source reads one ACTIVE seller binding, exactly one active
Principal-owned spend reservation for that cart/organisation/membership,
and uniquely resolved shipping/billing registered B2B delivery sites
matched to actual Medusa cart addresses. The native Cart Module produces
final valuation on the real Order-owned transaction. A valid source must
carry a complete seven-charge signed package and fresh CP issuer readback.
A missing Site, wrong tenant, wrong Principal, stale/changed cart, absent
charge class, absent source, or inconsistent amount fails closed.

The Currency Module's actual persisted `currency.decimal_digits` is now
the source of integer precision in the owner transaction. No issuer or
runtime plugin can assert a different exponent. The owner also checks the
ERP consequence's currency against that native value. Unit negatives
cover unavailable or ambiguous currency and a false exponent in an
otherwise plausible native snapshot.

The price issuer adapter accepts only a bounded Ed25519-signed package from
an authenticated HTTPS issuer, requires CP approval of that exact
issuer/tenant/Market/legal entity/policy, and immutably retains the full
package, signature, key fingerprint, individual explicit charge reasons
and original cart microsecond timestamp. The native owner independently
re-verifies the original signature and current CP mandate at BOTH
cart reads. Zero-rated, exempt and not-applicable reasons are distinct,
not interchangeable; missing tax/freight/duty is not silently zero.

### Required before a genuine positive is qualified

- Register a **real**, independently approved final-price issuer and CP
  mandate/current issuer-verification adapter. Provide genuine tax, freight,
  duty and incidental-charge sources for each selected market/corridor. No
  fixture/assumed waiver counts as a legal determination.
- Supply and qualify the runtime's native order-input builder and genuine
  persisted order/ERP-consequence readback, plus CP-authorised tenant
  resolution and independent durable replay verification.
- Prepare a legitimate buyer cart with signed current final price, selected
  registered delivery sites, an actual Principal-owned ACTIVE spend hold,
  adequate budget and a current consequential IAM/CP approval. The ordinary
  buyer-context discovery ALLOW is insufficient.
- Independently read back one non-draft Medusa order, matching native
  seller/buyer consumptions, spend COMMIT and original canonical outbox
  event with the same PostgreSQL transaction ID, and then connect that exact
  event to RabbitMQ, ERP JVM and exported W3C spans.
- Run **final-head** full CI, PostgreSQL migrations, security and all required
  negative cases before changing the Decision 9 SHADOW posture or L4-OPS-01
  verdict. Development may provision/tests; staging/production remain
  separately approved and disabled.

These source-only tests and prior real Order Module transaction drills
are not a positive buyer order and must never be reported as L4 acceptance.
