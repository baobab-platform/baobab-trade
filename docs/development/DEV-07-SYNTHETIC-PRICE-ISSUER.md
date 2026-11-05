# DEV-07 private development price issuer — real IAM, CP and synthetic facts

Status: SOURCE IMPLEMENTATION CANDIDATE; NO GENUINE NATIVE BUYER TRANSACTION YET. DO NOT MERGE, ACTIVATE IN PROTECTED ENVIRONMENTS OR REPORT INT-05/L4 ACCEPTED.

Authority: EA v2.3, EA-XB v1.1, EA-DEV DEV-07/11/14, ADR-SHARED-039/042/043, Trade CAA-06b Decision 9 and CP PR #465.

## Existing path

Use the already implemented ZuriBeans confidential buyer BFF, Trade POST /store/b2b/buyer-commit, native Medusa Order Module transaction, buyer/seller receipt and spend fencing, original PostgreSQL outbox, confirmed RabbitMQ publisher, ERP #125 inbox/JVM and exported OTel trace. This increment adds no second transaction owner, messaging framework, IAM, commercial authority registry or event type.

## Running the genuinely IAM-authenticated synthetic price source

Only inside isolated development/integration, run the private HTTPS service in src/scripts/serve-dev07-synthetic-price-issuer.ts using the repository's pinned ts-node TypeScript compiler. It REQUIRES a real IAM introspection endpoint and its separately authorised introspection client. No user-supplied token is treated as valid without live IAM verification, and there is no local success shortcut. The Price Provider client must be an actual IAM workload registered for trade:cart-final-charges with the exact dedicated audience.

Mandatory environment: BAOBAB_DEV07_SYNTHETIC_PRICE_ISSUER_ENABLED=true; BAOBAB_ENVIRONMENT=development; BAOBAB_DEV07_PRICE_PORT; BAOBAB_DEV07_PRICE_BIND_ADDRESS; BAOBAB_DEV07_IAM_ISSUER; BAOBAB_DEV07_IAM_INTROSPECTION_URL; BAOBAB_DEV07_IAM_INTROSPECTION_CLIENT_ID; BAOBAB_DEV07_IAM_INTROSPECTION_CLIENT_SECRET; BAOBAB_DEV07_PRICE_AUDIENCE; BAOBAB_NATIVE_PRICE_PROVIDER_CLIENT_ID; DATABASE_URL; BAOBAB_DEV07_PRICE_PROFILE_FILE; BAOBAB_DEV07_PRICE_SIGNING_KEY_FILE; BAOBAB_DEV07_PRICE_TLS_KEY_FILE; BAOBAB_DEV07_PRICE_TLS_CERT_FILE.

Private price profile is a JSON object with syntheticOnly=true, tenantId, marketId, marketKey, countryCode, sellerLegalEntityId, currency, issuerId, policyReference and exactly seven entries in charges. Every entry must explicitly contain kind, resolution, amountMinor, sourceReference starting with synthetic:dev07:, and zeroReason. The facts are invented; they must NEVER assert official tax, duty, carrier or regulatory authority. All private JSON, Ed25519 signing and TLS private keys must be owner-only 0600 and absent from Git. TLS is mandatory, with no insecure validation suppression. The provider obtains cart version and seller scope directly from the Trade database, with neither browser-provided price nor status trusted.

Trade's existing HttpGovernedCartChargeSource obtains this signed evidence through HTTPS at /v1/trade/cart-final-charges, then verifies the Ed25519 signature and exact native cart version, and invokes CP #465 for independently active signer/Market/seller mandate and bounded decision. A signed price package alone grants no commercial authority. The signed synthetic TAX/FREIGHT amounts must match the genuine Medusa native calculation for the disposable cart. A missing or inconsistent amount denies.

Set BAOBAB_NATIVE_PRICE_ISSUER_ENDPOINT to the HTTPS private provider, BAOBAB_NATIVE_PRICE_ISSUER_PUBLIC_KEY_PEM to its reviewed public key, and registered BAOBAB_NATIVE_PRICE_PROVIDER_CLIENT_ID, BAOBAB_NATIVE_PRICE_PROVIDER_CLIENT_SECRET and BAOBAB_NATIVE_PRICE_PROVIDER_AUDIENCE. Configure the CP and other Trade IAM workload credentials independently. After CP's current approval of the exact signer and legal seller in the matching development Market, issue charges using the existing issue-native-cart-charges.ts command. Do not create CP approvals by directly mutating CP tables from the Trade development script.

## Native buyer positive — original INT-05

