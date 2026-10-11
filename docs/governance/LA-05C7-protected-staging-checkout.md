# LA-05C7 — Staging native Medusa checkout bypass closure

**Source:** Accepted ADR-BCP-026/027, Package 4. Follows merged LA-05D5 production native checkout denial and LA-05C3 current CP seller/Payments vetting.

A `false` or missing `BAOBAB_LA05_NATIVE_CHECKOUT_GUARD` previously bypassed the real Medusa `completeCartWorkflow.hooks.validate` seller policy in staging. That route could then complete native cart workflows with no canonical server-owned binding, CP `SELLER_OF_RECORD`, documentary clearance or merchant readiness response. This was not an acceptable protected staging test path.

**Implementation:** `enforceNativeCheckoutGate` now accepts a separately determined staging signal; `BAOBAB_ENVIRONMENT=staging` or `BAOBAB_DEPLOYMENT_ENV=staging` causes native completion to fail closed when the flag is unset. When enabled in staging, all existing cart-binding, CP and Payments checks apply; an absent certified provider still denies. Production remains refused regardless of flag, as per LA-05D5; only development and integration retain explicit synthetic bypass.

The common native Medusa validate hook remains the only seller policy entrypoint and still applies Thamani product/market eligibility. There is no new browser or REST route that can assert legal actor or bypass tenant/provider authority.

**Still external:** A trusted cart-binding maker/checker issuance and revocation service, a certified PSP merchant readiness adapter, accepted IAM workloads, and end-to-end staging proof. This code closes the disabled-staging-flag bypass; it does not assert any successful live checkout or production support.
