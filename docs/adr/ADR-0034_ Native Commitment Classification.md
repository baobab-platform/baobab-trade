# ADR-0034: Native Commitment Classification

Status: Proposed. This is Trade's implementation record for ADR-SHARED-042 §14 Decision 8 (Platform Owner ruling of 2026-10-22), Trade classification step. Where this record and ADR-SHARED-042 differ, ADR-SHARED-042 governs.
Date: 2026-10-22

## Context

Every binding native commitment must be classified B2B or B2C (Decisions 6–8):

- the B2B regime requires the buyer-authority receipt, the seller receipt and the spend reservation;
- the B2C regime requires the seller receipt and its own consumer and payment controls;
- a missing classification never falls through to B2C.

Decision 8 assigns the parts:

- **CP** owns the governed EstateCommerceProfile (B2B or B2C per estate, engine instance and Market; no MIXED). It attests the profile read-only (CP ADR-BCP-030).
- **Trade** owns the immutable NativeCommitmentClassification. Trade verifies it against its own buyer relationship, and CP and Trade must agree.

Implementation order: Shared → CP → Trade classification (this record) → CAA-06 commit fence → CAA-08.

Contracts: Shared at `742295e2b4f67a3de6d985e7da6bd89ed0be39cb`:

- `trade/v2/native-commitment-classification.schema.json`;
- `control-plane/v1/estate-commerce-profile.schema.json` and `.openapi.yaml`;
- `trade/v2/buyer-authority-receipt` and `buyer-commitment-valuation`, vendored for the fence.

The re-pin also carries Decision 6's `trade.order.create`. It is now a `BUYER_COMMITMENT` operation with the same purchasing role set and site rule as `trade.order.commit`.

## Decision

### CP client

`ControlPlaneCommerceProfileResolver` calls `POST /internal/estate/v1/commerce-profiles/resolve` with Trade's own workload token (scope `estate:commerce-profile:resolve`).

**What Trade sends:**

- the estate, its own engine instance and the Market;
- `ESTATE_CLIENT_BINDING` provenance: the CAA-04 binding attestation of the buyer request.

Trade never names a Tenant, profile, model or revision. It never sends a request that fails the Shared request schema.

**What Trade accepts:** only an attestation that:

- is schema-valid;
- names this estate, instance and Market;
- is still current, lasts at most 60 s and does not outlive `profile_effective_until`.

Anything else is `RESOLUTION_UNAVAILABLE`.

### Classification

`classifyNativeCommitment` classifies one cart, draft order or order:

1. **Resource fit.** The resource's current seller attribution (TA-04) must:
   - name the resource and this engine instance;
   - name the CP platform context the caller supplies.
2. **Market.** The Market is that context's `market_id`. With no canonical Market there is no classification (`CLASSIFICATION_ABSENT`). Trade never mints a market id, and the ISO `market` of the attribution is not one.
3. **Estate binding.** The binding must be current, for this instance and for the attribution's Tenant.
4. **Buyer relationship.**
   - BUYER_ORGANISATION needs a current TradeBuyerExecutionContext for the same estate, Tenant, instance and binding (`cp-estate-binding:<id>@r<rev>`).
   - CONSUMER needs a positive consumer reference.
5. **CP resolution.** CP's answer maps to:

   | CP answer                                             | Trade refusal                                  |
   | ----------------------------------------------------- | ---------------------------------------------- |
   | `PROFILE_NOT_REGISTERED`, `ESTATE_PROVENANCE_INVALID` | `CLASSIFICATION_ABSENT`                        |
   | `PROFILE_NOT_ACTIVE`                                  | `PROFILE_NOT_ACTIVE`                           |
   | `PROFILE_AMBIGUOUS`, `ENGINE_INSTANCE_NOT_PERMITTED`  | `CLASSIFICATION_CONFLICT`                      |
   | `CALLER_NOT_PERMITTED`, unavailable or no resolver    | `PROFILE_UNAVAILABLE` (→ `SOURCE_UNAVAILABLE`) |

   Every CP decision is recorded. Unavailability is not an answer, so it is not recorded.

