# ADR-0033: IAM Buyer Identity and the Trade Buyer Execution Context

Status: Proposed — Trade's implementation record for ADR-SHARED-042 CAA-04/CAA-05 (Accepted 2026-10-21), and for the Platform Owner ruling of 2026-10-22 recorded in its §14. Where this record and ADR-SHARED-042 differ, ADR-SHARED-042 governs.
Date: 2026-10-21, reworked 2026-10-22

## Context

ADR-SHARED-042 requires that commercial authority be derived and verified, never inferred, inherited or manufactured. Trade builds a `TradeBuyerExecutionContext` (Shared `trade/v2/buyer-execution-context.schema.json`) server-side, from independently verified facts.

The ruling of 22 October 2026 adds three requirements:

- **Digital Estate.** The estate behind a request comes only from a Control Plane attestation of the BFF client's governed binding. `azp` alone never establishes it.
- **BFF caller authentication.** The BFF authenticates to Trade as itself.
- **Assurance.** Assurance is checked fail-closed. Until the Shared policy and IAM's values are qualified, the check is a strict interim `acr` allowlist.

Two parts of Trade still key buyers on Medusa: `GET /store/b2b/context` (on the Medusa customer) and buyer onboarding (on Medusa auth metadata). They remain for the legacy session only.

## Decision

`POST /store/b2b/buyer-context` implements operation `trade.buyer-context.resolve` under Shared `identity/v1/buyer-identity-handoff` v1.1.

**Request.**

- The bearer is the BFF's own IAM workload token.
- The body is `BuyerOperationHandoffRequest`:
  - the human's access token as `subject_token`;
  - `subject_token_type`;
  - `correlation_id`;
  - optional selection requests: `requested_organisation_id`, `requested_country_code` and `requested_digital_estate_id`.

  No other field is accepted, and an asserted principal, tenant, estate, membership, role or context is refused.

**Evaluation** (`src/baobab/b2b/buyer-authority.ts`). Checks run in this order, and any failure refuses:

1. **The BFF as itself** (`BuyerTokenVerifier.verifyBffCaller`). Issuer keys, audience `baobab-trade`, `actor_type` workload, scope `trade:buyer-handoff`, and a `client_id` on the BFF allowlist.
2. **The human token** (`verify`). Issuer keys, audience `baobab-trade`, `trade:buy`, `actor_type` human, `jti` and a bounded lifetime. Its `azp` and issuer must equal the BFF's. Provider organisation, group, role, tenant and email claims are never read. `acr`, `amr` and `auth_time` are carried as evidence only.
3. **Assurance** (`src/baobab/auth/buyer-assurance.ts`).
   - Only `BUYER_SESSION` operations can be activated, and only by an exact `acr` on `BAOBAB_BUYER_ACCEPTED_ACR` for the configured issuer, with `BAOBAB_BUYER_ASSURANCE_APPROVAL_REFERENCE`. The allowlist holds security-approved, IAM-evidenced values; there is no default.
   - Anything else is `OPERATION_NOT_ACTIVATED`, and a wrong `acr` is `ASSURANCE_INSUFFICIENT`.
   - The operation-to-profile mapping mirrors the pinned Shared constant, and a test enforces this.
4. **The canonical Principal**, from CP principal resolution (CAA-02). Trade never provisions here: an unknown buyer is `IDENTITY_NOT_RESOLVED`.
5. **The Digital Estate**, from CP's estate client binding attestation (CAA-04, `src/baobab/control-plane/estate-binding.ts`).
   - Trade presents the BFF's token as client evidence. It states only its own `BAOBAB_TRADE_ENGINE_INSTANCE_ID` and `BAOBAB_ENVIRONMENT` (development or staging).
   - The attestation must satisfy the Shared schema, name this instance, environment and client, and live at most 60 seconds.
   - Without it the operation is `UNAVAILABLE`. A binding denial is `CONTEXT_NOT_USABLE`.
6. **Express company selection.** No selection is `SELECTION_REQUIRED` (409). The server never infers a company.
7. **The Trade buyer relationship.** There must be exactly one, matching all of:
   - status ACTIVE;
   - the attested seller-side Tenant;
   - the selected canonical Organisation;
   - this engine instance;
   - a recorded `link_provenance`.

   Otherwise `BUYER_NOT_AUTHORISED`.

8. **Membership.** Exactly one ACTIVE, in-effect membership, keyed on the CP Principal (never a customer), with its database-owned `revision`. Roles are read from Trade, and unknown roles are dropped.
9. **CP attestation of the Organisation** for the seller-side Tenant, through platform context. The context ID becomes `cp_context_id`. It runs only after membership is proven, so attestation answers never reach non-members.

**Response.**

