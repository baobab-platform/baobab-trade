# DEV-07 — native ZuriBeans B2B components

Authority: Accepted Shared EA-DEV DEV-07 and the original INT-05 matrix,
ADR-SHARED-042/043; Trade ADR-0011, ADR-0024 and ADR-0030. This run is a
bounded development increment, not full INT-05 or ZuriBeans go-live acceptance.
The Shared EA-DEV implementation register remains the programme read model.

## Run and maintain

Use the repository's pinned Node/npm environment and a disposable PostgreSQL 17
and Redis as in `core-module-integration` in `.github/workflows/ci.yml`:

```sh
npm ci
npm run migrate
npm run bootstrap:market
npm run bootstrap:catalogue
NODE_ENV=test BAOBAB_DEV07_TEST_DB=baobab_trade_test npm run regression:dev07-b2b-slice
```

The existing test database configuration must match that explicit marker and
end in `_test`. Never point this command at protected/shared data. The command
creates uniquely owned synthetic fixtures through actual Medusa module services,
reads the persisted records, invokes the maintained assortment route handler
against those services, and removes its own active fixtures in reverse order.
It attempts every cleanup on assertion failure and independently re-reads active
absence for organisations, membership, role, grant, product and eligibility.
Grant history is revoked and retained; its referenced role, membership and
Organisation are soft-deleted. Medusa soft-deletion is not physical row erasure. The surrounding Actions service
lifecycle disposes the complete test databases; this report does not certify host
container, volume or image teardown, which remains Infrastructure's lifecycle.
No native order is submitted, no global commit fence is activated, and no raw
CP topology SQL, synthetic IAM response or invented provider is imported.

Only after all sixteen implemented observations and cleanup pass is
`artifacts/dev07/report.json` written, with a separate SHA-256 JSON file.
Actions uploads that sanitized pair as `dev07-native-b2b-components` with a
requested retention of 30 days; the artifact metadata expiry is authoritative
when repository or organisation policy caps retention.
The report records the exact checkout SHA, finite case/reason values and scope,
never fixture IDs, customer details, claims, credentials, DSNs or raw responses.
Missing, duplicated or unknown observations refuse report generation; a rerun
removes its previous report pair before executing any observations. A failed
step cannot publish a completed report. Source tests check boundaries but are
not database evidence. Reviewers must download and hash-check the actual artifact
before reconciling the programme register. Re-run after relevant module,
assortment, authority or provider changes; old receipts remain historical.

## What the evidence means

The implemented observations exercise independent native buyer relationships,
persisted local Principal references, customer/organisation mismatch refusal,
revoked membership refusal, actual role-bound Market grant loading, absent-role
refusal, missing canonical Market authority returning UNAVAILABLE, ten real
catalogue projections including vanilla in each of UG and ZA, mandatory public
regulatory clearance, current/expired/future/withdrawn assortment and owned active
fixture cleanup. The route is called as a handler; this is not a network/BFF run.

A local random Principal UUID is expressly a **synthetic reference**. It is not a
CP-created canonical Principal or IAM authentication. An ACTIVE native Organisation
is a Trade buyer relationship, not proof of canonical Organisation onboarding.
Native Market keys and commercial assortment are projections; they cannot become
CP Market or regulatory authority. Test-only ELIGIBLE rows demonstrate filtering,
never a live Regulations determination. No private price or purchase permission
is inferred from a public assortment result. UG and ZA are tested separately,
without claiming two production regions.

The report retains nine joined obligations as BLOCKED: current IAM/CP buyer
identity; supplier/ERP onboarding; entitled private catalogue/pricing; canonical
RFQ/controlled approval; quotation lifecycle; composed native order/replay fence;
actual ERP step; shipment/documentary access; cross-jurisdiction seller authority.
These engineering labels preserve the original INT-05 scenario meaning. They
neither create new canonical scenario IDs nor certify available-looking native
routes as canonical capabilities. Provider declarations remain planned-only.

## Catalogue correction and compatibility

The public `/store/b2b/assortment` endpoint now accepts regulatory-clearance
selection only when omitted, `true` or `1`. `false`, `0`, malformed or array
values return invalid data before querying. The operations-preview helper can
still use its explicit soft mode internally; a store caller cannot select it.
The maintained ZuriBeans consumer already requests `true` and needs no change.

