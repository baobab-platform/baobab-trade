# LA-05C3 — Trusted native cart binding, IAM and Payments readiness

**Authority:** Accepted ADR-BCP-027, LA-05C through LA-05C3. **State:** staging candidate; not accepted for live merchant/order processing.

## Enforced boundaries

| Concern                 | Implemented authority                                                                                                                 | Never inferred from                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cart identity           | Medusa native complete-cart workflow                                                                                                  | Browser-selected Organisation/LegalEntity                     |
| Trusted cart binding    | Dedicated Medusa PostgreSQL module; one active row per cart                                                                           | Cart metadata, headers, storefront aliases                    |
| Tenant/Organisation     | Fresh `baobab-cp` platform-context attestation using Trade's workload token                                                           | Unverified local `tenant_id`                                  |
| Legal responsibility    | Two current CP `SELLER_OF_RECORD` assessments bound to that cart's operation; same actor/mandate                                      | A tenant default LegalEntity or Nabhold affiliation           |
| Provider eligibility    | Separate authenticated, operation-scoped Payments readiness response; exact actor/market/currency/tenant/Organisation and short lease | CP legal-actor permission or a merchant's technical existence |
| Workload authentication | Environment-supplied IAM OAuth2 client-credentials; Trade CP and Payments credentials have separate audiences                         | Customer token or service account aliases                     |

The new `native_seller_cart_binding` model has an explicit server-owned cart, tenant, Organisation, CP-owned RUNTIME context, expected actor, sales channel, region, market, currency, named activity/capability, independent approval reference/approver, and expiry. The module migration creates an **empty** table. It does not silently migrate historical `legalSellerKey` values or grant any trading access. The generated Medusa module provides the persisted read path; it exposes **no Store API mutation route** for applicants to mint bindings.

`NativeSellerCheckoutModuleService.resolveTrustedCart` requires a uniquely active, unexpired and scope-matching binding and rechecks the tenant-to-Organisation association with CP before handing the candidate to the checkout legal-actor gate. Any expired, revoked, contradictory or missing record fails closed. The CP assessment independently rejects RUNTIME context handles not owned by the authenticated Trade workload. It is not sufficient to record a UUID in Trade's database.

The Payments adapter requires a separately acquired audience-specific IAM bearer token and a current, independently authorised merchant certification/activation response. It refuses blank, stale, mismatched or unauthenticated results; it grants no payment permission on its own.

## Explicit staging environment inputs

```text
BAOBAB_LA05_NATIVE_CHECKOUT_GUARD=true
BAOBAB_CONTROL_PLANE_BASE_URL=<approved HTTPS staging CP>
BAOBAB_IAM_WORKLOAD_TOKEN_URL=<approved IAM token endpoint>
BAOBAB_IAM_WORKLOAD_CLIENT_ID=<Trade's actual scoped client>
BAOBAB_IAM_WORKLOAD_CLIENT_SECRET=<secret from staging secret store>
BAOBAB_PAYMENTS_SELLER_READINESS_URL=<approved HTTPS Payments merchant-assessment endpoint>
BAOBAB_PAYMENTS_WORKLOAD_TOKEN_URL=<approved IAM token endpoint for Payments audience>
BAOBAB_PAYMENTS_WORKLOAD_CLIENT_ID=<approved Trade-to-Payments client>
BAOBAB_PAYMENTS_WORKLOAD_CLIENT_SECRET=<separate secret from staging secret store>
```

**No endpoints, account details or secret values are supplied in this PR.** The Payments readiness wire shape in `src/baobab/orders/payments-seller-readiness.ts` is a **proposed integration profile**, not a published live Payments API or agreed Shared contract. It must be accepted by Payments and Shared before staging. Missing it blocks checkout, not just payments capture.

The module is conditionally registered only when `BAOBAB_LA05_NATIVE_CHECKOUT_GUARD=true` and `NODE_ENV` is not production. The native guard rejects production enablement even if somebody sets the environment flag. Missing any required secret, binding or readiness result fails closed in staging. When the flag is absent, prior checkout behavior remains unguarded and **must not be advertised as LA-05 accepted**.

## Operational gates still required for LA-05C3 acceptance

1. Provide a reviewed maker/checker authorised **server-side binding issuance and revocation workflow**. A SQL row inserted by hand or a Trade admin selecting an actor does not prove CP legal-actor authority. Only bind a CP-issued RUNTIME context to an actual Medusa cart, immutable tenant/Organisation and independently authorised legal seller.
2. Confirm the actual deployed IAM workload receives `context:resolve` and `legal-actor:assess` with exact audience, issuer and owner. Payments audience needs separately reviewed authorization, not borrowed CP scope.
3. Agree a versioned Payments readiness endpoint and contract with `baobab-payments` and Shared, including provider certification, market/currency/merchant activation and auditable source evidence. **No such service is claimed deployed here.**
4. Run Medusa DB migrations, then exercise a genuine provisioned cart (not a test double), shared native `completeCartWorkflow.validate` policy, successful CP RUNTIME assessment, provider denial, changed region/channel, expiry, revocation, ambiguous mandates, retries and CP/Payments outages in staging.
5. Resolve Foundation npm/container security findings and obtain a signed production readiness decision before removing the production safety block or publishing provider-support.
6. Confirm order placement and payment routing independently satisfy tenancy, entitlements and domain-specific authorisation. A legal-actor assessment is a **fact**, not an entitlement.

## Corrected Medusa hook architecture

Medusa rejects two `completeCartWorkflow.hooks.validate` registrations. LA-05C2's independent registration is removed and its policy composed into the existing Thamani eligibility validation hook. This preserves Thamani's native cart product gate and allows optional guarded seller policy on the same native execution path, without changing low-risk storefront behavior while disabled.

## Rollback and safety

Disable the flag to restore previously unaccepted behavior only in controlled test environments; doing so must **not** be accepted as production remediation. Revoke compromised cart bindings, CP mandates and IAM scopes independently. Disabling the flag never revokes an already ACTIVE legal mandate. Never create synthetic Nabhold/Thamani/ZuriBeans legal records, fabricated merchant certifications or automatically granted provider rights to get a green test.
