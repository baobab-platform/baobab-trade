# LA-05C2 — Native Medusa checkout guard (pre-certification)

**Authority:** Accepted ADR-BCP-027 LA-05, Shared legal-actor assessment contract, CP LA-05A. Depends on LA-05C Trade #118 and does not supersede its existing seller-of-record adapter.

## Implemented

- Registers a `completeCartWorkflow.hooks.validate` handler, following the repository's existing Thamani native-cart hook approach, so enforcement can occur on the **actual Medusa order-commit path**, rather than only the standalone `OrderOrchestrationPort`.
- Uses `BAOBAB_LA05_NATIVE_CHECKOUT_GUARD=true` as an explicit **non-production only** staging opt-in. Production with the flag enabled refuses order completion until a separate audited rollout removes this hold. Flag absent leaves native checkout behavior unchanged; that remains an **unaccepted legal-actor bypass** for any commerce capability requiring scoped legal responsibility.
- Requires a server-registered dependency object at `baobab_native_seller_checkout_dependencies`; no fallback, no dummy provider, no direct trust in a browser-supplied context or legal-entity override. Without this registration, a guarded checkout fails closed.
- Requires a trusted server-side cart binding for **cart ID, sales channel, region, unique operation reference**, canonical Organisation and CP-issued owned runtime context. Rejects mismatches before contacting CP.
- Requires current CP seller-of-record assessment, separate provider/merchant readiness, and **a second fresh CP assessment after readiness**, with unchanged mandate and actor. Every replay is subject to revalidation.

## Explicit remaining LA-05C3 / native acceptance boundary

This change installs the native hook but **does not register** a real authoritative cart-to-tenant/Organisation/Context binding source or a certified Medusa seller/provider readiness implementation. A fake module returning permitted answers must never be installed. Before enabling staging:

1. Implement trusted, immutable server-owned binding storage with a current CP RUNTIME context issued to the Trade workload. Never treat cart metadata, storefront headers or legalSellerKey aliases as authority.
2. Register the dependency object with real active IAM credentials, CP client and independently assessed commercial/provider readiness.
3. Prove that every relevant store/cart/region/sales-channel completion route goes through this hook, including native checkout and idempotency replay, and that market changes cannot evade the binding.
4. Obtain CP staging assessor and token promotion, verify revocation/expired/ambiguous mandates, concurrent changes, CP unavailability, provider unavailable and merchant failure **before native order creation**.
5. Fix Trade Foundation dependency/image vulnerability gates and obtain per-capability readiness/authorised production release. CP assessment is currently production-disabled; do not remove its safety gate to make checkout work.

The implemented hook is a guarded staging integration *seam*, not a finished native provider PEP or a production claim.
