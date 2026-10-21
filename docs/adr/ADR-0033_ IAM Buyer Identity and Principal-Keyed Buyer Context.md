# ADR-0033: IAM Buyer Identity and Principal-Keyed Buyer Context

Status: Accepted (platform owner decision of 2026-10-21; ZB-G03 step 3)
Date: 2026-10-21

## Context

IAM ADR-0010 section 0 rules that the confidential estate BFF carries IAM evidence server-side, that the Control Plane owns the canonical Principal, and that Trade decides purchasing authority. No commerce operation may proceed on a Medusa token alone. Two parts of Trade conflicted with that:

- `GET /store/b2b/context` keyed membership on the Medusa customer (`auth_context.actor_id`).
- Buyer onboarding read the canonical Principal from Medusa auth metadata (`app_metadata.baobab_principal_id`).

CP ADR-BCP-028 and Shared `identity/v1/principal-resolution.openapi.yaml` now give Trade a sanctioned way to learn the buyer's Principal.

## Decision

`POST /store/b2b/buyer-context` accepts an IAM access token as the bearer and the Shared `BuyerOperationRequest` as the body: `requested_organisation_id`, `requested_country_code` and `correlation_id`, with no other fields. It derives buyer authority in this order, and any failure denies:

1. **Trade verifies the token itself** (`src/baobab/auth/buyer-access-token.ts`):
   - the signature, from the configured issuer's own discovery document and same-origin JWKS (RS256 or ES256 only);
   - the exact issuer, audience `baobab-trade`, scope `trade:buy`, `actor_type` `human`;
   - an `azp` on the BFF client allowlist;
   - `jti`, and a bounded, current lifetime.

   Provider organisation, group, role, tenant and email claims are never read.

2. **The Control Plane resolves the canonical Principal.** Trade authenticates with its own workload token (scope `identity:principal:resolve`) and carries the buyer token as subject evidence. CP verifies it again and introspects it. Unknown is `IDENTITY_NOT_RESOLVED`, and Trade never falls back to a Medusa customer.
3. **The Organisation must be CP-attested.** The requested canonical Organisation must be linked to exactly one ACTIVE Trade organisation, and CP must attest that organisation's tenant. Here that attestation is required; on `GET /store/b2b/context` it was opt-in.
4. **The membership must belong to the Principal.** Exactly one ACTIVE, in-effect buyer membership of that organisation must belong to the CP Principal. Roles come from Trade.

Two further rules:

- An unknown Organisation and a missing membership are both `BUYER_NOT_AUTHORISED`, so neither can be probed.
- The response is a private, `no-store` Trade projection: principal, organisation, membership, roles and `evidence_expires_at`. It is not a credential, and it implies no market, price, credit or purchase decision; each operation re-derives authority.

The route is disabled (404) unless `BAOBAB_BUYER_IDENTITY_ENABLED=true`. When enabled, it needs `BAOBAB_IAM_BUYER_ISSUER`, `BAOBAB_IAM_BUYER_AUTHORISED_PARTIES` and the existing workload and Control Plane settings; without them it answers 503 and never falls back.

## Consequences

- `GET /store/b2b/context` and the onboarding metadata read stay for the legacy Medusa session until the estate switches to the IAM BFF path. Retiring them is a separate change.
- `requested_country_code` is accepted but not yet bound. Market resolution against the tenant's ACTIVE participation through CP platform context is the next increment, and the response carries no market until then.
- Shared `trade/v1` `/buyer-context` still has the caller assert `principal_id` and `tenant_id`, which contradicts the handoff contract. That needs a Shared amendment before this route can claim `trade/v1` conformance.
- **Not acceptance evidence.** Synthetic tests prove the boundary only. Connected acceptance (ZB-G03 step 4) needs:
  - the IAM-registered BFF client;
  - the Hydra login/consent provider;
  - CP's buyer issuer and introspection configuration;
  - the scope allocated in the Shared workload registry.
