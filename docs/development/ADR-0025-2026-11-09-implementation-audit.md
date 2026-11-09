# ADR-0025 implementation audit — 9 November 2026

**Status of ADR-0025 in source:** Proposed — Normative Trade Architecture. This draft does not change its status.

## Gap and change

Trade has a CP negative-only documentary restriction veto, but that does not verify possession, provenance, authenticity, authority, current evidence or immutable content for transaction-required documents. A file upload must not become a legal document approval.

Added an internal, provider-neutral required-document release gate with tenant/LegalEntity/transaction binding, explicit document type and issuer-system authority, distinct canonical and external IDs, immutable positive version, storage reference, SHA-256-shaped content digest, independently verified custody receipt, issuer, issued/expiry dates and verified/issued status. Missing/duplicate, wrong issuer, expired/revoked/superseded, unverified, cross-tenant and reused custody proofs are denied. Regressions cover these refusals.

The checksum is syntactically validated here; this pure function DOES NOT compute or verify the actual object bytes. The trusted storage/document verifier must do that independently before issuing the custody verification receipt.

## HELD

No Shared canonical document aggregate, CMS/object storage adapters, malware/quarantine, signature verifier, legal-hold/retention controls, versioned append-only persistence, signed government certificates, real customs and ERP documentary provider, CP/IAM access to binary content, transaction settlement/readiness gate integration or connected UG/ZA execution proofs. This is a source-side safety building block, not an issued-document engine or full ADR acceptance.

Validation:

    npx vitest run tests/adr-0025-document-evidence-custody.test.ts
    npm run typecheck
    npm run format:check

Draft; no merge while custody/provider and documentary release authority remain unqualified.
