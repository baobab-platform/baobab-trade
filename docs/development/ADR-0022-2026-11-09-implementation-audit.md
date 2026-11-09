# ADR-0022 implementation audit — 9 November 2026

Governing decision: accepted ADR-0022 — Shipping, Logistics, Freight and Transport Provider Abstraction; ADR-0016 remains the commerce fulfilment authority.

## Audited gap

The existing fulfilment bridge stores provider/shipment details around a single commercial fulfilment. It does not define a canonical multi-leg, multi-provider plan, or ensure a booking confirmation belongs to the exact tenant, shipment, leg, current plan revision, CP provider binding and original quote/idempotency intent.

## Implementation

- Introduced a distinct bounded ShipmentLogisticsPlan with an ordered series of transport legs, each with its own mode, carrier/forwarder/3PL role and provider binding.
- Validates non-empty, unique, connected and temporally consistent legs, complete route and explicit UTC schedules.
- Introduced a provider-booking evidence adoption boundary that verifies exact tenant/shipment/leg/provider-binding/quote/idempotency/plan-revision identity.
- Accepts only CONFIRMED native booking evidence with provider, booking and evidence references observed after the plan was created.
- Requires exact original native booking identity for idempotent replay; UNKNOWN/PENDING/REJECTED cannot become a booked shipment.
- Adversarial tests cover foreign provider adoption, cross-tenant replay, leg gaps, duplicate legs and unknown responses.

This is an internal provider-neutral guard, not a live TMS, carrier API, booking orchestration service or transport contract. Provider binding metadata is not proof that CP has authorised it; callers must obtain independently attested current CP and IAM authority.

## Remaining / HELD

- Shared canonical shipment/transport/booking schemas, CP binding and market/transport authority.
- Provider adapters for a genuine carrier/forwarder/warehouse sandbox and booking readback, idempotent durable inbox/outbox and compensations.
- Shipment allocation, TMS capacity, partial shipments and consolidation, documentary custody, customs release, commercial responsibility and Incoterm risk allocation.
- Signed real tracking/POD and ERP freight-cost reconciliation.
- Connected UG→ZA and ZA→UG execution evidence, negatives, replay and exported traces.
- Integration with native Medusa fulfilment and Thamani TMS is not yet wired. No provider success may be inferred from these source-only tests.

## Validation

    npx vitest run tests/adr-0022-logistics-plan-guard.test.ts
    npm run typecheck
    npm run format:check

Draft until independent connected qualification. No merge authority implied.
