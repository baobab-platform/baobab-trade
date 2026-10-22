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

## Consequences

- **Data backfill.** Existing relationships have no `engine_instance_id` or `link_provenance`, so they are refused until a governed reconciliation records both. No relationship is auto-promoted (ADR-SHARED-042 §11).
- **Not yet built:**
  - `BUYER_COMMITMENT` and `BUYER_ADMINISTRATION` operations, the remaining CAA-05 operation policy (sites, Markets, spend, PO, separation of duties), the buyer-authority receipt and its native fences (CAA-06) all remain outstanding;
  - market binding: `requested_country_code` is accepted but not yet bound;
  - registration: governed buyer registration (`register-buyer`) is a separate onboarding operation and is not called here.
- **Activation dependencies.** CP's estate binding route (CP #426) and IAM-issued `trade:buyer-handoff` tokens are required before the route can return ALLOW outside tests.
- **Legacy routes.** `GET /store/b2b/context` and the onboarding metadata read stay for the legacy Medusa session until the estate switches.
- **Not acceptance evidence.** Synthetic tests prove the boundary only. Real-component acceptance is CAA-08.