Provision via their owning services one synthetic buyer Organisation/Principal/member/role, active legal seller and independent seller binding, active Market, matching registered shipping and billing Sites, current spend budget and ACTIVE exact reservation, actual open Medusa cart and approved synthetic charge package. The confidential BFF provides current human and BFF workload tokens. Trade must recheck IAM/CP buyer and seller authority at the consequential operation and under its spend lock. An authorised context discovery is not a commit authority.

Run the original read-only scripts/dev11_native_business_origin.py on a separate PostgreSQL connection and require genuine non-draft Medusa order, seller/buyer receipt consumption, spend COMMIT, and immutable original Trade outbox event all sharing the insertion XID. If any gate is absent or the fence remains SHADOW, keep NATIVE_ORDER_ABSENT/ BLOCKED. Execute 11 wrong-tenant, audience, revocation, changed payload, replay, expired lease, simultaneous reservation, publisher outage, post-commit/pre-ACK crash and ambiguous ERP result negatives with genuine independent readback. No prohibited side effects and one eligible effect upon authorised recovery.

## Next engineering and acceptance

Dispatch that exact event ID via the existing confirmed RabbitMQ publisher; independently join its unchanged payload digest through ERP #125 durable inbox, JVM native effect, CP authority and exported OTel graph. Infrastructure #72 must independently retain run-owned source hashes, original artefacts, negative results and disposal. This doc and source tests do not prove a successful connected buyer order; absent issuer, IAM client, CP issuer approval or native test fixtures remain BLOCKED. ERP postings, supplier import docs, payments, transport and production admission remain separately qualified.

Do not merge Trade #189, CP #465, Infrastructure #72, ERP #125, or companion PRs before platform-owner review.


## Original persisted event handoff — added 5 November 2026

After a real confidential ZuriBeans BFF buyer commitment has produced one
verified order, **do not manufacture a new CloudEvent** or introduce another
publisher. Find the existing outbox UUID through a separate read-only
PostgreSQL query, and run the existing independent native-origin verifier:

    NODE_ENV=test BAOBAB_ENVIRONMENT=development python -B scripts/dev11_native_business_origin.py \
      --event-id "$ORIGINAL_OUTBOX_EVENT_ID" --output "$RUN_PRIVATE/native-origin.json"

That verifier must return an independently confirmed, ENFORCED non-draft native
order with seller and buyer receipts, spend COMMIT and outbox INSERT all
sharing the original XID. A synthetic outbox fixture without a real buyer
order continues to refuse, and the event is not eligible for dispatch.

Only after the native origin is independently observed, use the existing
RabbitMQ publisher, not a new messaging framework:

    NODE_ENV=test BAOBAB_ENVIRONMENT=development \
      BAOBAB_EVENT_DISPATCH_BACKEND=rabbitmq-confirmed \
      python -B scripts/dev07_genuine_event_dispatch.py \
      --event-id "$ORIGINAL_OUTBOX_EVENT_ID" --output "$RUN_PRIVATE/publisher-handoff.json"

The dispatcher requires the existing database connection, RabbitMQ endpoint,
Trade signing key and optional official OTel endpoint, all from protected
run-private environment bindings. It calls the existing
dev11_rabbit_dispatcher once, selecting the original outbox event ID,
then independently rereads event UUID, XID, immutable digest, trace parent,
publisher-confirmed state and bounded attempt count. It never creates an
order, grants authority or reconstructs the event. Tests under
scripts/test_dev07_genuine_event_dispatch.py are mutation vectors only.

The publisher receipt deliberately keeps current IAM/CP independent custody,
ERP native effect, exported trace, L4-OPS-01 and protected/production flags
unqualified. For the next gate, ERP #125 and Infrastructure #72 must join the
**same** event and independently observe native iDempiere consequence, loss/
replay recovery and the distributed export graph; each component's actual
case failures must be retained instead of inferring success from dispatch.

The native owner reads and locks the Decision 9 mode in the same PostgreSQL
transaction as the buyer write. A SHADOW run refuses before creating an
order. In the run-owned buyer-BFF database only, the existing fixture CLI's
`enforce-checkout` phase can apply the disposable transition. It requires the
exact prepared run ID in `BAOBAB_DEV07_DISPOSABLE_CHECKOUT_APPROVED_RUN` and an
explicit `BAOBAB_DEV07_CHECKOUT_CHANGE_REFERENCE`. It accepts the initial
SHADOW revision or reads back its own prior transition. Provision the
approved price and buyer authority separately through their owners.
