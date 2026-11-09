# ADR-0030 implementation audit — 9 November 2026

**Governance:** Two distinct Accepted files share number ADR-0030:
- Gate ZB-06 Product Trade Profile and Market Assortment Boundary;
- Buyer KYB Evidence and Verification Gate (ZB-04).

They are not alternatives; renumber or cross-reference only through explicit ADR governance. This PR addresses a confirmed ZB-04 KYB readiness gap without modifying open ADR-0011 PR #204 or ADR-0024 PR #217, which own overlapping assortment work.

## Corrective implementation

assertVerifiedBuyerKybPackage previously treated any VERIFIED item whose expiry was absent/not passed as sufficient, including a future-issued certificate or an item lacking canonical document content identity. It now requires that a verified item have a nonblank canonical document ID, version, SHA-256-shaped checksum and non-future issuance when supplied. Expiry dates must be valid and unexpired. New regression covers future-issued, corrupted-hash and complete verified package behavior.

## Qualification limitations

This is validation of persisted Trade references, not independent checksum-over-bytes verification, signed source provenance, canonical CMS/document registry reconciliation, malicious-file scanning or bank document verification. CP KYB identity admission, ERP buyer activation, reviewer SoD and execution events remain separately governed. Gate ZB-06 product and assortment authority is not modified.

Validation:

    npx vitest run tests/buyer-kyb-evidence.test.ts
    npm run typecheck
    npm run format:check

Draft, held pending direct source and connected verification.
