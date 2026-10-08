# ADR-0028 — Workload-Attested Tenant Verification for B2B Organisation Context

**Status:** Accepted
**Date:** 2026-09-18
**Decision Owners:** NABHOLD / Baobab Platform Architecture
**Primary Repository:** `nabhold/baobab-trade`
**Canonical Identity Authority:** `nabhold/baobab-cp`
**IAM Authority:** `nabhold/baobab-iam` / Keycloak
**Reference Tenant:** ZuriBeans

## Related Decisions

- ADR-BCP-016 — Buyer Organisation Canonical Entity Registration and OrganisationID Context Resolution (`nabhold/baobab-cp`)
- ADR-0017 — Customer, B2B Organisation, Buyer Identity and Authorization Model
- Gate ZB-03.3 (this repo) — Buyer IAM → CP → Trade integration (`src/api/store/b2b/context/route.ts`, `src/baobab/b2b/context-resolver.ts`)
- `nabhold/baobab-cp/docs/reconciliation/gate-zb03-authority-contract-freeze.md` — names this gap (ZB-03.6) as an open item

## 1. Context

`b2b_organisation.tenant_id` (`src/modules/b2b/models/b2b-organisation.ts:8`) is written once, by an
admin operator, when a Trade B2B organisation row is created. Gate ZB-03.3 (ADR-0017,
`src/api/store/b2b/context/route.ts`) already requires every request to `GET /store/b2b/context` to
supply a CP-verified `canonical_organisation_id` and resolves the Trade-local organisation row from
it — but nothing in that flow checks that `tenant_id` on the resolved row is the tenant baobab-cp's
own canonical registry actually associates with that organisation. `tenant_id` is Trade-local data,
never independently attested by the Control Plane at read time. A misconfigured or stale
`tenant_id` on that row is not detected by Gate ZB-03.3 alone.

baobab-cp already exposes `POST /v1/platform-context/resolve`
(`nabhold/baobab-cp/api/platform_context_handler.go`), which resolves a `{tenant_id,
organisation_id}` pair and echoes the canonical `tenant_id` CP has on file. baobab-iam already
provisions a `baobab-trade-workload` Keycloak service-account client with the `context:resolve`
scope (`nabhold/baobab-iam/config/clients/baobab-trade-workload.json`), but until this slice no code
in `nabhold/baobab-trade` ever requested a token for it or called that endpoint.

No `nabhold/shared`-published JSON Schema exists yet for `/v1/platform-context/resolve`'s response
(checked against `contracts.lock.yaml`'s pinned commit: only `development_environment`, `tenancy`,
`legal_entity_registry`, `control_plane_domain`, `context_resolution`, `market_registry` and
`canonical_mapping` are published). This ADR's contract type
(`src/baobab/contracts/platform-context.ts`) is therefore maintained directly against baobab-cp's Go
struct until a shared schema is published, mirroring how `tenant-context.ts` was built before
`context_resolution` was published.

## 2. Decision

Add an **opt-in** tenant-attestation check to `GET /store/b2b/context`:

1. A new OAuth2 client-credentials token provider (`ClientCredentialsWorkloadTokenProvider`,
   `src/baobab/control-plane/workload-token.ts`) authenticates as the `baobab-trade-workload`
   workload identity.
2. A new `ControlPlaneClient.resolvePlatformContext` method
   (`src/baobab/control-plane/client.ts`) calls `POST /v1/platform-context/resolve` with the
   workload token, never a buyer's own token — this is a machine-to-machine assertion, not a
   user-scoped one.
3. `ControlPlaneWorkloadTenantVerifier` (`src/baobab/control-plane/workload-tenant-verifier.ts`)
   combines the two and, critically, does **not** trust a bare `200 OK` from CP: it checks the
   `tenant_id` CP echoes back equals the `tenant_id` being asserted. A `200` that resolves _some_
   context for the organisation without confirming the same tenant is treated as a failure
   (`TenantAttestationError`), following the same fail-closed pattern already used in
   `resolveMapping`'s canonical-entity-ID echo check (`src/baobab/control-plane/client.ts`).
4. `getWorkloadTenantVerifier()` returns `null` — and the route skips the check entirely, preserving
   exact pre-ZB-03.6 behaviour — unless `BAOBAB_CONTROL_PLANE_BASE_URL`,
   `BAOBAB_IAM_WORKLOAD_TOKEN_URL` and `BAOBAB_IAM_WORKLOAD_CLIENT_SECRET` are all configured.

## 3. Why opt-in rather than `requiredInProduction`

Every other Control Plane credential this repo's `environment.ts` treats as `requiredInProduction`
(`controlPlaneBaseUrl`, `webhookSigningSecret`) backs a flow this repo already depends on in
production. The workload-credentials flow this ADR adds is the **first** consumer in this repo of
the `baobab-trade-workload` client; there is no live baobab-iam + baobab-cp deployment available in
this development environment to prove the full round trip end-to-end (token issuance, scope
enforcement, CP's own verification stage). Forcing this on in every production deployment before
that integration is proven would risk taking `GET /store/b2b/context` down entirely on a
misconfigured or unreachable workload credential, for a check that is additive defense-in-depth, not
a replacement for Gate ZB-03.3's existing canonical-organisation verification. The existing
ZuriBeans OIDC and admin OIDC providers (`src/baobab/auth/providers.ts`) already establish the
precedent of "disabled unless explicitly configured" for exactly this reason.

This is a deliberate, revisitable choice: once a live integration proves the flow, a follow-up ADR
can promote this to `requiredInProduction`.

## 4. Consequences

- Every `GET /store/b2b/context` call now optionally performs one additional outbound HTTP call
  (workload token, cached until ~30s before its stated expiry) plus one Control Plane call (never
  cached — see `resolvePlatformContext`'s docstring: this exists specifically to attest a pair at
  read time, so serving a cached attestation for a different call would defeat its purpose).
- A `tenant_id` mismatch, an unreachable Control Plane, or an unreachable IAM token endpoint all
  reject the request with `403 FORBIDDEN` when the verifier is configured — fail closed, consistent
  with `contracts.lock.yaml`'s `fail_on_unresolved_tenant_context` principle already applied to
  `resolveContext`.
- This does **not** retroactively prove that `tenant_id` was correct at the time the
  `b2b_organisation` row was created — only that it is CP-attested as of this read. Historical writes
  are unaffected.
- Full proof of this flow (successful token issuance, CP's `platform-context/resolve`
  verification stage, and negative-path testing against a live baobab-iam + baobab-cp deployment)
  is out of scope for this slice and remains open for the ZB-03.10 cross-repository isolation
  certification suite.

## 5. Alternatives Considered

- **Verify at organisation-creation time only, not at read time.** Rejected: a canonical link or
  tenant reassignment in baobab-cp after Trade's row was created would go undetected until the next
  admin write, defeating the purpose of an authoritative-context check on every read.
- **Reuse the buyer's own access token instead of a workload identity.** Rejected: the buyer's token
  proves who the buyer is, not that CP independently agrees which tenant the _organisation_ belongs
  to — this is a system-to-system assertion, not something a buyer's own credential is scoped to
  make, hence the previously-unused `context:resolve`-scoped workload client.
- **`requiredInProduction` from the outset.** Rejected per Section 3.
