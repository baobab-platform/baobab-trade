# ADR-0021 implementation audit — 9 November 2026

Governing decision: accepted ADR-0021 — Customs, Trade Compliance and Regulatory Provider Architecture.

## Confirmed implementation gap

On current main, ProjectedTradeComplianceAdapter evaluates a static/projection TradeLanePolicy and a boolean product classification verification. For the bundled ZuriBeans lane the source is explicitly GATE11_CONFIGURATION_NOT_CUSTOMS_AUTHORITY, but the adapter still returned APPROVED when configuration and product HS references matched. It could therefore be confused with a customs, sanctions, licensing, origin or import/export provider decision.

## Implemented security tranche

- Configured policy + classification verification now returns REVIEW_REQUIRED with REGULATORY_PROVIDER_DECISION_REQUIRED, rather than presenting a complete cross-border clearance. The other review reasons remain intact.
- Introduced internal assertRegulatoryExecutionClearance with independent required-checks and corresponding fresh provider evidence, exact tenant/transaction/seller/buyer/countries/Market/product scope, CP binding and provider references, rule version and distinct decision receipts.
- A mandatory missing, duplicate, stale, foreign, errored, conditional or blocked check refuses execution. PASS_WITH_CONDITIONS remains held until a qualified conditions evaluator exists.
- New adversarial source tests and updated projected-adapter regression.

This pure gate MUST consume a trusted CP-registry/IAM-attested provider adapter. It is not a regulatory rules engine, a verified regulatory source or a customs declaration provider. A caller-supplied field named providerId or status=PASS is never evidence of genuine authority.

## HELD — conformance not completed

- No actual CP provider-binding readback, IAM workload trust and mandatory requirements resolution, nor vetted external customs/compliance sandbox.
- No versioned jurisdiction-pack authoritativeness, bitemporal as-of-effective/as-of-known evaluator, restricted-party screening, tariff/origin, documentary evidence custody or live customs declaration.
- No Medusa checkout/shipping commit wiring, broker replay, independently exported trace and UG/ZA cross-border negative matrix.
- No production release approval. Keep this implementation draft; do not merge on mock-only checks.

## Validation

    npx vitest run tests/adr-0021-regulatory-evidence-gate.test.ts tests/trade-compliance-port.test.ts
    npm run typecheck
    npm run format:check

ADR-0022 logistics orchestration remains separately owned. ADR-0020 price cost calculations do not determine customs legality.


## 27 November 2026 follow-up

- Regulatory execution context now distinguishes shipment origin, customs origin and country of production, and binds tenant, transaction, seller LegalEntity, buyer organisation/LegalEntity, Market ID/revision, Trade Lane, Incoterm, product and versioned classification evidence.
- The required-check set now carries the exact CP-resolved provider ID, binding reference, provider version, binding version and matching transaction context. Evidence must match that binding and context exactly; the evidence set must cover each required check once, with unique decision/evidence references and a current PASS decision.
- PASS_WITH_CONDITIONS, REVIEW_REQUIRED, BLOCKED, EXPIRED, ERROR, PENDING, NOT_EVALUATED and NO_PROVIDER cannot clear execution. Product-classification and origin checks require their respective versioned evidence inputs.
- The projected trade-compliance adapter now reports NO_PROVIDER when no regulatory provider decision exists; local Incoterm/UOM/classification issues remain REVIEW_REQUIRED. It never returns APPROVED/PASS.
- **Authority limitations remain:** the gate checks caller-supplied CP binding and provider evidence consistency; it does not authenticate CP/provider signatures or retrieve authoritative decisions. The existing trade-lane projection still carries Digital Estate scope and is not CP authority. No connected regulatory provider, sanctions screening, customs declaration, licence verification, duty/valuation decision, immutable evidence store or PostgreSQL 17 qualification is established.
