# P0-04A: Trade native contract convergence

## Scope and sequence

Audited on 2026-10-13 against CP `88b896d6a73607882e9dc4bff4745142b13a5e3f`, Shared `a9c53087d63caa356edf54ec8037ba1713c4827f`, IAM `ad7989ca085831303c265f943ef2b97735f911ad`, and Trade main `5d85b6c8c5d8966d0247318bf68321a06977f27f` (after reviewed dependency merges). Branches and open PRs were inspected before implementation.

The owning programme plan is CP's `docs/reconciliation/adr026-027-completion-plan-2026-10-12.md`. P0-03 precedes this work: CP already has the founding-record, independent-control and scoped-mandate workflows. Documentary CIPC references for Nabhold and Thamani are declared references, not independently accepted CP verification. No authorised human decisions, independent control evidence or protected live runtime were supplied for acceptance. No incorporation, mandate, sponsorship or verification fact is fabricated here. ZuriBeans and Equator remain operating-business records.

The programme permits independent consumer work while genuine P0-03 inputs remain pending. This PR completes the Trade code slice of P0-04A. ERP follows, then Payments, Subscriptions and Trade Docs contract locks. P0-04B live native issuance, revocation and execution acceptance remains separate.

## Decisions consulted

Trade ADRs 0002, 0004 and 0010, CP ADR-BCP-026/027, and Shared ADR-SHARED-014/018 govern ownership, stored context redemption and the separation of tenant, market, legal actor and consequential activity. Schema compilation and format validation follow primary [Ajv schema-management documentation](https://ajv.js.org/guide/managing-schemas.html) and [format documentation](https://ajv.js.org/guide/formats.html).

The reviewed pin advances from `6899a2d8f143bf23d36c4f4ac904e0a1e10c3cea` to Shared `a9c53087d63caa356edf54ec8037ba1713c4827f`. Legal-actor assessment, documentary restriction, merchant readiness, their reference closure and the scope registry are now explicitly declared consumers.

| Existing declaration changed at the new pin     | Compatibility consequence                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `control-plane/v1/external-systems.yaml`        | Preserve registered native system/engine mapping ownership.                   |
| `control-plane/v1/openapi.yaml`                 | New private assessment interfaces remain workload authenticated.              |
| `control-plane/v1/platform-context.schema.json` | Closed current context schema; country, market and currency tuple validation. |
| `events/v1/context-registry.yaml`               | Consume reviewed context registry; no local authority inference.              |
| `events/v1/event-registry.yaml`                 | Preserve canonical registered event ownership.                                |
| `identity/v1/workload-registry.yaml`            | Assessment workload is PROVISIONED, not live admission.                       |
| `legal-entity/registry.yaml`                    | Declared corporate records do not become accepted verification.               |
| `tenancy/tenancy.yaml`                          | Generated provenance now reports pinned schema version 2.0.                   |

## Reproducible maintenance

```bash
# Shared must be checked out at the exact contracts.lock.yaml source.commit.
BAOBAB_SHARED_PATH=../shared npm run contracts:sync
BAOBAB_SHARED_PATH=../shared npm run test:shared-conformance
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

The generator reads immutable Git blobs, rejects remote schema references and undeclared closure paths, replaces the previous generated closure only after validation (removing obsolete schema files), and commits the complete static schema bundle with per-file SHA-256 provenance. Regenerate, review compatibility and include generated artifacts in the same PR when changing the pin. The conformance suite checks byte identity against the owner checkout and verifies hashes, declarations and the complete directory inventory. Upstream schema JSON alone is excluded from Prettier to preserve exact upstream bytes; it remains parsed and validated by conformance.

Ajv 2020 and ajv-formats are production dependencies. Runtime compiles validators once from static imports, without network schema loading, coercion, defaults or property removal. The Medusa build copies the imported JSON into `.medusa/server/src/baobab/contracts/shared`; the postbuild step copies original schema bytes over TypeScript's reformatted JSON, verifies hashes and loads all compiled validators. The audited legacy `dist` output did not match Docker's `.medusa` copy. TypeScript now emits to the [documented standalone server directory](https://docs.medusajs.com/learn/build), and Docker copies that directory into its application root. An image-build smoke check loads the validators using only production dependencies.

## Runtime boundaries

| Boundary                | Contract enforcement                                                                                        | Independent runtime requirement                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Legal-actor assessment  | Exact request/response schema, finite canonical outcomes, UUID/date/reference limits, no extra grant fields | Current context/operation, exact actor and mandate, bounded freshness before native mutation |
| Documentary restriction | Exact request/response schema, unknown authority fields denied                                              | Exact scope, fresh negative-only veto with `authority_granted: false`                        |
| Merchant readiness      | Published request/ready-response schema, no extra fields                                                    | Exact seller/context/operation, provider references and bounded freshness                    |
| Platform context        | Closed pinned schema and market tuple                                                                       | Existing lifecycle, product and organisation pairing checks                                  |

HTTP assessment adapters refuse redirects and use `no-store`. Injected assessment ports are checked again at the consequential boundary. Valid schemas do not grant authority or turn synthetic fixtures into deployment evidence.

The pinned `baobab-trade-legal-actor-assessor-staging` workload is PROVISIONED, permits RUNTIME context resolution and legal-actor assessment, and lacks `documentary:restriction-assess`. The ACTIVE production workload lacks both private assessment scopes. Documentary activation and existing mapping/market scope gaps require separately reviewed Shared/IAM/CP admission work; this consumer does not grant missing scopes or activate identities.

## Open PR audit

| PR                                                                  | Disposition                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #140 pg 8.23.1; #143 ajv-formats 3.0.1                              | Reviewed, final-head checks green, no unresolved review threads; merged before this slice.                                                                                                            |
| #135 setup-node; #136 Foundation; #137 CodeQL; #138 upload-artifact | GitHub reported non-mergeable heads against current main. Refresh independently; #135 must not resurrect the removed formatter workflow. Historical green checks do not authorise a conflicted merge. |
| #139 TypeScript 7; #142 eslint plugin                               | Failing Foundation/container/verify/native/conformance checks; remain open pending independent fixes and final-head validation.                                                                       |
| #141 Node 26 types; #144 Node 26 image                              | Incompatible with repository Node `>=24 <25` policy; require a reviewed runtime upgrade rather than an isolated dependency merge.                                                                     |

No CI waiver or exception extension was added. Remaining dependency PRs are tracked independently from contract convergence.

## Validation and acceptance limits

Local verification: 459 tests across 88 files, 88 pinned conformance tests across six files, typecheck, lint and Medusa backend/frontend build passed. Tests cover malformed dates/UUIDs, missing and wrongly typed required fields, unknown outcomes/grants, scope echo mismatches, authenticated request shapes, and byte/hash provenance. Fixtures are synthetic. Hosted final-head CI additionally runs native PostgreSQL/Redis, container, security and readiness gates; merge requires every applicable check to pass.

This code convergence does not certify P0-03, provider readiness, workload admission, native live execution or the other consumers. Next owning engine: ERP, with its own audit, reviewed pin, conformance and PR.
