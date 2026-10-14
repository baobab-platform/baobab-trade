# P0-04B-03 — commit-point checkout fence

**Date and baseline:** 14 October 2026. Follows P0-04B-02 (#147, #148). Trade base `d8d517c`, Shared pin `5dcff30` (unchanged).

**Scope:** This set implements the commit-point part of ADR-BCP-027 LA-05 for Trade, under ADR-0010 §28 and ADR-0014 §10, §11 and §26–30. It does not close wider P0-04B, qualified merchant certification, workload/human admission or real P0-03 founding/legal/operator acceptance.

## Problem

Before this set, the native `completeCartWorkflow` validate hook assessed four things: the ACTIVE binding, the CP SELLER_OF_RECORD fact, the documentary veto and Payments readiness. Every check ran in the hook, against the JavaScript clock, outside any database transaction that order creation could see.

That left three gaps:

- A `revoke` could commit between the final check and order creation.
- The CP, Payments, binding and context leases were never re-checked at commit.
- The `native-checkout/{cartId}` idempotency key was computed but never persisted.

## Where the fence sits

Medusa 2.21.2 `completeCartWorkflow` is a compensating saga, not one transaction. It runs in this order:

1. validate hook
2. `createOrdersStep`
3. in parallel: the `order_cart` link, `updateCartsStep` (`completed_at`), the inventory reservation and the promotion usage
4. payment authorization
5. the order transactions

A failed step compensates the earlier ones. No write is atomic with order creation.

This implementation places the fence at the cart's `completed_at` NULL→NOT NULL write. That write commits **before payment authorization**, so a denial there removes the order and authorizes no payment. Money cannot move unless the fence passed.

Medusa's `beforePaymentAuthorization` hook exists at runtime but is `@ignore` and absent from the typed workflow hooks. It is deliberately not used.

## Mechanism

Migration `Migration20261014090000` adds the following.

**`la05_checkout_authorization`.** An append-only receipt recording:

- the ACTIVE binding id and revision;
- the CP context, legal entity and mandate, plus the CP decision lease;
- the final negative-only documentary decision expiry (at most two seconds);
- the Payments READY references (`provider_certification_reference`, `merchant_activation_reference`, `policy_reference`) and their lease;
- `lease_expires_at`, which a CHECK constrains to the earliest of the legal, documentary and readiness leases and to at most 31 seconds after creation;
- the key `native-checkout/{cartId}`.

A partial unique index allows exactly one live consumption per checkout key.

**Insert guard.** It takes the `seller-binding/{cartId}` advisory lock, the same lock that revocation and activation already take. It then requires a current, unconsumed lease and an ACTIVE binding at that revision whose binding and activation-context expiries are still in the future. The cart must be open, with native coordinates matching the binding. Update and delete are refused, except for the consume and release transitions made by the cart trigger.

**`la05_checkout_commit_fence`.** A BEFORE UPDATE trigger on `cart`. For a cart whose binding was ever activated, the NULL→NOT NULL transition of `completed_at`:

1. takes the same advisory lock;
2. requires the newest unconsumed authorization whose lease, binding `expires_at` and activation-context expiry are still in the future by `clock_timestamp()`, with the binding still ACTIVE at the authorized revision and matching coordinates;
3. consumes that authorization and voids any older unconsumed receipt for the cart, so exactly one receipt can ever authorize the completion.

A deferred constraint rechecks the final receipt, binding, context, coordinates and all three leases with `clock_timestamp()` immediately before COMMIT. Expiry after the cart UPDATE rolls back both completion and consumption. Compensation takes the same per-cart fence; released or voided receipts never authorize a retry. Any failure raises and Medusa compensates.

When compensation reopens a completed cart, NOT NULL→NULL, the consumed receipt is **released, never reused**, and any unconsumed receipt is voided, and a retry needs a fresh authorization.

**Writing the authorization.** `enforceNativeCheckoutGate` now refuses unless an authorization store is registered. After `assertNativeCartLegalSeller` passes, it records the authorization through `PostgresGovernedBindingPersistence.record()`. That method reuses the existing transaction, advisory-lock and timeout helper.

Medusa runs the validate hook on a completeCart replay too. The enabled guard still requires current binding, legal, documentary and merchant standing; a replay after binding revocation denies while preserving the historical order. After successful current checks, recording is a no-op only when the checkout already holds a live consumption on a completed cart with a live native order link and order (ADR-0014 §26–30).

`assertNativeCartLegalSeller` now returns the final CP decision and the Payments READY receipt. Readiness that passes without certified references denies.

**Revocation.** `revoke` is unchanged. A revocation that wins the advisory lock leaves the binding REVOKED, and the fence then denies. One that loses finds the order already placed, and ADR-0010 §28 makes the seller immutable.

**Scope of the fence.** It applies to carts whose binding has an activation snapshot, so a REVOKED-after-activation or expired binding cannot be completed by a direct write.

Carts that were never activated or have no binding keep the existing application gate: production denies, staging requires the guard, and development and test may use the explicit off path. Requiring a binding for every cart is a separate owner decision.

## Evidence

**Native acceptance.** `npm run regression:checkout-commit-fence` runs in the `core-module-integration` job after the Thamani simulation pack. It uses real Thamani Uganda carts, real `completeCartWorkflow` runs and applied migrations. CP and Payments are explicitly synthetic. Initial cases keep the hook flag off to prove the database fence independently; additional cases enable the actual installed hook with synthetic external ports in a scoped container. Native carts, workflows, persistence, triggers and consumption remain real. The cases are:

| Case                                     | Expected result                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Activated cart with no authorization     | Denied; compensated, no order link, cart still open                                                                                          |
| Authorized cart                          | Completes and consumes once                                                                                                                  |
| Replayed completion                      | Returns the original order with no second consumption                                                                                        |
| Hook re-run on a replay                  | Recording is an idempotent no-op; a direct new receipt for a completed cart is refused                                                       |
| Rewriting or deleting a receipt          | Refused                                                                                                                                      |
| Revocation committed after authorization | Denied                                                                                                                                       |
| Lease expired before commit              | Denied                                                                                                                                       |
| Direct SQL completion bypass             | Denied                                                                                                                                       |
| Direct pre-consumed insert               | Denied                                                                                                                                       |
| Two hook runs, then compensation         | Completion consumes the newest receipt and voids the older; compensation releases it; neither can be reused; a fresh authorization completes |
| Concurrent completions                   | Exactly one order and one live consumption                                                                                                   |

**Unit tests:**

- `native-cart-legal-seller` covers the returned authorization, denial when readiness passes without references, the idempotency key and a missing or failing store.
- `postgres-governed-binding-persistence` covers the lock ordering and input rejection.
- `payments-seller-readiness` covers the returned receipt.

**Original PR validation.** The initial implementation reported the following local checks; final-head CI and the continuation checks are authoritative:

- format, lint, typecheck and build;
- 500 unit tests;
- the contract, ports, isolation, conformance and ZB-04 suites;
- Shared conformance (89 checks at `5dcff30`);
- the governed-binding lifecycle regression;
- the store-credit regression, as unbound-cart control;
- the new acceptance.

The local database was PostgreSQL 16. The PostgreSQL 17 CI job is authoritative.

## Remaining and rollback

**Still open:**

- **Merchant readiness.** The existing Shared contract carries provider certification and merchant activation references. No real provider qualification is established by synthetic references; qualified owning Payments operation and separate workload admission remain required.
- **Not yet done:** real IAM workload and human admission, merchant certification, and the ERP, Payments, Subscriptions and Trade Docs execution points.
- **Production** stays hard-denied.

**Boundary limits.** This is the native cart-completion transaction fence for ever-activated bindings, not a serializable transaction spanning CP, Payments and Medusa. External mandate/documentary/merchant revocation after the last assessment is bounded by its lease, not synchronously fenced by this local database. Native order creation, link/event emission and payment authorization are separate saga steps; direct order creation and independently invoked payment paths are not covered by this cart trigger. Never-activated/unbound cart SQL writes are also outside its scope. Wider protected execution and real operational acceptance remain open; production stays denied.

**Continuation acceptance.** The suite additionally requires pre-COMMIT lease-expiry rollback, guard-enabled native completion/replay, revoked replay denial preserving the historical order, documentary veto, independent merchant denial and missing-binding denial. A bare completion timestamp without a linked native order is refused as a replay, and an activated completion timestamp cannot be replaced. The final documentary lease is persisted and positive leases are rechecked after its I/O. Generated Redis state is excluded from source.

**Rollback.** The down migration refuses: removing the fence would reopen activated carts and discard consumption history.
