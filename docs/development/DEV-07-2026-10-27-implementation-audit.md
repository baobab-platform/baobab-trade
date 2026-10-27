# DEV-07 — 27 October 2026 source-conformance and next implementation slice

**Authority:** Accepted Shared EA-DEV DEV-07/INT-05, ADR-SHARED-042/043, Trade ADR-0011/0024/0030 and `docs/development/DEV-07.md`.

DEV-07 is an architecture workstream, not a GitHub repository. Its governing register is in `baobab-platform/shared`, and its Medusa B2B implementation lives in `baobab-platform/baobab-trade`.

Trade #172 and Shared #391 merged a bounded native PostgreSQL/Medusa component qualification. The independently verified final receipt is 16 PASS, 9 BLOCKED, zero failed observations. Its evidence is historical and must not be overwritten or promoted. It does **not** certify real IAM/CP buyer identity, network/BFF joins, full INT-05, provider activation, protected staging or production.

## Native buyer-context source gap

The legacy Medusa-customer `GET /store/b2b/context` and its local resolver must not turn an expired/future membership, inactive buyer organisation, ambiguous membership or unknown role into usable context. This is a **read-path fail-closed guard**, not CP Principal resolution or purchasing permission. The canonical BFF path is `POST /store/b2b/buyer-context` and still needs connected IAM-issued and CP-readback evidence. Changes to the legacy route must not weaken that separation.

## Required regression evidence

- Active membership with inclusive start and exclusive end; future, expired, reversed or malformed windows deny.
- Multiple memberships, missing Principal/customer or mismatched owner deny; unknown role grants nothing.
- Suspended organisation denies even if membership is active; active organisation with active membership remains available in the legacy development path.
- Evaluation time is injected into the legacy membership resolver for deterministic source tests. Production still evaluates the current clock after the membership lookup; no earlier request-time authority snapshot is used.
- Exact start-inclusive/end-exclusive millisecond boundaries are exercised, and malformed native membership responses keyed to the wrong customer or Organisation are independently refused before any role read.
- The legacy read handler now emits `Cache-Control: private, no-store` on both successful buyer-context reads and refusal paths; regression tests explicitly verify both, matching the canonical BFF route's privacy posture without treating a Medusa session as IAM authority.
- Full repository TypeScript, lint, formatting, unit and PostgreSQL-backed CI must pass at the final reviewed head. Source tests are not independent IAM/CP join evidence.

## Outstanding joined INT-05 obligations — all BLOCKED until proven

1. Real IAM/CP buyer Principal/Organisation/Market authority.
2. Independent supplier/ERP onboarding.
3. Entitled private catalogue and pricing.
4. Canonical RFQ and governed approvals.
5. Quotation lifecycle.
6. Composed native order receipt, spend reservation and replay/commit fence.
7. Actual ERP step.
8. Shipment/documentary access.
9. Cross-jurisdiction seller authority.

Do not promote provider declarations or enable the SHADOW commitment fence by documentation. Preserve the 25 original observation labels and immutable historical evidence. The owner runbook `docs/development/DEV-07.md` remains the source for the disposable native test command and custody constraints.

## Rollback

Revert this bounded legacy-read hardening if a reviewed compatibility fault is demonstrated. Do not revert to allowing out-of-effect buyer identity in protected commerce; disable the legacy route pending correction. There are no schema or fixture migrations in this increment.

## Continuation from Trade #176

The canonical buyer-context path now forwards country selection to CP, retains
CP's canonical Market in the derived context, requires exact Organisation echo
and bounded cross-service context lifetime, filters roles by membership, and
refuses invalid native revisions or authority changed during external reads.
The last clock check and membership expiry bound close the stale read window.
Policy revision is `trade.buyer-context.resolve:v2`. This is implemented source,
not connected IAM/CP acceptance, private-catalogue authority or Market-key mapping.

The independent supplemental native database suite and CI artifact described in
`DEV-07.md` cover eleven read/revision/cleanup observations. Do not add those to
the historical 16 PASS / 9 BLOCKED inventory or claim they ran from source tests.

| DEV-07 delivery area                | Current implementation boundary / remaining action                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buyer Principal/Organisation        | Canonical two-token resolver present; current read freshness and CP country handoff implemented here. Real IAM/CP joined qualification remains open.             |
| Market catalogue                    | Native UG/ZA public catalogue qualified historically; selected canonical Market now retained. Governed local Market-key mapping and entitled prices remain open. |
| Supplier/ERP onboarding             | Requires actual independently owned supplier and ERP authority/readback; not supplied by buyer context.                                                          |
| RFQ/quotation/approval              | Operation policy exists; exact canonical RFQ and quotation provider lifecycles remain unimplemented.                                                             |
| Guarded native commitments          | Preserve existing seller fences and inactive buyer composition gate. Buyer receipt/reservation consumption in the native transaction remains unqualified.        |
| ERP/documentary steps               | Wire only available owning adapters, with native execution evidence per operation. Joined results remain BLOCKED.                                                |
| Negative/replay/jurisdiction checks | Native read negatives and revisions extended; complete INT-05 negatives require actual joined operations.                                                        |

The current Shared main inspected for this continuation is
`6b2199c550bfb70b10d3d7008bd6939806173c20`. Its Accepted EA-DEV DEV-07 and
ADR-SHARED-042 govern. This records current-source consultation, not a change to
the existing `contracts.lock.yaml` pin or an acceptance decision.

## Sequential continuation — workstream 1

Trade now owns a real-transport `qualify:dev07-iam-cp` Medusa command. It exchanges
native code/PKCE grants, separately obtains the BFF workload token, verifies
issuer signatures and independently introspects exact subject/client/audience/
expiry, then uses the existing actual CP Principal, estate and Organisation/
Market resolvers before creating disposable native buyer fixtures. Wrong-audience
and revoked-token observations must also be refused directly by CP, not merely
by Trade's local token verifier. Every dependent case starts BLOCKED. A missing
scope/binding cannot become PASS. Directly issued buyer/BFF access/refresh tokens
and native fixtures are cleaned on failure, with independent readback. Host,
CP workload and BFF HTTP teardown/qualification remain separately unobserved.

The implementation uncovered and fixes an actual Hydra compatibility bug:
`new URL(issuer).href` added a trailing slash to the configured issuer string.
OIDC discovery and signed `iss` still compare exactly, now against the unmodified
configured trust identifier. Regression tests cover slashless issuers and deny
alternate discovery/token spellings. Source fault-injection also verifies that
CP's CALLER_NOT_PERMITTED produces BLOCKED and still revokes every directly
issued access/refresh credential; it is expressly not real IAM/CP evidence.

**Runtime status:** NOT EXECUTED for this new live driver. Current Shared
`6b2199c550bfb70b10d3d7008bd6939806173c20` and CP
`055568a6ce2f2c22dd76273329b57b12429188bd` were inspected. They do not supply the
required development scope allocation/subject-validation registration and
CP-owned leased estate-client binding. These are cross-repository owning
implementation dependencies, not an independent-human approval request. All
Trade changes remain in #176. No copied CP topology SQL, invented binding,
self-issued token or development registry override substitutes for those owners.
