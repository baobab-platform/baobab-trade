# ADR-0025 implementation audit — 9 November 2026

**Architecture status:** Accepted by Platform Owner directive, 9 November 2026, under higher accepted Shared/CP/IAM decisions. The implementation remains a draft and its outstanding runtime qualification gates are HELD; architecture acceptance is not production certification.

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


## 27 November 2026 follow-up

- Mandatory-document requirements now arrive through a versioned, effective-dated policy bound to tenant, legal entity/role, transaction, Market ID/revision and optional shipment/Trade Lane/product scope.
- Each requirement explicitly constrains accepted source systems and issuer authorities, with optional exact issuer-reference allowlists. The package must cover the required set exactly; missing, duplicate and extra document types are refused.
- Evidence must preserve canonical and source document identities, version, issuer authority/reference, issue/effective dates, content reference/checksum, custody-verification reference, ISSUED status and VERIFIED state. Expiry is optional for non-expiring documents; where supplied, it is enforced.
- The result preserves the requirement-policy reference/version and each accepted document's canonical/source identity, version, issuer, content checksum and custody reference.
- **Connected custody remains outstanding:** the gate does not retrieve bytes, recompute checksums, authenticate signatures, validate the custody provider, verify issuer authority against external registries, persist canonical documents/versions/relationships, enforce retention/legal hold, or prove tenant/legal-entity access controls. The policy is caller-supplied and not authenticated. No PostgreSQL 17/object-storage connected acceptance is established.