The public partition uses the server clock and each record's effective interval:
start inclusive, end exclusive; omitted bounds are unbounded. Invalid/reversed
intervals, unknown states, expired/future rows and duplicate product eligibility
are excluded. A no-store header avoids caching a result beyond its validity.
This is a read-safety correction; it does not grant buyer or seller authority.
Rollback should disable the affected catalogue exposure or restore reviewed
pins, rather than relax the regulatory test. Preserve this regression when
adding an authenticated operations-preview route.

## Next dependency order

1. Compose actual IAM-issued buyer evidence with CP Principal and Organisation
   resolution, separate buyer/supplier identity and current buyer Market authority.
2. Implement the exact canonical RFQ/quotation lifecycles and approval controls;
   qualify provider support before claiming it in the declaration.
3. Complete buyer receipt/spend consumption at the native commitment fence;
   exercise wrong actor/Market, absent grant and duplicate/replay through HTTP,
   workflow and database paths. SHADOW is not an enforced buyer commitment policy.
4. Connect available ERP and documentary/Regulations adapters individually;
   retain explicit per-operation BLOCKED results where unavailable.
5. Add the joined native profile to Infrastructure's existing guarded lifecycle
   with current source pins, actual issuer/CP readbacks and verified teardown.

DEV-06/INT-07 remains partial while Subscriptions onboarding proceeds. That is
not a dependency freeze on this DEV-07 engineering. Subscription provenance alone
will not prove a CP binding or current resource-server enforcement.

## Current buyer context and supplemental read qualification — 27 October

`POST /store/b2b/buyer-context` passes `requested_country_code` to CP's existing
`POST /v1/platform-context/resolve` as selection intent, after native membership
has been established. The workload caller remains Trade, the buyer remains the
independently resolved human, and CP selects the canonical `market_id` from
current Tenant market participation. A mismatched country or missing CP Market/
currency refuses the selected context. This neither translates `zuribeans_ug` or
`zuribeans_za` to a canonical Market nor grants private pricing or purchasing.
That mapping and operation-specific capability/legal authority remain separate.

CP must echo the exact requested Organisation even when the Tenant agrees.
For the canonical buyer path its context must also have a finite future expiry;
an unbounded response is UNAVAILABLE. Canonical context policy revision v2
requires positive native revisions and at least one known role belonging to the
selected membership, re-reads relationship/membership revisions after external
I/O, and refuses an intervening role edit, revocation or canonical relink.
It rechecks the clock after those reads and bounds the result by the earlier
of request-start + 60 seconds, token/Principal/estate/CP expiry, and membership
end. This is a bounded read snapshot, not a lock on future authority. A later
operation must independently re-evaluate its facts; no receipt or native order
is authorised by this read response.

A new, separate migrated Medusa/PostgreSQL regression is available:

```sh
NODE_ENV=test BAOBAB_DEV07_TEST_DB=baobab_trade_test npm run regression:dev07-buyer-context
```

Run it after migrations in the same disposable database configuration as above.
It observes eleven native read/revision/cleanup cases, including exact membership
boundaries and actual database-owned revision changes after membership and role
writes. It uses no substituted IAM/CP responses. The output is a sanitized report
and hash pair under `artifacts/dev07-buyer-context`, uploaded by CI as
`dev07-native-buyer-context`. A failed run removes earlier outputs and cannot
write a completed receipt. Every cleanup is attempted and active absence is read
back before completion; soft-deletion remains distinct from physical teardown.
Source/unit tests, including the country handoff checks, use explicit test doubles
and are LOCAL_TESTED only. Actual PostgreSQL execution must be confirmed from the
new CI artifact before reporting those eleven observations as passed.

The original sixteen native observations, nine BLOCKED joined outcomes and their
historical receipt bytes are unchanged. The new report is supplemental evidence;
it cannot replace any original INT-05 case or activate the universal commitment
fence. The canonical buyer-context proof still needs real IAM issuance, CP-owned
Principal/Organisation/estate governance and independently retained run evidence.

Rollback this increment by restoring the reviewed source pin or disabling the
buyer-identity route. Keep unbounded/missing-Organisation CP evidence refused;
do not use the legacy Medusa route as an IAM purchasing fallback. No schema,
capability declaration, workload scope or fence activation changes are included.