6. **Agreement.**
   - B2B with a consumer is `BUYER_AUTHORITY_ABSENT`. A B2B commitment is never reinterpreted as B2C.
   - B2C with a buyer Organisation is `CLASSIFICATION_CONFLICT`.
   - A Tenant that differs from the binding is `CLASSIFICATION_CONFLICT`.
7. **Contract check.** The record must satisfy the Shared schema before it is stored.

**Existing classifications.**

- An existing ACTIVE classification that says the same thing is returned.
- A different answer quarantines it and returns `CLASSIFICATION_CHANGED`. It stays retired until a governed replacement.

### Database (Migration20261022210000)

**`trade_commerce_profile_observation`**

- Append-only record of CP's answers.
- An ATTESTED row is current, lasts at most 60 s and never outlives the profile.
- A profile is refused at a revision older than one seen, or with a different estate, Tenant, engine or model.
- A denial names no profile.

**`trade_native_commitment_classification`**

- **Insert.** Requires a live matching attestation (estate, Tenant, instance, Market, profile, revision, model). It also requires the resource's own attribution with the same Tenant, instance, seller binding version and CP context.
- **Model rules.**
  - B2B: buyer Organisation, buyer context, and exactly one of membership or mandate; no consumer.
  - B2C: consumer only.
- **Uniqueness.** At most one ACTIVE classification per resource.
- **Immutability.**
  - Nothing changes except ACTIVE → SUPERSEDED or QUARANTINED, with revision + 1.
  - A resource is classified once; any change is a REPLACEMENT naming a retired record of the same resource.
  - A CONVERTED record continues its non-quarantined parent's estate, Tenant, Market, model and buyer unchanged, at most once.
  - Nothing is deleted or truncated.
- **Quotations.** Refused until a governed quotation seller attribution exists.

### Commit check (Migration20261022220000)

The TA-07 fence consumes the seller receipt and records a `trade_order_commitment` for every cart commit and draft finalisation, whatever path wrote the order. A deferred constraint trigger on that commitment then checks, at COMMIT of the same transaction:

| Check                                                                                                                                                            | Refusal                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No ACTIVE classification for the committed cart or draft                                                                                                         | `CLASSIFICATION_ABSENT`, or `CLASSIFICATION_CHANGED` if the resource's classification was retired                         |
| The classification's Tenant or seller binding version differs from the seller receipt's                                                                          | `CLASSIFICATION_CONFLICT`                                                                                                 |
| The latest CP answer for the estate, engine instance and Market is not a live ATTESTED one for the same profile and model, at the classified or a later revision | `PROFILE_NOT_ACTIVE` (Trade re-resolves within the attestation's lifetime)                                                |
| B2B                                                                                                                                                              | `BUYER_AUTHORITY_ABSENT` until CAA-06b consumes the buyer-authority receipt and its spend reservation in this transaction |

- **B2C** passes on the seller receipt the TA-07 fence already consumed; its consumer and payment controls are its own policy.
- **Atomicity.** A refusal rolls back the order, the receipt consumption and the commitment together.
- **Posture.** The check applies in every persistence posture, because a commitment exists only for an attributed, receipted record. Unattributed SANDBOX fixtures never reach it.
- **Never B2C by default.** No path reinterprets a refused or unclassified commitment as B2C.

## Consequences

- **Default state.** Nothing classifies today. No profile is registered and no workload holds the scope. `getCommerceProfileResolver()` is null outside the configured buyer identity path in development or staging.
- **Not yet wired.** No route or workflow calls the classifier yet; the CAA-06b composition does. Until it does, every native cart commit and draft finalisation is refused for want of a classification, and every B2B one is refused for want of buyer authority.
- **Evidence.**
  - Unit tests: `tests/estate-commerce-profile.test.ts` and `tests/native-commitment-classification.test.ts`.
  - Disposable PostgreSQL 17 regression: `regression:native-commitment-classification`, covering guards, replay, concurrency, quarantine, replacement, conversion and expiry.
  - `regression:trade-a-commit-fences` on the real `completeCartWorkflow` and `convertDraftOrderWorkflow`: classified B2C commitments complete; unclassified, B2B, retired, stale-profile and CP-withdrawn commitments are refused and nothing commits; a re-resolved attestation commits.

  All CP answers in these are synthetic. This is source and engine-local evidence only, not connected qualification, staging or go-live readiness (ZB-G03 and ZB-G07 remain open).