- **ALLOW** returns the context, validated against the Shared schema before it is sent:
  - `actor_type` HUMAN, the Principal, its ExternalIdentity, the Tenant, estate and engine instance;
  - the canonical and Trade Organisation, the membership and its revision, and the roles;
  - `cp_context_id` and `policy_revision`;
  - `evaluated_at`, and an `expires_at` of at most 60 seconds that never outlives the earliest of the two tokens, the CP resolution, the estate attestation and the CP context;
  - redacted `evidence_references`.
- **Every other outcome** returns a closed `BuyerOperationDecision`. Reasons for an Organisation the actor cannot act for are never more specific than `BUYER_NOT_AUTHORISED`.

**Relationship and membership revisions** (migration `Migration20261022090000`).

- `b2b_organisation` gains `engine_instance_id`, `relationship_revision` and `link_provenance` (ADR-SHARED-042 §5).
- `b2b_buyer_membership` gains `revision`.
- Database triggers own both revisions:
  - an authority-relevant change increments them;
  - a role insert, update or delete increments the membership revision;
  - application code cannot set them backwards or skip ahead.

**Switches.** The route is disabled (404) unless `BAOBAB_BUYER_IDENTITY_ENABLED=true`. Enabled without its configuration, it is `UNAVAILABLE` and never falls back.

**CAA-05 operation policy** (Platform Owner ruling of 2026-10-22, ADR-SHARED-042 §14; `src/baobab/b2b/buyer-operation-policy.ts`, revision `trade.buyer-operation-policy:v1`). A pure evaluator decides one buyer operation from server-loaded facts and returns a Shared `BuyerOperationDecision`. The absence of a limit, grant or policy is never permission. Checks, in order:

1. **Membership.** ACTIVE and in effect, else `BUYER_NOT_AUTHORISED`.
2. **Role.** The exhaustive operation → role mapping for all 11 Shared operations:
   - reads are open to all six roles;
   - RFQ, cart, quotation acceptance, order commitment and draft finalization need `BUYER`, `SENIOR_BUYER`, `PROCUREMENT_MANAGER` or `ACCOUNT_ADMIN`;
   - approval decisions need `APPROVER`, `PROCUREMENT_MANAGER` or `ACCOUNT_ADMIN`;
   - member management needs `ACCOUNT_ADMIN`.

   There is no hierarchy, and an unknown role grants nothing. Invitation acceptance and member management are refused `OPERATION_NOT_ACTIVATED`: they need their own single-use recipient evaluator and governed administrative scope.

3. **Market.** A Market key and CP's current Market authority are required. Trade has no CP Market source yet, so callers supply `UNAVAILABLE` and no market-scoped operation can ALLOW.
4. **Sites.** Each referenced Site belongs to this Organisation (a foreign or unknown one is `BUYER_NOT_AUTHORISED`), is ACTIVE, is in the operation's Market and supports its shipping or billing use. A commitment must name a delivery Site.
5. **Role-bound scope.** One permitted role assignment must itself hold the active Market grant and every Site grant (`b2b_buyer_role_market_scope`, `b2b_buyer_role_site_scope`). Grants never compose across roles.
6. **Commitments.**
   - A required purchase order must be present and match its format.
   - Exactly one in-effect spend limit for the Market and currency, with a positive order limit, is required; otherwise `SPEND_POLICY_NOT_CONFIGURED`.
   - Cumulative budgets (step 7 below) must pass before any escalation is considered.
   - Over the limit is `SPEND_LIMIT_EXCEEDED`, unless an enabled approval policy for that exact Market and currency permits escalation (`APPROVAL_REQUIRED`).
   - A bound approval releases the commitment only when its digest, version, amount, currency, Market and policy revision are unchanged (`TRANSACTION_CHANGED`), the initiator is this Principal, the approver is someone else, and the approver's current re-evaluation still ALLOWs.
7. **Cumulative budgets** (Decision 5, ADR-SHARED-042 §14). Every applicable ceiling passes independently, and approving a purchase never raises a budget, so a shortfall is always `SPEND_LIMIT_EXCEEDED` and never `APPROVAL_REQUIRED`, for every role including `ACCOUNT_ADMIN`.
   - Exactly one ACTIVE, in-effect calendar-month `MEMBERSHIP` budget for this membership, Market and currency is required: none is `SPEND_POLICY_NOT_CONFIGURED`, more than one is `CONTEXT_NOT_USABLE`.
   - An `ORGANISATION` budget, and an `AGREEMENT` budget for the purchase's own agreement, bind when configured; more than one of either is `CONTEXT_NOT_USABLE`.
   - Available capacity is limit − committed − reserved for the current period. A budget with no current-period balance has consumed nothing; earlier periods never carry over.
   - The purchase's own reservation is credited once, through its hold on that policy revision and period, so the purchase is never counted twice and an increase needs capacity for the difference only. An expired, closed, stale-revision or other-period hold credits nothing.
   - A reservation whose membership, Market, currency, agreement, digest or resource version differs from the transaction is `TRANSACTION_CHANGED`: reservations are never transferred.
