# ADR-0026 implementation audit — 9 November 2026

**Governing status:** ADR-0026 currently reads Proposed — Normative Trade Architecture. This draft does not declare it Accepted.

## Audited gap

Existing cross-border transaction metadata modeled the commercial Incoterm as an unversioned code, omitted CPT, CIP and FAS from its type, and did not validate the runtime code against the full Incoterms 2020 list. It lacked a structured named place, durable versioned rule reference, independently sourced risk milestone and separation of title, tax and payment policies. An unversioned CIF or FOB string is insufficient for binding commercial terms.

## Bounded corrective implementation

- Recognises and validates all 11 Incoterms 2020 codes in the legacy cross-border metadata boundary without deriving customs or title authority from that code.
- New internal IncotermAgreement captures rule version, structured canonical named place, transport mode, rule provider and independently versioned title, payment and tax references. Rejects invalid/unversioned terms, blank named places and maritime-only rules applied to road/air/multimodal movements.
- A fingerprinted in-memory snapshot protects the agreed commercial reference against silent reinterpretation.
- Risk milestone evaluation requires exact tenant/transaction/shipment, actual carrier evidence, named milestone and rule version; planned/future/foreign events fail closed. Its result explicitly DOES NOT transfer title.
- Adversarial unit tests address malformed rules, modes, dates, title separation and foreign events.

## Held — not complete ADR implementation

No authoritative delivery-policy resolver or licenced rules dataset is integrated. No CP/IAM signed event provider, risk/title projection persistence, inventory/ERP ownership reconciliation, cost responsibility allocation, contract override/approval, Incoterm edition renewal, amendment/supersession chain, real shipment/insurance documentation, tax or legal advice, event replay and connected UG→ZA/ZA→UG negative certification exist in this increment. Actual contract and legal interpretation remains outside this source-level guard.

## Validation

    npx vitest run tests/adr-0026-incoterm-agreement.test.ts
    npm run typecheck
    npm run format:check

Draft until independent conformance. No merge on isolated tests.
