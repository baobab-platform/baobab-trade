# ADR 0004: Consume Canonical Contracts From Nabhold Shared

## Status

Accepted

## Decision

Baobab Trade pins the reviewed `nabhold/shared` commit and canonical contract paths in `contracts.lock.yaml`. Local TypeScript shapes are explicitly compatibility adapters, not canonical definitions.

The current `@nabhold/contracts-ts` package contains only placeholder health contracts. Trade therefore will not add a misleading package dependency until tenancy, legal-entity and event artefacts are actually published.

## Consequences

- Contract provenance is reviewable and deterministic.
- Shared remains the governance authority.
- CI can later replace adapters with generated types without changing domain ownership.
- Event-envelope publication in Shared remains an identified dependency.

## Implementation follow-up (2026-10-13)

The canonical repository is now `baobab-platform/shared`. P0-04A pins its reviewed commit in `contracts.lock.yaml` and generates a byte-identical static authority schema bundle and provenance manifest. Runtime validates consequential wire facts before independent scope/freshness checks. Local TypeScript shapes remain compatibility projections; schema validity grants no authority. See [the convergence plan](../plans/P0-04A-trade-contract-convergence.md) for maintenance and acceptance limits. This note records implementation progress without rewriting the original accepted decision.
