# LA-05D5 — Deny native production checkout with disabled legal-seller gate

This change implements an ADR-BCP-027/026 Package 4 bypass closure, not production certification.

Previously `enforceNativeCheckoutGate(cart,false,true,...)` returned immediately and allowed Medusa's default native checkout to execute without a legal seller, CP mandate, documentary scope or PSP readiness check. An unset `BAOBAB_LA05_NATIVE_CHECKOUT_GUARD` was thus sufficient to bypass the noncertified gate on production checkout.

Now **production checkout always fails closed** while the LA-05 native seller route lacks certified provider readiness, whether the flag is enabled or disabled. Development retains the explicit staging opt-in and its complete double-check of immutable cart binding, current CP legal actor, documentary restrictions and independently ready provider. Neither product eligibility nor a buyer's metadata supplies legal seller authority.

## Acceptance and operator impact

- In production the real `completeCartWorkflow` validation hook refuses both `enabled=false` and `enabled=true`; there is NO silent fallback to a default Medusa merchant or selling legal entity.
- In nonproduction `enabled=false` continues to skip the experimental PEP as before; this is **not** a production capability claim.
- In staging `enabled=true` requires trusted server-side cart binding and all CP/provider dependencies, including post-readiness revocation checks.
- Production checkout activation requires future controlled certification and an explicit architecture-gated change to remove the production deny; no live PSP or mandate has been invented.

**Scope:** this closes the identified feature-flag bypass. It does not prove a live merchant, PSP certification or full cross-engine acceptance.