8. **Approval decisions.**
   - Nobody approves their own transaction (`SEPARATION_OF_DUTIES`).
   - An explicit in-effect approval limit for the Market and currency is required; otherwise `APPROVAL_AUTHORITY_NOT_CONFIGURED`, never `APPROVAL_REQUIRED`.
   - The amount must be within it (`APPROVAL_THRESHOLD_EXCEEDED`).

`buyer-operation-policy-source.ts` loads the facts. Each source fails independently to `UNAVAILABLE`. Malformed money rows are dropped, which fails closed. A purchase-order requirement applies organisation-wide where no Market-specific row exists, because it is a restriction. Budgets are the exception to dropping: a dropped `ORGANISATION` or `AGREEMENT` budget would remove a ceiling, so any malformed budget, balance or hold makes that source `UNAVAILABLE`. The reservation is read only by the identifier on the purchase record and only within this Organisation; Shared's integer `resource_version` is compared in its decimal form.

`Migration20261022150000` adds the Decision 5 ledger. The database, not application code, is the capacity authority:

- **`b2b_spend_budget_policy`:** versioned, with a database-owned revision that advances on every change. Scope, Market, currency and period kind are immutable, RETIRED is terminal, policies are never deleted, the time zone must be a known IANA zone (UTC by default), and at most one ACTIVE policy exists per scope binding.
- **`b2b_spend_reservation`:** one immutable purchase (membership, Market, currency, agreement, digest, resource version). Its binding never changes, the membership must belong to its Organisation, and every non-ACTIVE state is terminal.
- **`b2b_spend_ledger_entry`:** append-only RESERVE, COMMIT and RELEASE entries with a unique idempotency key. Its trigger stamps the time, derives the calendar month in the policy's zone (or the agreement term), locks the policy and the period balance, and applies the entry in the same transaction:
  - RESERVE needs an ACTIVE, unexpired reservation and the current policy revision, and is refused when it exceeds limit − committed − reserved;
  - COMMIT converts reserved to committed and never exceeds what the reservation holds;
  - RELEASE returns only the unused portion.
- **`b2b_spend_budget_balance` and `b2b_spend_reservation_hold`:** written only by the ledger trigger; direct writes are refused.
- **No backfill:** no budget is created from `order_limit_minor`, so every commitment is `SPEND_POLICY_NOT_CONFIGURED` until a budget is configured through a governed path.

`Migration20261022120000` adds the grant tables and approval binding:

- **Grant revisions:** owned by the database.
- **Integrity:** a REVOKED grant is terminal, grants are never deleted or moved, and a Site grant may name only a Site of the role's own Organisation.
- **Revision bump:** every grant change advances the membership revision.
- **Approval binding:** `b2b_purchase_approval` gains the initiating and approving Principals, Market, digest, resource version and policy revision, with the approver distinct at database level.
- **No backfill:** no existing membership receives a grant.

The legacy `policy.ts` fails closed in the same way: a null spend or approver limit is no authority, and an over-limit purchase escalates only where a threshold is configured.

## Consequences

- **Data backfill.** Existing relationships have no `engine_instance_id` or `link_provenance`, so they are refused until a governed reconciliation records both. No relationship is auto-promoted (ADR-SHARED-042 §11).
- **Not yet built:**
  - **CAA-05 remainder:**
    - **Reservation commands (CAA-06):** the idempotent reserve, increase, commit, release, expiry and rollover commands, their multi-policy lock order (entries inserted in `budget_policy_id` order), revalidation of approvals on rollover, and the native Medusa fence that verifies the reservation at commit. Until then nothing writes the ledger, and an evaluator ALLOW is never sufficient on its own;
    - **Budget administration:** the governed path for creating and revising budget policies;
    - **Limit scope:** limits are scoped to the membership, not to the role;
    - **Market mapping:** the governed `market_key` ↔ canonical CP Market mapping, and the CP Market authority source, are missing;
    - **Unbuilt evaluators:** the invitation-recipient evaluator and the governed administrative scope for member management;
    - **Scope workflow:** the governed scope-assignment and backfill workflow;
  - the evaluator is not yet called by any route: composition with assurance, the buyer context, the seller decision, the buyer-authority receipt and native fences is CAA-06;
  - market binding: `requested_country_code` is accepted but not yet bound;
  - registration: governed buyer registration (`register-buyer`) is a separate onboarding operation and is not called here.
- **Activation dependencies.** CP's estate binding route (CP #426) and IAM-issued `trade:buyer-handoff` tokens are required before the route can return ALLOW outside tests.
- **Legacy routes.** `GET /store/b2b/context` and the onboarding metadata read stay for the legacy Medusa session until the estate switches.
- **Not acceptance evidence.** Synthetic tests prove the boundary only. Real-component acceptance is CAA-08.
